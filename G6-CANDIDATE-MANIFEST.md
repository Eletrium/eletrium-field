# G6 — Manifesto da Implantação Candidata

Status: **PREPARAÇÃO — NÃO DEPLOYADO**

Este arquivo não autoriza `clasp push`, deploy nem alteração da implantação `@40`.
A `@40` permanece congelada como baseline/rollback até decisão explícita de G7.

## Linha de código candidata

| Componente | Versão / referência | Status |
|---|---|---|
| Repo | `Eletrium/eletrium-field` | confirmado |
| Linha ativa recebida | `active-os-backend-v2.1-20260815` | preservada |
| Checkpoint de handoff | `e8fde3e1e1fe804fd9dbea5f3d48c1f304c61e96` | confirmado |
| Onda 1 HMAC | ancestral `2f08b21b0f52f9c1d48b3bce447747b9e287d18a` | handoff concluído |
| Branch ChatGPT G5 | `chatgpt/g5-hmac-onda2-20260815` | em desenvolvimento |
| FIELD_API_CONTRACT | `v1` | preservado; Onda 2 é aditiva/transicional |
| Apps Script produção `@40` | código antigo | **não tocar durante G6** |
| Apps Script candidate deploy | — | **ainda não criado** |
| Make 1A | PENDENTE INFORMAR | owner Claude/Make |
| Make 1B | PENDENTE INFORMAR | owner Claude/Make |
| SharePoint schema | PENDENTE INFORMAR | owner SharePoint/Admin |
| ERP Admin build | PENDENTE INFORMAR | confirmar antes da homologação |

## G5 incluído na candidata

A candidata só poderá ser criada quando o estado selecionado do G5 estiver congelado e identificado por SHA.

Até o momento:

- Fundação de sessão HMAC: concluída no handoff.
- Onda 1: concluída no handoff; token ainda opcional.
- Onda 2: em branch ChatGPT; `pausarOS`/`retomarOS` passam por sessão + posse via wrappers; token ainda opcional.
- Onda 3: não iniciada neste manifesto.
- Flip `token obrigatório`: **gate separado**, não antecipar.

## Pré-condições para criar a implantação candidata

1. G2 — 1B newest-wins: estado conhecido e versão do cenário registrada.
2. G3 — E2E-SYNC-CONFLICT: pode ainda estar pendente para deploy, mas o roteiro/ambiente deve estar definido.
3. G4 — retry: versão do scanner registrada.
4. G5 — SHA do backend candidato congelado e suíte de regressão executada sem falha crítica.
5. `SESSAO_HMAC_SECRET`: configurado apenas em Script Properties do ambiente candidato; nunca no Git.
6. `OFERTA_HMAC_SECRET`: confirmação manual separada, se o aceite de oferta entrar na candidata.
7. Field de homologação apontando inequivocamente para o deployment candidato.
8. Rollback conhecido para Field, Apps Script e cenários Make.

## Manifesto a preencher antes de G6 real

```text
G6-CANDIDATE

Backend branch:
Backend SHA:
Apps Script deployment ID candidato:
FIELD_API_CONTRACT:
Field branch/build/commit:
Make 1A scenario/version:
Make 1B scenario/version:
SharePoint schema/version:
ERP Admin build/commit:
SESSAO_HMAC_SECRET configurado: SIM/NÃO (nunca registrar o valor)
OFERTA_HMAC_SECRET configurado: SIM/NÃO (nunca registrar o valor)
Data/hora da criação:
Responsável:
```

## Critério de promoção

A implantação candidata serve exclusivamente para homologação integrada. Publicar a candidata **não** significa G6 PASS e não autoriza G7.

G6 somente passa quando a suíte crítica de homologação for executada contra a candidata real e as evidências forem registradas.
