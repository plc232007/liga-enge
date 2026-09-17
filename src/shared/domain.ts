export const modalidades = ['Truco', 'Buraco', 'Uno', 'Dominó', 'Paciência'] as const;
export const modalidadesDuplas = ['Truco', 'Buraco', 'Uno', 'Dominó'] as const;
export const regras = {
  torneio_campeao: { label: 'Campeão do torneio', pts: 150, categoria: 'torneio' },
  torneio_vice: { label: 'Vice-campeão', pts: 100, categoria: 'torneio' },
  torneio_terceiro: { label: '3º lugar', pts: 60, categoria: 'torneio' },
  torneio_part: { label: 'Participação no torneio', pts: 15, categoria: 'torneio' },
  casual_vitoria: { label: 'Vitória casual', pts: 10, categoria: 'casual' },
  casual_part: { label: 'Participação casual', pts: 2, categoria: 'casual' },
} as const;
export type TipoPontos = keyof typeof regras;
export interface Jogador { id: number; nome: string }
export interface Lancamento {
  id: number; jogador_id: number; nome: string; jogo: string; tipo: TipoPontos;
  pts: number; categoria: 'torneio' | 'casual'; partida_id: number | null;
}
export interface Partida {
  id: number; jogo: string; dupla_a1: string; dupla_a2: string;
  dupla_b1: string; dupla_b2: string; vencedora: 'A' | 'B'; data: string;
}
export interface Bootstrap { jogadores: Jogador[]; lancamentos: Lancamento[]; partidas: Partida[] }
export function ranking(lancamentos: Lancamento[], filtro = 'todos') {
  const grupos = new Map<number, { id: number; nome: string; torneio: number; casual: number; total: number }>();
  for (const item of lancamentos) {
    if (filtro !== 'todos' && item.jogo !== filtro) continue;
    const linha = grupos.get(item.jogador_id) ?? { id: item.jogador_id, nome: item.nome, torneio: 0, casual: 0, total: 0 };
    linha[item.categoria] += item.pts;
    linha.total += item.pts;
    grupos.set(item.jogador_id, linha);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id);
}
