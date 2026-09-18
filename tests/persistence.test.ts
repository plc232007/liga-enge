import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { databaseTarget, openDatabase } from '../src/server/database.js';
import { createApp } from '../src/server/app.js';
import { hashPassword } from '../src/server/auth.js';
import { Store } from '../src/v2/store.js';
import { users } from '../src/v2/auth.js';

test('Vercel exige banco remoto e token, sem fallback para arquivo efêmero', () => {
  assert.throws(() => databaseTarget({ VERCEL: '1' }), /TURSO_DATABASE_URL/);
  assert.throws(() => databaseTarget({ VERCEL: '1', TURSO_DATABASE_URL: 'file:/tmp/db', TURSO_AUTH_TOKEN: 'token' }), /libsql/);
  assert.throws(() => databaseTarget({ TURSO_DATABASE_URL: 'libsql://example.turso.io' }), /TURSO_AUTH_TOKEN/);
  assert.deepEqual(databaseTarget({ VERCEL: '1', TURSO_DATABASE_URL: 'libsql://example.turso.io', TURSO_AUTH_TOKEN: 'token' }), { url: 'libsql://example.turso.io', authToken: 'token' });
});

test('dados e sessão sobrevivem à recriação da API e conexão', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'liga-persist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite');
  const config = { username: 'admin', passwordHash: await hashPassword('teste-persistencia'), secure: false, origin: 'http://localhost' };
  const first = await openDatabase(file);
  let cookie: string[];
  try {
    const app = await createApp(first, config);
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'teste-persistencia' }).expect(200);
    cookie = login.headers['set-cookie'] as unknown as string[];
    const store = new Store(first);
    await store.put('notice', { id: 'persistente', userId: (await users(store))[0].id, message: 'Gravado', read: false });
  } finally { first.close(); }
  const second = await openDatabase(file);
  try {
    const app = await createApp(second, config);
    const response = await request(app).get('/api/bootstrap').set('Cookie', cookie!).expect(200);
    assert.equal(response.body.notices[0].message, 'Gravado');
    assert.equal((await users(new Store(second))).length, 1);
  } finally { second.close(); }
});

test('requisições concorrentes não entram na transação de outra requisição', async t => {
  const db = await openDatabase(':memory:');
  t.after(() => db.close());
  await db.exec('CREATE TABLE counter(id TEXT PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO counter VALUES (\'total\', 0);');
  const increment = () => db.transaction(async () => {
    const value = Number((await db.prepare('SELECT value FROM counter WHERE id=?').get('total'))!.value);
    await new Promise(resolve => setTimeout(resolve, 5));
    await db.prepare('UPDATE counter SET value=? WHERE id=?').run(value + 1, 'total');
  });
  const failed = db.transaction(async () => {
    await db.prepare('UPDATE counter SET value=100 WHERE id=?').run('total');
    await new Promise(resolve => setTimeout(resolve, 5));
    throw new Error('reverter');
  });
  await Promise.all([assert.rejects(failed, /reverter/), increment(), increment(), increment()]);
  assert.equal((await db.prepare('SELECT value FROM counter WHERE id=?').get('total'))!.value, 3);
  await assert.rejects(db.prepare('INSERT INTO partida(jogo,dupla_a1,dupla_a2,dupla_b1,dupla_b2,vencedora,data) VALUES (?,?,?,?,?,?,?)').run('Truco', 1, 2, 3, 4, 'A', '2026-01-01'), /FOREIGN KEY/);
});
