import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { createApp } from '../src/server/app.js';
import { hashPassword } from '../src/server/auth.js';
import { Store } from '../src/v2/store.js';
import { League } from '../src/v2/service.js';
import { users } from '../src/v2/auth.js';
import { defaults, modalities, type User, type Casual, type Entry, type Tournament, type Match, type RawResult, type SnapshotRow } from '../src/v2/model.js';
import { calendar, score, rank, scoreCopa } from '../src/v2/rules.js';
import { engines, grouping, draw } from '../src/v2/engine.js';
const password = 'senha-apenas-para-testes';
const passwordHash = await hashPassword(password);
function fixture(t: {
    after(fn: () => void): void;
}) { const db = openDatabase(':memory:'); t.after(() => db.close()); const app = createApp(db, { username: 'admin', passwordHash, secure: false, origin: 'http://127.0.0.1:5173' }); const store = new Store(db), league = new League(store), admin = users(store)[0]; const players: User[] = []; for (let i = 0; i < 10; i++) {
    const u: User = { id: randomUUID(), nome: `Pessoa ${i}`, username: `pessoa${i}`, email: `pessoa${i}@example.test`, roles: i === 9 ? ['organizador', 'mesario', 'jogador'] : ['jogador'], ativo: true, passwordHash };
    db.prepare('INSERT INTO v2_user VALUES (?,?,?,?,?,?,?)').run(u.id, u.nome, u.username, u.email, JSON.stringify(u.roles), 1, passwordHash);
    players.push(u);
} const season = store.transaction(() => league.createSeason(admin, 2026, structuredClone(defaults))); return { db, app, store, league, admin, players, season }; }
const raw = (a: string, b: string, winner = a): RawResult => ({ tipo: 'NORMAL', ausentes: [], quedas: [{ placar: { [a]: winner === a ? 12 : 4, [b]: winner === b ? 12 : 4 } }] });
function casual(f: ReturnType<typeof fixture>, a: User, b: User) { const hh = f.store.all<{
    id: string;
}>('happyhour')[0]; return f.store.transaction(() => { const c = f.league.createCasual(a, { happyHourId: hh.id, modalityId: 'truco', groups: [[a.id], [b.id]] }); f.league.reportCasual(a, c.id, raw('L1', 'L2')); return c; }); }
test('calendário gera segunda sexta, trimestre e horário local correto inclusive DST histórico', () => { const events = calendar(2026); assert.equal(events.length, 12); assert.equal(events[0].inicio, '2026-01-09T20:00:00.000Z'); assert.equal(events[8].inicio, '2026-09-11T20:00:00.000Z'); assert.equal(calendar(2018)[0].inicio, '2018-01-12T19:00:00.000Z'); });
test('pontos só entram na homologação por outra pessoa; correção estorna sem apagar', t => { const f = fixture(t), a = f.players[0], b = f.players[1]; const c = casual(f, a, b); assert.equal(f.store.points().length, 0); assert.throws(() => f.league.homologateCasual(a, c.id), /próprio/); f.store.transaction(() => f.league.homologateCasual(b, c.id)); assert.deepEqual(f.store.points().map(p => p.points), [10, 2]); assert.throws(() => f.db.prepare('UPDATE v2_points SET points=999').run(), /imutável/); assert.throws(() => f.db.prepare('DELETE FROM v2_points').run(), /imutável/); f.store.transaction(() => f.league.contestCasual(a, c.id, 'Placar digitado ao contrário')); f.store.transaction(() => f.league.correctCasual(f.admin, c.id, raw('L1', 'L2', 'L2'), 'Correção confirmada pelos jogadores')); assert.equal(f.store.points().length, 6); const rows = f.league.rankings(f.season.id, null, 'INDIVIDUAL'); assert.equal(rows[0].id, b.id); assert.equal(rows[0].points, 10); assert.equal(rows[1].points, 2); });
test('piso é contagem trimestral, não pontos; reservas também precisam cumprir', t => { const f = fixture(t), a = f.players[0], b = f.players[1]; for (let i = 0; i < 2; i++) {
    const c = casual(f, a, b);
    f.store.transaction(() => f.league.homologateCasual(b, c.id));
} const quarter = f.season.id + '-Q1'; assert.equal(f.league.eligibility([a.id], quarter).eligible, false); assert.equal(f.league.activity(a.id, quarter).points, 20); const c = casual(f, a, b); f.store.transaction(() => f.league.homologateCasual(b, c.id)); assert.equal(f.league.eligibility([a.id, b.id], quarter).eligible, true); assert.equal(f.league.eligibility([a.id, b.id], quarter).weighted, 6); assert.equal(f.league.eligibility([a.id, b.id, f.players[2].id], quarter).eligible, false); assert.equal(f.league.eligibility([a.id], f.season.id + '-Q2').eligible, false); });
test('coletivo fica fora do individual e conta para frequência trimestral', t => { const f = fixture(t), ps = f.players.slice(0, 4); const hh = f.store.all<{
    id: string;
}>('happyhour')[0]; const c = f.store.transaction(() => f.league.createCasual(ps[0], { happyHourId: hh.id, modalityId: 'duplas', groups: [ps.slice(0, 2).map(p => p.id), ps.slice(2).map(p => p.id)] })); f.store.transaction(() => f.league.reportCasual(ps[0], c.id, raw('L1', 'L2'))); assert.throws(() => f.league.homologateCasual(ps[1], c.id), /adversário/); f.store.transaction(() => f.league.homologateCasual(ps[2], c.id)); assert.equal(f.league.rankings(f.season.id, null, 'INDIVIDUAL').length, 0); assert.equal(f.league.rankings(f.season.id, null, 'COLETIVO').length, 4); assert.equal(f.league.activity(ps[0].id, f.season.id + '-Q1').matches, 1); });
test('Uno menor soma; Paciência conclusão precede tempo; playoff sem conclusão usa fundação', () => { const uno = modalities.find(m => m.id === 'uno')!; const u = score({ tipo: 'NORMAL', ausentes: [], quedas: [{ placar: { a: 0, b: 4, c: 6, d: 9 } }] }, ['a', 'b', 'c', 'd'], uno, defaults, 'seed'); assert.deepEqual(u.order, ['a', 'b', 'c', 'd']); const patience = modalities.find(m => m.id === 'paciencia')!; const r: RawResult = { tipo: 'NORMAL', ausentes: [], quedas: [], paciencia: { a: { concluiu: false, tempo_ms: 100, movimentos: 1, fundacao: 50 }, b: { concluiu: true, tempo_ms: 200, movimentos: 10, fundacao: 52 } } }; assert.equal(score(r, ['a', 'b'], patience, defaults, 's').order[0], 'b'); r.paciencia!.b.concluiu = false; assert.equal(score(r, ['a', 'b'], patience, defaults, 's', 1, true).order[0], 'b'); });
function complete(m: Match, winner = m.participants[0]) { m.status = 'HOMOLOGADO'; m.result = { raw: raw(m.participants[0], m.participants[1] ?? m.participants[0]), order: [winner, ...m.participants.filter(id => id !== winner)], stats: Object.fromEntries(m.participants.map(id => [id, { vitorias: id === winner ? 1 : 0, pro: id === winner ? 12 : 4, contra: id === winner ? 4 : 12 }])) }; }
function play(format: keyof typeof engines, n: number) { const engine = engines[format]; const b = engine.gerar(Array.from({ length: n }, (_, i) => `P${i + 1}`), 'test-seed', defaults); let limit = 2000; while (!b.champion && limit-- > 0) {
    const m = b.matches.find(m => m.participants.length > 1 && !m.resolved && !m.auto);
    assert.ok(m, `Sem partida pronta: ${format}/${n}`);
    complete(m);
    engine.avancar(b, 'test-seed', defaults);
} assert.ok(b.champion, `${format}/${n} não terminou`); return b; }
test('eliminatória simples/dupla com byes para 4 a 33 inscritos termina sem perder participantes', () => { for (let n = 4; n <= 33; n++)
    for (const format of ['SingleElimination', 'DoubleElimination'] as const) {
        const b = play(format, n);
        assert.equal(b.champion, 'P1');
        assert.ok(b.matches.every(m => new Set(m.participants).size === m.participants.length));
    } });
test('chave de oito usa pareamento olímpico', () => { const b = engines.SingleElimination.gerar(['1', '2', '3', '4', '5', '6', '7', '8'], 'seed', defaults); assert.deepEqual(b.matches.slice(0, 4).map(m => m.participants), [['1', '8'], ['4', '5'], ['2', '7'], ['3', '6']]); });
test('repescagem precisa vencer duas séries: bracket reset', () => { const engine = engines.DoubleElimination; const b = engine.gerar(['1', '2', '3', '4'], 'seed', defaults); while (!b.matches.find(m => m.label === 'Grande final')!.participants.length) {
    const m = b.matches.find(m => m.participants.length > 1 && !m.resolved)!;
    complete(m);
    engine.avancar(b, 'seed', defaults);
} const gf = b.matches.find(m => m.label === 'Grande final')!; const challenger = gf.participants[1]; complete(gf, challenger); engine.avancar(b, 'seed', defaults); assert.equal(b.champion, null); const reset = b.matches.find(m => m.label === 'Reset')!; complete(reset, challenger); engine.avancar(b, 'seed', defaults); assert.equal(b.champion, challenger); });
test('corrigir M1 de chave de oito finalizada invalida descendentes e recalcula campeão após re-homologação', () => { const b = play('SingleElimination', 8); assert.equal(b.champion, 'P1'); const affected = engines.SingleElimination.reverter(b, 'M1', 'test-seed', defaults); assert.ok(affected.length >= 3); assert.equal(b.champion, null); assert.equal(b.version, 2); const m = b.matches[0]; complete(m, 'P8'); engines.SingleElimination.avancar(b, 'test-seed', defaults); let limit = 30; while (!b.champion && limit-- > 0) {
    const next = b.matches.find(m => m.participants.length > 1 && !m.resolved)!;
    complete(next, next.participants.includes('P8') ? 'P8' : next.participants[0]);
    engines.SingleElimination.avancar(b, 'test-seed', defaults);
} assert.equal(b.champion, 'P8'); });
test('Uno recursivo, Douradinha, round robin e Paciência geram campeão', () => { for (const n of [4, 5, 6, 8, 12, 18, 24, 48])
    play('TableGroups', n); for (const n of [4, 6, 7, 8, 12, 16])
    play('GroupStage', n); play('RoundRobin', 3); play('TimeAttack', 8); assert.equal(grouping(['1', '2', '3', '4', '5', '6', '7'], 4, 6).cut.length, 1); assert.equal(grouping(['1', '2', '3', '4', '5'], 3, 4).cut.length, 1); });
test('sorteio terminal é determinístico, explicável e independente da ordem de entrada', () => { const rows = ['a', 'b', 'c'].map(id => ({ id, points: 10, wins: 1, balance: 8, casuals: 3, head: {}, draw: '', reason: '' })); assert.deepEqual(rank(rows, 'seed'), rank([...rows].reverse(), 'seed')); assert.match(rank(rows, 'seed')[0].reason, /Sorteio/); assert.notEqual(draw('seed', 'a'), draw('other', 'a')); });
test('API exige sessão e papel; idempotência não duplica; identidade não vem do corpo', async (t) => { const f = fixture(t); await request(f.app).get('/api/bootstrap').expect(401); const api = request.agent(f.app); await api.post('/api/auth/login').send({ username: 'pessoa0', password }).expect(200); await api.post('/api/seasons').set('Idempotency-Key', randomUUID()).send({ ano: 2027, params: defaults }).expect(403); const hh = f.store.all<{
    id: string;
}>('happyhour')[0]; const body = { happyHourId: hh.id, modalityId: 'truco', groups: [[f.players[0].id], [f.players[1].id]] }; const key = randomUUID(); const a = await api.post('/api/casuals').set('Idempotency-Key', key).send(body).expect(201); const b = await api.post('/api/casuals').set('Idempotency-Key', key).send(body).expect(201); assert.equal(a.body.id, b.body.id); assert.equal(f.store.all('casual').length, 1); await api.post('/api/casuals').set('Idempotency-Key', randomUUID()).send({ ...body, usuario_id: f.admin.id }).expect(400); await api.post('/api/casuals').set('Idempotency-Key', randomUUID()).send({ ...body, groups: [[f.players[2].id], [f.players[3].id]] }).expect(403); await api.post('/api/auth/logout').send({}).expect(204); await api.get('/api/bootstrap').expect(401); });
test('conflito na gravação reverte ledger e projeção na mesma transação', t => { const f = fixture(t); const c = casual(f, f.players[0], f.players[1]); f.db.exec(`CREATE TRIGGER falha BEFORE INSERT ON v2_points WHEN NEW.points=2 BEGIN SELECT RAISE(ABORT,'falha'); END;`); assert.throws(() => f.store.transaction(() => f.league.homologateCasual(f.players[1], c.id))); assert.equal(f.store.points().length, 0); assert.equal(f.store.all<Casual>('casual')[0].status, 'REPORTADO'); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM v2_projection').get() && (f.db.prepare('SELECT COUNT(*) n FROM v2_projection').get() as {
    n: number;
}).n, 0); });
test('inscrição recusa piso insuficiente, reserva substitui ausente no check-in e snapshot é congelado', t => {
    const f = fixture(t);
    const current = new Date().toISOString();
    const q = f.store.all<{
        id: string;
        inicio: string;
        fim: string;
    }>('quarter').find(q => current >= q.inicio && current < q.fim)!;
    const h = f.store.all<{
        id: string;
        quarterId: string;
    }>('happyhour').find(h => h.quarterId === q.id)!;
    const tx = (fn: () => unknown) => f.store.transaction(fn);
    const tournament = tx(() => f.league.createTournament(f.admin, { seasonId: f.season.id, quarterId: q.id, modalityId: 'duplas', nome: 'Duplas trimestral', tipo: 'TRIMESTRAL', abertura: new Date(Date.now() - 3600000).toISOString(), fechamento: new Date(Date.now() + 3600000).toISOString(), capacidade: 4, mesarios: [] })) as Tournament;
    assert.throws(() => tx(() => f.league.register(f.players[0], tournament.id, { nome: 'Equipe A', titulares: f.players.slice(0, 2).map(p => p.id), reservas: [f.players[2].id] })), /0\/3/);
    for (let i = 0; i < 3; i++)
        for (const a of f.players.slice(0, 3)) {
            const c = tx(() => f.league.createCasual(a, { happyHourId: h.id, modalityId: 'truco', groups: [[a.id], [f.players[3].id]] })) as Casual;
            tx(() => f.league.reportCasual(a, c.id, raw('L1', 'L2')));
            tx(() => f.league.homologateCasual(f.players[3], c.id));
        }
    const e = tx(() => f.league.register(f.players[0], tournament.id, { nome: 'Equipe A', titulares: f.players.slice(0, 2).map(p => p.id), reservas: [f.players[2].id] })) as Entry;
    const checked = tx(() => f.league.checkin(f.admin, e.id, [f.players[1].id])) as Entry;
    assert.deepEqual(checked.activeMembers, [f.players[0].id, f.players[2].id]);
    assert.equal(checked.status, 'CHECKIN');
    const latest = f.league.need<Tournament>('tournament', tournament.id);
    latest.fechamento = new Date(Date.now() - 1000).toISOString();
    f.store.put('tournament', latest);
    const closed = tx(() => f.league.close(f.admin, latest.id)) as Tournament;
    assert.equal(closed.status, 'CANCELADO');
    assert.ok(closed.snapshot.length);
    const saved = JSON.stringify(closed.snapshot);
    assert.equal(JSON.stringify(f.league.need<Tournament>('tournament', latest.id).snapshot), saved);
    assert.equal(f.store.points('TORNEIO', latest.id).length, 2);
});
test('torneio completo premia uma vez; correção estorna premiação e re-homologação produz novo campeão', t => {
    const f = fixture(t);
    const tournament: Tournament = { id: randomUUID(), seasonId: f.season.id, quarterId: f.season.id + '-Q1', modalityId: 'truco', nome: 'Chave de teste', tipo: 'TRIMESTRAL', status: 'EM_ANDAMENTO', abertura: '2026-01-01T00:00:00.000Z', fechamento: '2026-01-02T00:00:00.000Z', capacidade: 8, seed: 'seed', drawSeed: 'draw', drawModality: null, snapshot: [], bracket: null, versions: [], mesarios: [] };
    const entries = f.players.slice(0, 8).map((u, i): Entry => ({ id: 'E' + i, tournamentId: tournament.id, userId: u.id, teamId: null, members: [u.id], activeMembers: [u.id], playedMembers: [], status: 'CHECKIN', checkinAt: new Date().toISOString(), seed: i + 1, score: 0 }));
    entries.forEach(e => f.store.put('entry', e));
    tournament.bracket = engines.SingleElimination.gerar(entries.map(e => e.id), 'seed', defaults);
    f.store.put('tournament', tournament);
    const run = () => { let count = 100; while (count-- > 0) {
        const latest = f.league.need<Tournament>('tournament', tournament.id);
        if (latest.status === 'FINALIZADO')
            return latest;
        const match = latest.bracket!.matches.find(m => m.participants.length > 1 && !m.resolved && !m.auto)!;
        assert.ok(match);
        const result = raw(match.participants[0], match.participants[1]);
        result.quedas.push(result.quedas[0]);
        f.store.transaction(() => f.league.reportMatch(f.admin, tournament.id, match.id, result));
        f.store.transaction(() => f.league.homologateMatch(f.players[9], tournament.id, match.id));
    } throw new Error('Torneio não terminou'); };
    const finished = run();
    assert.equal(finished.bracket!.champion, 'E0');
    assert.equal(f.store.points('TORNEIO', tournament.id).length, 8);
    assert.equal(f.store.points('TORNEIO', tournament.id).find(p => p.userId === f.players[0].id)!.points, 150);
    f.store.transaction(() => f.league.contestMatch(f.players[9], tournament.id, 'M1', 'Resultado incorreto na abertura'));
    const changed = raw('E0', 'E7', 'E7');
    changed.quedas.push(changed.quedas[0]);
    f.store.transaction(() => f.league.correctMatch(f.players[9], tournament.id, 'M1', changed, 'Placar revisado com evidência'));
    assert.equal(f.store.points('TORNEIO', tournament.id).reduce((sum, p) => sum + p.points, 0), 0);
    const replay = run();
    assert.equal(replay.bracket!.champion, 'E7');
    assert.equal(replay.versions.length, 1);
    assert.equal(f.store.points('TORNEIO', tournament.id).filter(p => p.reversesId).length, 8);
});
test('Copa elimina campeões repetidos e completa oito vagas pelo ranking individual', t => { const f = fixture(t); f.season.campeoes = { 1: f.players[0].id, 2: f.players[0].id, 3: f.players[1].id, 4: f.players[1].id }; f.store.put('season', f.season); for (let i = 0; i < 10; i++)
    f.store.transaction(() => f.store.append({ userId: f.players[i].id, seasonId: f.season.id, quarterId: f.season.id + '-Q1', scope: 'INDIVIDUAL', sourceType: 'CASUAL', sourceId: 'fixture' + i, points: 100 - i, reason: 'Fixture', authorId: f.admin.id, reversesId: null })); const copa = f.store.transaction(() => f.league.copa(f.admin, f.season.id, 'truco', '2027-01-10T20:00:00.000Z')); const entries = f.store.all<Entry>('entry').filter(e => e.tournamentId === copa.id); assert.equal(entries.length, 8); assert.equal(new Set(entries.map(e => e.userId)).size, 8); assert.ok(copa.drawSeed); const drawResult = f.store.transaction(() => f.league.drawCopa(f.admin, copa.id)); assert.ok(drawResult.drawModality); assert.equal(drawResult.drawSeed, copa.drawSeed); });
test('ordem de desempate configurável mantém sorteio terminal obrigatório', () => { const a = { id: 'a', points: 10, wins: 2, balance: 4, casuals: 3, head: {}, draw: '', reason: '' }; const b = { ...a, id: 'b', wins: 1, balance: 20 }; assert.equal(rank([a, b], 'seed')[0].id, 'a'); const changed = rank([a, b], 'seed', ['SALDO', 'VITORIAS', 'CONFRONTO_DIRETO', 'CONSTANCIA']); assert.equal(changed[0].id, 'b'); assert.match(changed[0].reason, /Saldo/); });
test('no-show gera W.O. para confirmação independente e exclui pontos do ausente', t => { const f = fixture(t); f.season.params.piso_partidas_trimestre = 0; f.store.put('season', f.season); const tournament: Tournament = { id: randomUUID(), seasonId: f.season.id, quarterId: f.season.id + '-Q1', modalityId: 'truco', nome: 'No-show', tipo: 'TRIMESTRAL', status: 'INSCRICOES', abertura: '2026-01-01T00:00:00.000Z', fechamento: '2026-01-02T00:00:00.000Z', capacidade: 4, seed: 'seed', drawSeed: 'draw', drawModality: null, snapshot: [], bracket: null, versions: [], mesarios: [] }; f.store.put('tournament', tournament); const entries = f.players.slice(0, 4).map((u, i): Entry => ({ id: 'N' + i, tournamentId: tournament.id, userId: u.id, teamId: null, members: [u.id], activeMembers: [u.id], playedMembers: [], status: i === 3 ? 'AUSENTE' : 'CHECKIN', checkinAt: new Date().toISOString(), seed: i + 1, score: 0 })); entries.forEach(e => f.store.put('entry', e)); const closed = f.store.transaction(() => f.league.close(f.admin, tournament.id)); const wo = closed.bracket!.matches.find(m => m.result?.raw.tipo === 'WO'); assert.ok(wo); assert.equal(wo.status, 'REPORTADO'); assert.throws(() => f.store.transaction(() => f.league.homologateMatch(f.admin, tournament.id, wo.id)), /próprio/); f.store.transaction(() => f.league.homologateMatch(f.players[9], tournament.id, wo.id)); assert.equal(f.store.points('TORNEIO', tournament.id).filter(p => p.userId === f.players[3].id).length, 0); });
test('janela de 48h expirada impede contestação', t => { const f = fixture(t), c = casual(f, f.players[0], f.players[1]); f.store.transaction(() => f.league.homologateCasual(f.players[1], c.id)); const item = f.league.need<Casual>('casual', c.id); item.homologatedAt = new Date(Date.now() - 49 * 3600000).toISOString(); f.store.put('casual', item); assert.throws(() => f.store.transaction(() => f.league.contestCasual(f.players[0], c.id, 'Contestar fora do prazo')), /encerrada/); });
test('Copa usa derrotas nas quartas, confronto direto nas semis e morte súbita na final', () => { const mod = modalities.find(m => m.id === 'truco')!; const result: RawResult = { tipo: 'NORMAL', ausentes: [], quedas: [{ placar: { a: 12, b: 12 } }] }; const rows: SnapshotRow[] = [{ id: 'a', points: 0, wins: -1, balance: 0, casuals: 0, head: { b: 0 }, draw: '', reason: '' }, { id: 'b', points: 0, wins: -3, balance: 0, casuals: 0, head: { a: 2 }, draw: '', reason: '' }]; assert.equal(scoreCopa(result, ['a', 'b'], mod, defaults, 'seed', 1, 'QUARTAS', rows).order[0], 'a'); assert.equal(scoreCopa(result, ['a', 'b'], mod, defaults, 'seed', 1, 'SEMIFINAL', rows).order[0], 'b'); assert.throws(() => scoreCopa(result, ['a', 'b'], mod, defaults, 'seed', 1, 'FINAL', rows), /morte súbita/); assert.equal(scoreCopa({ ...result, morte_subita: { a: 0, b: 1 } }, ['a', 'b'], mod, defaults, 'seed', 1, 'FINAL', rows).order[0], 'b'); });
