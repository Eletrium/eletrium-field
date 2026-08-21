# Contrato proposto — Backend para aceite da oferta via link profundo

Escrito pela sessão de frontend (`eletrium-field`, branch `checklist-3-fases`) para a
sessão de backend avaliar. Não implementado por aqui — Apps Script fora do escopo desta
sessão. Nenhuma linha de `Código.js`/`API.js` foi tocada.

## Base: a decisão já está registrada

`docs/SPEC-PWA-TECNICO.md` §1 (04/08/2026, "por ordem do dono") já recomendou: o registro
de aceite migra do `portal-alocacao.html` (MSAL, morto por construção pro técnico MEI sem
conta Microsoft) para o **PWA, via PIN + link profundo** (entrega por WhatsApp). O
`portal-alocacao.html` não morre — muda de público, vira console do GESTOR (fora do
escopo desta fatia e desta sessão). Identidade do técnico: `Tecnico_ID` + PIN, nunca
e-mail. Este contrato é a tradução dessa decisão em funções/schema concretos — o próprio
spec já registrava isso como pendente ("Aval da recomendação §1", "Desenho dos syncs
novos" — pendências de decisão do dono).

## O que o frontend já entrega (pronto, testado com rede mockada, sem funcionar de ponta a
## ponta até o backend existir)

- Parser de link profundo (`parseLinkOferta`, roda no `DOMContentLoaded`, antes até do
  login normal — o técnico pode abrir o app pela 1ª vez direto de um link do WhatsApp).
- Tela de PIN dedicada ao fluxo de oferta (`scr-oferta-pin`/`confirmarPinOferta`) — reusa
  a action `validarPin` **já existente** (Frente E, não alterada), mas não entra no fluxo
  normal de sessão (sem `getDiariaHoje`/`carregarHome`).
- Tela de detalhe + aceite/recusa (`scr-oferta`) — recusa exige motivo (mesma regra do
  `portal-alocacao.html`, `Motivo_Recusa` obrigatório), aceite/recusa por confirmação
  explícita (`confirm()`, mesmo padrão de `confirmarIniciarOS`).
- Chamadas já usam `gsCall`/`gsCallIdempotente` (Frente D, mesma máquina de estados —
  enfileira offline se sem sinal, idempotente com `operationId`).

O que falta pra isso funcionar de verdade: as 2 funções abaixo + a aba nova, mais **quem
gera o link** (fora desta fatia — ver "Fora do escopo").

## Formato do link profundo

```
https://<usuário>.github.io/<repo>/index.html#oferta&id=<Oferta_ID>&tecnico=<Tecnico_ID>&exp=<epoch_segundos>&sig=<hmac_hex>
```

`sig = HEX(Utilities.computeHmacSha256Signature(id + '|' + tecnico + '|' + exp, SEGREDO))`,
`SEGREDO` em `PropertiesService.getScriptProperties()` — **nunca no código-fonte público**
do repo `eletrium-field` (é GitHub Pages público). Mesmo primitivo já desenhado em
`docs/DESENHO-FRENTE-E-AUTH-DISPATCHER.md` (Opção A, token HMAC pós-PIN) — aqui aplicado
só a esta ação pontual (assinatura por oferta), não como sessão geral do dispatcher. As
duas coisas podem ser aprovadas/implementadas independentemente.

**O frontend nunca calcula nem valida `sig`** — só repassa os 4 campos do hash da URL pro
backend. Toda validação (assinatura, expiração, se a oferta ainda está `Pendente`) é
server-side, único lugar com o segredo.

## Contrato proposto (não implementado, só desenhado)

1. **Aba nova `Alocacoes_Ofertas`** (Google Sheets do PWA), append-only (evento, não
   edição — mesma filosofia já usada em `Checklist_Respostas`/`Log_Central`):
   `Oferta_ID, OS_ID, Tecnico_ID, Escopo_Resumo, Valor_Proposto, Criada_Em, Expira_Em,
   Status (Pendente/Aceita/Recusada), Respondida_Em, Motivo_Recusa, operation_id`.

2. **`getOfertaAlocacao(ofertaId, tecnicoId, exp, sig)`** (só leitura):
   - Recalcula `sig` esperada com o mesmo segredo e compara (constant-time se possível,
     `Utilities.computeHmacSha256Signature` já retorna bytes prontos pra isso).
   - Assinatura errada, ou `tecnicoId` do parâmetro diferente do embutido no payload
     assinado → `{ encontrada: false, erro: 'Link inválido' }` (fail-closed, não revela
     se a oferta existe).
   - `exp` no passado → `{ encontrada: true, expirada: true, expiraEm: ... }`.
   - `Status !== 'Pendente'` → `{ encontrada: true, status: ... }` (frontend já trata os
     3 casos: expirada / já respondida / válida).
   - Caso válido → `{ encontrada: true, status: 'Pendente', osId, escopoResumo,
     valorProposto, expiraEm }`.

3. **`registrarAceiteOferta(ofertaId, tecnicoId, aceito, motivoRecusa, operationId,
   dispositivoId)`**, passando por `executarIdempotente` (mesmo padrão da Frente D):
   - Revalida que a oferta ainda está `Pendente` antes de gravar (retry/corrida com outra
     resposta já registrada não sobrescreve).
   - `aceito=false` sem `motivoRecusa` não preenchido → recusa (fail-closed, mesma regra
     do `portal-alocacao.html`).
   - Grava `Status`, `Respondida_Em`, `Motivo_Recusa` (evento novo, não edita a proposta
     original).

4. **Dispatcher (`API.js::executarAcao`)**: adicionar `case 'getOfertaAlocacao'` e
   `case 'registrarAceiteOferta'`, mesmo padrão dos outros cases.

## Fora do escopo deste contrato (registrado pra não confundir)

- **Quem gera o link** (mint da assinatura, ao criar a oferta) — provavelmente o console
  do gestor (`portal-alocacao.html` reescopado, per SPEC §1.2) ou uma ação nova. Não é
  parte desta fatia nem desta sessão (frontend do técnico); só precisa gerar links no
  formato acima com o mesmo segredo.
- **Sync `Alocacoes_Ofertas` (Sheets) → `OS_Alocacoes_Parceiros` (SharePoint)** — o
  próprio `SPEC-PWA-TECNICO.md` já lista isso como pendência separada de decisão do dono
  ("Desenho dos syncs novos... decidir junto com a lição do 1F/1E-B"). Frente A/F,
  Cowork — fora daqui.
- **Reescopo do `portal-alocacao.html` pra console do gestor** — Cowork/staff, fora do
  PWA do técnico.

## Teste

`test/test-aceite-oferta.js` — roda o `<script>` de verdade via `vm`, rede 100% mockada
(`gsCallReal` cobre só as actions esperadas; qualquer outra derruba o teste). Cobre: parse
do link (formato válido/inválido/ausente), gate de PIN dedicado (sem afetar login normal),
os 3 desfechos de `getOfertaAlocacao` (válida/expirada/já respondida/link inválido),
aceite, recusa (com e sem motivo), enfileiramento offline, e regressão do login normal
(`confirmarPin`/`_entrarConfirmado`) pra provar que nada foi alterado lá.
