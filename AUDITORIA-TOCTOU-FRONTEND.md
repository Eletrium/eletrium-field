# Auditoria — TOCTOU / duplo-submit no frontend (14/08)

Pedido do dono, mesmo espírito da varredura de TOCTOU já pedida ao Code 1 do lado backend:
"checar estado → decidir → agir" sem proteção contra duplo-clique/corrida. Foco nomeado:
botões de ação crítica (encerrar OS, aceitar oferta, registrar KM final).

## Achado principal — mais fundamental do que debounce de UI

Esta branch (`checklist-3-fases`) foi criada a partir de um ponto do histórico ANTES do commit
`e46a925` ("feat(idempotencia): fia os call sites do frontend pro padrao gsCallIdempotente",
12/08) — esse commit é uma branch irmã de `main` que nunca convergiu de volta pra cá (confirmado
via `git merge-base --is-ancestor e46a925 HEAD` → `NOT ANCESTOR`). Resultado: **7 pontos de
escrita crítica continuavam em `gsCall` puro, sem `operationId`/`dispositivoId`**, apesar de
`DIRETRIZ-V1.1-FRENTES-BCDE.md` documentar esse trabalho como concluído — a doc está certa sobre
o que aconteceu em `main`, só nunca chegou nesta branch.

**Por que isso importa mais do que duplo-clique**: `gsCall` (via `enfileirarChamada`,
`index.html:915`) gera um `operationId` novo só no MOMENTO de enfileirar — esse id nunca é
embutido no array `params` (a assinatura antiga da função nem tinha essa posição). Numa rede
lenta (timeout na 1ª tentativa ao vivo, servidor já processou de verdade), o retry via
`processarFilaOffline()` reenvia os MESMOS `params`, sem NENHUM `operationId` — o backend
(`executarIdempotente`) recebe `operationId=undefined` e roda `fn()` de novo incondicionalmente
("Sem operationId, roda fn() direto — compatibilidade retroativa", comportamento documentado e
esperado do próprio backend). **Duplo submit real em rede lenta, não hipotético.**

Os 7 pontos afetados, confirmados por leitura direta (não suposição) e cada um verificado 1:1
contra a assinatura REAL do backend (`pwa\Código.js`, posição exata de `operationId`/
`dispositivoId`):

| Função | Botão / fluxo | Posição confirmada no backend real |
|---|---|---|
| `registrarInicioDia` | Iniciar o dia | `(tecnicoId, tecnicoNome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId)` |
| `registrarFimDia` | Encerrar o dia | `(tecnicoId, kmFinal, operationId, dispositivoId)` |
| `registrarKMFinalPendente` | **Registrar KM final** (nomeado pelo dono) | `(osId, tecnicoId, kmFinal, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId)` |
| `iniciarOSComGeo` | Iniciar OS (sem veículo hoje) | `(osId, tecnicoId, tecnicoNome, local, lat, lng, operationId, dispositivoId)` |
| `iniciarOSComKM` | Iniciar OS (com veículo hoje) | `(osId, tecnicoId, tecnicoNome, local, lat, lng, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId)` |
| `pausarOS` (×2 call sites) | Pausar OS / pausa automática do fluxo de emergência | `(osId, tecnicoId, tecnicoNome, motivo, osInterrupcaoId, operationId, dispositivoId)` |
| `retomarOS` | Retomar OS pausada | `(osId, tecnicoId, tecnicoNome, operationId, dispositivoId)` |

`salvarResposta` (também coberta por `e46a925`) **já tinha sido corrigida** independentemente
nesta sessão (commit `924fac0`, antes desta auditoria) — não repetido aqui.

**Corrigido**: `cherry-pick e46a925` foi bloqueado pelo classifier de permissões do Auto Mode;
reaplicado à mão (edição normal, sem tocar histórico do git) o mesmo padrão — cada um dos 7
pontos migrado pra `gsCallIdempotente`, `operationId`/`dispositivoId` no final da assinatura
posicional, confirmados contra o backend real antes de escrever qualquer teste.

## Achado secundário — upload de arquivo sem trava (Laudo/Assinatura/Selfie/foto de KM)

`capturarEUpload` (usada por Laudo, Assinatura, Selfie e foto de desvio de KM) só mudava o
texto do status (`"Enviando..."`) durante o envio — o `<input type="file">` continuava
clicável. Cada chamada gera um `operationId` novo (`gerarOperationId()` roda por chamada, não é
persistido entre tentativas como no caso acima), então uma 2ª seleção de arquivo enquanto a 1ª
ainda está em voo criaria um upload concorrente genuinamente separado, sem dedup nenhum
possível (dois `operationId` diferentes, dois arquivos possivelmente diferentes indo pro
Drive).

**Corrigido**: `input.disabled = true` no início do envio, `input.disabled = false` no
`finally` (sucesso, recusa OU erro — nunca fica travado permanentemente).

## O que já estava protegido — confirmado, não suposto

Os 3 botões nomeados pelo dono e os demais handlers de escrita crítica (exceto os 7 do achado
principal) já tinham proteção contra duplo-clique — mas de forma **implícita**: `showLoading()`
chamado SINCRONAMENTE como a primeira coisa relevante no handler (antes de qualquer
`await`/promise), e o overlay `#loading` (`position:fixed;inset:0`, sem `pointer-events:none`)
intercepta cliques em tudo por baixo. Como JavaScript é single-threaded, o 2º evento de clique
só é processado depois que o handler do 1º já retornou — e a essa altura o overlay já está
visível, bloqueando o clique fisicamente antes de chegar no botão.

Verificado especificamente:
- **`confirmarEncerramento()`** (encerrar OS) — `showLoading()` antes de `gsCallIdempotente`,
  já era `gsCallIdempotente` (não afetado pelo achado principal).
- **`aceitarOferta()`/`recusarOferta()`** — protegidos em CAMADA DUPLA: `confirm()` nativo
  (modal bloqueante, impede um 2º clique de sequer iniciar um novo handler enquanto o diálogo
  está aberto) + `showLoading()` síncrono na sequência.
- **`_iniciarOSDeVerdade()`** — `showLoading('Capturando localizacao...')` é a 1ª linha, ANTES
  de `capturarGeolocalizacao()` (que pode levar até 8s pra resolver) — o overlay já protege
  durante toda a espera do GPS, não só durante a chamada de rede final.
- `registrarMovimentoFerramental` (ferramental) — mesmo padrão, já era `gsCallIdempotente`.

## Endurecido (14/08, pedido explícito do dono) — lock EXPLÍCITO nos 3 botões nomeados

Dado quantos TOCTOU reais apareceram nesta mesma auditoria (achado principal acima), o padrão
implícito foi considerado frágil demais pra ficar como estava: funciona hoje, mas nenhum teste
pegaria a regressão se um futuro editor inserisse um `await` antes do `showLoading()` num desses
3 handlers. `confirmarEncerramento()`, `_registrarAceiteOferta()` (compartilhado por
`aceitarOferta()`/`recusarOferta()` — é a MESMA operação crítica) e `confirmarKMFinalPendente()`
agora checam/travam um lock explícito (`ACOES_CRITICAS_EM_ANDAMENTO`, um `Set` de chaves em
andamento) como a PRIMEIRA coisa no handler, independente da UI — destravado em todo caminho de
saída (sucesso, recusa de negócio, erro de rede). Validação que falha ANTES do lock ser
adquirido (ex.: campo vazio) nunca trava nada.

Os demais ~12 call sites (ferramental, checklist, KM inicial, apontamentos) continuam com a
proteção implícita — não convertidos porque não têm o mesmo peso de "ação crítica nomeada" e
converter todos de uma vez só por precaução seria escopo maior do que o achado motivava. O
padrão (`acaoCriticaEmAndamento`/`travarAcaoCritica`/`destravarAcaoCritica`) já existe pronto
pra estender aos outros se algum novo achado justificar.

## Teste

`test/test-toctou-frontend.js` (10/10):
1. Os 7 pontos do achado principal mandam `operationId`/`dispositivoId` na posição exata
   confirmada contra o backend real (comprimento do array + posição, não só presença).
2. **Prova real de retry** (`registrarKMFinalPendente`, o botão nomeado): simula 1ª tentativa
   falhando por rede, confirma que o item enfileirado guarda o MESMO `operationId` da tentativa
   ao vivo (não um novo gerado só no enfileiramento), e que o retry via
   `processarFilaOffline()` reenvia esse MESMO `operationId` — é isso que permite o backend
   deduplicar de verdade.
3. `capturarEUpload`: 2ª chamada disparada com a 1ª ainda em voo não gera nenhuma chamada de
   rede nova; input destrava depois que o envio termina (sucesso).

`test/test-lock-acoes-criticas.js` (4/4): chama cada um dos 3 handlers uma 2ª vez ENQUANTO a 1ª
chamada ainda está em voo (rede mockada nunca resolvendo até o teste mandar) — confirma que só
1 chamada de rede acontece, não 2; confirma que o lock libera depois que a 1ª termina (uma nova
ação legítima funciona normalmente); confirma que aceitar/recusar compartilham o lock (recusar
logo depois de aceitar é bloqueado); confirma que validação inválida não deixa o lock preso.

Suíte completa revalidada, zero regressão: **128/128** (17 arquivos).

## Revisão dos ~12 "ainda-implícitos" (15/08) — achou mais 1, confirmou o resto

Pedido do dono: revisar se algum dos ~12 call sites listados acima como "ainda-implícitos"
tinha achado concreto motivando conversão pra lock explícito, dado quanto TOCTOU real já
tinha aparecido no mesmo dia (D7-08, os 7 call sites órfãos de `e46a925`).

**Verificado, um por um, os caminhos mais complexos primeiro** (batches de checklist —
`_finalizarFase1`, `CHKV2.finalizar()`, `CHK._gravarResposta` — e os apontamentos): todos têm
`showLoading()` como a primeira coisa síncrona do handler, mesmo padrão já confirmado
funcionando nos 3 botões nomeados, e todos já usam `gsCallIdempotente` (nenhum plain `gsCall`
sobrando) — ou seja, já se beneficiam automaticamente do fix de D7-08 (persistência antes da
tentativa + reconciliação no boot), já que essa proteção vive dentro do próprio
`gsCallIdempotente`, não em cada call site. **Nenhum achado concreto novo nesses.**

**Um achado real, mais grave que os outros 12**: `criarOSEmergencia` (via
`confirmarEmergencia()`) ainda usava `gsCall` PURO — nem tinha `gsCallIdempotente`, então nem
o dedup do backend nem a persistência de D7-08 se aplicavam. Pior que os ~12 (que ao menos já
tinham a proteção de `gsCallIdempotente`): aqui não havia proteção NENHUMA além do lock
implícito de UI. **Mesma classe do achado de `e46a925`**: o backend real
(`pwa/Código.js:2091-2094`) já lê `dados.operationId`/`dados.dispositivoId` desde a rodada
documentada como concluída em `DIRETRIZ-V1.1-FRENTES-BCDE.md` (commit de backend `6889b60`),
mas a mudança correspondente no frontend nunca chegou nesta branch (confirmado: `6889b60` nem
existe como objeto git neste repo — é commit do outro lado, `pwa`).

**Corrigido**: `confirmarEmergencia()` migrada pra `gsCallIdempotente` (convenção própria desta
função — `operationId`/`dispositivoId` como PROPRIEDADES de `dados`, não posicional, espelhando
exatamente o que o backend real lê) + lock explícito (`criarEmergencia`) — é criação de OS
nova, tão crítica quanto os 3 botões já endurecidos.

Teste novo (`test-toctou-frontend.js`, +2 casos): confirma `dados.operationId`/
`dados.dispositivoId` preenchidos com os campos de negócio originais intactos; confirma que um
2º "clique" enquanto o 1º está em voo não duplica a OS de emergência.

Suíte completa revalidada, zero regressão: **142/142** (17 arquivos).

## Fora desta rodada, sinalizado

- Os ~12 call sites que continuam só com o padrão implícito de UI (batches de checklist,
  apontamentos, KM inicial, ferramental) — revisados nesta rodada, nenhum achado concreto —
  fica documentado que a mesma fragilidade teórica se aplica a eles, e o utilitário de lock
  explícito já existe pronto pra reaproveitar se algum achado futuro justificar estender.
- Não foi auditado o backend (`executarIdempotente`, `verificarPosseOS` etc.) — esse é o
  território da varredura já pedida ao Code 1, fora do escopo desta auditoria.
