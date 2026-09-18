import Database from 'better-sqlite3';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';

if (existsSync('.env')) loadEnvFile('.env');
const source = resolve(process.env.DATABASE_PATH ?? 'data/liga.db');
const target = resolve(process.argv[2] ?? `backups/turso-${Date.now()}.db`);
if (source === target || existsSync(target)) throw new Error('Escolha um arquivo de destino novo para preservar os dados.');
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  // SQLite backup includes committed WAL data; copying just liga.db may lose it.
  await db.backup(target);
  chmodSync(target, 0o600);
  console.log(`Cópia consistente criada: ${target}`);
} finally { db.close(); }
