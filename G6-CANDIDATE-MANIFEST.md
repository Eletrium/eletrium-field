# G6 — Manifesto da Implantação Candidata

Status: **NÃO CRIADO — SOMENTE PREPARAÇÃO DOCUMENTAL**

Este arquivo não representa um deployment candidato existente e não autoriza `clasp push`, `clasp deploy` nem alteração da implantação `@40`.
A `@40` permanece congelada como baseline/rollback.

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

## Linha de código candidata

| Componente | Versão / referência | Status |
|---|---|---|
| Repo backend atual | `Eletrium/eletrium-field` | confirmado, porém contém frontend fóssil que deve ser ignorado para build Field |
| Linha ativa backend | `active-os-backend-v2.1-20260815` | preservada |
| Backend HMAC após Onda 3 | merge `3c2e002826d9a28f77137072cec5fa1bb323b2dd` | integrado; red-team independente do PR #4 ainda pendente |
| FIELD_API_CONTRACT | `v1` | preservado durante rollout transicional |
| Field fonte funcional | `eletrium-field-checklist3` | local / ainda sem SHA remoto canônico |
| Field branch/build/commit candidato | — | **BLOQUEADO até materialização de `eletrium-field-checklist3`** |
| `index.html` da linhagem backend | snapshot antigo | **PROIBIDO como fonte de build candidato** |
| `origin/main` | snapshot antigo | **PROIBIDO como fonte de build candidato** |
| Apps Script produção `@40` | código antigo | congelado |
| Apps Script candidate deploy | — | **NÃO EXISTE** |
| Make 1A | PENDENTE INFORMAR | owner ainda precisa confirmar versão exata |
| Make 1B | PENDENTE INFORMAR | owner ainda precisa confirmar versão exata |
| SharePoint schema | PENDENTE INFORMAR | owner ainda precisa confirmar versão/schema |
| ERP Admin build | PENDENTE INFORMAR | confirmar antes da homologação |

## Pré-condições para autorizar criação de G6

1. Red-team independente executado especificamente contra o PR #4 / árvore mergeada correspondente; achados do PR #3 são apenas histórico.
2. `eletrium-field-checklist3` materializado em branch remota dedicada, com SHA estável e sem perda das funcionalidades P0/UX atuais.
3. Migração G5 frontend concluída nessa mesma linhagem funcional: token emitido no login, armazenado e encaminhado nos call-sites definidos.
4. Reconciliação de `registrarUsoVeiculo` concluída antes do enforcement obrigatório.
5. E2E autenticado real executado entre Field autoritativo e backend candidato.
6. SHA do backend candidato congelado e suíte de regressão sem falha crítica.
7. Field branch/build/commit congelado a partir da linhagem `eletrium-field-checklist3`, nunca dos snapshots legacy.
8. Make 1A scenario/version registrado.
9. Make 1B scenario/version registrado.
10. SharePoint schema/version registrado.
11. ERP Admin build/commit registrado.
12. `SESSAO_HMAC_SECRET` configurável apenas em Script Properties do futuro ambiente candidato; nunca no Git.
13. `OFERTA_HMAC_SECRET` confirmado separadamente se o aceite de oferta entrar na candidata.
14. Rollback conhecido para Field, Apps Script, Make e demais componentes envolvidos.

## Manifesto a preencher somente antes de G6 real

```text
G6-CANDIDATE

Backend branch:
Backend SHA:
Apps Script deployment ID candidato:
FIELD_API_CONTRACT:
Field source lineage: eletrium-field-checklist3
Field branch:
Field SHA:
Field build/version:
Prova de que Field não veio do index.html legacy: SIM/NÃO
Make 1A scenario/version:
Make 1B scenario/version:
SharePoint schema/version:
ERP Admin build/commit:
SESSAO_HMAC_SECRET configurado: SIM/NÃO (nunca registrar o valor)
OFERTA_HMAC_SECRET configurado: SIM/NÃO (nunca registrar o valor)
Data/hora da criação:
Responsável:
```

## Critério de criação e promoção

A criação do deployment candidato é uma decisão explícita do owner G5/G6 e **não deve ser executada automaticamente por quem possui acesso técnico ao clasp**.

Somente após todas as pré-condições acima estarem fechadas o owner poderá autorizar a criação de G6.

Mesmo depois de criada, a implantação candidata servirá exclusivamente para homologação integrada. Criar G6 **não** significa G6 PASS e não autoriza G7.
