# Implementação — contrato REAUTH_REQUIRED no Field (21/08)

Pedido do dono: "trabalho real agora, não mais só preparação" — contrato fechado
(`G5-DECISAO-CONTRATO-REAUTH-REQUIRED.md`), implementar o lado Field contra mock, sem esperar o
backend mergear. Prioridade: (1) interceptor central, (2) UX de leitura síncrona, (3) UX de
escrita/outbox, (4) isolamento por técnico.

## Fonte do contrato — achado importante antes de começar

O dono citou `ROTEIRO-E3-REAUTH-REQUIRED.md` (36 casos formais) como possível fonte. **Esse
arquivo não foi encontrado** em nenhum branch acessível (`pwa` nem `eletrium-field-checklist3`,
local e remoto, incluindo `chatgpt/g5-reauth-backend-20260821` e
`chatgpt/g5-session-contract-preenforcement-20260821`). Em vez disso, usei os 2 documentos reais
que encontrei no repo backend (read-only, branches remotas):

- `G5-DECISAO-CONTRATO-REAUTH-REQUIRED.md` (branch `chatgpt/g6-candidate-prep-20260819`) —
  contrato formal completo: campo `reauth_required`, quando ele dispara, UX de leitura/escrita,
  interceptor central, versionamento do `FIELD_API_CONTRACT`.
- `G5-DECISOES-E3-REAUTH-UX.md` (branch `chatgpt/g5-reauth-backend-20260821`) — decisões
  específicas E3-10 (pausarOS/retomarOS), E3-14 (cancelar leitura), E3-14b (bootstrap
  `getDiariaHoje`), E3-24 (offline+expirado).
- `HMAC_Reauth.js` + `SESSAO_DISPATCHER_POLITICAS` (mesma branch) — de onde vem o achado mais
  importante pra implementação: **o token é sempre o ÚLTIMO parâmetro** de toda action protegida
  (confirmado conferindo várias entradas da tabela contra a assinatura real de cada função em
  `Código.js` — o índice do token é sempre exatamente `params.length` de hoje, um a mais que o
  último parâmetro existente).
- `API.js` (`_respostaValidacaoPin`) — confirma que `validarPin` (a MESMA action do login normal)
  é reaproveitada pra reautenticação: retorna `{valido:true, token, expiraEm}` quando o segredo
  HMAC está configurado, `{valido:true}` sem token durante a transição (aditivo).

Não tive acesso ao roteiro de 36 casos numerados citado pelo dono — a numeração E3-11/12/13/
15-19/20/21/29/30 usada no pedido não bate 1:1 com nenhum artefato que consegui ler. Implementei
contra o CONTEÚDO (o comportamento descrito), não contra os números dos casos — se o roteiro
formal chegar depois, pode haver nuances específicas por caso não cobertas aqui.

## O que foi implementado

### 1. Interceptor central (E3-30)

`gsCallReal()` (`index.html`) deixou de ser só o transporte JSONP — o transporte bruto virou
`_jsonpBruto()`, e `gsCallReal()` agora é a ÚNICA camada que:
1. Anexa o token de sessão vigente (`obterTokenSessao()`) como **último parâmetro**, se existir.
   Sem token local (pré-login, ou ação que ainda não decidiu adotar o contrato), nada é anexado —
   params sai idêntico a hoje, backend trata `token===undefined` como "sem sessão" (comportamento
   antigo preservado, `validarSessaoDispatcherOpcional`).
2. Depois da resposta, verifica `reauth_required===true` e transforma isso num erro tipado
   (`err.reauthRequired=true`, `err.recusaOriginal=<resposta completa>`) em vez de deixar cada
   tela reconhecer o campo sozinha.

Como `gsCall`/`gsCallIdempotente`/`processarFilaOffline`/`reconciliarIntencoesOrfas`/
`reconciliarUploadsOrfaos` já delegavam TODOS pra `gsCallReal`, nenhum desses precisou de
nenhuma mudança pra herdar o interceptor — só o transporte mudou.

**Gap conhecido**: `enviarPOSTNoCors`/`capturarEUpload` (Laudo/Assinatura/Selfie/foto de KM) usa
`fetch(...,{mode:'no-cors'})` direto, resposta opaca — não passa pelo interceptor. `reauth_required`
nesse caminho só pode ser descoberto depois, via o poll de `consultarStatusOperacao` (que ESSE sim
passa pelo interceptor normalmente). Não coberto nesta rodada — acompanha o mesmo padrão da
resposta opaca já documentado em `enviarPOSTNoCors`.

### 2. UX de leitura síncrona (E3-11/12/13/14/14b)

`leituraComReauth(fnLeitura)` — wrapper genérico: interrompe, chama `_solicitarReautenticacao()`
(modal central, promessa compartilhada — N chamadas falhando juntas geram 1 SÓ prompt), repete a
MESMA leitura uma única vez se renovar, nunca tenta 2 vezes. Usado em `carregarHome()`
(`getOsDoTecnico`), `irParaResumo()` (`getDiariaTecnico`), `_carregarFormVeiculo()`/
`responderVeiculo()` (`getVeiculoDoTecnico`).

**`getDiariaHoje` tem tratamento próprio** (`_tentarGetDiariaHoje`, E3-14b) — não usa o wrapper
genérico porque não existe tela estável segura pra onde voltar nesse ponto específico (bootstrap
do login). **Achado/bug real corrigido**: o `.catch()` antigo de `_entrarConfirmado` caía em
`carregarHome()` como fallback pra QUALQUER erro, inclusive `reauth_required` — assumindo
silenciosamente que a diária não existe. Agora: erro genérico (rede) preserva o fallback antigo;
`reauth_required` interrompe, pede login, replay único, e se cancelar/expirar de novo volta pro
LOGIN (não Home, não Início do Dia) sem inferir nada sobre a diária.

**Trade-off registrado, não escondido**: `carregarHome()` e `irParaResumo()` já navegam pra sua
tela (`showScreen('scr-home')`/`showScreen('scr-resumo')`) ANTES de disparar a leitura — então
"voltar pra última tela estável anterior" (E3-14), nesses 2 casos específicos, acaba sendo a
própria tela de destino (não a tela de origem de onde o técnico veio). Não reordenei a navegação
dessas 2 funções nesta rodada pra não aumentar o raio de mudança — o comportamento de leitura em
si (interrupção, replay único, sem loop) está correto; só o "pra onde volta ao cancelar" é uma
aproximação nesses 2 pontos.

**Não implementado**: E3-24 (leitura + sessão expirada + offline — esperar reconexão antes de
abrir o PIN, sem cache genérico). Não estava na lista de prioridades desta rodada; o
comportamento atual, se `_solicitarReautenticacao()` for chamado offline, é abrir a tela de PIN
mesmo assim (que vai falhar ao tentar `validarPin`, mostrando "Sem conexão para verificar o PIN")
— funcional, mas não é o fluxo mais fino que E3-24 descreve.

### 3. UX de escrita/outbox (E3-15 a E3-19, E3-29)

Novo status local do outbox: `REAUTH_BLOQUEADO` (vocabulário PRÓPRIO do Field, nunca chega no
Log_Central do backend — a operação nem foi processada lá ainda). Quando `processarFilaOffline()`
bate `reauth_required` no envio de um item:
- **não descarta** (fica na fila);
- **não gera operationId novo** (o mesmo item, mesmo id, só muda de status);
- **não conta como tentativa/backoff técnico** (`tentativas` fica intocado — só `SYNC_ERROR`
  incrementa isso);
- mostra o banner tocável `#sessao-expirada-banner` (não interrompe o técnico à força numa tela
  não relacionada por causa de uma escrita em segundo plano — decisão de produto registrada
  explicitamente, não estava no contrato letra-por-letra).

`retomarOperacoesBloqueadasPorSessao()` — chamada automaticamente depois de qualquer
reautenticação bem-sucedida (`_solicitarReautenticacao`): promove os itens `REAUTH_BLOQUEADO` do
técnico atual de volta pra `QUEUED` (preserva `operationId`/`params`/`tentativas` intactos) e
manda `processarFilaOffline()` reenviar — o interceptor injeta o token novo no MOMENTO do envio
(nunca fica "congelado" dentro do item armazenado).

`resumoFila()`/banner de pendências contam `REAUTH_BLOQUEADO` como "pendente" (não é recusa de
negócio como `DIVERGENT`, é uma escrita genuinamente aguardando login de novo).

### 4. Isolamento por técnico (E3-20/21)

`enfileirarChamadaComId()` agora grava `tecnicoId: APP.tecnico.id` no item, capturado no momento
do enfileiramento (sem precisar passar isso por todo call site). `item.tecnicoId===null` (item de
schema anterior a esta mudança) continua visível/processável por qualquer um — compat com dado já
existente no IndexedDB.

`_pertenceAoTecnicoAtual(item)` filtra: `processarFilaOffline()` pula itens de outro técnico (não
dispara), `resumoFila()` não conta (não mostra), `reconciliarIntencoesOrfas`/
`reconciliarUploadsOrfaos` também pulam (não disparam `consultarStatusOperacao` pra intenção de
outro técnico). Trocar de técnico automaticamente re-escopa tudo (nenhum estado extra pra
limpar) — os itens do técnico anterior voltam a aparecer/processar assim que ele logar de novo.

## Correção ao levantamento anterior (achado, não erro grave)

`PREPARACAO-TOKEN-SESSAO-ONDA3-PAUSAR-RETOMAR.md` (commit anterior desta sessão) presumia que
anexar o token exigiria tocar em cada `montarParams` individualmente, function por function.
**Superado**: como o token é sempre o último parâmetro em toda action protegida (achado desta
rodada, `SESSAO_DISPATCHER_POLITICAS`), a injeção é genérica e centralizada no interceptor —
NENHUM call site individual precisou ser tocado. `obterDispositivoId()`/`eletrium_dispositivo_id`
continua sendo o padrão de referência pro formato de armazenamento (confirmado certo).

## Testes

`test/test-reauth-required.js` — 20/20, cobrindo as 4 prioridades: injeção/detecção do
interceptor, replay único sem loop (leitura), cancelamento (E3-14), dedupe do prompt
compartilhado, bug do `getDiariaHoje` corrigido + fallback antigo preservado pra erro genérico,
`REAUTH_BLOQUEADO` sem incrementar tentativas/backoff preservando `operationId`, reenvio
preservando payload com token novo anexado, isolamento por técnico nas 3 frentes
(`processarFilaOffline`/`resumoFila`/reconciliação).

Suíte completa: **197/197** (23 arquivos, nenhuma falha, contagem exata computada
programaticamente).
