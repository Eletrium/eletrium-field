# Homologação — interceptor REAUTH_REQUIRED do Field contra o backend real (25/08)

Pendência levantada pelo dono após a publicação G7: `test-reauth-required.js` (20/20) validava o
interceptor só contra um mock escrito à mão por mim — faltava provar contra código de backend
real rodando.

## O que foi feito

Novo teste, `test/test-reauth-integracao-backend-real.js` (7/7) — carrega o backend REAL via
`git show` (leitura, nenhum arquivo do repo `pwa` foi tocado) da branch
`chatgpt/g5-reauth-backend-20260821` (commit `39481cbce0c55131ff36674b7d09d5fd67e71fe2`):
`Código.js` + `HMAC_Onda2.js` + `API.js` (172760 + 1605 + 13456 bytes), carregados via `vm` com os
mesmos primitivos GAS mockados que a própria suíte do backend usa
(`tests/g5-token-sessao/test-reauth-required-backend.js`, mesma branch) — `PropertiesService`
devolvendo o segredo HMAC, `Utilities.computeHmacSha256Signature` via `crypto` real,
`SpreadsheetApp`/`LockService` lançando erro de propósito (os guards de sessão retornam antes de
qualquer acesso a planilha — confirmado lendo o código real, mesma asserção que o teste deles já
faz).

`executarAcao(action, params)` de `API.js` — o roteador REAL usado por `doGet`/`doPost` em
produção — faz o papel de `_jsonpBruto` neste teste. Não é uma reimplementação minha do
dispatcher: é o código que o GitHub Pages chamaria de verdade via JSONP.

## Resultado — 7/7, contra código de backend real

1. `pausarOS` com token real EXPIRADO (minerado via `emitirTokenSessao` real, relógio do sandbox
   voltado 25h) → `executarAcao` real devolve o envelope de `_recusaSessao` genuíno
   (`reauth_required:true, retryable:false, session_error:'TOKEN_EXPIRADO'`) → interceptor do
   Field (`gsCallReal`) reconhece corretamente.
2. `retomarOS` — mesmo caminho, confirma `retomarOSComSessao`.
3. Token real VÁLIDO (não expirado) → interceptor NÃO marca `reauthRequired` (o guard de sessão
   passa de verdade; o erro que sobra é o `'DOWN'` esperado da planilha mockada, não sessão).
4. Token real válido mas de OUTRO técnico (identidade divergente) → backend real devolve
   `reauth_required:false` (Eixo 2 do contrato: spoof nunca é reauth) → interceptor não entra em
   loop de reautenticação.
5. `leituraComReauth()` + `getOsDoTecnico` real expirado → interrompe, abre
   `scr-reautenticar`, cancelamento correto.
6. `_tentarGetDiariaHoje()` + `getDiariaHoje` real expirado → E3-14b (bug do fallback
   `carregarHome()` corrigido na rodada anterior) confirmado também contra o backend real, não só
   contra o mock.
7. `gsCallIdempotente('registrarInicioDia')` + token real expirado → outbox marca
   `REAUTH_BLOQUEADO` com a recusa vinda do backend de verdade, sem incrementar tentativas.

Achado extra confirmado end-to-end: o token realmente cai na posição que `pausarOSComSessao`
espera (`params[7]`, 8ª posição) quando passado pelo dispatcher REAL — não só pela minha leitura
de `SESSAO_DISPATCHER_POLITICAS`, mas pelo roteamento de `API.js` de fato executado.

## Limitação registrada, não escondida

Caminhos que exigem `SpreadsheetApp` de verdade (sucesso de `getOsDoTecnico`/`pausarOS` com token
válido, ou `validarPin` lendo `Tecnicos_MEI`) batem em `'DOWN'` — mesma limitação intencional do
sandbox mínimo que a própria suíte do backend usa. O que este teste prova é o **envelope de
recusa por sessão**, ponta a ponta contra código real — não uma homologação completa de todo o
fluxo com planilha real (isso pertence à homologação E2E real, que ainda não aconteceu com dado
real segundo `PLANO-PRIMEIRO-DEPLOY-REAL.md`).

## Suíte completa

**204/204** (24 arquivos, nenhuma falha, contagem exata computada programaticamente) —
`test-reauth-required.js` (20/20, mock) + `test-reauth-integracao-backend-real.js` (7/7, backend
real) + as 22 suítes preexistentes, sem regressão.
