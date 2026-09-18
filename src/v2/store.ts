import type { Database } from '../server/libsql.js';
import { randomUUID } from 'node:crypto';
import type { Audit, Transaction } from './model.js';
export type Collection = 'season' | 'quarter' | 'happyhour' | 'casual' | 'team' | 'entry' | 'tournament' | 'notice';
export class Store {
    constructor(public db: Database) { }
    async initialize() {
        await this.db.exec(`
 CREATE TABLE IF NOT EXISTS v2_user(id TEXT PRIMARY KEY,nome TEXT NOT NULL,username TEXT NOT NULL UNIQUE,email TEXT NOT NULL,roles TEXT NOT NULL,ativo INTEGER NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS v2_session(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES v2_user(id),expira_em INTEGER NOT NULL,credencial TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS v2_entity(collection TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(collection,id));
 CREATE INDEX IF NOT EXISTS v2_entity_period ON v2_entity(collection,json_extract(data,'$.quarterId'));
 CREATE INDEX IF NOT EXISTS v2_entry_status ON v2_entity(collection,json_extract(data,'$.tournamentId'),json_extract(data,'$.status'));
 CREATE TABLE IF NOT EXISTS v2_points(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES v2_user(id),season_id TEXT NOT NULL,quarter_id TEXT,scope TEXT NOT NULL CHECK(scope IN ('INDIVIDUAL','COLETIVO')),source_type TEXT NOT NULL,source_id TEXT NOT NULL,points INTEGER NOT NULL,reason TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES v2_user(id),created_at TEXT NOT NULL,reverses_id TEXT UNIQUE REFERENCES v2_points(id));
 CREATE INDEX IF NOT EXISTS v2_points_ranking ON v2_points(user_id,season_id,scope);
 CREATE INDEX IF NOT EXISTS v2_points_source ON v2_points(source_type,source_id);
 CREATE TABLE IF NOT EXISTS v2_projection(user_id TEXT NOT NULL,season_id TEXT NOT NULL,quarter_id TEXT NOT NULL,scope TEXT NOT NULL,source_type TEXT NOT NULL,points INTEGER NOT NULL,PRIMARY KEY(user_id,season_id,quarter_id,scope,source_type));
 CREATE TRIGGER IF NOT EXISTS v2_points_no_update BEFORE UPDATE ON v2_points BEGIN SELECT RAISE(ABORT,'Ledger imutável'); END;
 CREATE TRIGGER IF NOT EXISTS v2_points_no_delete BEFORE DELETE ON v2_points BEGIN SELECT RAISE(ABORT,'Ledger imutável'); END;
 CREATE TABLE IF NOT EXISTS v2_audit(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS v2_audit_no_update BEFORE UPDATE ON v2_audit BEGIN SELECT RAISE(ABORT,'Auditoria imutável'); END;
 CREATE TRIGGER IF NOT EXISTS v2_audit_no_delete BEFORE DELETE ON v2_audit BEGIN SELECT RAISE(ABORT,'Auditoria imutável'); END;
 CREATE TABLE IF NOT EXISTS v2_idempotency(key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,response TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS v2_rate(key TEXT PRIMARY KEY,start INTEGER NOT NULL,count INTEGER NOT NULL);
 `);
    }
    async all<T>(collection: Collection): Promise<T[]> {
        return ((await this.db.prepare('SELECT data FROM v2_entity WHERE collection=? ORDER BY rowid').all(collection)) as {
            data: string;
        }[]).map(r => JSON.parse(r.data));
    }
    async get<T>(collection: Collection, id: string): Promise<T | undefined> {
        const r = (await this.db.prepare('SELECT data FROM v2_entity WHERE collection=? AND id=?').get(collection, id)) as {
            data: string;
        } | undefined;
        return r ? JSON.parse(r.data) : undefined;
    }
    async put<T extends {
        id: string;
    }>(collection: Collection, item: T) { await this.db.prepare('INSERT INTO v2_entity(collection,id,data) VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(collection, item.id, JSON.stringify(item)); return item; }
    async audit(entity: string, entityId: string, action: string, before: unknown, after: unknown, authorId: string) { const item: Audit = { id: randomUUID(), entity, entityId, action, before, after, authorId, createdAt: new Date().toISOString() }; await this.db.prepare('INSERT INTO v2_audit VALUES (?,?)').run(item.id, JSON.stringify(item)); }
    async transaction<T>(fn: () => T | Promise<T>): Promise<T> { return await this.db.transaction(fn); }
    async points(sourceType?: string, sourceId?: string): Promise<Transaction[]> { const where = sourceType ? ' WHERE source_type=? AND source_id=?' : ''; return (await this.db.prepare(`SELECT id,user_id userId,season_id seasonId,quarter_id quarterId,scope,source_type sourceType,source_id sourceId,points,reason,author_id authorId,created_at createdAt,reverses_id reversesId FROM v2_points${where} ORDER BY rowid`).all(...(sourceType ? [sourceType, sourceId ?? null] : []))) as Transaction[]; }
    async append(t: Omit<Transaction, 'id' | 'createdAt'>) {
        const row = { ...t, id: randomUUID(), createdAt: new Date().toISOString() };
        await this.db.prepare('INSERT INTO v2_points VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id, row.userId, row.seasonId, row.quarterId, row.scope, row.sourceType, row.sourceId, row.points, row.reason, row.authorId, row.createdAt, row.reversesId);
        await this.db.prepare('INSERT INTO v2_projection VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,season_id,quarter_id,scope,source_type) DO UPDATE SET points=points+excluded.points').run(row.userId, row.seasonId, row.quarterId ?? '', row.scope, row.sourceType, row.points);
        await this.audit('points', row.id, row.reversesId ? 'ESTORNO' : 'CREDITO', null, row, row.authorId);
        return row;
    }
    async reverse(type: string, id: string, author: string, reason: string) {
        const rows = await this.points(type, id);
        const reversed = new Set(rows.map(r => r.reversesId));
        for (const r of rows)
            if (!r.reversesId && !reversed.has(r.id))
                await this.append({ ...r, points: -r.points, reason, authorId: author, reversesId: r.id });
    }
}
