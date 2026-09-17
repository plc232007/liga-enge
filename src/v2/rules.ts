import { z } from 'zod';
import { draw } from './engine.js';
import { defaults, type Modality, type Params, type RawResult, type Result, type SnapshotRow, type TieCriterion } from './model.js';
export class DomainError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition { if (!condition)
    throw new DomainError(message, status); }
const positive = z.number().int().positive();
const nonnegative = z.number().int().nonnegative();
export const paramsSchema = z.object({
    desempate_ordem: z.array(z.enum(['VITORIAS', 'SALDO', 'CONFRONTO_DIRETO', 'CONSTANCIA'])).length(4).refine(v => new Set(v).size === 4, 'Use cada critério uma vez.').optional(),
    pontos_vitoria_casual: nonnegative, pontos_participacao_casual: nonnegative, pontos_campeao_trimestral: nonnegative, pontos_vice_trimestral: nonnegative, pontos_terceiro_trimestral: nonnegative, pontos_participacao_trimestral: nonnegative,
    piso_partidas_trimestre: nonnegative, min_inscritos_torneio: positive.min(4), teto_pontos_domino: positive, teto_pontos_buraco: positive, tentos_por_queda_truco: positive,
    rodadas_uno_classificatoria: positive, rodadas_uno_final: positive, tempo_limite_playoff_paciencia_min: positive, janela_contestacao_horas: positive,
    happy_hour: z.object({ semana_do_mes: positive.max(4), dia_semana: z.literal('SEXTA'), inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict(),
}).strict().refine(p => p.happy_hour.fim > p.happy_hour.inicio, 'Fim do evento deve ser após início.');
export const rawSchema = z.object({ morte_subita: z.record(z.string(), z.number().int().nonnegative()).optional(), quedas: z.array(z.object({ placar: z.record(z.string(), z.number().int().min(0).max(1000000)) }).strict()).max(100),
    paciencia: z.record(z.string(), z.object({ concluiu: z.boolean(), tempo_ms: nonnegative.max(86400000), movimentos: nonnegative.max(1000000), fundacao: nonnegative.max(104) }).strict()).optional(),
    tipo: z.enum(['NORMAL', 'WO', 'DESISTENCIA']).default('NORMAL'), ausentes: z.array(z.string()).max(6).default([]), }).strict();
export function localDateTime(year: number, month: number, day: number, time: string): string {
    const [h, m] = time.split(':').map(Number);
    let utc = Date.UTC(year, month - 1, day, h, m);
    const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    for (let i = 0; i < 3; i++) {
        const parts = Object.fromEntries(format.formatToParts(new Date(utc)).map(p => [p.type, p.value]));
        const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
        const delta = Date.UTC(year, month - 1, day, h, m) - shown;
        if (!delta)
            break;
        utc += delta;
    }
    return new Date(utc).toISOString();
}
export function calendar(year: number, p: Params = defaults) { return Array.from({ length: 12 }, (_, i) => { const month = i + 1; const weekday = new Date(Date.UTC(year, i, 1)).getUTCDay(); const day = 1 + (5 - weekday + 7) % 7 + 7 * (p.happy_hour.semana_do_mes - 1); return { month, quarter: Math.floor(i / 3) + 1, inicio: localDateTime(year, month, day, p.happy_hour.inicio), fim: localDateTime(year, month, day, p.happy_hour.fim) }; }); }
export function score(raw: RawResult, ids: string[], mod: Modality, p: Params, seed: string, bestOf = 1, playoff = false, tieRows: SnapshotRow[] = []): Result {
    ensure(ids.length > 0 && new Set(ids).size === ids.length, 'Participantes inválidos.');
    const stats = Object.fromEntries(ids.map(id => [id, { vitorias: 0, pro: 0, contra: 0 }]));
    const totals = Object.fromEntries(ids.map(id => [id, 0]));
    const fallback = (a: string, b: string) => { const rows = rank(tieRows.filter(r => r.id === a || r.id === b), seed, p.desempate_ordem); return rows.length === 2 ? rows.findIndex(r => r.id === a) - rows.findIndex(r => r.id === b) : draw(seed, a).localeCompare(draw(seed, b)); };
    if (raw.tipo !== 'NORMAL') {
        ensure(ids.length === 2 && raw.ausentes.length === 1 && ids.includes(raw.ausentes[0]), 'W.O./desistência exige um lado ausente em confronto de dois lados.');
        ensure(raw.tipo !== 'DESISTENCIA' || raw.quedas.length > 0, 'Desistência exige placar congelado.');
    }
    else
        ensure(raw.ausentes.length === 0, 'Ausentes somente em W.O./desistência.');
    if (raw.tipo === 'WO') {
        ensure(raw.quedas.length === 0, 'W.O. não deve inventar placar jogado.');
        const order = [...ids.filter(id => !raw.ausentes.includes(id)), ...raw.ausentes];
        stats[order[0]].vitorias = 1;
        return { raw, order, stats };
    }
    if (mod.regra === 'PACIENCIA') {
        ensure(raw.paciencia && Object.keys(raw.paciencia).length === ids.length && ids.every(id => raw.paciencia?.[id]), 'Informe conclusão, duração, movimentos e fundação de cada jogador.');
        ensure(raw.quedas.length === 0, 'Paciência usa os dados de tempo, não quedas.');
        if (playoff)
            ensure(ids.every(id => raw.paciencia![id].tempo_ms <= p.tempo_limite_playoff_paciencia_min * 60000), 'Duração excede o limite do playoff.');
        const order = [...ids].sort((a, b) => {
            const x = raw.paciencia![a], y = raw.paciencia![b];
            if (x.concluiu !== y.concluiu)
                return x.concluiu ? -1 : 1;
            if (playoff && !x.concluiu && !y.concluiu)
                return y.fundacao - x.fundacao || draw(seed, a).localeCompare(draw(seed, b));
            return x.tempo_ms - y.tempo_ms || x.movimentos - y.movimentos || (!x.concluiu ? y.fundacao - x.fundacao : 0) || draw(seed, a).localeCompare(draw(seed, b));
        });
        stats[order[0]].vitorias = 1;
        return { raw, order, stats };
    }
    ensure(raw.quedas.length > 0, 'Placar por queda/mão é obrigatório.');
    for (const [index, round] of raw.quedas.entries()) {
        ensure(Object.keys(round.placar).length === ids.length && ids.every(id => Number.isInteger(round.placar[id])), 'Cada queda deve ter exatamente os participantes da partida.');
        for (const id of ids) {
            const value = round.placar[id];
            totals[id] += value;
            stats[id].pro += value;
            stats[id].contra += ids.filter(x => x !== id).reduce((sum, x) => sum + round.placar[x], 0);
        }
        const order = [...ids].sort((a, b) => mod.direcao === 'MAIOR_VENCE' ? round.placar[b] - round.placar[a] : round.placar[a] - round.placar[b]);
        if (mod.regra === 'UNO') {
            ensure(round.placar[order[0]] === 0, 'Uno: vencedor da rodada deve ter zero pontos residuais.');
        }
        if (['TRUCO', 'DOMINO', 'BURACO'].includes(mod.regra) && raw.tipo === 'NORMAL') {
            const target = mod.regra === 'TRUCO' ? p.tentos_por_queda_truco : mod.regra === 'DOMINO' ? p.teto_pontos_domino : p.teto_pontos_buraco;
            ensure((mod.regra === 'TRUCO' ? round.placar[order[0]] === target : round.placar[order[0]] >= target) && round.placar[order[1]] < target, 'Cada queda deve terminar no teto da modalidade, com um vencedor.');
            ensure(ids.every(id => stats[id].vitorias < Math.ceil(bestOf / 2)), `A série já estava decidida antes da queda ${index + 1}.`);
        }
        stats[order[0]].vitorias++;
    }
    let order = [...ids].sort((a, b) => ['TRUCO', 'DOMINO', 'BURACO'].includes(mod.regra) ? stats[b].vitorias - stats[a].vitorias || fallback(a, b) : (mod.direcao === 'MAIOR_VENCE' ? totals[b] - totals[a] : totals[a] - totals[b]) || fallback(a, b));
    if (raw.tipo !== 'NORMAL')
        order = [...ids.filter(id => !raw.ausentes.includes(id)), ...raw.ausentes];
    else if (['TRUCO', 'DOMINO', 'BURACO'].includes(mod.regra))
        ensure(stats[order[0]].vitorias === Math.ceil(bestOf / 2), 'Série ainda não atingiu o número de vitórias necessário.');
    else if (mod.regra === 'UNO')
        ensure(raw.quedas.length === bestOf, `Uno exige ${bestOf} rodadas nesta fase.`);
    else {
        const target = mod.regra === 'DOMINO' ? p.teto_pontos_domino : p.teto_pontos_buraco;
        ensure(totals[order[0]] >= target && totals[order[0]] !== totals[order[1]], 'O placar não define vencedor no teto da modalidade.');
        if (bestOf > 1)
            ensure(raw.quedas.length >= Math.ceil(bestOf / 2), 'Registre as quedas da série melhor de três.');
    }
    for (const id of ids)
        stats[id].vitorias = order[0] === id ? 1 : 0;
    return { raw, order, stats };
}
export function rank(rows: SnapshotRow[], seed: string, criteria: TieCriterion[] = ['VITORIAS', 'SALDO', 'CONFRONTO_DIRETO', 'CONSTANCIA']): SnapshotRow[] {
    const enriched = rows.map(r => ({ ...r, draw: draw(seed, r.id) }));
    const base = (r: SnapshotRow, c: TieCriterion) => c === 'VITORIAS' ? r.wins : c === 'SALDO' ? r.balance : r.casuals;
    const preceding = criteria.slice(0, criteria.indexOf('CONFRONTO_DIRETO'));
    const headScore = (row: SnapshotRow) => enriched.filter(other => other.id !== row.id && other.points === row.points && preceding.every(c => base(row, c) === base(other, c))).reduce((sum, other) => sum + (row.head[other.id] ?? 0), 0);
    const metric = (r: SnapshotRow, c: TieCriterion) => c === 'CONFRONTO_DIRETO' ? headScore(r) : base(r, c);
    const result = enriched.sort((a, b) => { if (a.points !== b.points)
        return b.points - a.points; for (const c of criteria) {
        const d = metric(b, c) - metric(a, c);
        if (d)
            return d;
    } return a.draw.localeCompare(b.draw); });
    const labels: Record<TieCriterion, string> = { VITORIAS: 'Vitórias', SALDO: 'Saldo', CONFRONTO_DIRETO: 'Confronto direto', CONSTANCIA: 'Constância' };
    return result.map((r, i) => { const other = result[i - 1] ?? result[i + 1]; let reason = 'Único participante.'; if (other) {
        reason = r.points !== other.points ? `Pontuação (${r.points} × ${other.points}).` : `Sorteio auditável; seed ${seed}; chave ${r.draw.slice(0, 12)}.`;
        if (r.points === other.points)
            for (const c of criteria)
                if (metric(r, c) !== metric(other, c)) {
                    reason = `${labels[c]} (${metric(r, c)} × ${metric(other, c)}).`;
                    break;
                }
    } return { ...r, reason }; });
}
export function scoreCopa(raw: RawResult, ids: string[], mod: Modality, p: Params, seed: string, bestOf: number, stage: 'QUARTAS' | 'SEMIFINAL' | 'FINAL', tieRows: SnapshotRow[]): Result {
    const tied = raw.tipo === 'NORMAL' && ids.length === 2 && raw.quedas.length === bestOf && raw.quedas.some(q => q.placar[ids[0]] === q.placar[ids[1]]);
    if (!tied) {
        ensure(!raw.morte_subita, 'Morte súbita só se aplica ao empate da final.');
        return score(raw, ids, mod, p, seed, bestOf, stage !== 'QUARTAS', tieRows);
    }
    ensure(['TRUCO', 'DOMINO', 'BURACO'].includes(mod.regra), 'Desempate da Copa requer confronto direto.');
    const target = mod.regra === 'TRUCO' ? p.tentos_por_queda_truco : mod.regra === 'DOMINO' ? p.teto_pontos_domino : p.teto_pontos_buraco;
    const stats = Object.fromEntries(ids.map(id => [id, { vitorias: 0, pro: 0, contra: 0 }]));
    const wins: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
    for (const q of raw.quedas) {
        ensure(Object.keys(q.placar).length === 2 && ids.every(id => Number.isInteger(q.placar[id]) && q.placar[id] >= 0), 'Placar inválido.');
        const [a, b] = ids;
        ensure(Math.max(q.placar[a], q.placar[b]) >= target, 'Placar não atingiu o teto da modalidade.');
        for (const id of ids) {
            stats[id].pro += q.placar[id];
            stats[id].contra += q.placar[ids.find(x => x !== id)!];
        }
        if (q.placar[a] !== q.placar[b])
            wins[q.placar[a] > q.placar[b] ? a : b]++;
    }
    let order: string[];
    if (wins[ids[0]] !== wins[ids[1]])
        order = [...ids].sort((a, b) => wins[b] - wins[a]);
    else if (stage === 'FINAL') {
        ensure(raw.morte_subita && Object.keys(raw.morte_subita).length === 2 && ids.every(id => Number.isInteger(raw.morte_subita![id])) && raw.morte_subita[ids[0]] !== raw.morte_subita[ids[1]], 'Final empatada: registre o placar de morte súbita.');
        order = [...ids].sort((a, b) => raw.morte_subita![b] - raw.morte_subita![a]);
    }
    else {
        ensure(!raw.morte_subita, 'Morte súbita somente na final/terceiro lugar.');
        order = rank(tieRows.map(r => ({ ...r, points: 0, balance: 0, casuals: 0, wins: stage === 'SEMIFINAL' ? 0 : r.wins })), seed, ['VITORIAS', 'CONFRONTO_DIRETO', 'SALDO', 'CONSTANCIA']).map(r => r.id);
    }
    ensure(order.length === 2, 'Estatísticas de desempate indisponíveis.');
    stats[order[0]].vitorias = 1;
    return { raw, order, stats };
}
