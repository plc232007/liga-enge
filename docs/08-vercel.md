# Publicar na Vercel com Turso

A interface Vite e a API Express ficam no mesmo projeto Vercel. O banco fica no
Turso/libSQL e é acessado por `@libsql/client`. Não há banco em `/tmp`, réplica
local nem dependência de disco persistente na Vercel. Sem as credenciais remotas,
a API retorna 503 e não cria um banco temporário.

## 1. Criar o banco

Crie uma conta no [Turso](https://turso.tech/) e um banco **libSQL** compatível com
`@libsql/client`. Use o painel ou a [CLI oficial](https://docs.turso.tech/cli/installation).
Escolha uma região próxima à região das funções na Vercel para reduzir a latência
das transações. Consulte o plano do serviço antes de criar recursos.

Para começar sem os dados locais:

```bash
turso auth login
turso db create liga-enge
turso db show liga-enge --url
turso db tokens create liga-enge
```

As tabelas e o administrador são criados na primeira inicialização da API.

### Levar os dados locais existentes

Se quiser manter usuários, temporadas, partidas, rankings e auditoria, use este
caminho **no lugar de criar um banco vazio**. Suspenda lançamentos locais durante
a troca para não deixar alterações posteriores à cópia fora do banco remoto.

```bash
npm run db:export -- backups/turso.db
turso db create liga-enge --from-file backups/turso.db
turso db show liga-enge --url
turso db tokens create liga-enge
```

`db:export` faz uma cópia consistente, incluindo os dados confirmados no WAL, e
recusa sobrescrever arquivos existentes. Mantenha o `.env` e o banco original:
o mesmo `ADMIN_USERNAME` e `ADMIN_PASSWORD_HASH` preserva o acesso do administrador.
A cópia contém dados privados e está excluída do Git.

## 2. Importar o repositório na Vercel

Importe `plc232007/liga-enge`, branch `main`, com a raiz do projeto em `.`.
O `vercel.json` configura Vite, `npm run build`, saída `dist`, a API e a rota de TV.
Selecione Node.js **22.x** nas configurações do projeto.

Em **Settings → Environment Variables**, configure para **Production**:

| Variável | Valor |
| --- | --- |
| `TURSO_DATABASE_URL` | URL `libsql://...` fornecida pelo Turso |
| `TURSO_AUTH_TOKEN` | Token de leitura e escrita do banco |
| `ADMIN_USERNAME` | Valor do `.env` local, normalmente `admin` |
| `ADMIN_PASSWORD_HASH` | Valor completo do `.env` local: `salt:hash`, não a senha em texto |
| `APP_ORIGIN` | Endereço público exato, como `https://liga-enge.vercel.app`, sem barra final |

Não coloque prefixo `VITE_` nessas variáveis: são exclusivas do servidor.
Não configure `DATABASE_PATH`, `HOST` ou `PORT` na Vercel.
Se não houver `.env`, `npm run setup` gera o hash e informa a senha uma única vez.
Não execute o setup novamente se você já tem credenciais.

Se `APP_ORIGIN` não estiver definida, a API usa `https://${VERCEL_URL}`. Para acessar
pelo domínio fixo do projeto ou domínio próprio, configure `APP_ORIGIN` explicitamente.
Um domínio diferente do configurado será recusado nas operações de escrita.
Use banco e credenciais separados em **Preview**; não conecte previews ao banco de produção.

Faça o deploy após salvar as variáveis. Ao alterá-las, faça um novo deploy.

## 3. Verificar

1. Abra `/api/health`: deve retornar `{"status":"ok","version":2}`.
2. Entre com seu usuário e senha e crie uma temporada de teste.
3. Faça outro deploy e confira que a temporada continua disponível.
4. Confira um torneio em `/tv/ID_DO_TORNEIO`.

`npm run check` valida o build e os testes locais usando o mesmo driver libSQL,
incluindo integridade, rollback, concorrência e persistência entre inicializações.
Esses testes não substituem a verificação do deploy com credenciais reais.

### Se a API retornar 503

No painel da Vercel, abra **Logs**, acesse `/api/health` e procure
`Falha ao iniciar API`. O registro informa a etapa (`origem`,
`configuracao-banco`, `conexao-banco` ou `aplicacao`), o tipo do erro,
códigos conhecidos, status HTTP de falhas remotas e localizações no código. Mensagens brutas, tokens,
senhas e URLs do banco não são registrados. A resposta pública continua genérica.
Um registro que mostre apenas `TypeError` pertence à versão anterior desse
diagnóstico; publique a alteração de código antes de consultar novamente.
Falhas HTTP do Turso também incluem `motivo` (uma classificação da resposta)
e `formatoToken` (por exemplo, `endereco-no-lugar-do-token` ou `formato-jwt`).
Esses campos não contêm a resposta bruta nem a credencial. `formato-jwt` indica
apenas o formato do texto; não garante assinatura válida, permissão ou validade.

## Transações e desenvolvimento local

Sem `TURSO_DATABASE_URL`, o desenvolvimento local continua usando `data/liga.db`
(ou `DATABASE_PATH`). Com URL e token, `npm run dev` também pode acessar Turso;
use um banco de desenvolvimento. As consultas agora são assíncronas. As transações
mantêm operações, auditoria, pontos e resposta de idempotência juntas, e aguardam
o commit antes de responder. Cada requisição mantém seu próprio contexto de transação.

Referências: [Turso SDK e transações](https://docs.turso.tech/sdk/ts/reference),
[importação SQLite](https://docs.turso.tech/cli/db/create),
[Vite e funções na Vercel](https://vercel.com/docs/frameworks/frontend/vite).
