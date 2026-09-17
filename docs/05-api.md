# API da nova versão

Prefixo `/api`. JSON de entrada e saída. Escritas POST/PUT exigem `Content-Type: application/json`. Todos os endpoints de domínio exigem cookie de sessão. A origem do navegador deve coincidir com `APP_ORIGIN`. Corpo limitado a 32 KB. IDs são inteiros positivos.

## Autenticação

| Método | Rota | Resultado |
| --- | --- | --- |
| GET | `/health` | Público, `{ "status": "ok" }` |
| POST | `/auth/login` | `{ "username": "...", "password": "..." }`; cria cookie, retorna usuário |
| GET | `/auth/me` | Usuário atual ou 401 |
| POST | `/auth/logout` | Enviar `{}`; revoga sessão e limpa cookie, 204 |

Login incorreto: 401 com mensagem genérica. Após 10 tentativas por janela global de 15 minutos: 429 com `Retry-After`. Login bem-sucedido cria um novo token. Sessões expiram em 8 horas, persistem no SQLite e são invalidadas pela troca de credencial.

## Domínio

| Método | Rota | Entrada / comportamento |
| --- | --- | --- |
| GET | `/bootstrap` | `{ jogadores, lancamentos, partidas }`; snapshot usado pelo dashboard |
| POST | `/jogadores` | `{ "nome": "Nome" }`, 201 |
| PUT | `/jogadores/:id` | Mesmo corpo; renomeia mantendo ID, 200 |
| DELETE | `/jogadores/:id` | Exclui somente sem histórico, 204 ou 409 |
| POST | `/partidas` | Corpo abaixo; grava partida e quatro lançamentos, 201 |
| DELETE | `/partidas/:id` | Exclui partida e seus pontos, 204 |
| POST | `/lancamentos` | Corpo abaixo; pontuação calculada no servidor, 201 |
| PUT | `/lancamentos/:id` | Mesmo corpo; apenas lançamento manual, 200 |
| DELETE | `/lancamentos/:id` | Apenas lançamento manual, 204 |

Partida:

```json
{
  "jogo": "Truco",
  "duplaA": [1, 2],
  "duplaB": [3, 4],
  "vencedora": "A"
}
```

Lançamento manual:

```json
{
  "jogadorId": 1,
  "jogo": "Truco",
  "tipo": "torneio_campeao"
}
```

Os IDs acima são exemplos; use IDs de jogadores cadastrados. Modalidades e tipos válidos estão em `src/shared/domain.ts`. Paciência aceita lançamentos manuais, mas não partidas em duplas. `pts`, `categoria`, `nome` e `partida_id` não são aceitos no corpo de lançamento da nova API.

`bootstrap` devolve jogadores `{ id, nome }`; lançamentos incluem `jogador_id`, nome atual, modalidade, tipo, pontos, categoria, vínculo opcional e data de criação; partidas incluem os nomes atuais dos participantes e data ISO. As respostas de criação/edição de lançamentos devolvem os campos gravados, sem o nome consultado por JOIN. Após uma mutação, o cliente recarrega o bootstrap.

## Erros

Formato principal: `{ "erro": "Mensagem" }`. Validação pode incluir `campos` com problemas de esquema. Códigos: 400 dados/JSON inválidos; 401 sessão ausente ou credencial incorreta; 403 origem rejeitada; 404 registro/rota ausente; 409 nome duplicado ou relação que impede operação; 413 corpo grande; 415 conteúdo não JSON; 429 excesso de login; 500 falha interna com mensagem genérica.

Lançamentos vinculados a partida não podem ser editados/excluídos isoladamente e retornam 404 nas rotas manuais. Corrija a partida inteira para preservar a consistência.

## Mudanças em relação ao legado

A API não é compatível com os corpos antigos: participantes agora são IDs; pontos e categoria não vêm do cliente. Não existe `/migrar-legado` na nova API. Não há paginação, idempotência de criação ou edição de partidas; esses limites devem ser considerados antes de integrar outros clientes.
