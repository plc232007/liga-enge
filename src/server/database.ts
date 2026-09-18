import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Database } from './libsql.js';
import { tursoFetch } from './turso-fetch.js';
export async function openDatabase(filename: string, authToken?: string) {
    const remote = /^(libsql|https):\/\//.test(filename);
    if (!remote && filename !== ':memory:')
        mkdirSync(dirname(resolve(filename)), { recursive: true });
    const url = remote || filename === ':memory:' ? filename : pathToFileURL(resolve(filename)).href;
    const db = new Database(createClient({ url, authToken, intMode: 'number', ...(remote ? { fetch: tursoFetch(authToken) } : {}) }));
    try {
        await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        await db.transaction(async () => {
            const version = Number((await db.prepare('PRAGMA user_version').get())?.user_version ?? 0);
            if (version > 2) {
                throw new Error('Versão do banco não suportada.');
            }
            if (version === 0)
                await db.transaction(async () => {
                    await db.exec(`
      CREATE TABLE jogador (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL CHECK(length(nome) BETWEEN 1 AND 60),
        nome_chave TEXT NOT NULL UNIQUE,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE partida (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogo TEXT NOT NULL CHECK(jogo IN ('Truco','Buraco','Uno','Dominó')),
        dupla_a1 INTEGER NOT NULL REFERENCES jogador(id),
        dupla_a2 INTEGER NOT NULL REFERENCES jogador(id),
        dupla_b1 INTEGER NOT NULL REFERENCES jogador(id),
        dupla_b2 INTEGER NOT NULL REFERENCES jogador(id),
        vencedora TEXT NOT NULL CHECK(vencedora IN ('A','B')),
        data TEXT NOT NULL,
        CHECK(dupla_a1 <> dupla_a2 AND dupla_a1 <> dupla_b1 AND dupla_a1 <> dupla_b2
          AND dupla_a2 <> dupla_b1 AND dupla_a2 <> dupla_b2 AND dupla_b1 <> dupla_b2)
      );
      CREATE TABLE lancamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jogador_id INTEGER NOT NULL REFERENCES jogador(id),
        jogo TEXT NOT NULL CHECK(jogo IN ('Truco','Buraco','Uno','Dominó','Paciência')),
        tipo TEXT NOT NULL CHECK(tipo IN ('torneio_campeao','torneio_vice','torneio_terceiro','torneio_part','casual_vitoria','casual_part')),
        pts INTEGER NOT NULL CHECK(pts >= 0),
        categoria TEXT NOT NULL CHECK(categoria IN ('torneio','casual')),
        partida_id INTEGER REFERENCES partida(id) ON DELETE CASCADE,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(partida_id, jogador_id)
      );
      CREATE INDEX lancamento_jogador ON lancamento(jogador_id);
      CREATE INDEX lancamento_jogo ON lancamento(jogo);
      PRAGMA user_version = 1;
    `);
                });
            if (version < 2)
                await db.transaction(async () => {
                    await db.exec(`CREATE TABLE sessao (token_hash TEXT PRIMARY KEY, expira_em INTEGER NOT NULL, credencial TEXT NOT NULL);
      PRAGMA user_version = 2;`);
                });
        });
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
export function databaseTarget(env: NodeJS.ProcessEnv = process.env) {
    const url = env.TURSO_DATABASE_URL;
    if (url) {
        if (!/^(libsql|https):\/\//.test(url) || !env.TURSO_AUTH_TOKEN) {
            throw new Error('Configure TURSO_DATABASE_URL (libsql:// ou https://) e TURSO_AUTH_TOKEN.');
        }
        return { url, authToken: env.TURSO_AUTH_TOKEN };
    }
    if (env.VERCEL)
        throw new Error('Na Vercel, configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN. SQLite local não é persistente.');
    return { url: env.DATABASE_PATH ?? 'data/liga.db', authToken: undefined };
}
