# Migração e plano de evolução

## Situação atual

A pasta original e seu banco foram preservados. A nova aplicação inicia com banco vazio em `liga-enge/data/liga.db`. **Não foi implementado nem executado um importador de dados nesta etapa.** Isso mantém a migração separada das mudanças de modelo e permite validar a base antes de transferir o histórico real.

O levantamento encontrou 7 jogadores, 1 partida e 4 lançamentos no banco original. O total esperado dessa amostra é 24 pontos. Contagens são do momento da análise; devem ser refeitas quando houver migração.

## Procedimento planejado para o importador

1. Pausar escritas no legado e produzir um backup consistente pelo mecanismo de backup do SQLite. Registrar data, contagens e hash do arquivo.
2. Abrir a origem em modo somente leitura. Criar um novo banco de destino temporário; nunca apontar a nova aplicação diretamente ao arquivo antigo.
3. Normalizar nomes com NFC, trim e chave em minúsculas; gerar relatório de colisões. Não unir pessoas apenas por suposição.
4. Criar mapeamento de IDs de jogadores antigos para os novos. Lançamentos com nome livre de dupla, nomes ausentes ou ambíguos devem impedir importação e exigir resolução explícita.
5. Mapear as quatro referências de cada partida por nome; rejeitar participantes repetidos, inexistentes ou ambíguos.
6. Importar partidas e lançamentos existentes sem gerar os pontos automáticos novamente. Preservar datas, valores e vínculo com partida. Validar diferenças de regras e não recalcular silenciosamente pontuações históricas.
7. Executar tudo em transação. Gravar uma identificação única da origem para que repetir a importação não duplique os dados.
8. Comparar contagens, somas por jogador/modalidade/categoria e vínculos. Executar `integrity_check` e `foreign_key_check` e conferir uma amostra na interface.
9. Aprovar o relatório de comparação antes da troca do banco ativo. Manter o legado e o backup disponíveis para retorno.

Dados em `localStorage` pertencem a cada navegador/origem e não foram inspecionados. Não reativar a importação automática antiga na nova versão. Se existirem dados exclusivos de navegador, exportá-los e conciliá-los como fonte separada; partidas locais não podem ser apagadas apenas porque jogadores e pontos foram transferidos.

## Roadmap

| Etapa | Entregável | Estado |
| --- | --- | --- |
| 1. Conhecimento | Diagnóstico, regras e arquitetura | Documentado |
| 2. Base funcional | React/TS, API validada, IDs, transações, CRUD e ranking | Implementado |
| 3. Acesso inicial | Login administrativo, sessão e logout | Implementado |
| 4. Identidade do produto | Decidir contas individuais, SSO, papéis e recuperação | Pendente |
| 5. Migração assistida | Importador com simulação, relatório e idempotência | Pendente |
| 6. Publicação | Escolher host/domínio; HTTPS, processo, backups e monitoramento | Pendente |
| 7. Evolução da liga | Temporadas, torneios, desempate, arquivamento e auditoria | Pendente de regras |

## Próxima decisão recomendada

Escolher hospedagem e quem terá conta. Para um organizador e servidor persistente, a base atual é um ponto de partida operacional. Se cada colaborador tiver login ou a empresa exigir Microsoft Entra ID/Google Workspace, integrar o provedor escolhido e separar os papéis de leitura e organização antes de distribuir acesso. Se houver implantação em múltiplas instâncias/serverless, migrar para PostgreSQL antes de publicar.
