# Engesoftware Gaming League — Especificação Consolidada v2

> Revisão do documento `Requisito_v1`. Todas as ambiguidades foram resolvidas com uma decisão explícita.
> Cada decisão está marcada com **[D-n]** e traz a justificativa e o impacto técnico.
> Onde a v1 dizia "ex.:", o valor virou **parâmetro de temporada**, não constante em código.

---

## 0. Sumário das decisões tomadas

| ID | Incoerência na v1 | Decisão v2 |
|----|-------------------|------------|
| D-1 | "4 Campeões Trimestrais" vs. 5 modalidades × 4 trimestres = 20 campeões | Criado o título **Campeão Trimestral Geral** (1 por trimestre, agregado). Títulos por modalidade continuam existindo, mas dão pontos — não vaga direta. |
| D-2 | Vitória = 10 ou 10+2? | **Excludente**: vitória = 10, derrota/participação = 2. |
| D-3 | Piso "3 partidas **ou** 20 pontos" | Piso = **3 partidas casuais registradas no trimestre**. Pontos saem do critério de elegibilidade e servem só para seeding. |
| D-4 | Pontos de duplas/trios poluindo o ranking individual | **Dois ledgers separados** via campo `escopo` (`INDIVIDUAL` / `COLETIVO`). |
| D-5 | Média aritmética simples qualifica dupla/trio | Piso individual obrigatório para **todos** os integrantes + média **ponderada por nº de partidas**. |
| D-6 | Paciência: "menor tempo **ou** menos movimentos" | Cadeia ordenada: conclusão válida → tempo → movimentos → sorteio com seed. |
| D-7 | Uno usa pontuação invertida | Formalizado `direcao_pontuacao` por modalidade (`MAIOR_VENCE` / `MENOR_VENCE`). |
| D-8 | Uno e Douradinha só funcionam em faixas estreitas de inscritos | Fórmulas de composição de mesas/grupos + regra de corte por ranking. |
| D-9 | Chaveamento definido só para exatamente 8 | Regra de **bye** para qualquer N ≥ 4 + bracket reset padronizado em toda Eliminatória Dupla. |
| D-10 | Desempates sem fallback terminal | Toda cadeia termina em **sorteio auditável com seed persistida**. |
| D-11 | Saldo de tentos sem placar detalhado | Placar por queda/mão passa a ser **obrigatório** no registro de resultado. |

---

## 1. Modelo conceitual

### 1.1 Hierarquia temporal

```
Temporada (ano)
 └── Trimestre (ciclo) ×4
      ├── HappyHour (2ª sexta do mês, 17h–19h) ×3
      │    └── PartidaCasual *
      └── TorneioTrimestral (1 por modalidade)
           └── Chaveamento → Partida *
 └── CopaDosCampeoes (encerramento da temporada)
```

### 1.2 Modalidades

| Modalidade | Escopo | Jogadores/mesa | Formato do chaveamento | Direção de pontuação |
|---|---|---|---|---|
| Dominó Individual | INDIVIDUAL | 2 | Eliminatória Dupla | MAIOR_VENCE |
| Truco Mano a Mano | INDIVIDUAL | 2 | Eliminatória Dupla | MAIOR_VENCE |
| Buraco Individual | INDIVIDUAL | 2 | Eliminatória Dupla | MAIOR_VENCE |
| Uno | INDIVIDUAL | 4–6 | Fase de Mesas + Mesa Final | **MENOR_VENCE** |
| Paciência (Klondike/Spider) | INDIVIDUAL | 1 | Time-Attack 2 fases | **MENOR_VENCE** (tempo) |
| Truco em Duplas (2x2) | COLETIVO | 4 | Eliminatória Dupla | MAIOR_VENCE |
| Truco Douradinha (3x3) | COLETIVO | 6 | Round-robin + Playoff | MAIOR_VENCE |

> **[D-7]** `direcao_pontuacao` é config da modalidade, não `if (modalidade == 'UNO')` espalhado no código. Uno e Paciência usam *golf scoring* — menor total vence.

---

## 2. Pontuação

### 2.1 Partidas casuais (happy hour) — **[D-2]**

| Resultado | Pontos |
|---|---|
| Vitória | 10 |
| Derrota / participação | 2 |

Regras são **excludentes**: quem vence recebe 10 (não 12). Ambos os valores são parâmetros de temporada.

Para modalidades multi-jogador no casual (Uno, Douradinha), "vitória" = 1º lugar da mesa; os demais recebem 2.

### 2.2 Torneios trimestrais

| Colocação | Pontos |
|---|---|
| Campeão | 150 |
| Vice-campeão | 100 |
| 3º lugar | 60 |
| Participação (demais) | 15 |

Em modalidades coletivas, cada integrante recebe o valor integral, lançado com `escopo = COLETIVO`.

### 2.3 Separação de ledgers — **[D-4]**

Todo lançamento de pontos é uma linha em `PointsTransaction` com campo `escopo`:

- **Ranking Anual Individual** = `SUM(pontos) WHERE escopo = 'INDIVIDUAL'`
- **Ranking Anual de Equipes** = `SUM(pontos) WHERE escopo = 'COLETIVO'`, agrupado por integrante
- **Ranking Trimestral Geral** (define o Campeão Trimestral Geral) = apenas `INDIVIDUAL`

Sem isso, um jogador medíocre em dupla forte disputaria a Copa individual.

### 2.4 Ledger append-only

`PointsTransaction` é **imutável**. Correção = transação de estorno (valor negativo) + nova transação, ambas com `motivo` e `autor_id`. Nunca `UPDATE saldo`.

> Padrão: *event sourcing* simplificado / *append-only ledger*. Saldo é projeção, não estado.

---

## 3. Elegibilidade

### 3.1 Modalidades individuais — **[D-3]**

Para se inscrever em um torneio trimestral, o competidor precisa de:

- **≥ 3 partidas casuais homologadas no trimestre corrente** (`piso_partidas_trimestre`, parametrizável)

Pontuação **não** é critério alternativo. Justificativa: o objetivo declarado é constância nas mesas casuais; permitir "20 pontos" deixaria um jogador entrar com 2 partidas. Pontos continuam definindo **seeding**.

O piso é contado por **temporada+trimestre**, agregando todas as modalidades casuais (participar do happy hour conta, independente do jogo).

### 3.2 Duplas e trios — **[D-5]**

Uma equipe é elegível se:

1. **Todos** os integrantes (titulares e reservas) cumprem individualmente o piso de 3 partidas;
2. A **média ponderada** da equipe é calculada como:

```
media_ponderada = Σ(pontos_casuais_i) / Σ(partidas_casuais_i)
```

Ou seja: pontos por partida, não pontos absolutos. Isso neutraliza o jogador que inflou o total só por volume, e o que inflou a média com amostra de 1 partida (barrado pelo piso).

**Composição de equipes**: duplas = 2 titulares + até 1 reserva; trios = 3 titulares + até 1 suplente. O reserva só entra por ausência confirmada no check-in e **pontua normalmente** se jogar ao menos uma partida da etapa.

---

## 4. Seeding e chaveamento

### 4.1 Fonte do seeding

Ordenação pelo **Ranking Casual do trimestre** (pontos `INDIVIDUAL` acumulados no ciclo). Empate resolvido pela cadeia da seção 6.

O ranking usado é **congelado (snapshot)** no momento do fechamento das inscrições e persistido junto ao torneio. Reprodutibilidade > dado vivo.

### 4.2 Chaveamento olímpico — **[D-9]**

Padrão para 8 participantes:

```
M1: 1 vs 8    M2: 4 vs 5    M3: 2 vs 7    M4: 3 vs 6
```

**Para N ≠ potência de 2**, generalização:

1. `tamanho_chave = 2^ceil(log2(N))`
2. `byes = tamanho_chave - N`
3. Os `byes` primeiros seeds avançam automaticamente à 2ª rodada
4. Confrontos da 1ª rodada seguem o pareamento `seed_i vs seed_(tamanho_chave + 1 - i)`

Mínimo de 4 inscritos para abrir um torneio; abaixo disso a etapa é cancelada e todos recebem os 15 pontos de participação.

### 4.3 Eliminatória Dupla (1x1 e Duplas 2x2)

- **Winners Bracket**: séries em melhor de 3
- **Losers Bracket**: queda única até a final da repescagem (agilidade dentro da janela do evento)
- **Grande Final com bracket reset**: o invicto vence 1 série; o vindo da repescagem precisa vencer **duas séries consecutivas**

> **[D-9]** O bracket reset, descrito na v1 só para Duplas, passa a valer para **toda** Eliminatória Dupla, incluindo 1x1.

### 4.4 Regras por jogo

| Jogo | Condição de vitória da partida |
|---|---|
| Dominó | Primeiro a 100 pontos |
| Truco 1x1 | Melhor de 3 quedas de 12 tentos |
| Truco 2x2 | Melhor de 3 quedas de 12 tentos (repescagem: queda única) |
| Truco 3x3 | Grupos: queda única de 12 tentos · Playoff: melhor de 3 |
| Buraco | Teto de 1.500 pontos |

### 4.5 Uno — **[D-8]**

Composição de mesas em função de N inscritos:

```
n_mesas = ceil(N / 6)   // mesas de 4 a 6 jogadores
se N / n_mesas < 4  →  n_mesas = floor(N / 4)
```

Distribuição **serpentina** (snake) pelo ranking casual, para equilibrar força entre mesas:
mesa 1 recebe seeds 1, 2n, 2n+1…; mesa 2 recebe 2, 2n−1… — evita "mesa da morte".

- **Fase classificatória**: 3 rodadas por mesa. Vencedor da rodada pontua 0; demais somam as cartas retidas.
- **Classificação**: os 2 de cada mesa com **menor** pontuação residual.
- **Mesa Final**: 4 rodadas.

**Se `n_mesas > 3`** (mais de 3 mesas → mais de 6 classificados), insere-se uma **Fase Semifinal** intermediária: os classificados são redistribuídos em mesas de 4–6, jogam 3 rodadas, e os 2 melhores de cada mesa avançam — recursivamente, até restarem ≤ 6.

- Empate em pontuação residual na classificação → cadeia da seção 6.

### 4.6 Paciência — **[D-6]**

**Fase classificatória**: todos jogam a mesma *seed* de baralho (semente persistida no torneio, mesma distribuição para todos). Registram-se `concluiu` (bool), `tempo_ms` e `movimentos`.

**Ordenação — cadeia estrita, nesta ordem**:

1. Concluiu a partida (quem concluiu sempre à frente de quem não concluiu)
2. Menor `tempo_ms`
3. Menor `movimentos`
4. Entre quem **não** concluiu: maior número de cartas na fundação
5. Sorteio com seed persistida

**Playoff (Top 4)**: 1º vs 4º e 2º vs 3º, simultâneos, mesma seed de baralho, cronômetro aberto. Vence quem concluir primeiro; se nenhum concluir no tempo-limite (`tempo_limite_playoff`, default 10 min), aplica-se a cadeia acima a partir do item 4.

### 4.7 Douradinha 3x3 — **[D-8]**

```
n_grupos = ceil(T / 4)   // T = trios inscritos, grupos de 3 ou 4
```

- Round-robin em queda única de 12 tentos dentro de cada grupo.
- Avançam os **2 melhores de cada grupo**.
- Se `n_grupos > 2` (mais de 4 classificados), o playoff vira chave eliminatória simples com bye (seção 4.2), seeded pela colocação no grupo + saldo de tentos.
- Se `n_grupos == 2`: semifinais cruzadas (1ºA vs 2ºB, 1ºB vs 2ºA) + final, em melhor de 3.

**Disposição de mesa**: jogadores alternados `A-B-A-B-A-B`. Corte de maço e distribuição seguem rotação horária rígida, para equilibrar as posições de "mão" e "pé".

---

## 5. Copa dos Campeões (final anual)

### 5.1 Títulos e vagas — **[D-1]**

A v1 dizia "4 Campeões Trimestrais" com 5 modalidades por trimestre. Resolução:

**Campeão Trimestral por Modalidade** (20 no ano): recebe 150 pontos. Não dá vaga direta.

**Campeão Trimestral Geral** (4 no ano): jogador com maior pontuação `INDIVIDUAL` acumulada no trimestre (casuais + todas as etapas trimestrais). **Este** tem vaga direta na Copa.

Top 8 da Copa:

```
4 × Campeão Trimestral Geral
+ 4 × maiores pontuações do Ranking Anual Individual (excluídos os já classificados)
```

Se um jogador for Campeão Geral em mais de um trimestre, a vaga vaga desce para o próximo do Ranking Anual.

### 5.2 Formato

| Etapa | Participantes | Formato | Desempate |
|---|---|---|---|
| Quartas (Top 8) | 4 Campeões Gerais + Top 4 anual | Eliminatória simples, seed pela pontuação total do ano | Menor nº de derrotas no circuito → confronto direto → sorteio seeded |
| Semifinais | 4 vencedores | Melhor de 3 na modalidade sorteada | Confronto direto no ano → sorteio seeded |
| Final e 3º lugar | Finalistas e perdedores da semi | Série decisiva presencial | Morte súbita |

**Sorteio de modalidade nas semifinais**: a seed do RNG é gerada, **persistida e exibida** antes do sorteio. Sorteio não reprodutível é sorteio contestável.

### 5.3 Finais coletivas

- **Duplas**: Final Four das 4 duplas com maior média ponderada anual.
- **Douradinha**: triangular final com os 3 trios de maior pontuação acumulada.

---

## 6. Cadeia de desempate universal — **[D-10]**

Aplicada em qualquer contexto de ranking, na ordem, até quebrar o empate:

1. Maior número de vitórias diretas
2. Saldo de tentos/pontos (marcados − sofridos)
3. Confronto direto no período
4. Maior número de partidas casuais (constância)
5. **Sorteio com seed persistida** — terminal, sempre resolve

> A etapa 5 é obrigatória. Sem terminal, o sistema pode ficar em estado irresolvível — e vai, mais cedo ou mais tarde.

O sistema deve ser capaz de **explicar** a posição: *"3º lugar — empatado em vitórias com Fulano, decidido por saldo de tentos (+14 vs +9)."*

---

## 7. Registro de resultados

### 7.1 Placar detalhado obrigatório — **[D-11]**

`winner_id` sozinho **não** atende ao requisito. Registro mínimo por partida:

```
Partida
 ├── quedas[]        // cada queda com tentos_a, tentos_b
 ├── pontos_finais   // por participante
 ├── duracao         // opcional, obrigatório em Paciência
 └── movimentos      // só Paciência
```

Sem isso, "saldo de tentos" (seção 6, item 2) é incalculável.

### 7.2 Fluxo de homologação

```
RASCUNHO → REPORTADO → HOMOLOGADO → (CONTESTADO → CORRIGIDO)
```

- **REPORTADO**: um participante ou o mesário lança o resultado.
- **HOMOLOGADO**: confirmação do adversário **ou** do mesário/organizador. Só aqui os pontos entram no ledger.
- **CONTESTADO**: abre janela de 48h; correção gera estorno + novo lançamento, com trilha de auditoria.

> Quem reporta não pode ser quem homologa sozinho. Ranking auto-declarado não sobrevive à primeira premiação real.

### 7.3 W.O. e no-show

- No-show no check-in: adversário avança, recebe a vitória; ausente perde os pontos de participação daquela etapa.
- Desistência no meio da série: placar congelado, vitória ao adversário.

### 7.4 Rollback de resultado

Corrigir um resultado já propagado deve **desfazer em cascata** as partidas seguintes do bracket. O estado do chaveamento é versionado; correção cria nova versão e registra o diff.

> Esta é a fonte nº 1 de bug em sistema de torneio. Escreva teste para: corrigir a M1 de uma chave de 8 já finalizada e verificar que o campeão foi recalculado.

---

## 8. Modelo de dados (esboço)

```
Usuario(id, nome, email, papel[], ativo)
Temporada(id, ano, params_json, status)
Trimestre(id, temporada_id, numero, inicio, fim)
Modalidade(id, slug, escopo, min_jogadores, max_jogadores,
           direcao_pontuacao, formato_chaveamento, regras_json)

HappyHour(id, trimestre_id, data, hora_inicio, hora_fim, status)
PartidaCasual(id, happy_hour_id, modalidade_id, status, seed_rng)
PartidaCasualParticipante(partida_id, usuario_id, colocacao, pontos_partida)

Equipe(id, torneio_id, nome, tipo[DUPLA|TRIO])
EquipeIntegrante(equipe_id, usuario_id, papel[TITULAR|RESERVA])

Torneio(id, trimestre_id|null, modalidade_id, tipo[TRIMESTRAL|COPA],
        status, snapshot_ranking_json, seed_rng, abertura, fechamento)
Inscricao(id, torneio_id, usuario_id|equipe_id, seed, status, checkin_em)

Chaveamento(id, torneio_id, versao, tipo, estrutura_json, criado_em)
Partida(id, chaveamento_id, rodada, slot, bracket[W|L|GRUPO|MESA],
        status, proximo_slot_vitoria, proximo_slot_derrota)
PartidaParticipante(partida_id, inscricao_id, colocacao, pontos, tentos_pro, tentos_contra)
Queda(id, partida_id, numero, placar_json)

PointsTransaction(id, usuario_id, temporada_id, trimestre_id,
                  escopo[INDIVIDUAL|COLETIVO], origem_tipo, origem_id,
                  pontos, motivo, autor_id, criado_em, estorna_id|null)

AuditLog(id, entidade, entidade_id, acao, antes_json, depois_json, autor_id, criado_em)
```

**Índices críticos**: `PointsTransaction(usuario_id, temporada_id, escopo)`, `PartidaCasualParticipante(usuario_id)`, `Inscricao(torneio_id, status)`.

**Ranking como materialized view** (ou tabela de projeção com refresh no commit da transação) — recalcular `SUM` a cada request de leaderboard não escala nem no happy hour.

---

## 9. Backlog funcional

> Implementação v0.2.0: itens marcados abaixo possuem implementação. Evidências, testes e decisões para casos ambíguos estão em [Implementação da v2](docs/07-especificacao-v2.md). A marcação não significa publicação em produção ou teste de carga.

Marque o que já existe; o restante é o gap real.

### 9.1 Núcleo
- [x] Entidades Temporada / Trimestre / Modalidade
- [x] Tabela de parâmetros versionada por temporada (10/2, 150/100/60/15, piso, tetos)
- [x] Timezone fixo `America/Sao_Paulo` com tratamento de horário de verão
- [x] Seed de modalidades e regras

### 9.2 Happy hour e casuais
- [x] Geração automática da agenda: 2ª sexta de cada mês, 17h–19h (regra de calendário, não data fixa)
- [x] Validação de janela de registro (bloqueia ou flaga lançamento fora do horário)
- [x] Registro de partida casual com confirmação dupla ou papel de mesário
- [x] Lançamento de pontos no ledger ao homologar

### 9.3 Elegibilidade e inscrições
- [x] Cálculo do piso de 3 partidas por trimestre
- [x] Validação na inscrição com **motivo legível** da recusa
- [x] Média ponderada de dupla/trio + piso de cada integrante
- [x] Janela de inscrição, lista de espera, check-in no dia
- [x] Cadastro e ativação de reserva/suplente

### 9.4 Motor de chaveamento
- [x] `SingleElimination`
- [x] `DoubleElimination` (winners + losers + bracket reset)
- [x] `RoundRobin` (grupos)
- [x] `GroupStage + Playoff`
- [x] `TimeAttack` (Paciência)
- [x] `TableGroups` com distribuição serpentina (Uno)
- [x] Geração de seeding olímpico + byes para N arbitrário
- [x] Avanço automático ao homologar resultado
- [x] **Rollback em cascata** com versionamento do bracket

### 9.5 Resultados
- [x] Placar por queda/mão
- [x] W.O., desistência, no-show
- [x] Contestação e correção com auditoria

### 9.6 Rankings
- [x] Ranking casual trimestral (define seeding)
- [x] Ranking anual individual
- [x] Ranking anual de duplas/equipes (separado)
- [x] Cadeia de desempate configurável e **explicável**
- [x] Snapshot histórico por torneio

### 9.7 Copa dos Campeões
- [x] Apuração do Campeão Trimestral Geral
- [x] Qualificação automática do Top 8 com regra de vaga vaga
- [x] Sorteio de modalidade com seed exibida e persistida
- [x] Disputa de 3º lugar

### 9.8 Transversal
- [x] Auth + RBAC (`jogador`, `mesario`, `organizador`, `admin`)
- [x] Audit log de toda mutação de pontos e bracket
- [x] Perfil do jogador: histórico, head-to-head, estatísticas
- [x] Notificações (próxima partida, mesa, chamada)
- [x] **Tela pública de bracket ao vivo** (TV do happy hour) — maior ganho de percepção do projeto
- [x] Export CSV/PDF para premiação

---

## 10. Segurança

Hábitos que, se entrarem agora, ficam:

| Risco | Regra |
|---|---|
| **Identidade forjada** | `usuario_id` **sempre** da sessão/token. Nunca do body ou query. |
| **IDOR** | `POST /partidas/:id/resultado` precisa validar que o autor é participante daquela partida ou mesário do torneio. Achar o ID não pode ser autorização. |
| **Pontuação no cliente** | O front nunca envia pontos calculados. Envia o placar bruto; o servidor recalcula e é a única fonte de verdade. |
| **Duplo lançamento** | Chave de idempotência no registro de resultado. Duplo clique = pontos dobrados. |
| **Escalada de privilégio** | Papel nunca vem do payload. Checagem por middleware, não por `if` na view. |
| **Rate limit** | Endpoints de registro de resultado e inscrição. |
| **Mass assignment** | DTO explícito na entrada. Nada de `Model.update(req.body)`. |
| **Vazamento em logs** | Não logar token, e-mail completo nem payload inteiro em produção. |

---

## 11. Identidade visual

### 11.1 Cor de marca

Laranja base estimado do logo: **`#EE7623`**.

> Confirme no guia de marca ou no SVG original. Amostrar cor de PNG comprimido introduz desvio.

**Restrição de acessibilidade**: `#EE7623` sobre branco dá contraste ~3:1 — **reprova em WCAG AA para texto normal**. Passa apenas para componentes de UI e texto grande (≥18.66px bold / ≥24px regular).

Consequência de design: **o laranja é cor de preenchimento, não de texto em fundo claro.** Botão laranja com texto branco, sim. Link laranja em parágrafo, não — use `--brand-600` ou mais escuro.

### 11.2 Escala

```
--brand-50:  #FEF4EC
--brand-100: #FDE4CF
--brand-200: #FAC49F
--brand-300: #F6A470
--brand-400: #F28D4A
--brand-500: #EE7623   /* base da marca */
--brand-600: #D65F12
--brand-700: #A84A0E
--brand-800: #7A360B
--brand-900: #4D2207
```

### 11.3 Tokens semânticos

Nomeie por função, nunca por cor (`--accent`, não `--laranja`). Trocar a marca depois não deve exigir find-and-replace.

```css
:root {
  --bg:            #FFFFFF;
  --surface:       #F7F7F8;
  --surface-raised:#FFFFFF;
  --border:        #E4E4E7;
  --text:          #18181B;
  --text-muted:    #52525B;
  --accent:        var(--brand-600);  /* texto e links */
  --accent-fill:   var(--brand-500);  /* fundos e botões */
  --accent-fg:     #FFFFFF;           /* texto sobre accent-fill */
  --success:       #15803D;
  --danger:        #B91C1C;
  --warning:       #A16207;
}

[data-theme="dark"] {
  --bg:            #0F1012;
  --surface:       #1A1B1F;
  --surface-raised:#232428;
  --border:        #2E3035;
  --text:          #ECECEE;
  --text-muted:    #A1A1AA;
  --accent:        #F79B52;  /* clareado: ~7:1 sobre --bg */
  --accent-fill:   var(--brand-500);
  --accent-fg:     #16110C;
  --success:       #4ADE80;
  --danger:        #F87171;
  --warning:       #FBBF24;
}
```

> No dark mode o `#EE7623` puro sobre `#0F1012` "vibra" (halation por excesso de saturação em fundo escuro). Por isso `--accent` no escuro é uma variante clareada e levemente dessaturada.

### 11.4 Implementação

- CSS custom properties em `:root` + `[data-theme="dark"]`
- Default por `prefers-color-scheme`, com override manual persistido (cookie ou `localStorage`)
- Aplicar o tema **antes do primeiro paint** (script inline no `<head>`) para evitar *flash of wrong theme* (FOUC)
- Tailwind: `darkMode: 'class'` + cores do tema apontando para as variáveis. Evite `dark:` espalhado por centenas de componentes — centralizado em tokens, o dark mode vira config de uma linha

```js
// tailwind.config.js
colors: {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  accent: { DEFAULT: 'var(--accent)', fill: 'var(--accent-fill)', fg: 'var(--accent-fg)' },
}
```

### 11.5 Direção estética

Laranja é cor de alta energia e satura rápido. Usá-lo como cor dominante deixa a interface cansativa numa tela que as pessoas vão olhar por 2h no happy hour.

- **Base neutra**, laranja reservado para: ação primária, jogador em destaque, linha vencedora do bracket, badge de campeão
- Tipografia: uma sans geométrica de peso variável (Inter, Geist, Satoshi). Números tabulares (`font-variant-numeric: tabular-nums`) em toda tabela de placar e ranking — sem isso, os dígitos dançam na coluna
- Bracket: linhas em `--border`, caminho do vencedor em `--accent`. O olho segue a cor
- Espaçamento em escala de 4px, raio de borda consistente (8px componentes, 12px cards)

---

## 12. Parâmetros configuráveis por temporada

Nenhum destes deve ser literal no código:

```json
{
  "pontos_vitoria_casual": 10,
  "pontos_participacao_casual": 2,
  "pontos_campeao_trimestral": 150,
  "pontos_vice_trimestral": 100,
  "pontos_terceiro_trimestral": 60,
  "pontos_participacao_trimestral": 15,
  "piso_partidas_trimestre": 3,
  "min_inscritos_torneio": 4,
  "teto_pontos_domino": 100,
  "teto_pontos_buraco": 1500,
  "tentos_por_queda_truco": 12,
  "rodadas_uno_classificatoria": 3,
  "rodadas_uno_final": 4,
  "tempo_limite_playoff_paciencia_min": 10,
  "janela_contestacao_horas": 48,
  "happy_hour": { "semana_do_mes": 2, "dia_semana": "SEXTA", "inicio": "17:00", "fim": "19:00" }
}
```

---

## 13. Ordem sugerida de implementação

1. **Fundação** — modelo de dados, auth/RBAC, parâmetros de temporada, ledger append-only
2. **Casuais** — happy hour, registro de partida, homologação, ranking casual
3. **Elegibilidade e inscrição** — piso, seeding, snapshot de ranking
4. **Motor de chaveamento** — comece por `SingleElimination`, depois `DoubleElimination`, e só então os formatos especiais (Uno, Paciência)
5. **Resultados e rollback** — a parte com mais bugs; blinde com teste
6. **Rankings anuais e Copa**
7. **Tela pública ao vivo, notificações, export**

O item 4 é o coração do sistema e o que mais custa. Modele o motor como **estratégia plugável** (`interface BracketEngine { gerar(), avancar(), reverter() }`) — cada formato é uma implementação. Não faça `switch (formato)` dentro de uma função gigante.
