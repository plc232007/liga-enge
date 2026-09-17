import { createHash } from 'node:crypto';
import { emptyReport, type Bracket, type Format, type Match, type Params, type Source } from './model.js';
export const draw = (seed: string, id: string) => createHash('sha256').update(`${seed}:${id}`).digest('hex');
export function seededOrder<T extends {
    id: string;
}>(items: T[], seed: string) { return [...items].sort((a, b) => draw(seed, a.id).localeCompare(draw(seed, b.id))); }
export function olympic(size: number): number[] {
    if (size < 2)
        return [1];
    let order = [1, 2];
    for (let n = 4; n <= size; n *= 2)
        order = order.flatMap((v, i) => i % 2 === 0 ? [v, n + 1 - v] : [n + 1 - v, v]);
    // Standard recursive seed positions: 1/8,4/5,2/7,3/6 at eight.
    if (size === 8)
        return [1, 8, 4, 5, 2, 7, 3, 6];
    return order;
}
function seedPositions(size: number): number[] { if (size === 1)
    return [1]; if (size === 2)
    return [1, 2]; return seedPositions(size / 2).flatMap(v => [v, size + 1 - v]); }
export function snake(entries: string[], count: number) { const groups: string[][] = Array.from({ length: count }, () => []); entries.forEach((id, i) => { const row = Math.floor(i / count); groups[row % 2 === 0 ? i % count : count - 1 - i % count].push(id); }); return groups; }
export function grouping(entries: string[], min: number, max: number) {
    let selected = [...entries];
    const cut: string[] = [];
    while (selected.length && Math.ceil(selected.length / max) * min > selected.length)
        cut.unshift(selected.pop()!);
    const count = Math.ceil(selected.length / max);
    return { groups: count ? snake(selected, count) : [], cut };
}
const win = (id: string): Source => ({ match: id, outcome: 'W' });
const lose = (id: string): Source => ({ match: id, outcome: 'L' });
function add(b: Bracket, label: string, bracket: Match['bracket'], round: number, sources: Source[], bestOf = 1, phase = 0): Match {
    const m: Match = { ...emptyReport(), id: `M${b.matches.length + 1}`, label, bracket, round, sources, participants: [], resolved: false, auto: false, bestOf, deckSeed: null, phase };
    b.matches.push(m);
    return m;
}
function blank(format: Format): Bracket { return { version: 1, format, matches: [], champion: null, standings: [], phase: 0, cut: [] }; }
function tree(b: Bracket, entries: string[], third: boolean, bestOf: number, prefix = 'W'): Match {
    const size = 2 ** Math.ceil(Math.log2(entries.length));
    const order = seedPositions(size);
    let previous: Match[] = [];
    for (let i = 0; i < size; i += 2)
        previous.push(add(b, `${prefix}1 · ${i / 2 + 1}`, size === 2 ? 'FINAL' : 'W', 1, [{ entry: entries[order[i] - 1] ?? null }, { entry: entries[order[i + 1] - 1] ?? null }], bestOf, b.phase));
    let round = 2;
    while (previous.length > 1) {
        const next: Match[] = [];
        if (previous.length === 2 && third)
            add(b, 'Disputa de 3º lugar', 'TERCEIRO', round, previous.map(m => lose(m.id)), bestOf, b.phase);
        for (let i = 0; i < previous.length; i += 2)
            next.push(add(b, `${prefix}${round} · ${i / 2 + 1}`, previous.length === 2 ? 'FINAL' : 'W', round, [win(previous[i].id), win(previous[i + 1].id)], bestOf, b.phase));
        previous = next;
        round++;
    }
    return previous[0];
}
function resolve(b: Bracket) {
    for (const m of b.matches) {
        let resetWinner: string | undefined;
        if (m.label === 'Reset' && b.matches.find(x => x.label === 'Grande final')?.resolved) {
            const gf = b.matches.find(x => x.label === 'Grande final')!;
            if (gf.result?.order[0] === gf.participants[0] || gf.auto) {
                resetWinner = gf.result?.order[0] ?? gf.participants[0];
            }
        }
        let ready = true;
        const participants: string[] = [];
        for (const s of m.sources) {
            if ('entry' in s) {
                if (s.entry)
                    participants.push(s.entry);
                continue;
            }
            const parent = b.matches.find(x => x.id === s.match);
            if (!parent?.resolved) {
                ready = false;
                continue;
            }
            const order = parent.result?.order ?? parent.participants;
            const id = order[s.position ?? (s.outcome === 'L' ? 1 : 0)];
            if (id)
                participants.push(id);
        }
        if (m.unavailable) {
            for (let i = participants.length - 1; i >= 0; i--)
                if (m.unavailable.includes(participants[i]))
                    participants.splice(i, 1);
        }
        if (resetWinner) {
            participants.splice(0, participants.length, resetWinner);
        }
        if (ready) {
            if (m.participants.join() !== participants.join() && m.result) {
                Object.assign(m, emptyReport());
                m.resolved = false;
                m.auto = false;
            }
            m.participants = participants;
            if (participants.length <= 1 && m.bracket !== 'TA') {
                m.auto = true;
                m.resolved = true;
            }
            else {
                m.auto = false;
                m.resolved = ['HOMOLOGADO', 'CORRIGIDO'].includes(m.status) && !!m.result;
            }
        }
        else {
            m.participants = [];
            m.resolved = false;
        }
    }
}
function roundRobin(b: Bracket, groups: string[][]) { groups.forEach((group, g) => { for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++)
        add(b, `Grupo ${g + 1} · ${i + 1}×${j + 1}`, 'GRUPO', g + 1, [{ entry: group[i] }, { entry: group[j] }], 1, b.phase); }); }
function groupOrder(matches: Match[], seed: string) {
    const data = new Map<string, {
        wins: number;
        balance: number;
        direct: Record<string, number>;
    }>();
    for (const m of matches) {
        for (const id of m.participants)
            if (!data.has(id))
                data.set(id, { wins: 0, balance: 0, direct: {} });
        if (m.result) {
            for (const id of m.participants) {
                const row = data.get(id)!;
                row.wins += m.result.order[0] === id ? 1 : 0;
                const stats = m.result.stats[id];
                row.balance += (stats?.pro ?? 0) - (stats?.contra ?? 0);
                for (const other of m.participants)
                    if (other !== id)
                        row.direct[other] = (row.direct[other] ?? 0) + (m.result.order[0] === id ? 1 : 0);
            }
        }
    }
    return [...data.keys()].sort((a, b) => { const x = data.get(a)!, y = data.get(b)!; return y.wins - x.wins || y.balance - x.balance || (y.direct[a] ?? 0) - (x.direct[b] ?? 0) || draw(seed, a).localeCompare(draw(seed, b)); });
}
export interface BracketEngine {
    gerar(entries: string[], seed: string, params: Params): Bracket;
    avancar(b: Bracket, seed: string, params: Params): void;
    reverter(b: Bracket, matchId: string, seed: string, params: Params): string[];
}
abstract class Base implements BracketEngine {
    abstract gerar(entries: string[], seed: string, p: Params): Bracket;
    avancar(b: Bracket, _seed: string, _p: Params) { resolve(b); const finals = b.matches.filter(m => m.bracket === 'FINAL'); const final = finals.at(-1); if (final?.resolved) {
        b.champion = final.result?.order[0] ?? final.participants[0] ?? null;
        const second = final.result?.order[1];
        const third = b.matches.find(m => m.bracket === 'TERCEIRO');
        b.standings = [b.champion, second, ...(third?.result?.order ?? [])].filter((id): id is string => !!id);
    }
    else {
        b.champion = null;
        b.standings = [];
    } }
    reverter(b: Bracket, id: string, seed: string, p: Params) {
        const affected = new Set([id]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const m of b.matches)
                if (!affected.has(m.id) && m.sources.some(s => s.match && affected.has(s.match))) {
                    affected.add(m.id);
                    changed = true;
                }
        }
        const target = b.matches.find(m => m.id === id)!;
        // Derived phases (tables/groups/time attack) are regenerated from the corrected qualifying phase.
        const derived = b.matches.filter(m => m.phase > target.phase);
        for (const m of derived)
            affected.add(m.id);
        b.matches = b.matches.filter(m => m.phase <= target.phase);
        b.phase = target.phase;
        for (const m of b.matches)
            if (affected.has(m.id)) {
                Object.assign(m, emptyReport());
                m.auto = false;
                m.resolved = false;
            }
        b.champion = null;
        b.standings = [];
        b.version++;
        this.avancar(b, seed, p);
        return [...affected];
    }
}
class Single extends Base {
    gerar(entries: string[], seed: string, p: Params) { const b = blank('SingleElimination'); tree(b, entries, true, 3); this.avancar(b, seed, p); return b; }
}
class Double extends Base {
    gerar(entries: string[], seed: string, p: Params) {
        const b = blank('DoubleElimination');
        const size = 2 ** Math.ceil(Math.log2(entries.length));
        const order = seedPositions(size);
        let winners: Match[] = [];
        for (let i = 0; i < size; i += 2)
            winners.push(add(b, `W1 · ${i / 2 + 1}`, 'W', 1, [{ entry: entries[order[i] - 1] ?? null }, { entry: entries[order[i + 1] - 1] ?? null }], 3));
        const rounds = [winners];
        let r = 2;
        while (winners.length > 1) {
            const next: Match[] = [];
            for (let i = 0; i < winners.length; i += 2)
                next.push(add(b, `W${r} · ${i / 2 + 1}`, 'W', r, [win(winners[i].id), win(winners[i + 1].id)], 3));
            rounds.push(next);
            winners = next;
            r++;
        }
        let losers: Match[] = [];
        let lr = 1;
        for (let i = 0; i < rounds[0].length; i += 2)
            losers.push(add(b, `L${lr} · ${i / 2 + 1}`, 'L', lr, [lose(rounds[0][i].id), lose(rounds[0][i + 1].id)]));
        for (let wr = 1; wr < rounds.length; wr++) {
            lr++;
            const drops = [...rounds[wr]].reverse();
            losers = losers.map((m, i) => add(b, `L${lr} · ${i + 1}`, 'L', lr, [win(m.id), lose(drops[i].id)]));
            if (wr < rounds.length - 1) {
                lr++;
                const next: Match[] = [];
                for (let i = 0; i < losers.length; i += 2)
                    next.push(add(b, `L${lr} · ${i / 2 + 1}`, 'L', lr, [win(losers[i].id), win(losers[i + 1].id)]));
                losers = next;
            }
        }
        const gf = add(b, 'Grande final', 'FINAL', r, [win(winners[0].id), win(losers[0].id)], 3);
        add(b, 'Reset', 'FINAL', r + 1, [{ match: gf.id, position: 0 }, { match: gf.id, position: 1 }], 3);
        this.avancar(b, seed, p);
        return b;
    }
    override avancar(b: Bracket, seed: string, p: Params) { super.avancar(b, seed, p); if (b.champion) {
        const gf = b.matches.find(m => m.label === 'Grande final')!;
        const reset = b.matches.at(-1)!;
        const runner = reset.result?.order[1] ?? gf.participants.find(id => id !== b.champion);
        const third = b.matches.filter(m => m.bracket === 'L').at(-1)?.result?.order[1];
        b.standings = [b.champion, runner, third].filter((id): id is string => !!id);
    } }
}
class Groups extends Base {
    gerar(entries: string[], seed: string, p: Params) { const b = blank('GroupStage'); const { groups, cut } = grouping(entries, 3, 4); b.cut = cut; roundRobin(b, groups); this.avancar(b, seed, p); return b; }
    override avancar(b: Bracket, seed: string, p: Params) {
        resolve(b);
        const matches = b.matches.filter(m => m.bracket === 'GRUPO');
        if (b.phase === 0 && matches.length && matches.every(m => m.resolved)) {
            const groups = [...new Set(matches.map(m => m.round))].map(r => groupOrder(matches.filter(m => m.round === r), seed));
            b.phase = 1;
            if (groups.length === 2) {
                const a = add(b, 'Semifinal 1', 'W', 1, [{ entry: groups[0][0] }, { entry: groups[1][1] }], 3, 1);
                const c = add(b, 'Semifinal 2', 'W', 1, [{ entry: groups[1][0] }, { entry: groups[0][1] }], 3, 1);
                add(b, '3º lugar', 'TERCEIRO', 2, [lose(a.id), lose(c.id)], 3, 1);
                add(b, 'Final', 'FINAL', 2, [win(a.id), win(c.id)], 3, 1);
            }
            else {
                const balances = Object.fromEntries(groups.flat().map(id => [id, matches.reduce((sum, m) => sum + (m.result?.stats[id]?.pro ?? 0) - (m.result?.stats[id]?.contra ?? 0), 0)]));
                const qualified = groups.flatMap(g => g.slice(0, 2).map((id, place) => ({ id, place }))).sort((a, b) => a.place - b.place || balances[b.id] - balances[a.id] || draw(seed, a.id).localeCompare(draw(seed, b.id))).map(r => r.id);
                tree(b, qualified, qualified.length >= 4, 3);
            }
        }
        super.avancar(b, seed, p);
        if (b.champion && b.standings.length === 2) {
            const third = groupOrder(matches, seed).find(id => !b.standings.includes(id));
            if (third)
                b.standings.push(third);
        }
    }
}
class RoundRobin extends Base {
    gerar(entries: string[], seed: string, p: Params) { const b = blank('RoundRobin'); roundRobin(b, [entries]); this.avancar(b, seed, p); return b; }
    override avancar(b: Bracket, seed: string, p: Params) { resolve(b); if (b.matches.length && b.matches.every(m => m.resolved)) {
        b.standings = groupOrder(b.matches, seed);
        b.champion = b.standings[0];
    }
    else {
        b.standings = [];
        b.champion = null;
    } }
}
class Tables extends Base {
    gerar(entries: string[], seed: string, p: Params) { const b = blank('TableGroups'); const { groups, cut } = grouping(entries, 4, 6); b.cut = cut; groups.forEach((g, i) => add(b, `Mesa ${i + 1} · classificatória`, 'MESA', 1, g.map(entry => ({ entry })), p.rodadas_uno_classificatoria, 0)); this.avancar(b, seed, p); return b; }
    override avancar(b: Bracket, seed: string, p: Params) {
        resolve(b);
        const current = b.matches.filter(m => m.phase === b.phase);
        if (current.length && current.every(m => m.resolved)) {
            if (current[0].bracket === 'FINAL') {
                b.standings = current[0].result!.order;
                b.champion = b.standings[0];
                return;
            }
            // One initial table keeps all its players for a legal 4–6 player final.
            const qualified = current.length === 1 ? current[0].result!.order : current.flatMap(m => m.result!.order.slice(0, 2));
            b.phase++;
            if (qualified.length <= 6)
                add(b, 'Mesa final', 'FINAL', b.phase + 1, qualified.map(entry => ({ entry })), p.rodadas_uno_final, b.phase);
            else
                grouping(qualified, 4, 6).groups.forEach((g, i) => add(b, `Mesa ${i + 1} · semifinal ${b.phase}`, 'MESA', b.phase + 1, g.map(entry => ({ entry })), p.rodadas_uno_classificatoria, b.phase));
            resolve(b);
        }
    }
}
class TimeAttack extends Base {
    gerar(entries: string[], seed: string, p: Params) { const b = blank('TimeAttack'); const m = add(b, 'Classificatória · mesmo baralho', 'TA', 1, entries.map(entry => ({ entry })), 1); m.deckSeed = draw(seed, 'classificatoria'); this.avancar(b, seed, p); return b; }
    override avancar(b: Bracket, seed: string, p: Params) {
        resolve(b);
        const first = b.matches[0];
        if (b.phase === 0 && first.resolved) {
            b.phase = 1;
            const top = first.result!.order.slice(0, 4);
            const a = add(b, 'Semifinal 1', 'TA', 2, [{ entry: top[0] }, { entry: top[3] }], 1, 1);
            const c = add(b, 'Semifinal 2', 'TA', 2, [{ entry: top[1] }, { entry: top[2] }], 1, 1);
            a.deckSeed = c.deckSeed = draw(seed, 'semifinal');
            const third = add(b, '3º lugar', 'TERCEIRO', 3, [lose(a.id), lose(c.id)], 1, 1);
            const final = add(b, 'Final', 'FINAL', 3, [win(a.id), win(c.id)], 1, 1);
            third.deckSeed = final.deckSeed = draw(seed, 'final');
        }
        super.avancar(b, seed, p);
    }
}
export const engines: Record<Format, BracketEngine> = { SingleElimination: new Single(), DoubleElimination: new Double(), RoundRobin: new RoundRobin(), GroupStage: new Groups(), TimeAttack: new TimeAttack(), TableGroups: new Tables() };
