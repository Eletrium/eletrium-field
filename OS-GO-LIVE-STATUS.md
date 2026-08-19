# OS — Go-Live Status / Ownership

> Fonte compartilhada de coordenação. Atualizar por evidência de gate, não por quantidade de commits.

| Gate | Owner | Status | Branch / Componente | Bloqueio atual | Evidência / próxima prova |
|---|---|---|---|---|---|
| G1 — 1A | congelado | ✅ PASS | Make 1A | — | validado ponta a ponta com dado real |
| G2 — 1B newest-wins | Claude | 🟡 EM TESTE | Make 1B | casos A/C/D ainda exigem confirmação final conforme último handoff | quatro casos com dado real |
| G3 — E2E-SYNC-CONFLICT | Claude | ⏸️ AGUARDANDO G2 | 1A + 1B | G2 | `ROTEIRO-E2E-SYNC-CONFLICT.md` |
| G4 — Retry automático | Claude + ação operacional | 🟡 NÃO FECHADO | scanner Make 5952040 | confirmação real do Run once / resultado | execução real + teto/retry |
| G5 — Sessão HMAC / E-TOCTOU-01 | ChatGPT | 🟡 EM EXECUÇÃO | `chatgpt/g5-hmac-onda2-20260815` | red-team Onda 2 + escopo exato Onda 3 + flip obrigatório posterior | PR #1; CI limpo |
| G6 — Homologação candidata | ChatGPT; Claude co-review | 🟡 PREPARAÇÃO | `chatgpt/g6-candidate-prep-20260819` | convergência G2-G5 + dados de versões Make/SP + criação do deployment candidato | `G6-CANDIDATE-MANIFEST.md` |
| G7 — Deploy | coordenado | ⏹️ NÃO INICIADO | — | G2-G6 | plano + rollback |
| G8 — Produção assistida | coordenado | ⏹️ NÃO INICIADO | — | G7 | OS real controlada ponta a ponta |

## Ownership freeze

### Claude
- G2 — 1B newest-wins
- G3 — E2E-SYNC-CONFLICT
- G4 — retry
- P0 checklist/frontend: garantir chamada real de `fecharFaseChecklist`

### ChatGPT
- G5 — sessão HMAC
- G6 — candidate / manifesto / homologação técnica
- revisão independente posterior de G2/G3

### Coordenado
- G7 deploy
- G8 produção assistida

## Regras

1. Não editar simultaneamente a mesma região crítica sem handoff explícito.
2. `origin/main` permanece histórico/legacy por enquanto.
3. `active-os-backend-v2.1-20260815` é a linha ativa candidata e deve permanecer estável enquanto PRs são revisados.
4. `@40` permanece congelada; homologação deve usar deployment candidato separado.
5. Nenhum gate passa por HTTP 200, commit ou mock isolado; exigir efeito real/evidência correspondente.
6. Funcionalidades P1/P2 permanecem congeladas até go-live P0.

## Evidência G5 — Onda 2

- PR #1: `chatgpt/g5-hmac-onda2-20260815` → `active-os-backend-v2.1-20260815`
- HEAD final observado: `fb7341ed62864f0e61b48661cd23840110ba9fe4`
- CI final: SUCCESS, workflow run `32294619083`
- runner portátil: checkout limpo; zero falha de arquivo
- testes específicos Onda 2: 11 PASS / 0 FAIL
- token ainda opcional por desenho de transição; flip obrigatório é gate posterior
