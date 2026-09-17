# Produto e regras de negócio

## Objetivo

Gerenciar a pontuação de participantes da Engesoftware Gaming League em jogos de mesa, reunindo resultados casuais e torneios em uma classificação geral e por modalidade.

Confirmado pelo solicitante: a nova versão será publicada na internet com login. Ainda não foram definidos provedor de hospedagem, domínio, quantidade de acessos, identidade corporativa ou perfis de permissão. A implementação inicial usa um administrador e um servidor com disco persistente.

## Regras extraídas do código

| Resultado | Pontos | Categoria |
| --- | ---: | --- |
| Campeão de torneio | 150 | torneio |
| Vice-campeão | 100 | torneio |
| Terceiro lugar | 60 | torneio |
| Participação em torneio | 15 | torneio |
| Vitória casual | 10 | casual |
| Participação casual | 2 | casual |

Modalidades: Truco, Buraco, Uno, Dominó e Paciência. O formulário de duplas original admite as quatro primeiras; não há regra de partidas de Paciência. Mantivemos esse comportamento, sem afirmar que todos esses jogos precisam obrigatoriamente de duplas em futuras versões.

Partida: quatro jogadores distintos, duas duplas e uma vencedora. Cada vencedor ganha 10 pontos; cada perdedor ganha 2. O total distribuído por partida é 24 pontos. A exclusão de uma partida exclui somente seus lançamentos vinculados. Não há placar por rodada, empate ou edição direta da partida; uma correção é feita excluindo e registrando novamente.

Ranking: soma dos lançamentos por jogador, com subtotais de torneio e casual e filtro por modalidade. Jogadores sem pontos não aparecem. Empates são exibidos em ordem alfabética e, por último, ID; a posição numérica é apenas ordem de apresentação, não um desempate esportivo homologado.

## Decisões novas da primeira versão

- Todo lançamento pertence a um jogador cadastrado. O nome livre de dupla aceito no legado não foi convertido automaticamente em pessoa ou equipe.
- Renomear preserva o mesmo ID e atualiza o nome exibido nos históricos por consulta relacional.
- Nomes são normalizados em Unicode NFC e comparados sem diferença de maiúsculas/minúsculas; acentos diferentes continuam diferentes.
- Um jogador com histórico não pode ser excluído; arquivamento será uma evolução.
- Pontos e categoria vêm da tabela de regras no servidor. A API rejeita esses campos extras no corpo.
- A sessão administrativa dura 8 horas; não há cadastro público. Leitura do ranking também exige login nesta etapa.

## Critérios de aceitação da base

1. Sem sessão, uma chamada aos dados retorna 401.
2. Quatro jogadores distintos podem registrar uma partida, produzindo quatro lançamentos com total de 24.
3. Participantes repetidos ou inexistentes não deixam dados parciais.
4. Renomear um jogador preserva seus pontos e participação.
5. Excluir uma partida desfaz seus quatro lançamentos; lançamentos manuais permanecem independentes.
6. O servidor rejeita uma tentativa de escolher arbitrariamente `pts`.
7. O ranking pode ser filtrado e inclui corretamente pontos de torneios e casuais.
8. A nova aplicação utiliza banco próprio; o legado é preservado.

## Decisões de produto pendentes

São necessários alinhamentos antes de expandir o produto: acesso só para organizadores ou contas para todos; ranking público ou restrito; login corporativo Microsoft/Google; limite de participantes; temporadas e reinício anual; se participação de torneio acumula com colocação; equipes persistentes; critério oficial de desempate; formato individual de Uno/Paciência; correção de resultados com auditoria; datas retroativas. Nenhuma dessas regras foi inferida como já aprovada.
