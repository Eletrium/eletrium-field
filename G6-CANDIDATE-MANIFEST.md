# G6 — Manifesto da Implantação Candidata: OS_FIELD_CANDIDATE_V2_1

Status: **FORMALMENTE DECLARADA — VERSÕES CONGELADAS — SEM DEPLOYMENT TÉCNICO**

Autorizado pelo owner em 24/08/2026: "G6 AUTORIZADO. Pode criar a candidata
OS_FIELD_CANDIDATE_V2_1 agora." — com a ressalva explícita do próprio owner na mesma mensagem:
**"Isso NÃO autoriza deploy — só a existência formal da candidata pra homologação apontar pra
ela."** Este documento é essa existência formal: nome, versões congeladas de cada componente,
plano de rollback. **Não é, e não autoriza, nenhuma ação técnica de `clasp push`, `clasp
deploy`, publicação de Make, ou qualquer outra ação que crie um endpoint/deployment real.**

`@40` permanece congelada como baseline/rollback, intocada — nenhum comando de deploy foi
executado por causa deste documento.

## Decisão de source of truth do Field

Foram identificados três artefatos de frontend divergentes. Para fins de G6, a decisão do owner é:

| Artefato | Classificação | Pode originar o Field candidato? |
|---|---|---|
| `eletrium-field-checklist3` — worktree funcional do Code 2, onde vivem KM final, checklist P0 e UX atuais | **LINHAGEM FUNCIONAL AUTORITATIVA** | **SIM, após materialização remota com SHA estável** |
| `index.html` presente na linhagem de backend/PWA | **LEGACY / FÓSSIL EMBARCADO** | **NÃO** |
| `origin/main` do repo `Eletrium/eletrium-field` | **LEGACY / SNAPSHOT HISTÓRICO** | **NÃO** |

Enquanto `eletrium-field-checklist3` existir apenas como worktree local, ele é a fonte funcional autoritativa, mas **ainda não é uma fonte auditável/reproduzível para homologação**. Antes de G6 real, seu estado deve ser publicado em uma branch remota dedicada, com SHA explícito, sem force-push e sem sobrescrever `main` ou a linhagem ativa de backend.

### Regra obrigatória

`Field branch/build/commit` **nunca** poderá ser preenchido com SHA de uma branch cujo frontend provenha do `index.html` fóssil da linhagem de backend nem de `origin/main` histórico.

O arquivo `index.html` que acompanha a linhagem de backend deve ser tratado como artefato legado não-candidato. Sua presença no mesmo repositório não o torna fonte de verdade do Field.

## Linha de código candidata — versões congeladas (OS_FIELD_CANDIDATE_V2_1)

| Componente | Versão / referência | Status | Confirmado por |
|---|---|---|---|
| Backend — branch | `active-os-backend-v2.1-20260815` | linha ativa | — |
| Backend — SHA congelado | **`52c9cca1d1e9c7736120ec92b2e859caf2b27307`** | pós squash-merge do PR#6 (G5/HMAC/REAUTH_REQUIRED completo, aprovado pela Cowork 2 sem bloqueante) | confirmado agora via `git ls-remote` |
| Field — branch | `active-field-v2.1-20260821` | linhagem funcional autoritativa (`eletrium-field-checklist3`), materializada remota — **não** é o `index.html` fóssil nem `origin/main` | — |
| Field — SHA congelado | **`1636814ace613297d99d54dd85dc9ff47ac133f2`** | ponta atual da branch acima | confirmado agora via `git ls-remote`, bate exatamente com o valor informado pelo owner |
| FIELD_API_CONTRACT | `v1` | preservado — token ainda opcional, enforcement é gate futuro separado | confirmado no backend (`Código.js`) |
| Apps Script produção `@40` | congelada | **intocada** — nenhuma ação de deploy neste documento | — |
| Apps Script candidate deploy | **ainda não existe** | este documento formaliza a candidata; a criação técnica do deployment (`clasp deploy`) é ação separada, futura, com autorização explícita própria | — |
| Make 1A | scenario `5519682` ("Eletrium — 1A: GS → SP (OS)") | ativo em produção hoje; congelado como a versão de referência da candidata | confirmado antes via `scenarios_list` (Make API) |
| Make 1B | scenario `5512830` ("Eletrium — 1B: SP → GS (OS)") | ativo em produção hoje; congelado como a versão de referência da candidata | confirmado antes via `scenarios_list` (Make API) |
| SharePoint schema | snapshot factual do Code 3, 24/08/2026 | `docs/SNAPSHOT-SCHEMA-SHAREPOINT-CANDIDATO-G6.md` (commit `1542c64`) — `OrdensDeServico`, `Log_Central_Espelho`, `Log_Central_Espelho_Status`, `OS_Respostas`, `Perguntas_Checklist`, `Opcoes_Resposta`, `Disciplinas_Checklist` | Code 3, via PnP app-only, só leitura |
| ERP Admin build | **PENDENTE INFORMAR** | não recebido nesta rodada — não presumo um valor | — |
| `SESSAO_HMAC_SECRET` configurado no ambiente candidato | **NÃO VERIFICÁVEL POR MIM** | não tenho acesso a Script Properties de nenhum ambiente Apps Script; alguém com acesso interativo precisa confirmar antes do deploy real | — |
| `OFERTA_HMAC_SECRET` configurado no ambiente candidato | **NÃO VERIFICÁVEL POR MIM** | idem — só relevante se aceite de oferta entrar na candidata | — |

**Nota sobre Make 1A/1B**: "versão" aqui é `scenario ID` + estado `ativo` — o Make não expõe
número de versão git-style. Se os scenarios forem editados entre agora e o deploy real, o
`lastEdit` vai mudar e esse congelamento precisa ser revisitado antes de prosseguir.

## Decisão de contrato de sessão antes do enforcement

- Em produção existe **uma única `_recusa` canônica**, definida em `Código.js`. `HMAC_Onda2.js` chama essa função global; a versão reduzida de 3 campos existe apenas no mock histórico do teste da Onda 2.
- `retryable` representa repetição técnica automática. Para token expirado continuará `false`, porque repetir a mesma chamada com o mesmo token expirado geraria loop.
- A migração do Field deve introduzir um sinal separado e explícito de **reautenticação necessária**, sem sobrecarregar `retryable`.
- `verificarTokenSessao` real é fail-closed para token ausente, malformado, assinatura inválida, expirado e técnico divergente.
- PR #5 cristalizou essa decisão em teste com código real: 18 PASS / 0 FAIL; suíte completa 32 arquivos PASS / 0 FAIL; workflow `32521567331` SUCCESS.

## Pré-condições — status na hora da autorização (24/08/2026)

O owner autorizou G6 formalmente nesta data. As pré-condições abaixo que dependiam de
confirmação técnica minha foram verificadas; as que dependiam de decisão/execução do owner ou
de outra frente ficam registradas como ele as declarou (autorização do owner é o próprio sinal
de que ele considera essas fechadas — não reabro julgamento sobre isso aqui).

1. Red-team independente contra o PR #4 — CONCLUÍDO, sem bloqueante.
2. PR #5 / contrato pré-enforcement — CONCLUÍDO E INTEGRADO.
3. `eletrium-field-checklist3` materializado em branch remota — CONCLUÍDO (`active-field-v2.1-20260821`, SHA confirmado acima).
4. PR#6 — contrato `REAUTH_REQUIRED` completo (backend) — CONCLUÍDO, aprovado pela Cowork 2 sem bloqueante, mergeado (`52c9cca`).
5. SHA do backend candidato congelado — CONCLUÍDO (`52c9cca`).
6. Field branch/build/commit congelado a partir da linhagem correta — CONCLUÍDO, confirmado agora (não é fóssil nem `origin/main`).
7. Make 1A/1B scenario/version registrado — CONCLUÍDO (versões acima).
8. SharePoint schema/version registrado — CONCLUÍDO (snapshot do Code 3).
9. ERP Admin build/commit registrado — **NÃO RECEBIDO** nesta rodada.
10. `SESSAO_HMAC_SECRET`/`OFERTA_HMAC_SECRET` configurados no ambiente candidato — **NÃO VERIFICÁVEL POR MIM**, precisa de confirmação de quem tem acesso interativo antes do deploy real.
11. Rollback documentado para Field/Apps Script/Make 1A/Make 1B/schema/ERP Admin — **CONCLUÍDO NESTE DOCUMENTO**, ver seção abaixo.
12. Migração completa do token no Field, sinal de reauth, reconciliação de `registrarUsoVeiculo`, E2E autenticado real — **status exato não confirmado por mim nesta rodada**; o owner autorizou G6 apesar disso, decisão dele.

## Plano de rollback — documentado ANTES de qualquer deploy real

Nenhum destes componentes foi tocado ainda. Este plano existe pra estar pronto quando (e se) um
deploy real acontecer — é o que o owner pediu explicitamente antes de autorizar qualquer ação
técnica.

### Apps Script (backend)
- **Hoje**: `@40` é a única implantação servindo tráfego real, publicada em 10/08, nunca
  repontada desde então. A candidata, quando criada tecnicamente, será uma implantação NOVA e
  SEPARADA (URL própria) — não um repontar de `@40`.
- **Rollback, se necessário**: não repontar `@40` — ela nunca muda. Bastaria parar de apontar
  qualquer `API_URL` de homologação/candidata pra URL nova e voltar a apontar pra `@40`. Não
  existe ação de "desfazer" no Apps Script em si, porque `@40` nunca seria alterada.

### Field
- **Hoje**: produção real serve a partir de qualquer build que o GitHub Pages/URL pública
  aponte atualmente — não é `active-field-v2.1-20260821` (essa é a branch candidata,
  separada).
- **Rollback, se um deploy real de Field apontar pra essa branch**: repontar o `API_URL`/build
  de produção de volta pro commit/branch anterior conhecido — como a candidata é uma branch
  separada (não `main`), reverter é trocar o pointer de deploy do Field de volta, sem precisar
  reverter nenhum commit.

### Make 1A / Make 1B
- **Hoje**: ambos `isActive:true`, rodando em produção real (1A intervalo 1200s, 1B
  intervalo 1200s). Nenhuma mudança nesses scenarios está prevista como parte da criação da
  candidata.
- **Risco real a evitar**: homologação da candidata **não deve rodar contra os scenarios 1A/1B
  de produção** — eles escrevem em dados reais (Sheets/SharePoint). Se a homologação precisar
  exercitar o fluxo de sync, precisa de uma cópia dedicada dos scenarios apontando pra dados de
  teste, não os IDs `5519682`/`5512830` congelados aqui.
- **Rollback, se algo for editado neles por engano**: Make mantém histórico de versões de
  blueprint por scenario — reverter pela própria interface do Make pro blueprint anterior ao
  `lastEdit` congelado nesta tabela. Não tenho ferramenta de "restore" automatizado nesta
  sessão — seria ação manual do dono/quem tem acesso.

### Schema SharePoint
- **Hoje**: snapshot factual capturado (Code 3), nenhuma mudança de schema prevista como parte
  da criação da candidata.
- **Rollback, se um campo for adicionado/alterado por engano durante homologação**: comparar
  contra `SNAPSHOT-SCHEMA-SHAREPOINT-CANDIDATO-G6.md` e reverter manualmente via
  SharePoint/PnP — não tenho ferramenta de schema/Lista nesta sessão (só busca de documento),
  então não posso nem aplicar nem reverter isso sozinho.

### ERP Admin
- **Hoje**: build/commit não confirmado nesta rodada — sem essa informação, não dá pra
  documentar rollback específico. Precisa ser preenchido antes do deploy real, não antes da
  formalização da candidata.

### Regra geral de rollback
Nenhum componente de produção real (`@40`, Field em produção, Make 1A/1B ativos, schema
SharePoint real) é tocado pela EXISTÊNCIA da candidata — só pela criação técnica do deployment
(ainda não autorizada) e por qualquer homologação que vier depois. Enquanto isso não acontecer,
"rollback" é simplesmente "não apontar nada de produção pra candidata" — que já é o estado
atual.

## Manifesto — preenchido nesta declaração formal

```text
OS_FIELD_CANDIDATE_V2_1

Backend branch: active-os-backend-v2.1-20260815
Backend SHA: 52c9cca1d1e9c7736120ec92b2e859caf2b27307
Apps Script deployment ID candidato: AINDA NÃO CRIADO (esta declaração não autoriza clasp deploy)
FIELD_API_CONTRACT: v1
Field source lineage: eletrium-field-checklist3 (confirmado, não é o fóssil nem origin/main)
Field branch: active-field-v2.1-20260821
Field SHA: 1636814ace613297d99d54dd85dc9ff47ac133f2
Field build/version: (não recebido separadamente do SHA)
Prova de que Field não veio do index.html legacy: SIM (branch dedicada, SHA confirmado via git ls-remote)
Sinal reauth separado de retry implementado: SIM no backend (contrato REAUTH_REQUIRED, PR#6 mergeado); status no Field não confirmado por mim nesta rodada
Make 1A scenario/version: 5519682 (ativo, lastEdit 2026-08-15T03:55:30Z)
Make 1B scenario/version: 5512830 (ativo, lastEdit 2026-08-16T01:33:48Z)
SharePoint schema/version: snapshot Code 3, 24/08/2026 (docs/SNAPSHOT-SCHEMA-SHAREPOINT-CANDIDATO-G6.md, commit 1542c64)
ERP Admin build/commit: PENDENTE — não recebido nesta rodada
SESSAO_HMAC_SECRET configurado: NÃO VERIFICÁVEL POR MIM (sem acesso a Script Properties)
OFERTA_HMAC_SECRET configurado: NÃO VERIFICÁVEL POR MIM (sem acesso a Script Properties)
Data/hora da declaração formal: 2026-08-24
Responsável pela declaração: Code 1 (backend), autorizado pelo owner
```

## Critério de criação técnica e promoção — inalterado

A criação TÉCNICA do deployment candidato (`clasp deploy`) continua sendo uma decisão explícita
separada do owner, com autorização própria — **esta declaração formal não é essa autorização**.
Quem tem acesso técnico ao `clasp` não deve executar `clasp deploy` só porque este documento
existe.

Mesmo depois de criada tecnicamente, a implantação candidata serve exclusivamente para
homologação integrada. Criar G6 tecnicamente não significa G6 PASS e não autoriza G7.

ERP Admin build/commit e a confirmação dos 2 segredos HMAC no ambiente candidato ficam como
pendências explícitas — não bloqueiam esta declaração formal (o owner autorizou apesar delas),
mas devem ser fechadas antes de qualquer `clasp deploy` real.
