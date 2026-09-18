# Liga Enge · v2

Gestão da Engesoftware Gaming League: temporadas, happy hours, inscrições, torneios, resultados homologados e rankings individuais/coletivos.

## Executar

```bash
npm ci
npm run setup # somente se ainda não existir .env
npm run dev
```

Abra **http://127.0.0.1:5173**. Se já utilizava a primeira versão, mantenha seu `.env`: o usuário `admin` e sua senha continuam válidos. O banco anterior é preservado e seus dados ficam disponíveis em Auditoria → Consultar dados anteriores à v2.

## Primeiro uso da v2

1. Entre como administrador e crie contas em **Usuários**. Cada pessoa deve ter sua própria conta.
2. Em **Temporadas**, abra o ano; os quatro trimestres e 12 happy hours são gerados automaticamente.
3. Selecione um encontro e crie uma partida em **Happy hours**. Informe os placares no rascunho.
4. Outro participante adversário ou mesário/organizador homologa. Só então entram pontos no ranking.
5. Após cumprir o piso de casuais, faça a inscrição no torneio, confirme check-in e gere o chaveamento.
6. Acompanhe a disputa em **Torneios** ou abra a tela pública de TV.

O administrador que reportou um resultado também precisa de outra pessoa para homologá-lo. A nova versão não possui lançamento manual irrestrito ou exclusão de pontos.

## Documentação

- [Especificação consolidada](<ESPEC_Liga_Engesoftware_v2 (1).md>)
- [Implementação, decisões e validação da v2](docs/07-especificacao-v2.md)
- [Publicação na Vercel com banco Turso](docs/08-vercel.md)
- [Diagnóstico da aplicação original](docs/01-diagnostico.md)

Os documentos `02` a `06` descrevem a fundação v1; para comportamento funcional atual prevalecem a especificação v2 e o documento `07`.

## Código e comandos

`src/v2/model.ts`: contratos e modalidades; `rules.ts`: calendário/placares/ranking; `engine.ts`: estratégias de torneio; `service.ts`: casos de uso; `store.ts`: persistência/ledger; `auth.ts`: contas/permissões; `api.ts`: HTTP; `src/client`: interface.

```bash
npm run check # testes de integração e build
npm run build
npm start     # interface compilada e API em 3001
```

Ao usar `npm start` localmente, configure `APP_ORIGIN=http://127.0.0.1:3001`. Para `npm run dev`, use `APP_ORIGIN=http://127.0.0.1:5173`.

Para publicar na **Vercel**, siga [o guia de configuração do Turso e deploy](docs/08-vercel.md). A interface e a API ficam na Vercel; os dados persistem no Turso/libSQL. Configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` e `APP_ORIGIN` nas variáveis de produção. O projeto já inclui `vercel.json` e a função `api/index.ts`.

Localmente, sem variáveis do Turso, o banco SQLite continua em `data/liga.db`. Em servidor próprio com SQLite, a publicação exige `NODE_ENV=production`, `APP_ORIGIN=https://SEU-DOMINIO`, proxy HTTPS e disco persistente. O processo local escuta em loopback por padrão.
