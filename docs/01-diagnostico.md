# Diagnóstico do projeto original

Análise realizada em 11/09/2026 por leitura do código e consulta ao SQLite em modo somente leitura. Os problemas abaixo são observações estáticas; não foi realizado teste de intrusão nem alteração do banco original.

## Inventário

| Arquivo | Responsabilidade |
| --- | --- |
| `Modalidades/index.js` | Express 5, rotas REST, criação de tabelas, acesso SQLite e arquivos estáticos |
| `Modalidades/dashboard_enge_jogos.html` | 503 linhas com HTML, eventos, estado, chamadas HTTP e regras de ranking |
| `Modalidades/package.json` | Projeto CommonJS chamado `truco`; dependências Express, sqlite3 e cors |
| `Modalidades/banco_engesoftware_league.db` | Persistência de jogadores, partidas e lançamentos |

O servidor original inicia com `node index.js`, na porta 3000, dentro de `Modalidades`. O frontend utiliza Tailwind via CDN e Font Awesome externo. Não há build. O script `npm test` termina com erro por não possuir uma suíte; seis verificações de pontuação rodam no console do navegador, sem encerrar processo em falha.

## Dados encontrados

| Tabela | Registros | Relações |
| --- | ---: | --- |
| jogador | 7 | Nome único com `COLLATE NOCASE` |
| partida | 1 | Quatro nomes de participantes armazenados como texto |
| lancamento | 4 | Nome textual e FK opcional para partida com exclusão em cascata |

`PRAGMA integrity_check` retornou `ok`. Os quatro lançamentos são de Truco: duas vitórias de 10 pontos e duas participações de 2 pontos. Não foram encontrados nomes de lançamentos sem cadastro na amostra atual. A integridade física do banco não comprova todas as regras de negócio. Nomes pessoais não são reproduzidos nesta documentação.

## Fluxo atual

O navegador chama `GET /api/bootstrap`, mantém uma cópia dos dados na memória e calcula a classificação. Jogadores são cadastrados, renomeados e excluídos pela interface. Partidas são registradas com duas duplas; a API cria quatro lançamentos. Pontos manuais aceitam nome livre de colaborador ou dupla. A API também permite editar/excluir lançamentos manuais e excluir partidas, mas o HTML atual não expõe esses fluxos de histórico/edição de pontos.

Há uma importação automática de `localStorage` quando o banco está vazio. Ela envia jogadores e lançamentos ao endpoint `/api/migrar-legado`, remove também a chave `truco-partidas`, mas não importa o histórico de partidas dessa chave. O servidor não implementa uma chave de idempotência para impedir duplicação caso a importação seja repetida.

## Pontos que orientaram a nova base

| Observação | Consequência | Tratamento inicial |
| --- | --- | --- |
| `express.static(__dirname)` | Arquivos do diretório, incluindo o banco, ficam potencialmente disponíveis por HTTP | Servir apenas `dist/` |
| Ausência de login e CORS aberto | Operações de leitura/escrita sem controle de acesso | Sessão e mesma origem |
| Nomes interpolados em `innerHTML` | Conteúdo cadastrado pode ser interpretado como HTML/script | Renderização textual pelo React |
| `pts`, `categoria`, `tipo` e `jogo` enviados pelo cliente com pouca validação | Pontuação pode divergir das regras | Enumerações e cálculo no servidor |
| Jogadores relacionados pelo nome | Renomeação altera várias colunas e pode ficar parcial | Chaves estrangeiras por ID |
| Exclusão do cadastro sem FK para participantes | Histórico pode referenciar jogador removido | Impedir exclusão com histórico |
| Partida e pontos inseridos sem transação | Falha intermediária deixa registros parciais | Transação para a operação inteira |
| Quatro jogadores distintos validados só no navegador | Requisição direta permite repetir participantes | Validação na API e restrição SQL |
| Importação e outras escritas compartilham conexão assíncrona | Transações podem se intercalar com outras requisições | Operações transacionais síncronas curtas |
| Erros expõem `error.message` | Detalhes internos chegam ao cliente | Respostas controladas |
| Ranking agrupado em objeto usando nome como chave | Identidade e nomes especiais podem causar resultados incorretos | `Map` por ID |
| Temporada anual e torneios trimestrais só no texto | Não existem filtros/modelos de temporada ou torneio | Registrar como requisito futuro |

Existe um comentário mencionando um PDF de regras; esse PDF não está no projeto. Os valores documentados foram extraídos do código, não conferidos contra um regulamento externo.
