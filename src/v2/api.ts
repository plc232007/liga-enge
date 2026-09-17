import express, { type Request, type ErrorRequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { AuthConfig } from '../server/auth.js';
import { Store } from './store.js';
import { League } from './service.js';
import { auth, actor, users, publicUser, hash, rate, requireRoles } from './auth.js';
import { defaults, modalities, type Season, type Quarter, type HappyHour, type Casual, type Tournament, type Entry, type Team, type Notice, type Scope } from './model.js';
import { DomainError, ensure, paramsSchema, rawSchema } from './rules.js';
import { pdf } from './export.js';
const id = z.string().min(1).max(120);
const reason = z.string().trim().min(5).max(500);
const date = z.iso.datetime();
export function createV2App(db: Database.Database, config: AuthConfig) {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '128kb' }));
    app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
    const store = new Store(db);
    const league = new League(store);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: 2 }));
    auth(app, store, config);
    const write = (req: Request, action: () => unknown) => {
        const user = actor(req);
        rate(store, `write:${user.id}`, 60);
        const key = req.header('Idempotency-Key');
        ensure(key && /^[a-zA-Z0-9_-]{8,120}$/.test(key), 'Envie Idempotency-Key (8–120 caracteres).');
        const identity = `${user.id}:${req.method}:${req.path}:${key}`;
        const requestHash = hash(JSON.stringify(req.body));
        return store.transaction(() => {
            const existing = db.prepare('SELECT request_hash,response FROM v2_idempotency WHERE key=?').get(identity) as {
                request_hash: string;
                response: string;
            } | undefined;
            if (existing) {
                ensure(existing.request_hash === requestHash, 'Chave de idempotência reutilizada com conteúdo diferente.', 409);
                return JSON.parse(existing.response);
            }
            const response = action();
            db.prepare('INSERT INTO v2_idempotency VALUES (?,?,?)').run(identity, requestHash, JSON.stringify(response));
            return response;
        });
    };
    app.get('/api/bootstrap', (req, res) => { const user = actor(req); res.json({ user: publicUser(user), users: users(store).map(u => ({ id: u.id, nome: u.nome, ativo: u.ativo, roles: u.roles, ...(user.roles.includes('admin') ? publicUser(u) : {}) })), seasons: store.all<Season>('season'), quarters: store.all<Quarter>('quarter'), happyHours: store.all<HappyHour>('happyhour'), modalities, defaults, casuals: store.all<Casual>('casual'), tournaments: store.all<Tournament>('tournament'), entries: store.all<Entry>('entry'), teams: store.all<Team>('team'), notices: store.all<Notice>('notice').filter(n => n.userId === user.id) }); });
    app.post('/api/seasons', (req, res) => res.status(201).json(write(req, () => { const v = z.object({ ano: z.number().int().min(2000).max(2100), params: paramsSchema.default(defaults) }).strict().parse(req.body); return league.createSeason(actor(req), v.ano, v.params); })));
    app.put('/api/seasons/:id/params', (req, res) => res.json(write(req, () => league.updateParams(actor(req), id.parse(req.params.id), paramsSchema.parse(req.body)))));
    app.get('/api/rankings', (req, res) => { const v = z.object({ seasonId: id, quarterId: id.optional(), scope: z.enum(['INDIVIDUAL', 'COLETIVO']).default('INDIVIDUAL'), casual: z.enum(['true', 'false']).default('false') }).parse(req.query); res.json(league.rankings(v.seasonId, v.quarterId ?? null, v.scope, v.casual === 'true')); });
    app.post('/api/casuals', (req, res) => res.status(201).json(write(req, () => league.createCasual(actor(req), z.object({ happyHourId: id, modalityId: id, groups: z.array(z.array(id).min(1).max(3)).min(1).max(6) }).strict().parse(req.body)))));
    app.post('/api/casuals/:id/report', (req, res) => res.json(write(req, () => league.reportCasual(actor(req), id.parse(req.params.id), rawSchema.parse(req.body)))));
    app.post('/api/casuals/:id/homologate', (req, res) => res.json(write(req, () => { z.object({}).strict().parse(req.body); return league.homologateCasual(actor(req), id.parse(req.params.id)); })));
    app.post('/api/casuals/:id/contest', (req, res) => res.json(write(req, () => league.contestCasual(actor(req), id.parse(req.params.id), z.object({ motivo: reason }).strict().parse(req.body).motivo))));
    app.post('/api/casuals/:id/correct', (req, res) => res.json(write(req, () => { const v = z.object({ resultado: rawSchema, motivo: reason }).strict().parse(req.body); return league.correctCasual(actor(req), id.parse(req.params.id), v.resultado, v.motivo); })));
    app.get('/api/eligibility', (req, res) => { const v = z.object({ quarterId: id, userIds: z.string().optional() }).parse(req.query); res.json(league.eligibility(v.userIds ? v.userIds.split(',') : [actor(req).id], v.quarterId)); });
    app.post('/api/tournaments', (req, res) => res.status(201).json(write(req, () => { const v = z.object({ seasonId: id, quarterId: id, modalityId: id, nome: z.string().trim().min(3).max(100), abertura: date, fechamento: date, capacidade: z.number().int().min(4).max(256).default(64), mesarios: z.array(id).default([]) }).strict().parse(req.body); ensure(v.mesarios.every(id => users(store).some(u => u.id === id && u.ativo && u.roles.includes('mesario'))), 'Mesário inexistente ou sem papel adequado.'); return league.createTournament(actor(req), { ...v, tipo: 'TRIMESTRAL' }); })));
    app.post('/api/tournaments/:id/register', (req, res) => res.status(201).json(write(req, () => league.register(actor(req), id.parse(req.params.id), z.object({ nome: z.string().min(1).max(80).optional(), titulares: z.array(id).max(3).optional(), reservas: z.array(id).max(1).optional() }).strict().parse(req.body)))));
    app.post('/api/entries/:id/checkin', (req, res) => res.json(write(req, () => league.checkin(actor(req), id.parse(req.params.id), z.object({ ausentes: z.array(id).max(4) }).strict().parse(req.body).ausentes))));
    app.post('/api/entries/:id/promote', (req, res) => res.json(write(req, () => league.promote(actor(req), id.parse(req.params.id)))));
    app.post('/api/tournaments/:id/close', (req, res) => res.json(write(req, () => league.close(actor(req), id.parse(req.params.id)))));
    app.post('/api/tournaments/:id/matches/:matchId/start', (req, res) => res.json(write(req, () => { const user = actor(req), t = league.need<Tournament>('tournament', id.parse(req.params.id)); ensure(user.roles.some(r => r === 'admin' || r === 'organizador') || user.roles.includes('mesario') && t.mesarios.includes(user.id), 'Cronômetro exige mesário ou organizador.', 403); const m = t.bracket?.matches.find(m => m.id === req.params.matchId); ensure(m && m.participants.length && !m.resolved && !m.startedAt, 'Partida não disponível para início.'); m.startedAt = new Date().toISOString(); store.put('tournament', t); store.audit('bracket', t.id, 'INICIAR_CRONOMETRO', null, { matchId: m.id, startedAt: m.startedAt }, user.id); return t; })));
    app.post('/api/tournaments/:id/matches/:matchId/call', (req, res) => res.json(write(req, () => { const user = actor(req), t = league.need<Tournament>('tournament', id.parse(req.params.id)); ensure(user.roles.some(r => r === 'admin' || r === 'organizador') || user.roles.includes('mesario') && t.mesarios.includes(user.id), 'Chamada exige mesário designado ou organizador.', 403); const m = t.bracket?.matches.find(m => m.id === req.params.matchId); ensure(m && !m.resolved && m.participants.length, 'Partida indisponível.'); const members = Object.values(league.matchContext(t, m)).flat(); league.notify(members, `Chamada: ${t.nome} · ${m.label} (${m.id}). Compareça à mesa para sua próxima partida.`); store.audit('bracket', t.id, 'CHAMAR_PARTICIPANTES', null, { matchId: m.id, participants: members }, user.id); return { ok: true }; })));
    app.post('/api/tournaments/:id/matches/:matchId/report', (req, res) => res.json(write(req, () => league.reportMatch(actor(req), id.parse(req.params.id), id.parse(req.params.matchId), rawSchema.parse(req.body)))));
    app.post('/api/tournaments/:id/matches/:matchId/homologate', (req, res) => res.json(write(req, () => league.homologateMatch(actor(req), id.parse(req.params.id), id.parse(req.params.matchId)))));
    app.post('/api/tournaments/:id/matches/:matchId/contest', (req, res) => res.json(write(req, () => league.contestMatch(actor(req), id.parse(req.params.id), id.parse(req.params.matchId), z.object({ motivo: reason }).strict().parse(req.body).motivo))));
    app.post('/api/tournaments/:id/matches/:matchId/correct', (req, res) => res.json(write(req, () => { const v = z.object({ resultado: rawSchema, motivo: reason }).strict().parse(req.body); return league.correctMatch(actor(req), id.parse(req.params.id), id.parse(req.params.matchId), v.resultado, v.motivo); })));
    app.post('/api/quarters/:id/champion', (req, res) => res.json(write(req, () => league.crown(actor(req), id.parse(req.params.id)))));
    app.post('/api/seasons/:id/copa', (req, res) => res.status(201).json(write(req, () => { const v = z.object({ modalityId: id, fechamento: date }).strict().parse(req.body); return league.copa(actor(req), id.parse(req.params.id), v.modalityId, v.fechamento); })));
    app.post('/api/seasons/:id/collective-final', (req, res) => res.status(201).json(write(req, () => { const v = z.object({ tipo: z.enum(['FINAL_DUPLAS', 'FINAL_TRIOS']), fechamento: date }).strict().parse(req.body); return league.collectiveFinal(actor(req), id.parse(req.params.id), v.tipo, v.fechamento); })));
    app.post('/api/tournaments/:id/draw', (req, res) => res.json(write(req, () => league.drawCopa(actor(req), id.parse(req.params.id)))));
    app.get('/api/public/tournaments/:id', (req, res) => { const t = league.need<Tournament>('tournament', id.parse(req.params.id)); const entries = store.all<Entry>('entry').filter(e => e.tournamentId === t.id); const names = Object.fromEntries(entries.map(e => [e.id, e.teamId ? league.need<Team>('team', e.teamId).nome : users(store).find(u => u.id === e.userId)?.nome ?? 'Participante'])); res.json({ id: t.id, nome: t.nome, status: t.status, seed: t.seed, drawSeed: t.drawSeed, drawModality: t.drawModality, bracket: t.bracket ? { version: t.bracket.version, champion: t.bracket.champion, matches: t.bracket.matches.map(m => ({ id: m.id, label: m.label, bracket: m.bracket, round: m.round, participants: m.participants, status: m.status, auto: m.auto, bestOf: m.bestOf, deckSeed: m.deckSeed, startedAt: m.startedAt, order: m.result?.order ?? [], sources: m.sources })) } : null, names }); });
    app.get('/api/audit', requireRoles('admin', 'organizador'), (_req, res) => res.json((db.prepare('SELECT data FROM v2_audit ORDER BY rowid DESC LIMIT 300').all() as {
        data: string;
    }[]).map(r => JSON.parse(r.data))));
    app.get('/api/ledger', requireRoles('admin', 'organizador'), (_req, res) => res.json(store.points()));
    app.get('/api/profile/:id', (req, res) => { const user = users(store).find(u => u.id === req.params.id); ensure(user, 'Usuário não encontrado.', 404); res.json({ id: user.id, nome: user.nome, history: store.all<Casual>('casual').filter(c => c.participants.includes(user.id)), points: store.points().filter(p => p.userId === user.id), stats: store.all<Season>('season').map(s => ({ seasonId: s.id, individual: league.rankings(s.id, null, 'INDIVIDUAL').find(r => r.id === user.id), coletivo: league.rankings(s.id, null, 'COLETIVO').find(r => r.id === user.id) })) }); });
    app.post('/api/notices/:id/read', (req, res) => res.json(write(req, () => { const notice = league.need<Notice>('notice', id.parse(req.params.id)); ensure(notice.userId === actor(req).id, 'Notificação de outro usuário.', 403); notice.read = true; store.put('notice', notice); return { ok: true }; })));
    app.get('/api/export/:type', (req, res) => { const v = z.object({ seasonId: id, quarterId: id.optional(), scope: z.enum(['INDIVIDUAL', 'COLETIVO']).default('INDIVIDUAL') }).parse(req.query); const rows = league.rankings(v.seasonId, v.quarterId ?? null, v.scope); const lines = [['Posição', 'Jogador', 'Pontos', 'Vitórias', 'Saldo', 'Partidas casuais', 'Desempate'], ...rows.map((r, i) => [String(i + 1), users(store).find(u => u.id === r.id)?.nome ?? r.id, String(r.points), String(r.wins), String(r.balance), String(r.casuals), r.reason])]; if (req.params.type === 'csv') {
        const safe = (s: string) => `"${(/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
        res.type('text/csv').attachment('ranking.csv').send('\uFEFF' + lines.map(row => row.map(safe).join(';')).join('\r\n'));
    }
    else {
        ensure(req.params.type === 'pdf', 'Formato inválido.');
        res.type('application/pdf').attachment('ranking.pdf').send(pdf(lines));
    } });
    app.get('/api/legacy', requireRoles('admin'), (_req, res) => res.json({ aviso: 'Dados anteriores à v2 sem temporada/escopo/homologação. Preservados para conciliação.', jogadores: db.prepare('SELECT id,nome FROM jogador').all(), partidas: db.prepare('SELECT * FROM partida').all(), lancamentos: db.prepare('SELECT * FROM lancamento').all() }));
    app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
    const errors: ErrorRequestHandler = (error, _req, res, _next) => { if (error instanceof z.ZodError)
        return res.status(400).json({ erro: 'Dados inválidos.', campos: error.issues }); if (error instanceof DomainError)
        return res.status(error.status).json({ erro: error.message }); if (error instanceof SyntaxError)
        return res.status(400).json({ erro: 'JSON inválido.' }); if (error.code?.startsWith('SQLITE_CONSTRAINT'))
        return res.status(409).json({ erro: 'Operação viola a integridade dos dados.' }); console.error('Falha interna', error.name, error.code ?? ''); res.status(500).json({ erro: 'Não foi possível concluir a operação.' }); };
    app.use(errors);
    return app;
}
