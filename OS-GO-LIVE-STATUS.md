# OS — Go-Live Status / Ownership

> Fonte compartilhada de coordenação. Atualizar por evidência de gate, não por quantidade de commits.

| Gate | Owner | Status | Branch / Componente | Bloqueio atual | Evidência / próxima prova |
|---|---|---|---|---|---|
| G1 — 1A | congelado | ✅ PASS | Make 1A | — | validado ponta a ponta com dado real |
| G2 — 1B newest-wins | Claude | 🟡 EM TESTE | Make 1B | casos A/C/D ainda exigem confirmação final conforme último handoff | quatro casos com dado real |
| G3 — E2E-SYNC-CONFLICT | Claude | ⏸️ AGUARDANDO G2 | 1A + 1B | G2 | `ROTEIRO-E2E-SYNC-CONFLICT.md` |
| G4 — Retry automático | Claude + ação operacional | 🟡 NÃO FECHADO | scanner Make 5952040 | confirmação real do Run once / resultado | execução real + teto/retry |
| G5 — Sessão HMAC / E-TOCTOU-01 | ChatGPT | 🟡 EM EXECUÇÃO | linha ativa + `chatgpt/g5-hmac-onda3-20260820` | Onda 3 CI verde; falta red-team + decisão sobre `getDiariaHoje`/`registrarUsoVeiculo` + migração Field + flip obrigatório posterior | PR #3 draft; 37/37 Onda 3; 31 arquivos PASS |
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
- Red-team Cowork 2: 5 achados; Achado 2 classificado bloqueante e corrigido antes do merge
- caso adicionado: token válido do próprio técnico + posse negada → bloqueia e não delega
- HEAD testado antes do merge: `26aeb23cead7b2e2382ded531e2ee58696d2140f`
- CI final: SUCCESS, workflow run `32423848815`
- runner portátil: 30 arquivos PASS / 0 FAIL
- testes específicos Onda 2: 12 PASS / 0 FAIL
- merge squash na linha ativa: `31618e1a11f025633e9fe09b5d0c42977b522ed7`
- Achados 1/3/4/5 permanecem registrados como não bloqueantes no README da suíte
- token ainda opcional por desenho de transição; flip obrigatório é gate posterior

## Evidência G5 — Onda 3

- PR #3: `chatgpt/g5-hmac-onda3-20260820` → `active-os-backend-v2.1-20260815`
- HEAD em teste: `5bea6e66abd61d6b3c301b46de157ed302f74782`
- funções ativas migradas: `registrarInicioDia`, `registrarFimDia`, `cadastrarOuEditarVeiculo`, `getDiariaTecnico`, `getVeiculoDoTecnico`, `getOsDoTecnico`
- validação fica dentro da própria função, não apenas no dispatcher
- `registrarUsoVeiculo`: não migrada; backend órfão sem case/call-site real confirmado, pendente de reconciliação antes do enforcement
- `getDiariaHoje`: fora da lista fonte da Onda 3; enviado ao red-team para classificar exclusão intencional vs. omissão
- CI: SUCCESS, workflow run `32425241220`
- testes específicos Onda 3: 37 PASS / 0 FAIL
- runner portátil: 31 arquivos PASS / 0 FAIL
- token continua opcional; frontend versionado ainda não encaminha sessão nestes calls
- PR permanece draft até red-team e zero achado bloqueante aberto
