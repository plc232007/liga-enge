# Implementação da especificação v2

A implementação está em `src/v2`, com interface em `src/client`. A API antiga de edição/exclusão de pontos foi substituída pelo fluxo de resultado, homologação, contestação e correção.

## Implementado e coberto pela suíte

- Temporadas, quatro trimestres, parâmetros congelados após início e agenda de 12 encontros.
- Horário `America/Sao_Paulo`, incluindo datas históricas com horário de verão.
- Contas com papéis jogador, mesário, organizador e administrador.
- Partidas casuais com placar bruto; homologação por pessoa diferente e adversário/mesário autorizado.
- Ledger imutável, estorno, auditoria e projeção de pontos atualizada na transação.
- Separação individual/coletivo, frequência trimestral e elegibilidade de todos os integrantes.
- Inscrições, reservas, lista de espera, check-in e congelamento do ranking.
- Eliminatórias simples e dupla, byes, repescagem, reset, round robin, grupos, Uno e Paciência.
- Avanço por homologação e rollback dos confrontos dependentes, com versões anteriores preservadas.
- Premiação trimestral, campeões gerais e seleção de oito jogadores distintos para a Copa.
- Controle de acesso, idempotência e transação que reverte pontos/projeção em falha.

## Interface e operação

- Navegação por agenda, torneios, rankings, perfil, temporadas, contas e auditoria.
- Temas claro/escuro, preferência persistida e aplicação do tema antes da renderização.
- Tela pública `/tv/:id` com atualização a cada cinco segundos.
- Notificações internas e exportação CSV/PDF.
- Finais coletivas: Final Four de duplas e triangular de trios.

## Decisões para casos não fechados no documento

1. **Uno com 7 inscritos:** seis primeiros seeds compõem a mesa; o sétimo vai para espera. Para apenas uma mesa classificatória, todos continuam para a final de 4–6 participantes. Avançar apenas dois produziria uma mesa final inválida.
2. **Douradinha com 5 trios:** quatro primeiros formam um grupo; o quinto vai para espera. Um grupo único classifica dois para a final; o terceiro é apurado na classificação do grupo.
3. **Correção de bracket encerrado:** o campeão fica pendente após invalidar os confrontos dependentes. Esses confrontos precisam de novos resultados e homologação; o sistema não inventa placares. A suíte reproduz a correção de M1 em oito inscritos e verifica o novo campeão após re-homologação.
4. **Pontuação antiga:** os dados sem temporada/escopo/homologação ficam disponíveis somente para consulta administrativa em `/api/legacy`. Não são classificados por suposição nem entram no novo ledger.
5. **Identidade:** o administrador inicial continua usando a credencial do `.env`. Novas contas são criadas pelo administrador, com senha aleatória mostrada uma vez na interface.
6. **Acessibilidade:** texto normal sobre o botão laranja usa primeiro plano escuro. Laranja base com texto branco não atinge 4,5:1; a recomendação textual da seção 11.1 contradiz o contraste solicitado. Links claros usam a variante mais escura.
7. **Persistência:** entidades de calendário/torneio são agregados JSON em SQLite; usuários, sessões, ledger, projeções, idempotência e auditoria têm tabelas próprias. Não foi implementada uma migração para PostgreSQL.
8. **Séries:** cada linha de placar representa uma queda concluída. Para Dominó/Buraco, uma queda é um jogo até o teto; para Truco, até os tentos configurados.
9. **Copa:** o sorteio inicial usa modalidades individuais de confronto direto (Dominó, Truco e Buraco); Uno/Paciência mantêm seus motores especiais nas etapas trimestrais.

## Validação

A suíte tem 20 testes de integração/domínio. Foram verificados no navegador: login, oito áreas da interface, troca de tema, largura móvel de 390 px e exportação PDF. Os testes usam SQLite em memória; nenhum resultado de teste foi gravado no banco de uso.

Os desempates são configuráveis por temporada, com sorteio terminal obrigatório. A Copa utiliza sua cadeia específica (derrotas nas quartas, confronto direto nas semifinais e morte súbita na final/terceiro lugar). Paciência tem cronômetro compartilhado com início registrado pelo servidor. Mesários/organizadores podem chamar os participantes de uma partida; as notificações internas são atualizadas a cada 15 segundos. O checklist do documento original será atualizado após essa conferência.

Não houve publicação externa. Notificações são internas; nenhuma mensagem foi enviada por e-mail ou outro canal.

## Mapa dos requisitos

| Seção da especificação | Implementação principal |
| --- | --- |
| 9.1 Núcleo | `model.ts`, `rules.calendar`, `League.createSeason/updateParams` |
| 9.2 Happy hour | `League.createCasual/reportCasual/homologateCasual`, agenda na interface |
| 9.3 Inscrições | `League.activity/eligibility/register/checkin/promote/close` |
| 9.4 Motores | `engine.ts`: seis estratégias com geração, avanço e reversão |
| 9.5 Resultados | `rules.score/scoreCopa`, contestação, estorno e versões de bracket |
| 9.6 Rankings | `Store.v2_projection`, `League.rankings/tieRows`, snapshots |
| 9.7 Copa | `League.crown/copa/drawCopa/collectiveFinal`, terceiro lugar no motor |
| 9.8 Transversal | `auth.ts`, `Store.audit`, perfil, notificações, `/tv/:id`, CSV/PDF |
| 10 Segurança | Sessão, RBAC, DTOs estritos, idempotência, rate limit e acesso por participante/mesário |
| 11 Visual | Tokens semânticos, temas, laranja de destaque e números tabulares |
| 12 Parâmetros | `Params`, schema validado e formulário em Temporadas |

## Como conferir

`npm run check` executa a suíte e o build. `npm run test:browser` utiliza Chrome headless com CDP e banco descartável; configure `BROWSER_PATH` para o executável do Chrome se estiver em outro computador. Capturas de inspeção são gravadas em `/tmp/liga-v2-desktop.png` e `/tmp/liga-v2-mobile.png`.

O banco anterior permanece intacto nas tabelas de domínio v1. O backup anterior à atualização fica em `backups/antes-v2-*/liga.db`. A nova estrutura usa tabelas com prefixo `v2_`; a senha do administrador continua vindo do `.env`.
