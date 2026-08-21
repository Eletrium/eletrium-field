# Preparação — call sites do token de sessão: Onda 3 + pausarOS/retomarOS (21/08)

**Isto é reconhecimento de terreno, não implementação.** Nenhuma linha de `index.html` mudou por
causa deste documento. Trabalho de preparação pedido pelo dono, **independente do backend
REAUTH** — quando o contrato `CONTRATO-BACKEND-TOKEN-SESSAO.md` for formalizado e implementado
no backend, a regra de sempre continua valendo: mudança de frontend motivada por backend entra
via `CONTRATO-BACKEND-*.md` pro dono repassar, nunca edição direta deste worktree.

Complementa (não substitui) o levantamento mais amplo já existente em
`ERPEletrium/docs/LEVANTAMENTO-CALL-SITES-TOKEN-SESSAO.md` (15/08) — aqui o escopo é só as 9
funções pedidas nesta rodada, com uma coluna nova (onde o PIN/token viveria hoje) e as linhas
reconferidas contra o `index.html` atual (o arquivo cresceu ~350 linhas desde 15/08; várias
linhas citadas no levantamento antigo já não batem mais).

## As 9 funções

| Backend | Frontend (função) | Linha(s) hoje | Tipo | Chamada |
|---|---|---|---|---|
| `registrarInicioDia` | `confirmarInicioDia()` | decl. 1898, chamada 1907 | escrita via outbox | `gsCallIdempotente` |
| `registrarFimDia` | `confirmarFimDia()` | decl. 1934, chamada 1938 | escrita via outbox | `gsCallIdempotente` |
| `cadastrarOuEditarVeiculo` | `salvarVeiculo()` | decl. 3271, chamada 3278 | escrita via outbox (`{enfileiravelSeOffline:true}`) | `gsCall` **plain**, não `gsCallIdempotente` — ver achado abaixo |
| `getDiariaTecnico` | `irParaResumo()` | decl. 3490, chamada 3494 | leitura síncrona | `gsCall` |
| `getVeiculoDoTecnico` | `irParaInicioDia()` / `irParaMeuVeiculo()` | 1833/1859 e 3213/3234 (2 pontos) | leitura síncrona | `gsCall` |
| `getOsDoTecnico` | `carregarHome()` | decl. 2215, chamada 2223 | leitura síncrona | `gsCall` |
| `getDiariaHoje` | `_entrarConfirmado()` | decl. 2031, chamada 2035 | leitura síncrona | `gsCall` |
| `pausarOS` | `confirmarPausa()` / ramo "pausar" de `confirmarEmergencia()` | chamada 2486 e chamada 2583 (2 pontos) | escrita via outbox | `gsCallIdempotente` |
| `retomarOS` | `confirmarRetomar()` | decl. 2510, chamada 2514 | escrita via outbox | `gsCallIdempotente` |

## Onde o PIN/token seria armazenado hoje

**Não existe nenhum armazenamento de PIN ou token hoje** — confirmado lendo o fluxo de login
real (`confirmarPin()` → `entrarComoTecnico()` → `_entrarConfirmado()`, `index.html:2008-2039`):

- O PIN digitado (`#pin-input`) é lido, mandado uma única vez pra `validarPin(tec.id, pin)`
  (`index.html:2014`), e **descartado imediatamente** — nunca é atribuído a nenhuma variável
  persistente, nunca vai pro `localStorage`. Não há campo `pin` em `APP` nem em qualquer objeto
  serializado.
- O que É persistido hoje, ao confirmar login (`_entrarConfirmado`, `index.html:2031-2033`):
  `APP.tecnico = tec` + `localStorage.setItem('eletrium_tecnico', JSON.stringify(tec))` — só a
  **identidade** do técnico (id, nome — o objeto que `getTecnicos` devolve), não uma credencial.
  Sobrevive a reload, mas não prova posse de sessão nenhuma pra um backend com REAUTH.
- O padrão mais próximo de "token persistido" que já existe no código é
  `obterDispositivoId()`/`localStorage['eletrium_dispositivo_id']` (`index.html:894-896`) — gera
  um ID uma vez, grava, reusa em toda chamada daí pra frente. **Candidato natural de mesmo
  formato** pro token de sessão (`eletrium_token_sessao` ou nome equivalente, ao lado de
  `eletrium_tecnico`) quando o contrato chegar — mas isso é decisão de implementação, não deste
  documento.

Consequência prática: quando o `CONTRATO-BACKEND-TOKEN-SESSAO.md` definir o formato do token, a
integração no frontend precisa criar esse armazenamento do zero (não há nada pra só "estender") —
mesmo padrão que `dispositivoId` já resolveu, não uma descoberta nova.

## Achado — `cadastrarOuEditarVeiculo` é o único dos 9 que não passa por `gsCallIdempotente`

Os outros 8 (leituras via `gsCall` puro não contam, não escrevem) ou já usam
`gsCallIdempotente` (as 4 escritas restantes) ou são leitura sem necessidade de idempotência.
`cadastrarOuEditarVeiculo` é a única ESCRITA da lista que roda por `gsCall(..., {enfileiravelSeOffline:true})`
direto (`index.html:3278`) — sem `operationId`, sem entrada no outbox com dedupe por intenção,
sem o hook do banner persistente (`atualizarBannerPendenteEnvio`) que todas as escritas via
`gsCallIdempotente` já disparam. Isso já era verdade antes deste levantamento (mesma classe do
achado registrado em `AUDITORIA-NOMENCLATURA-SISTEMA.md`) — não é novo, só fica reafirmado aqui
porque muda o que "anexar o token" significa pra esta função especificamente: não há um
`montarParams(operationId, dispositivoId)` pra estender (o padrão que as outras 8 usam) — o
token entraria direto na lista de params de `gsCall`, um caminho de integração ligeiramente
diferente das demais. Sinalizando, não decidindo se `cadastrarOuEditarVeiculo` deveria migrar
pra `gsCallIdempotente` — isso é uma mudança de comportamento real, fora do escopo de um
levantamento.

## O que o frontend vai precisar fazer quando o contrato chegar (preparação, não implementação)

Mesma seção 6 já registrada em `LEVANTAMENTO-CALL-SITES-TOKEN-SESSAO.md`, reafirmada aqui pro
subconjunto destas 9 funções:
1. Criar o armazenamento do token (não existe hoje — ver seção acima), ao lado de `APP.tecnico`.
2. Para as 4 escritas via `gsCallIdempotente` (`registrarInicioDia`, `registrarFimDia`,
   `pausarOS` ×2, `retomarOS`): anexar o token dentro de `montarParams(operationId,
   dispositivoId)` — mesmo padrão mecânico já usado 3x pro `operationId`/`dispositivoId`.
3. Para `cadastrarOuEditarVeiculo` (`gsCall` plain): anexar o token direto na lista de params —
   sem `montarParams`, integração ligeiramente diferente (ver achado acima).
4. Para as 4 leituras (`getDiariaTecnico`, `getVeiculoDoTecnico` ×2, `getOsDoTecnico`,
   `getDiariaHoje`): mesmo padrão de anexar token nos params de `gsCall` — sem outbox, sem
   `operationId`, o token entra e sai numa chamada só.
