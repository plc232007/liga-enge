export type Role = 'jogador' | 'mesario' | 'organizador' | 'admin';
export type Scope = 'INDIVIDUAL' | 'COLETIVO';
export type Format = 'SingleElimination' | 'DoubleElimination' | 'RoundRobin' | 'GroupStage' | 'TimeAttack' | 'TableGroups';
export interface User {
    id: string;
    nome: string;
    username: string;
    email: string;
    roles: Role[];
    ativo: boolean;
    passwordHash: string;
}
export type TieCriterion = 'VITORIAS' | 'SALDO' | 'CONFRONTO_DIRETO' | 'CONSTANCIA';
export interface Params {
    desempate_ordem?: TieCriterion[];
    pontos_vitoria_casual: number;
    pontos_participacao_casual: number;
    pontos_campeao_trimestral: number;
    pontos_vice_trimestral: number;
    pontos_terceiro_trimestral: number;
    pontos_participacao_trimestral: number;
    piso_partidas_trimestre: number;
    min_inscritos_torneio: number;
    teto_pontos_domino: number;
    teto_pontos_buraco: number;
    tentos_por_queda_truco: number;
    rodadas_uno_classificatoria: number;
    rodadas_uno_final: number;
    tempo_limite_playoff_paciencia_min: number;
    janela_contestacao_horas: number;
    happy_hour: {
        semana_do_mes: number;
        dia_semana: 'SEXTA';
        inicio: string;
        fim: string;
    };
}
export const defaults: Params = {
    desempate_ordem: ['VITORIAS', 'SALDO', 'CONFRONTO_DIRETO', 'CONSTANCIA'],
    pontos_vitoria_casual: 10, pontos_participacao_casual: 2, pontos_campeao_trimestral: 150, pontos_vice_trimestral: 100,
    pontos_terceiro_trimestral: 60, pontos_participacao_trimestral: 15, piso_partidas_trimestre: 3, min_inscritos_torneio: 4,
    teto_pontos_domino: 100, teto_pontos_buraco: 1500, tentos_por_queda_truco: 12, rodadas_uno_classificatoria: 3,
    rodadas_uno_final: 4, tempo_limite_playoff_paciencia_min: 10, janela_contestacao_horas: 48,
    happy_hour: { semana_do_mes: 2, dia_semana: 'SEXTA', inicio: '17:00', fim: '19:00' },
};
export interface Modality {
    id: string;
    nome: string;
    escopo: Scope;
    min: number;
    max: number;
    equipe: number;
    direcao: 'MAIOR_VENCE' | 'MENOR_VENCE';
    formato: Format;
    regra: 'TRUCO' | 'DOMINO' | 'BURACO' | 'UNO' | 'PACIENCIA';
}
export const modalities: Modality[] = [
    { id: 'domino', nome: 'Dominó Individual', escopo: 'INDIVIDUAL', min: 2, max: 2, equipe: 1, direcao: 'MAIOR_VENCE', formato: 'DoubleElimination', regra: 'DOMINO' },
    { id: 'truco', nome: 'Truco Mano a Mano', escopo: 'INDIVIDUAL', min: 2, max: 2, equipe: 1, direcao: 'MAIOR_VENCE', formato: 'DoubleElimination', regra: 'TRUCO' },
    { id: 'buraco', nome: 'Buraco Individual', escopo: 'INDIVIDUAL', min: 2, max: 2, equipe: 1, direcao: 'MAIOR_VENCE', formato: 'DoubleElimination', regra: 'BURACO' },
    { id: 'uno', nome: 'Uno', escopo: 'INDIVIDUAL', min: 4, max: 6, equipe: 1, direcao: 'MENOR_VENCE', formato: 'TableGroups', regra: 'UNO' },
    { id: 'paciencia', nome: 'Paciência (Klondike/Spider)', escopo: 'INDIVIDUAL', min: 1, max: 1, equipe: 1, direcao: 'MENOR_VENCE', formato: 'TimeAttack', regra: 'PACIENCIA' },
    { id: 'duplas', nome: 'Truco em Duplas', escopo: 'COLETIVO', min: 4, max: 4, equipe: 2, direcao: 'MAIOR_VENCE', formato: 'DoubleElimination', regra: 'TRUCO' },
    { id: 'douradinha', nome: 'Truco Douradinha', escopo: 'COLETIVO', min: 6, max: 6, equipe: 3, direcao: 'MAIOR_VENCE', formato: 'GroupStage', regra: 'TRUCO' },
];
export interface Season {
    id: string;
    ano: number;
    params: Params;
    versao: number;
    status: 'ABERTA' | 'ENCERRADA';
    seed: string;
    campeoes: Record<string, string>;
}
export interface Quarter {
    id: string;
    seasonId: string;
    numero: number;
    inicio: string;
    fim: string;
}
export interface HappyHour {
    id: string;
    quarterId: string;
    inicio: string;
    fim: string;
    status: string;
}
export interface RawResult {
    morte_subita?: Record<string, number>;
    quedas: {
        placar: Record<string, number>;
    }[];
    paciencia?: Record<string, {
        concluiu: boolean;
        tempo_ms: number;
        movimentos: number;
        fundacao: number;
    }>;
    tipo: 'NORMAL' | 'WO' | 'DESISTENCIA';
    ausentes: string[];
}
export interface Result {
    raw: RawResult;
    order: string[];
    stats: Record<string, {
        vitorias: number;
        pro: number;
        contra: number;
    }>;
}
export type MatchStatus = 'RASCUNHO' | 'REPORTADO' | 'HOMOLOGADO' | 'CONTESTADO' | 'CORRIGIDO';
export interface Report {
    status: MatchStatus;
    result: Result | null;
    author: string | null;
    homologator: string | null;
    homologatedAt: string | null;
    contestedAt: string | null;
    reason: string | null;
}
export const emptyReport = (): Report => ({ status: 'RASCUNHO', result: null, author: null, homologator: null, homologatedAt: null, contestedAt: null, reason: null });
export interface Casual extends Report {
    id: string;
    happyHourId: string;
    modalityId: string;
    participants: string[];
    sides: Record<string, string[]>;
    seed: string;
    foraJanela: boolean;
    createdAt: string;
}
export interface Team {
    id: string;
    tournamentId: string;
    nome: string;
    titulares: string[];
    reservas: string[];
}
export interface Entry {
    id: string;
    tournamentId: string;
    userId: string | null;
    teamId: string | null;
    members: string[];
    activeMembers: string[];
    playedMembers: string[];
    status: 'INSCRITO' | 'ESPERA' | 'CHECKIN' | 'AUSENTE';
    checkinAt: string | null;
    seed: number;
    score: number;
}
export interface Source {
    entry?: string | null;
    match?: string;
    outcome?: 'W' | 'L';
    position?: number;
}
export interface Match extends Report {
    unavailable?: string[];
    startedAt?: string;
    id: string;
    label: string;
    bracket: 'W' | 'L' | 'GRUPO' | 'MESA' | 'TA' | 'FINAL' | 'TERCEIRO';
    round: number;
    sources: Source[];
    participants: string[];
    resolved: boolean;
    auto: boolean;
    bestOf: number;
    deckSeed: string | null;
    phase: number;
}
export interface Bracket {
    version: number;
    format: Format;
    matches: Match[];
    champion: string | null;
    standings: string[];
    phase: number;
    cut: string[];
}
export interface SnapshotRow {
    id: string;
    points: number;
    wins: number;
    balance: number;
    casuals: number;
    head: Record<string, number>;
    draw: string;
    reason: string;
}
export interface Tournament {
    id: string;
    quarterId: string | null;
    seasonId: string;
    modalityId: string;
    nome: string;
    tipo: 'TRIMESTRAL' | 'COPA' | 'FINAL_DUPLAS' | 'FINAL_TRIOS';
    status: 'INSCRICOES' | 'EM_ANDAMENTO' | 'FINALIZADO' | 'CANCELADO';
    abertura: string;
    fechamento: string;
    capacidade: number;
    seed: string;
    drawSeed: string;
    drawModality: string | null;
    snapshot: SnapshotRow[];
    bracket: Bracket | null;
    versions: Bracket[];
    mesarios: string[];
}
export interface Notice {
    id: string;
    userId: string;
    message: string;
    read: boolean;
    createdAt: string;
}
export interface Audit {
    id: string;
    entity: string;
    entityId: string;
    action: string;
    before: unknown;
    after: unknown;
    authorId: string;
    createdAt: string;
}
export interface Transaction {
    id: string;
    userId: string;
    seasonId: string;
    quarterId: string | null;
    scope: Scope;
    sourceType: 'CASUAL' | 'TORNEIO';
    sourceId: string;
    points: number;
    reason: string;
    authorId: string;
    createdAt: string;
    reversesId: string | null;
}
