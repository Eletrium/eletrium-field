# OS — Go-Live Status / Ownership

> Fonte compartilhada de coordenação. Atualizar por evidência de gate, não por quantidade de commits.

| Gate | Owner | Status | Branch / Componente | Bloqueio atual | Evidência / próxima prova |
|---|---|---|---|---|---|
| G1 — 1A | congelado | ✅ PASS | Make 1A | — | validado ponta a ponta com dado real |
| G2 — 1B newest-wins | Claude | 🟡 EM TESTE | Make 1B | confirmar estado atual pela frente Claude antes de alterar este gate | evidência real mais recente de G2 |
| G3 — E2E-SYNC-CONFLICT | Claude | ⏸️ DEPENDE DE G2 | 1A + 1B | G2 | `ROTEIRO-E2E-SYNC-CONFLICT.md` + execução real |
| G4 — Retry automático | Claude + ação operacional | 🟡 NÃO FECHADO | scanner Make | confirmar evidência real mais recente pela frente Claude | execução real + teto/retry |
| G5 — Sessão HMAC / E-TOCTOU-01 | ChatGPT; Claude assumiu backend/PR#6/autorização G6 | 🟢 BACKEND FECHADO | PR#6 mergeado (`52c9cca`) | Field: status de migração de token/sinal reauth/E2E não reconfirmado nesta rodada — owner autorizou G6 apesar disso | PR#6 aprovado pela Cowork 2 sem bloqueante; 103/103 REAUTH; 33/33 suíte portátil |
| G6 — Homologação candidata | Claude (autorização assumida do ChatGPT) | 🟡 DECLARADA FORMALMENTE, SEM DEPLOYMENT TÉCNICO | `OS_FIELD_CANDIDATE_V2_1` | criação técnica (`clasp deploy`) exige autorização separada; ERP Admin build e segredos HMAC do ambiente candidato ainda pendentes | `G6-CANDIDATE-MANIFEST.md` atualizado 24/08 — versões congeladas + rollback documentado; nenhum candidate deployment técnico existe |
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

## Evidência G5 — Onda 3 / PR #4

- PR #3 foi supersedido e fechado sem merge.
- PR #4: `chatgpt/g5-hmac-onda3-clean-20260820`; commit `7b7a52bcd606e9d5852f4bb0f8640add601d8392`; squash merge `3c2e002826d9a28f77137072cec5fa1bb323b2dd`.
- CI do PR #4: SUCCESS; Onda 3 65 PASS / 0 FAIL; runner portátil 31 arquivos PASS / 0 FAIL.
- red-team independente Cowork 2 executado especificamente contra o PR #4: **zero bloqueante para o PR**.
- três achados antigos do PR #3 foram confirmados resolvidos por inspeção independente: `isRejected`/`_recusa`, mutação negativa de token e existência/status órfão de `registrarUsoVeiculo`.
- `getDiariaHoje` foi inspecionado diretamente no PR #4 e o guard de identidade confirmado.

### Novos pontos do red-team PR #4 — classificação final

1. A aparente divergência de `_recusa` entre Onda 2 e Onda 3 era divergência do harness: `HMAC_Onda2.js` **não define uma segunda `_recusa`**. Em produção, ambas usam a `_recusa` global/canônica de `Código.js`.
2. `retryable:false` para sessão expirada é **deliberado**: retry automático com o mesmo token expirado produziria loop. O Field deverá receber sinal separado de reautenticação.
3. `verificarTokenSessao` real foi inspecionado e é fail-closed para ausência, malformação, assinatura inválida, expiração e técnico divergente.

## PR #5 — contrato pré-enforcement — ✅ INTEGRADO

- branch: `chatgpt/g5-session-contract-preenforcement-20260821`
- base original: `3c2e002826d9a28f77137072cec5fa1bb323b2dd`
- HEAD testado: `b3803d8e7bdf913e8b66013e933e8ffd29f2dd36`
- workflow: `32521567331` — SUCCESS
- teste específico: **18 PASS / 0 FAIL**
- suíte portátil completa: **32 arquivos PASS / 0 FAIL**
- escopo: teste somente, sem alteração de runtime
- squash merge na linha ativa: `20c53f41e84a3af01b11964b45372999f0f22885`
- prova permanente: envelope canônico único Onda 2/3; `retryable:false` para expiração; verifier fail-closed sem exceção para entradas adversariais.

## PR#6 — contrato REAUTH_REQUIRED completo — ✅ MERGEADO

- branch: `chatgpt/g5-reauth-backend-20260821`
- HEAD final: `39481cbce0c55131ff36674b7d09d5fd67e71fe2`
- achado real durante a retomada: patch (`tools/apply-g5-reauth.js`) provado só dentro do CI
  (arquivos exportados como artifact, nunca commitados) — corrigido, aplicado de verdade no
  source (causa raiz: CRLF quebrando o match de string do script num checkout Windows).
- red-team independente (agente sem contexto prévio): sem bloqueante.
- revisão de coerência da Cowork 2: **APROVADO sem bloqueante** — 2 achados reais corrigidos
  (lacuna de teste do item 9 do contrato; `cadastrarOuEditarVeiculo` sem cobertura), workflow de
  CI órfão removido antes do merge.
- suíte final: 103/103 no arquivo REAUTH dedicado; 33/33 arquivos na suíte portátil.
- squash merge na linha ativa: `52c9cca1d1e9c7736120ec92b2e859caf2b27307`.

## Baseline atual do backend G5

- branch: `active-os-backend-v2.1-20260815`
- SHA atual após PR#6: `52c9cca1d1e9c7736120ec92b2e859caf2b27307`
- nenhuma publicação Apps Script decorrente desses merges; `@40` continua congelada.

## G6 — declarada formalmente, sem deployment técnico

Owner autorizou G6 em 24/08/2026: **"G6 AUTORIZADO... Isso NÃO autoriza deploy — só a
existência formal da candidata pra homologação apontar pra ela."**

`G6-CANDIDATE-MANIFEST.md` atualizado com: Backend `52c9cca`, Field `1636814`
(`active-field-v2.1-20260821`, confirmado como a linhagem correta), Make 1A `5519682`, Make 1B
`5512830`, schema SharePoint (snapshot Code 3, commit `1542c64`), plano de rollback completo por
componente (Apps Script/Field/Make 1A/Make 1B/schema/ERP Admin). ERP Admin build e a confirmação
dos 2 segredos HMAC no ambiente candidato ficam pendentes — não bloqueiam a declaração formal
(decisão do owner), mas precisam fechar antes de qualquer `clasp deploy` real.

**Nenhuma ação técnica de deploy foi executada.** `@40` intocada. Criação técnica do deployment
candidato continua exigindo autorização explícita separada.
