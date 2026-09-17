import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 2) { db.close(); throw new Error('Versão do banco não suportada.'); }
  if (version === 0) db.transaction(() => {
    db.exec(`
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
  })();
  if (version < 2) db.transaction(() => {
    db.exec(`CREATE TABLE sessao (token_hash TEXT PRIMARY KEY, expira_em INTEGER NOT NULL, credencial TEXT NOT NULL);
      PRAGMA user_version = 2;`);
  })();
  return db;
}
