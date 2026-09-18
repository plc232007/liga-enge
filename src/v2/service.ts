import { someAsync, filterAsync, mapAsync, flatMapAsync, everyAsync, forEachAsync } from '../shared/async.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { Store } from './store.js';
import { users, hasRole } from './auth.js';
import { calendar, ensure, localDateTime, rank, score, scoreCopa } from './rules.js';
import { draw, engines, grouping } from './engine.js';
import { modalities, emptyReport, type User, type Season, type Quarter, type HappyHour, type Casual, type Team, type Entry, type Tournament, type Scope, type SnapshotRow, type RawResult, type Match, type Params, type Notice } from './model.js';
export const seed = () => randomBytes(16).toString('hex');
const now = () => new Date().toISOString();
export class League {
    constructor(public store: Store) { }
    async need<T>(collection: Parameters<Store['get']>[0], id: string): Promise<T> { const value = await this.store.get<T>(collection, id); ensure(value, 'Registro não encontrado.', 404); return value; }
    mod(id: string) { const m = modalities.find(x => x.id === id); ensure(m, 'Modalidade inválida.'); return m; }
    organizer(user: User) { ensure(hasRole(user, 'admin', 'organizador'), 'Operação reservada à organização.', 403); }
    async season(id: string) { return await this.need<Season>('season', id); }
    async period(quarterId: string) { const q = await this.need<Quarter>('quarter', quarterId); return { q, s: (await this.season(q.seasonId)) }; }
    async audit(entity: string, id: string, action: string, before: unknown, after: unknown, user: User) { await this.store.audit(entity, id, action, before, after, user.id); }
    async createSeason(user: User, ano: number, params: Params) {
        this.organizer(user);
        ensure(!(await this.store.all<Season>('season')).some(s => s.ano === ano), 'Temporada já cadastrada.', 409);
        const s: Season = { id: randomUUID(), ano, params, versao: 1, status: 'ABERTA', seed: seed(), campeoes: {} };
        await this.store.put('season', s);
        for (let n = 1; n <= 4; n++) {
            const start = 1 + (n - 1) * 3;
            const end = start + 3;
            await this.store.put<Quarter>('quarter', { id: `${s.id}-Q${n}`, seasonId: s.id, numero: n, inicio: localDateTime(ano, start, 1, '00:00'), fim: localDateTime(end > 12 ? ano + 1 : ano, end > 12 ? 1 : end, 1, '00:00') });
        }
        for (const event of calendar(ano, params))
            await this.store.put<HappyHour>('happyhour', { id: randomUUID(), quarterId: `${s.id}-Q${event.quarter}`, inicio: event.inicio, fim: event.fim, status: 'AGENDADO' });
        await this.audit('season', s.id, 'CRIAR', null, s, user);
        return s;
    }
    async updateParams(user: User, id: string, params: Params) {
        this.organizer(user);
        const s = await this.season(id);
        ensure(!(await this.store.points()).some(p => p.seasonId === id) && !(await this.store.all<Tournament>('tournament')).some(t => t.seasonId === id) && !(await someAsync((await this.store.all<Casual>('casual')), async (c) => (await this.period((await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId)).s.id === id)), 'Parâmetros congelados após o início dos registros. Crie outra temporada para mudar regras.');
        const before = structuredClone(s);
        s.params = params;
        s.versao++;
        await this.store.put('season', s);
        const events = calendar(s.ano, params);
        for (const h of (await this.store.all<HappyHour>('happyhour')))
            if (h.quarterId.startsWith(id)) {
                const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(h.inicio)));
                const e = events[month - 1];
                h.inicio = e.inicio;
                h.fim = e.fim;
                await this.store.put('happyhour', h);
            }
        await this.audit('season', id, 'PARAMETROS', before, s, user);
        return s;
    }
    async activity(userId: string, quarterId: string) {
        const matches = await filterAsync((await this.store.all<Casual>('casual')), async (c) => ['HOMOLOGADO', 'CORRIGIDO', 'CONTESTADO'].includes(c.status) && c.participants.includes(userId) && (await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId === quarterId && !(c.result?.raw.tipo === 'WO' && c.result.raw.ausentes.some(side => c.sides[side]?.includes(userId))));
        const points = (await this.store.points()).filter(p => p.userId === userId && p.quarterId === quarterId && p.sourceType === 'CASUAL').reduce((sum, p) => sum + p.points, 0);
        return { matches: matches.length, points };
    }
    async eligibility(ids: string[], quarterId: string) { const { s } = await this.period(quarterId); const detail = await mapAsync(ids, async (id) => ({ id, ...(await this.activity(id, quarterId)) })); const missing = detail.filter(r => r.matches < s.params.piso_partidas_trimestre); const eligible = !missing.length; const denominator = detail.reduce((sum, r) => sum + r.matches, 0); return { eligible, reason: eligible ? 'Piso cumprido por todos os integrantes.' : (await mapAsync(missing, async (r) => `${(await users(this.store)).find(u => u.id === r.id)?.nome ?? r.id}: ${r.matches}/${s.params.piso_partidas_trimestre} partidas homologadas`)).join('; '), weighted: denominator ? detail.reduce((sum, r) => sum + r.points, 0) / denominator : 0, detail }; }
    async rankings(seasonId: string, quarterId: string | null, scope: Scope, casualOnly = false): Promise<SnapshotRow[]> {
        const rows = new Map<string, SnapshotRow>();
        const add = (id: string) => {
            if (!rows.has(id))
                rows.set(id, { id, points: 0, wins: 0, balance: 0, casuals: 0, head: {}, draw: '', reason: '' });
            return rows.get(id)!;
        };
        const projections = (await this.store.db.prepare('SELECT * FROM v2_projection WHERE season_id=? AND scope=?').all(seasonId, scope)) as {
            user_id: string;
            quarter_id: string;
            source_type: string;
            points: number;
        }[];
        for (const p of projections)
            if ((!quarterId || p.quarter_id === quarterId) && (!casualOnly || p.source_type === 'CASUAL'))
                add(p.user_id).points += p.points;
        const record = (result: Casual['result'], sides: Record<string, string[]>, casual: boolean) => {
            if (!result)
                return;
            for (const [side, ids] of Object.entries(sides))
                for (const id of ids) {
                    if (result.raw.tipo === 'WO' && result.raw.ausentes.includes(side))
                        continue;
                    const r = add(id);
                    r.casuals += casual ? 1 : 0;
                    r.wins += result.order[0] === side ? 1 : 0;
                    r.balance += (result.stats[side]?.pro ?? 0) - (result.stats[side]?.contra ?? 0);
                    for (const [other, opponents] of Object.entries(sides))
                        if (other !== side)
                            for (const opponent of opponents)
                                r.head[opponent] = (r.head[opponent] ?? 0) + (result.order[0] === side ? 1 : 0);
                }
        };
        for (const c of (await this.store.all<Casual>('casual'))) {
            const h = await this.need<HappyHour>('happyhour', c.happyHourId);
            if ((await this.period(h.quarterId)).s.id === seasonId && (!quarterId || h.quarterId === quarterId) && this.mod(c.modalityId).escopo === scope && ['HOMOLOGADO', 'CORRIGIDO', 'CONTESTADO'].includes(c.status))
                record(c.result, c.sides, true);
        }
        if (!casualOnly)
            for (const t of (await this.store.all<Tournament>('tournament')))
                if (t.seasonId === seasonId && (!quarterId || t.quarterId === quarterId) && this.mod(t.modalityId).escopo === scope)
                    for (const m of t.bracket?.matches ?? [])
                        if (['HOMOLOGADO', 'CORRIGIDO'].includes(m.status))
                            record(m.result, Object.fromEntries((await mapAsync(m.participants, async (id) => [id, (await this.need<Entry>('entry', id)).activeMembers]))), false);
        return rank([...rows.values()], (await this.season(seasonId)).seed, (await this.season(seasonId)).params.desempate_ordem);
    }
    async tieRows(seasonId: string, quarterId: string | null, scope: Scope, sides: Record<string, string[]>): Promise<SnapshotRow[]> { const ranking = await this.rankings(seasonId, quarterId, scope); return Object.entries(sides).map(([id, members]) => { const rows = ranking.filter(r => members.includes(r.id)); return { id, points: 0, wins: rows.reduce((sum, r) => sum + r.wins, 0), balance: rows.reduce((sum, r) => sum + r.balance, 0), casuals: rows.reduce((sum, r) => sum + r.casuals, 0), head: Object.fromEntries(Object.entries(sides).filter(([other]) => other !== id).map(([other, opponents]) => [other, rows.reduce((sum, r) => sum + opponents.reduce((a, o) => a + (r.head[o] ?? 0), 0), 0)])), draw: '', reason: '' }; }); }
    async createCasual(user: User, input: {
        happyHourId: string;
        modalityId: string;
        groups: string[][];
    }) {
        const h = await this.need<HappyHour>('happyhour', input.happyHourId);
        const { s } = await this.period(h.quarterId);
        ensure(s.status === 'ABERTA', 'Temporada encerrada.');
        const m = this.mod(input.modalityId);
        const ids = input.groups.flat();
        ensure(ids.length >= m.min && ids.length <= m.max && new Set(ids).size === ids.length, 'Quantidade de jogadores inválida ou repetida.');
        ensure(input.groups.every(g => g.length === m.equipe), 'Composição inválida dos lados.');
        ensure(m.equipe === 1 || input.groups.length === 2, 'São necessárias duas equipes.');
        ensure((await everyAsync(ids, async (id) => (await users(this.store)).some(u => u.id === id && u.ativo))), 'Participante inexistente/inativo.');
        ensure(ids.includes(user.id) || hasRole(user, 'admin', 'organizador', 'mesario'), 'Somente participante ou mesário pode registrar.', 403);
        const c: Casual = { ...emptyReport(), id: randomUUID(), happyHourId: h.id, modalityId: m.id, participants: ids, sides: Object.fromEntries(input.groups.map((g, i) => [`L${i + 1}`, g])), seed: seed(), foraJanela: Date.now() < Date.parse(h.inicio) || Date.now() > Date.parse(h.fim), createdAt: now() };
        await this.store.put('casual', c);
        await this.audit('casual', c.id, 'RASCUNHO', null, c, user);
        return c;
    }
    canMatch(user: User, t: Tournament | null, participants: string[]) { ensure(participants.includes(user.id) || hasRole(user, 'admin', 'organizador') || hasRole(user, 'mesario') && (!t || t.mesarios.includes(user.id)), 'Você não participa desta partida nem é mesário autorizado.', 403); }
    async reportCasual(user: User, id: string, raw: RawResult) { const c = await this.need<Casual>('casual', id); this.canMatch(user, null, c.participants); ensure(c.status === 'RASCUNHO', 'O resultado já foi reportado.'); const { s } = await this.period((await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId); const before = structuredClone(c); c.result = score(raw, Object.keys(c.sides), this.mod(c.modalityId), s.params, c.seed, 1, false, (await this.tieRows(s.id, (await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId, this.mod(c.modalityId).escopo, c.sides))); c.status = 'REPORTADO'; c.author = user.id; await this.store.put('casual', c); await this.audit('casual', id, 'REPORTAR', before, c, user); await this.notify(c.participants, 'Resultado casual aguardando homologação.'); return c; }
    async homologateCasual(user: User, id: string) { const c = await this.need<Casual>('casual', id); this.canConfirm(user, c, null, c.participants, c.sides); ensure(c.status === 'REPORTADO', 'Resultado não está aguardando homologação.'); const before = structuredClone(c); c.status = 'HOMOLOGADO'; c.homologator = user.id; c.homologatedAt = now(); await this.store.put('casual', c); await this.creditCasual(c, user, 'Homologação de partida casual'); await this.audit('casual', id, 'HOMOLOGAR', before, c, user); return c; }
    canConfirm(user: User, r: {
        author: string | null;
    }, t: Tournament | null, participants: string[], sides: Record<string, string[]>) {
        this.canMatch(user, t, participants);
        ensure(r.author !== user.id, 'Quem reportou não pode homologar o próprio resultado.', 403);
        if (!hasRole(user, 'admin', 'organizador') && !(hasRole(user, 'mesario') && (!t || t.mesarios.includes(user.id)))) {
            const reporterSide = Object.values(sides).find(ids => ids.includes(r.author ?? ''));
            ensure(!reporterSide?.includes(user.id), 'Homologação exige adversário ou mesário/organizador.', 403);
        }
    }
    async creditCasual(c: Casual, user: User, reason: string) {
        const h = await this.need<HappyHour>('happyhour', c.happyHourId);
        const { s } = await this.period(h.quarterId);
        const mod = this.mod(c.modalityId);
        for (const [side, members] of Object.entries(c.sides)) {
            if (c.result!.raw.tipo === 'WO' && c.result!.raw.ausentes.includes(side))
                continue;
            for (const userId of members)
                await this.store.append({ userId, seasonId: s.id, quarterId: h.quarterId, scope: mod.escopo, sourceType: 'CASUAL', sourceId: c.id, points: side === c.result!.order[0] ? s.params.pontos_vitoria_casual : s.params.pontos_participacao_casual, reason, authorId: user.id, reversesId: null });
        }
    }
    async contestCasual(user: User, id: string, reason: string) { const c = await this.need<Casual>('casual', id); this.canMatch(user, null, c.participants); ensure(['HOMOLOGADO', 'CORRIGIDO', 'CONTESTADO'].includes(c.status), 'Resultado ainda não homologado.'); const { s } = await this.period((await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId); ensure(Date.now() - Date.parse(c.homologatedAt!) <= s.params.janela_contestacao_horas * 3600000, 'Janela de contestação encerrada.'); const before = structuredClone(c); c.status = 'CONTESTADO'; c.contestedAt = now(); c.reason = reason; await this.store.put('casual', c); await this.audit('casual', id, 'CONTESTAR', before, c, user); return c; }
    async correctCasual(user: User, id: string, raw: RawResult, reason: string) { this.organizer(user); const c = await this.need<Casual>('casual', id); ensure(c.status === 'CONTESTADO', 'Abra uma contestação antes de corrigir.'); ensure(c.author !== user.id, 'A correção exige organizador diferente do autor do resultado.', 403); const before = structuredClone(c); const { s } = await this.period((await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId); c.result = score(raw, Object.keys(c.sides), this.mod(c.modalityId), s.params, c.seed, 1, false, (await this.tieRows(s.id, (await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId, this.mod(c.modalityId).escopo, c.sides))); await this.store.reverse('CASUAL', id, user.id, reason); c.status = 'CORRIGIDO'; c.homologatedAt = now(); c.homologator = user.id; c.reason = reason; await this.store.put('casual', c); await this.creditCasual(c, user, reason); await this.invalidateTitle((await hQuarter(this, c)), user); await this.audit('casual', id, 'CORRIGIR', before, c, user); return c; }
    async createTournament(user: User, input: Omit<Tournament, 'id' | 'status' | 'seed' | 'snapshot' | 'bracket' | 'versions' | 'drawSeed' | 'drawModality'>) {
        this.organizer(user);
        const s = await this.season(input.seasonId);
        ensure(s.status === 'ABERTA', 'Temporada encerrada.');
        this.mod(input.modalityId);
        ensure(input.fechamento > input.abertura, 'Fechamento deve ser após abertura.');
        if (input.quarterId) {
            const q = await this.need<Quarter>('quarter', input.quarterId);
            ensure(q.seasonId === s.id, 'Trimestre não pertence à temporada.');
            ensure(input.abertura >= q.inicio && input.fechamento < q.fim, 'Inscrições devem pertencer ao trimestre.');
            ensure(!(await this.store.all<Tournament>('tournament')).some(t => t.quarterId === input.quarterId && t.modalityId === input.modalityId && t.tipo === 'TRIMESTRAL' && t.status !== 'CANCELADO'), 'Já existe uma etapa desta modalidade no trimestre.');
        }
        const t: Tournament = { ...input, id: randomUUID(), status: 'INSCRICOES', seed: seed(), snapshot: [], bracket: null, versions: [], drawSeed: seed(), drawModality: null };
        await this.store.put('tournament', t);
        await this.audit('tournament', t.id, 'CRIAR', null, t, user);
        return t;
    }
    async register(user: User, tournamentId: string, input: {
        nome?: string;
        titulares?: string[];
        reservas?: string[];
    }) {
        const t = await this.need<Tournament>('tournament', tournamentId);
        ensure(t.tipo === 'TRIMESTRAL', 'Inscrições de finais são automáticas.');
        ensure(t.status === 'INSCRICOES' && now() >= t.abertura && now() <= t.fechamento, 'Janela de inscrição fechada.');
        const m = this.mod(t.modalityId);
        const titulares = m.equipe === 1 ? [user.id] : (input.titulares ?? []);
        const reservas = m.equipe === 1 ? [] : (input.reservas ?? []);
        ensure(titulares.length === m.equipe && reservas.length <= 1 && titulares.includes(user.id), 'Informe os titulares e até um reserva; o solicitante deve ser titular.');
        const members = [...titulares, ...reservas];
        ensure(new Set(members).size === members.length && (await everyAsync(members, async (id) => (await users(this.store)).some(u => u.id === id && u.ativo))), 'Integrantes inválidos/repetidos.');
        ensure(!(await this.store.all<Entry>('entry')).some(e => e.tournamentId === t.id && e.members.some(id => members.includes(id))), 'Integrante já inscrito nesta etapa.');
        const eligibility = await this.eligibility(members, t.quarterId!);
        ensure(eligibility.eligible, eligibility.reason);
        let team: Team | null = null;
        if (m.equipe > 1) {
            team = { id: randomUUID(), tournamentId: t.id, nome: input.nome ?? 'Equipe', titulares, reservas };
            await this.store.put('team', team);
        }
        const count = (await this.store.all<Entry>('entry')).filter(e => e.tournamentId === t.id && e.status !== 'ESPERA').length;
        const entry: Entry = { id: randomUUID(), tournamentId: t.id, userId: team ? null : user.id, teamId: team?.id ?? null, members, activeMembers: titulares, playedMembers: [], status: count >= t.capacidade ? 'ESPERA' : 'INSCRITO', checkinAt: null, seed: 0, score: eligibility.weighted };
        await this.store.put('entry', entry);
        await this.audit('entry', entry.id, 'INSCREVER', null, entry, user);
        return entry;
    }
    async checkin(user: User, id: string, absent: string[]) {
        const e = await this.need<Entry>('entry', id);
        const t = await this.need<Tournament>('tournament', e.tournamentId);
        ensure(t.status === 'INSCRICOES', 'Etapa já iniciada.');
        ensure(hasRole(user, 'admin', 'organizador') || hasRole(user, 'mesario') && t.mesarios.includes(user.id), 'Check-in exige mesário designado ou organização.', 403);
        const date = (v: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
        ensure(date(now()) === date(t.fechamento), 'Check-in disponível no dia do fechamento.');
        ensure(e.status !== 'ESPERA', 'Promova a inscrição da lista de espera primeiro.');
        ensure(absent.every(id => e.members.includes(id)), 'Ausente não pertence à inscrição.');
        const before = structuredClone(e);
        const m = this.mod(t.modalityId);
        if (e.teamId) {
            const team = await this.need<Team>('team', e.teamId);
            e.activeMembers = team.titulares.filter(id => !absent.includes(id));
            if (e.activeMembers.length < m.equipe)
                e.activeMembers.push(...team.reservas.filter(id => !absent.includes(id)).slice(0, m.equipe - e.activeMembers.length));
        }
        else
            e.activeMembers = absent.includes(e.userId!) ? [] : [e.userId!];
        e.status = e.activeMembers.length === m.equipe ? 'CHECKIN' : 'AUSENTE';
        e.checkinAt = now();
        await this.store.put('entry', e);
        await this.audit('entry', id, 'CHECKIN', before, e, user);
        return e;
    }
    async promote(user: User, id: string) { this.organizer(user); const e = await this.need<Entry>('entry', id); const t = await this.need<Tournament>('tournament', e.tournamentId); ensure(t.status === 'INSCRICOES' && e.status === 'ESPERA', 'Inscrição fora da lista de espera.'); const count = (await this.store.all<Entry>('entry')).filter(x => x.tournamentId === t.id && !['ESPERA', 'AUSENTE'].includes(x.status)).length; ensure(count < t.capacidade, 'Não há vaga disponível.'); const before = structuredClone(e); e.status = 'INSCRITO'; await this.store.put('entry', e); await this.audit('entry', id, 'PROMOVER', before, e, user); return e; }
    async close(user: User, id: string) {
        this.organizer(user);
        const t = await this.need<Tournament>('tournament', id);
        ensure(t.status === 'INSCRICOES' && now() >= t.fechamento, 'Aguarde o fechamento das inscrições.');
        const s = await this.season(t.seasonId);
        const before = structuredClone(t);
        const mod = this.mod(t.modalityId);
        t.snapshot = (await this.rankings(t.seasonId, t.quarterId, 'INDIVIDUAL', t.tipo === 'TRIMESTRAL'));
        let entries = (await this.store.all<Entry>('entry')).filter(e => e.tournamentId === id && e.status !== 'ESPERA');
        for (const e of entries)
            if (e.status === 'INSCRITO') {
                e.status = 'AUSENTE';
                await this.store.put('entry', e);
            }
        if (t.tipo === 'TRIMESTRAL')
            for (const e of entries) {
                const eligible = await this.eligibility(e.members, t.quarterId!);
                ensure(eligible.eligible, eligible.reason);
                e.score = mod.equipe > 1 ? eligible.weighted : (t.snapshot.find(r => r.id === e.userId)?.points ?? 0);
            }
        entries.sort((a, b) => mod.equipe > 1 ? b.score - a.score || draw(t.seed, a.id).localeCompare(draw(t.seed, b.id)) : (t.snapshot.findIndex(r => r.id === a.userId) < 0 ? 999999 : t.snapshot.findIndex(r => r.id === a.userId)) - (t.snapshot.findIndex(r => r.id === b.userId) < 0 ? 999999 : t.snapshot.findIndex(r => r.id === b.userId)) || draw(t.seed, a.id).localeCompare(draw(t.seed, b.id)));
        await forEachAsync(entries, async (e, i) => { e.seed = i + 1; await this.store.put('entry', e); });
        if (entries.length < s.params.min_inscritos_torneio && !['FINAL_TRIOS', 'FINAL_DUPLAS'].includes(t.tipo)) {
            t.status = 'CANCELADO';
            for (const e of entries.filter(e => e.status === 'CHECKIN'))
                for (const userId of e.activeMembers)
                    await this.store.append({ userId, seasonId: s.id, quarterId: t.quarterId, scope: mod.escopo, sourceType: 'TORNEIO', sourceId: id, points: s.params.pontos_participacao_trimestral, reason: 'Etapa cancelada por inscrições insuficientes', authorId: user.id, reversesId: null });
        }
        else {
            ensure(entries.length >= 2, 'Participantes insuficientes.');
            const format = t.tipo === 'COPA' || t.tipo === 'FINAL_DUPLAS' ? 'SingleElimination' : t.tipo === 'FINAL_TRIOS' ? 'RoundRobin' : mod.formato;
            t.bracket = engines[format].gerar(entries.map(e => e.id), t.seed, s.params);
            for (const cut of t.bracket.cut) {
                const e = await this.need<Entry>('entry', cut);
                e.status = 'ESPERA';
                await this.store.put('entry', e);
            }
            t.status = 'EM_ANDAMENTO';
            await this.queueNoShows(t, user);
            await this.notify(entries.flatMap(e => e.activeMembers), `Chaveamento aberto: ${t.nome}. Consulte a próxima partida.`);
        }
        await this.store.put('tournament', t);
        await this.audit('tournament', id, 'FECHAR_INSCRICOES', before, t, user);
        return t;
    }
    async matchContext(t: Tournament, m: Match) { return Object.fromEntries((await mapAsync(m.participants, async (id) => [id, (await this.need<Entry>('entry', id)).activeMembers]))); }
    async tournamentScore(t: Tournament, m: Match, raw: RawResult) {
        const mod = t.tipo === 'COPA' && m.round === 2 && t.drawModality ? this.mod(t.drawModality) : this.mod(t.modalityId);
        const sides = await this.matchContext(t, m), params = (await this.season(t.seasonId)).params;
        const rows = await this.tieRows(t.seasonId, t.quarterId, mod.escopo, sides);
        if (t.tipo !== 'COPA')
            return score(raw, m.participants, mod, params, t.seed, m.bestOf, m.bracket !== 'TA' || m.phase > 0, rows);
        const losses: Record<string, number> = {};
        const count = (result: Casual['result'], participants: Record<string, string[]>) => {
            if (result)
                for (const [side, ids] of Object.entries(participants))
                    if (result.order[0] !== side)
                        for (const id of ids)
                            losses[id] = (losses[id] ?? 0) + 1;
        };
        for (const c of (await this.store.all<Casual>('casual')))
            if ((await this.period((await this.need<HappyHour>('happyhour', c.happyHourId)).quarterId)).s.id === t.seasonId && this.mod(c.modalityId).escopo === 'INDIVIDUAL' && ['HOMOLOGADO', 'CORRIGIDO', 'CONTESTADO'].includes(c.status))
                count(c.result, c.sides);
        for (const circuit of (await this.store.all<Tournament>('tournament')))
            if (circuit.seasonId === t.seasonId && circuit.tipo === 'TRIMESTRAL' && this.mod(circuit.modalityId).escopo === 'INDIVIDUAL')
                for (const game of circuit.bracket?.matches ?? [])
                    if (['HOMOLOGADO', 'CORRIGIDO'].includes(game.status))
                        count(game.result, (await this.matchContext(circuit, game)));
        const tie = rows.map(r => ({ ...r, wins: -(sides[r.id] ?? []).reduce((sum, id) => sum + (losses[id] ?? 0), 0) }));
        return scoreCopa(raw, m.participants, mod, params, t.seed, m.bestOf, m.bracket === 'FINAL' || m.bracket === 'TERCEIRO' ? 'FINAL' : m.round === 1 ? 'QUARTAS' : 'SEMIFINAL', tie);
    }
    async reportMatch(user: User, tId: string, mId: string, raw: RawResult) { const t = await this.need<Tournament>('tournament', tId); const m = t.bracket?.matches.find(m => m.id === mId); ensure(m && !m.auto && m.participants.length, 'Partida não está pronta.'); ensure(t.status === 'EM_ANDAMENTO' && m.status === 'RASCUNHO', 'Partida não está aguardando resultado.'); ensure(!t.bracket!.matches.some(x => x.status === 'CONTESTADO'), 'Resolva a contestação antes de registrar novos resultados.'); this.canMatch(user, t, Object.values((await this.matchContext(t, m))).flat()); const before = structuredClone(t); ensure(t.tipo !== 'COPA' || m.round !== 2 || t.drawModality, 'Realize o sorteio da modalidade antes das semifinais.'); const mod = t.tipo === 'COPA' && m.round === 2 && t.drawModality ? this.mod(t.drawModality) : this.mod(t.modalityId); m.result = (await this.tournamentScore(t, m, raw)); m.status = 'REPORTADO'; m.author = user.id; await this.store.put('tournament', t); await this.audit('bracket', tId, 'REPORTAR', before, t, user); await this.notify(Object.values((await this.matchContext(t, m))).flat(), `${m.label}: resultado aguarda homologação.`); return t; }
    async homologateMatch(user: User, tId: string, mId: string) {
        const t = await this.need<Tournament>('tournament', tId);
        const m = t.bracket?.matches.find(m => m.id === mId);
        ensure(m && m.status === 'REPORTADO', 'Resultado não está reportado.');
        ensure(!t.bracket!.matches.some(x => x.status === 'CONTESTADO'), 'Resolva a contestação antes de homologar outros confrontos.');
        const sides = await this.matchContext(t, m);
        this.canConfirm(user, m, t, Object.values(sides).flat(), sides);
        const before = structuredClone(t);
        m.status = 'HOMOLOGADO';
        m.homologator = user.id;
        m.homologatedAt = now();
        for (const id of m.participants) {
            const e = await this.need<Entry>('entry', id);
            if (m.result!.raw.tipo !== 'WO' || !m.result!.raw.ausentes.includes(id))
                e.playedMembers = [...new Set([...e.playedMembers, ...e.activeMembers])];
            else
                e.status = 'AUSENTE';
            await this.store.put('entry', e);
        }
        engines[t.bracket!.format].avancar(t.bracket!, t.seed, (await this.season(t.seasonId)).params);
        await this.queueNoShows(t, user);
        await this.finalize(t, user, 'Classificação homologada');
        await this.store.put('tournament', t);
        await this.audit('bracket', tId, 'HOMOLOGAR_AVANCAR', before, t, user);
        await this.notify((await this.store.all<Entry>('entry')).filter(e => e.tournamentId === t.id).flatMap(e => e.activeMembers), `Chave atualizada: ${t.nome}. Confira sua próxima mesa.`);
        return t;
    }
    async finalize(t: Tournament, user: User, reason: string) {
        const b = t.bracket!;
        if (!b.champion || b.matches.some(m => m.bracket === 'TERCEIRO' && !m.resolved))
            return;
        t.status = 'FINALIZADO';
        if (t.tipo !== 'TRIMESTRAL')
            return;
        const s = await this.season(t.seasonId);
        const mod = this.mod(t.modalityId);
        for (const e of (await this.store.all<Entry>('entry')).filter(e => e.tournamentId === t.id && !['ESPERA', 'AUSENTE'].includes(e.status))) {
            const index = b.standings.indexOf(e.id);
            const points = index === 0 ? s.params.pontos_campeao_trimestral : index === 1 ? s.params.pontos_vice_trimestral : index === 2 ? s.params.pontos_terceiro_trimestral : s.params.pontos_participacao_trimestral;
            for (const userId of e.playedMembers)
                await this.store.append({ userId, seasonId: s.id, quarterId: t.quarterId, scope: mod.escopo, sourceType: 'TORNEIO', sourceId: t.id, points, reason, authorId: user.id, reversesId: null });
        }
    }
    async contestMatch(user: User, tId: string, mId: string, reason: string) { const t = await this.need<Tournament>('tournament', tId); const m = t.bracket?.matches.find(m => m.id === mId); ensure(m && ['HOMOLOGADO', 'CORRIGIDO'].includes(m.status), 'Resultado não homologado.'); this.canMatch(user, t, Object.values((await this.matchContext(t, m))).flat()); ensure(Date.now() - Date.parse(m.homologatedAt!) <= (await this.season(t.seasonId)).params.janela_contestacao_horas * 3600000, 'Janela de contestação encerrada.'); const before = structuredClone(t); m.status = 'CONTESTADO'; m.reason = reason; m.contestedAt = now(); await this.store.put('tournament', t); await this.audit('bracket', tId, 'CONTESTAR', before, t, user); return t; }
    async correctMatch(user: User, tId: string, mId: string, raw: RawResult, reason: string) { this.organizer(user); const t = await this.need<Tournament>('tournament', tId); let m = t.bracket?.matches.find(m => m.id === mId); ensure(m && m.status === 'CONTESTADO', 'Conteste o resultado antes de corrigir.'); ensure(m.author !== user.id, 'O organizador corretor deve ser diferente do autor.', 403); const before = structuredClone(t); const participants = [...m.participants]; const matchMod = t.tipo === 'COPA' && m.round === 2 && t.drawModality ? this.mod(t.drawModality) : this.mod(t.modalityId); const result = await this.tournamentScore(t, m, raw); await this.store.reverse('TORNEIO', t.id, user.id, reason); t.versions.push(structuredClone(t.bracket!)); const affected = engines[t.bracket!.format].reverter(t.bracket!, mId, t.seed, (await this.season(t.seasonId)).params); m = t.bracket!.matches.find(x => x.id === mId)!; m.participants = participants; m.result = result; m.author = before.bracket!.matches.find(x => x.id === mId)!.author; m.status = 'CORRIGIDO'; m.homologator = user.id; m.homologatedAt = now(); m.reason = reason; t.status = 'EM_ANDAMENTO'; engines[t.bracket!.format].avancar(t.bracket!, t.seed, (await this.season(t.seasonId)).params); await this.rebuildParticipation(t); await this.finalize(t, user, reason); await this.store.put('tournament', t); await this.invalidateTitle(t.quarterId, user); await this.audit('bracket', t.id, 'CORRIGIR_CASCATA', { bracket: before.bracket }, { bracket: t.bracket, invalidated: affected, reason }, user); return { tournament: t, invalidated: affected }; }
    async invalidateTitle(quarterId: string | null, user: User) {
        if (!quarterId)
            return;
        const { s, q } = await this.period(quarterId);
        if (s.campeoes[q.numero]) {
            const before = structuredClone(s);
            delete s.campeoes[q.numero];
            await this.store.put('season', s);
            await this.audit('season', s.id, 'TITULO_REQUER_REAPURACAO', before, s, user);
            await this.notify((await users(this.store)).filter(u => hasRole(u, 'admin', 'organizador')).map(u => u.id), 'Correção alterou um trimestre encerrado. Reapure o campeão geral e revise a Copa existente.');
        }
    }
    async rebuildParticipation(t: Tournament) {
        const entries = (await this.store.all<Entry>('entry')).filter(e => e.tournamentId === t.id);
        for (const e of entries) {
            e.playedMembers = [];
            if (e.status !== 'ESPERA')
                e.status = e.checkinAt && e.activeMembers.length === this.mod(t.modalityId).equipe ? 'CHECKIN' : 'AUSENTE';
            for (const m of t.bracket?.matches ?? [])
                if (m.participants.includes(e.id) && ['HOMOLOGADO', 'CORRIGIDO'].includes(m.status) && m.result) {
                    if (m.result.raw.tipo === 'WO' && m.result.raw.ausentes.includes(e.id))
                        e.status = 'AUSENTE';
                    else
                        e.playedMembers = [...new Set([...e.playedMembers, ...e.activeMembers])];
                }
            await this.store.put('entry', e);
        }
    }
    async queueNoShows(t: Tournament, user: User) {
        if (!t.bracket)
            return;
        for (const m of t.bracket.matches) {
            if (m.auto || m.status !== 'RASCUNHO' || m.participants.length !== 2)
                continue;
            const absent = await filterAsync(m.participants, async (id) => (await this.need<Entry>('entry', id)).status === 'AUSENTE');
            if (absent.length === 2) {
                m.unavailable = [...m.participants];
                m.participants = [];
                m.auto = true;
                m.resolved = true;
                m.reason = 'Ambos os lados ausentes no check-in: nenhuma classificação por esta partida.';
            }
            else if (absent.length === 1) {
                m.result = score({ tipo: 'WO', ausentes: absent, quedas: [] }, m.participants, this.mod(t.modalityId), (await this.season(t.seasonId)).params, t.seed, m.bestOf);
                m.status = 'REPORTADO';
                m.author = user.id;
                m.reason = 'Ausência confirmada no check-in; aguarda homologação independente.';
            }
        }
        engines[t.bracket.format].avancar(t.bracket, t.seed, (await this.season(t.seasonId)).params);
        if ((await this.store.all<Entry>('entry')).filter(e => e.tournamentId === t.id && e.status !== 'ESPERA').every(e => e.status === 'AUSENTE'))
            t.status = 'CANCELADO';
    }
    async collectiveFinal(user: User, seasonId: string, type: 'FINAL_DUPLAS' | 'FINAL_TRIOS', fechamento: string) {
        this.organizer(user);
        const season = await this.season(seasonId);
        const modalityId = type === 'FINAL_DUPLAS' ? 'duplas' : 'douradinha';
        ensure(!(await this.store.all<Tournament>('tournament')).some(t => t.seasonId === seasonId && t.tipo === type), 'Final coletiva já criada.');
        const groups = new Map<string, {
            members: string[];
            name: string;
            score: number;
        }>();
        for (const team of (await this.store.all<Team>('team'))) {
            const tournament = await this.need<Tournament>('tournament', team.tournamentId);
            if (tournament.seasonId !== seasonId || tournament.modalityId !== modalityId || tournament.tipo !== 'TRIMESTRAL')
                continue;
            const key = [...team.titulares].sort().join(':');
            if (groups.has(key))
                continue;
            const activity = await flatMapAsync((await this.store.all<Quarter>('quarter')).filter(q => q.seasonId === seasonId), async (q) => (await mapAsync(team.titulares, async (id) => (await this.activity(id, q.id)))));
            const games = activity.reduce((sum, a) => sum + a.matches, 0);
            const points = type === 'FINAL_DUPLAS' ? activity.reduce((sum, a) => sum + a.points, 0) : (await filterAsync((await this.store.points()), async (p) => {
                if (p.seasonId !== seasonId || p.scope !== 'COLETIVO' || !team.titulares.includes(p.userId))
                    return false;
                if (p.sourceType === 'CASUAL') {
                    const c = await this.store.get<Casual>('casual', p.sourceId);
                    return c?.modalityId === modalityId && Object.values(c.sides).some(ids => [...ids].sort().join(':') === key);
                }
                const source = await this.store.get<Tournament>('tournament', p.sourceId);
                return source?.modalityId === modalityId && (await this.store.all<Team>('team')).some(g => g.tournamentId === source.id && [...g.titulares].sort().join(':') === key);
            })).reduce((sum, p) => sum + p.points, 0);
            groups.set(key, { members: team.titulares, name: team.nome, score: type === 'FINAL_DUPLAS' ? (games ? points / games : 0) : points });
        }
        const count = type === 'FINAL_DUPLAS' ? 4 : 3;
        const selected = [...groups.entries()].sort(([ka, a], [kb, b]) => b.score - a.score || draw(season.seed, ka).localeCompare(draw(season.seed, kb))).slice(0, count);
        ensure(selected.length === count, `São necessárias ${count} equipes distintas no circuito.`);
        ensure(new Set(selected.flatMap(([, g]) => g.members)).size === selected.reduce((sum, [, g]) => sum + g.members.length, 0), 'Integrantes em mais de uma equipe classificada: concilie as formações antes da final.');
        const t = await this.createTournament(user, { seasonId, quarterId: null, modalityId, nome: type === 'FINAL_DUPLAS' ? 'Final Four de Duplas' : 'Triangular de Douradinha', tipo: type, abertura: now(), fechamento, capacidade: count, mesarios: [] });
        await forEachAsync(selected, async ([, g], i) => { const team: Team = { id: randomUUID(), tournamentId: t.id, nome: g.name, titulares: g.members, reservas: [] }; await this.store.put('team', team); await this.store.put<Entry>('entry', { id: randomUUID(), tournamentId: t.id, userId: null, teamId: team.id, members: g.members, activeMembers: g.members, playedMembers: [], status: 'INSCRITO', checkinAt: null, seed: i + 1, score: g.score }); });
        return t;
    }
    async notify(ids: string[], message: string) {
        for (const userId of new Set(ids))
            await this.store.put<Notice>('notice', { id: randomUUID(), userId, message, read: false, createdAt: now() });
    }
    async crown(user: User, quarterId: string) { this.organizer(user); const { s, q } = await this.period(quarterId); ensure(now() >= q.fim, 'O trimestre ainda não terminou.'); ensure(!(await this.store.all<Tournament>('tournament')).some(t => t.quarterId === quarterId && !['FINALIZADO', 'CANCELADO'].includes(t.status)), 'Há etapas pendentes no trimestre.'); const ranking = await this.rankings(s.id, q.id, 'INDIVIDUAL'); ensure(ranking.length, 'Trimestre sem pontuação.'); const before = structuredClone(s); s.campeoes[q.numero] = ranking[0].id; await this.store.put('season', s); await this.audit('season', s.id, 'CAMPEAO_GERAL', before, s, user); return s; }
    async copa(user: User, seasonId: string, modalityId: string, fechamento: string) {
        this.organizer(user);
        const s = await this.season(seasonId);
        ensure(Object.keys(s.campeoes).length === 4, 'Apure os quatro campeões gerais primeiro.');
        ensure(!(await this.store.all<Tournament>('tournament')).some(t => t.seasonId === seasonId && t.tipo === 'COPA'), 'Copa já criada.');
        ensure(this.mod(modalityId).equipe === 1 && this.mod(modalityId).regra !== 'UNO', 'Escolha modalidade de confronto individual.');
        const ranking = await this.rankings(seasonId, null, 'INDIVIDUAL');
        const ids = [...new Set(Object.values(s.campeoes))];
        for (const row of ranking)
            if (ids.length < 8 && !ids.includes(row.id))
                ids.push(row.id);
        ensure(ids.length === 8, 'São necessários oito jogadores distintos no circuito.');
        const t = await this.createTournament(user, { seasonId, quarterId: null, modalityId, nome: `Copa dos Campeões ${s.ano}`, tipo: 'COPA', abertura: now(), fechamento, capacidade: 8, mesarios: [] });
        for (const id of ids)
            await this.store.put<Entry>('entry', { id: randomUUID(), tournamentId: t.id, userId: id, teamId: null, members: [id], activeMembers: [id], playedMembers: [], status: 'INSCRITO', checkinAt: null, seed: 0, score: ranking.find(r => r.id === id)?.points ?? 0 });
        return t;
    }
    async drawCopa(user: User, id: string) { this.organizer(user); const t = await this.need<Tournament>('tournament', id); ensure(t.tipo === 'COPA' && !t.drawModality, 'Sorteio indisponível ou já realizado.'); const options = modalities.filter(m => m.equipe === 1 && m.regra !== 'UNO' && m.regra !== 'PACIENCIA'); t.drawModality = [...options].sort((a, b) => draw(t.drawSeed, a.id).localeCompare(draw(t.drawSeed, b.id)))[0].id; await this.store.put('tournament', t); await this.audit('tournament', id, 'SORTEIO_MODALIDADE', { seed: t.drawSeed }, { seed: t.drawSeed, modalityId: t.drawModality }, user); return t; }
}
async function hQuarter(league: League, c: Casual) { return (await league.need<HappyHour>('happyhour', c.happyHourId)).quarterId; }
