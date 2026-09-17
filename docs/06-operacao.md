# Execução e publicação

## Configuração local

```bash
npm ci
npm run setup
npm run dev
```

Abra `http://127.0.0.1:5173` e use a credencial exibida pelo `setup`. A origem usa exatamente `127.0.0.1`; usar `localhost` sem alterar a configuração causa rejeição de origem nas escritas.

O arquivo `.env` é carregado pelo Node e não é conteúdo público. `setup` usa criação exclusiva e permissões 0600. O banco é independente do original. `.env`, `data/`, dependências e build estão ignorados pelo Git da nova pasta.

| Variável | Padrão / exigência |
| --- | --- |
| `ADMIN_USERNAME` | Obrigatória; `setup` usa `admin` |
| `ADMIN_PASSWORD_HASH` | Obrigatória; salt e hash scrypt gerados pelo `setup` |
| `APP_ORIGIN` | Origem exata; `http://127.0.0.1:5173` em desenvolvimento |
| `HOST` | `127.0.0.1` |
| `PORT` | `3001`; se alterada em desenvolvimento, ajustar proxy do Vite |
| `DATABASE_PATH` | `data/liga.db`, relativo à raiz da nova aplicação ou absoluto |
| `NODE_ENV` | Usar `production` na publicação; exige `APP_ORIGIN` com HTTPS |

Sem credencial válida o servidor recusa a inicialização. Não existe modo de pular autenticação. Para substituir uma credencial local, pare a aplicação, preserve as variáveis de infraestrutura, mova o `.env` antigo para local protegido e execute `setup` novamente; restaure as variáveis de infraestrutura no novo arquivo. Não publique o backup do `.env`. Alterar usuário/hash invalida sessões antigas.

## Publicação prevista: servidor único

Não houve publicação nesta entrega. Este é o procedimento para a infraestrutura escolhida posteriormente:

1. Preparar uma VM/servidor Linux com Node compatível, disco persistente e usuário de serviço sem privilégios administrativos. Restringir leitura de `.env`, banco e backups a esse usuário.
2. Instalar dependências com `npm ci`, executar `npm run check` e manter `dist/`, código do servidor e dependências de runtime. `npm start` usa `tsx`, que está nas dependências de produção.
3. Gerar a credencial no servidor com `npm run setup`. Configurar `NODE_ENV=production`, `APP_ORIGIN=https://SEU-DOMINIO` e caminho persistente do banco. Não transportar a senha de desenvolvimento para uso público.
4. Configurar domínio e proxy HTTPS (por exemplo Caddy ou Nginx) para encaminhar ao processo em `127.0.0.1:3001`. Redirecionar HTTP para HTTPS. Não disponibilizar a porta da API diretamente na internet.
5. Manter `npm start` com um supervisor de processos e reinício automático. Executar uma única instância; este projeto não tem coordenação para múltiplas réplicas.
6. Aplicar limite de requisições de login no proxy, definir backups e monitorar disponibilidade/espaço em disco. O limite global da aplicação é um mecanismo inicial em memória.
7. Validar via HTTPS: login, cookie Secure/HttpOnly/SameSite, logout, 401 sem sessão, partida com pontuação, persistência após reinício, bloqueio de origem e ausência de acesso HTTP a `.env` e banco.

O host não foi escolhido. Não usar arquivo SQLite em filesystem efêmero de função serverless ou compartilhamento de rede. Se esse for o modelo da plataforma, adotar PostgreSQL e implementar a migração antes da publicação. A [documentação do SQLite](https://www.sqlite.org/whentouse.html) detalha essas condições. HTTPS e proteção de cookies seguem a [orientação oficial do Express](https://expressjs.com/en/advanced/best-practice-security.html).

## Backup e restauração

Com WAL ativo, copiar apenas `liga.db` enquanto o processo escreve pode perder alterações ainda presentes em `-wal`. Use a API de backup do SQLite ou o comando `.backup` do cliente SQLite, quando instalado. Alternativamente, pare o serviço de forma limpa e copie o banco depois do fechamento da conexão. Mantenha cópia criptografada fora do servidor e uma política de retenção acordada.

Na restauração: pare o serviço, preserve o estado atual, restaure o backup em um caminho novo, execute `integrity_check` e `foreign_key_check`, compare contagens e ranking, aponte `DATABASE_PATH` ao arquivo validado e reinicie. Limpe a tabela `sessao` no banco restaurado para não reativar sessões de um backup. Teste restaurações periodicamente; a rotina automatizada de backup ainda não foi implementada.

## Verificação de desenvolvimento

`npm run check` executa testes HTTP em SQLite em memória e compilação TypeScript/Vite. Os testes não abrem nem alteram o banco original. Cobrem consistência de partida e pontos, rollback por falha, renomeação, bloqueio de exclusão com histórico, validação, filtros e autenticação. Não substituem teste de navegador, revisão de acessibilidade, avaliação de carga ou validação do proxy real.

Para operação com vários organizadores, priorizar contas individuais e auditoria; compartilhar a conta inicial impede atribuir mudanças a uma pessoa. Recuperação de senha, MFA e integração corporativa ainda exigem a etapa de identidade descrita no roadmap.
