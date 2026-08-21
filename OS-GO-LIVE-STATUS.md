# OS — Go-Live Status / Ownership

> Fonte compartilhada de coordenação. Atualizar por evidência de gate, não por quantidade de commits.

| Gate | Owner | Status | Branch / Componente | Bloqueio atual | Evidência / próxima prova |
|---|---|---|---|---|---|
| G1 — 1A | congelado | ✅ PASS | Make 1A | — | validado ponta a ponta com dado real |
| G2 — 1B newest-wins | Claude | 🟡 EM TESTE | Make 1B | casos A/C/D ainda exigem confirmação final conforme último handoff | quatro casos com dado real |
| G3 — E2E-SYNC-CONFLICT | Claude | ⏸️ AGUARDANDO G2 | 1A + 1B | G2 | `ROTEIRO-E2E-SYNC-CONFLICT.md` |
| G4 — Retry automático | Claude + ação operacional | 🟡 NÃO FECHADO | scanner Make 5952040 | confirmação real do Run once / resultado | execução real + teto/retry |
| G5 — Sessão HMAC / E-TOCTOU-01 | ChatGPT | 🟡 EM EXECUÇÃO | backend integrado + Field divergente | red-team específico do PR #4; materializar Field autoritativo; migrar token no frontend; reconciliar `registrarUsoVeiculo`; E2E; enforcement | PR #4 mergeado e CI verde, mas red-team independente específico ainda pendente |
| G6 — Homologação candidata | ChatGPT; Claude co-review | ⛔ NÃO CRIADO | preparação documental apenas | G5 frontend + Field SHA autoritativo + versões Make/SP/Admin + demais pré-condições | `G6-CANDIDATE-MANIFEST.md` atualizado; nenhum candidate deployment existe |
| G7 — Deploy | coordenado | ⏹️ NÃO INICIADO | — | G2-G6 | plano + rollback |
| G8 — Produção assistida | coordenado | ⏹️ NÃO INICIADO | — | G7 | OS real controlada ponta a ponta |

## Ownership freeze

### Claude
- G2 — 1B newest-wins
- G3 — E2E-SYNC-CONFLICT
- G4 — retry
- P0 checklist/frontend conforme coordenação, sem criar linha paralela de HMAC

### ChatGPT
- G5 — sessão HMAC e definição do Field candidato
- autorização futura de criação de G6
- manifesto / homologação técnica quando as pré-condições forem fechadas
- revisão independente posterior de G2/G3

### Coordenado
- G7 deploy
- G8 produção assistida

## Decisão — fonte de verdade do Field

Foram identificados três artefatos divergentes:

1. `eletrium-field-checklist3` — worktree funcional do Code 2, com KM final, checklist P0 e UX atuais. **É a linhagem funcional autoritativa.**
2. `index.html` presente na linhagem de backend/PWA — snapshot antigo, sem `fecharFaseChecklist`. **É legado/fóssil e está proibido como fonte do Field candidato.**
3. `origin/main` do repo `Eletrium/eletrium-field` — snapshot manual antigo. **É histórico/legacy e está proibido como fonte do Field candidato.**

A linhagem #1 só poderá preencher `Field branch/build/commit` depois de ser materializada em branch remota dedicada com SHA estável. Até isso acontecer, **G6 permanece bloqueado**.

A presença de `index.html` dentro da branch de backend não o promove a frontend oficial. Backend e Field têm fontes de verdade distintas durante esta fase.

## Regras

1. Não editar simultaneamente a mesma região crítica sem handoff explícito.
2. `origin/main` permanece histórico/legacy por enquanto.
3. `active-os-backend-v2.1-20260815` é a linha ativa do backend, não a fonte de verdade do frontend Field.
4. O `index.html` carregado nessa linhagem é artefato legacy e não deve ser usado para build/homologação do Field.
5. `@40` permanece congelada.
6. Nenhum `clasp push`/`clasp deploy` candidato sem autorização explícita do owner G5/G6.
7. Nenhum gate passa por HTTP 200, commit ou mock isolado; exigir efeito real/evidência correspondente.
8. Funcionalidades P1/P2 permanecem congeladas até go-live P0.

## Evidência G5 — Onda 2

- PR #1: `chatgpt/g5-hmac-onda2-20260815` → `active-os-backend-v2.1-20260815`.
- Red-team Cowork 2: bloqueante de token válido + posse negada corrigido antes do merge.
- testes específicos: 12 PASS / 0 FAIL; runner portátil sem regressão.
- merge da Onda 2 na linha ativa concluído.

## Evidência G5 — Onda 3

- PR #3 foi supersedido e fechado sem merge.
- PR #4: `chatgpt/g5-hmac-onda3-clean-20260820`; commit `7b7a52bcd606e9d5852f4bb0f8640add601d8392`; squash merge `3c2e002826d9a28f77137072cec5fa1bb323b2dd`.
- CI do PR #4: SUCCESS; Onda 3 65 PASS / 0 FAIL; runner portátil 31 arquivos PASS / 0 FAIL.
- o PR #4 altera a prova de recusa para o contrato canônico `success:false`, inclui `getDiariaHoje` e amplia casos negativos.
- **red-team do PR #3 não é evidência final do PR #4**; novo red-team independente específico do #4 continua pendente.
- `registrarUsoVeiculo`: função existente no backend, sem case/call-site real confirmado; reconciliar antes do enforcement obrigatório.

## Próxima sequência G5 → G6

`red-team PR #4 → materializar eletrium-field-checklist3 em branch remota → migrar sessão/token no Field real → reconciliar registrarUsoVeiculo → E2E autenticado → congelar SHAs/versões de todos os componentes → owner autoriza criação do G6 → homologação integrada`.
