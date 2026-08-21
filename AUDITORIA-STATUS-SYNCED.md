# Auditoria — terminal antigo do status do Log_Central (`SYNCED`) no frontend

Pedido do dono, 13/08: varrer o `eletrium-field` inteiro atrás de qualquer ponto que ainda
dependa do terminal antigo do Log_Central (`status==='SYNCED'` como sinal de "operação
terminou com sucesso"), já que a mudança de terminal (`SYNCED`→`QUEUED` como sucesso do
Sheets, `SYNCED`/`RECONCILED` reservados pro 1A) aconteceu no meio do dia e não foi
auditada sistematicamente por esse motivo específico.

## Metodologia

1. `grep` completo (case-insensitive) por `SYNCED` em `index.html`, `sw.js`, `API.gs`,
   `manifest.json`.
2. `grep` complementar por qualquer `.status ===` (não só contra `'SYNCED'` — pra pegar
   comparação contra outro valor de terminal também, caso houvesse).
3. Cada ocorrência revisada individualmente: é comparação contra o `status` de uma
   resposta de operação (Log_Central, o bug real) ou outro namespace (falso positivo)?

## Resultado: nenhum caso novo encontrado

Só os **2 já conhecidos e já corrigidos hoje** antes deste levantamento:

1. **`pollStatusOperacao`** — comparava `r.status === 'SYNCED' || r.status === 'SYNC_ERROR'`
   pra decidir fim de operação. **Era o bug real.** Corrigido: usa a presença de
   `r.resultado` (resultado_json, escrito pelo backend ANTES de status/sincronizado_em)
   como sinal de "concluído", não mais um valor de status específico.
2. **`processarFilaOffline`** — já usava o padrão certo (`success`/`retryable` do envelope
   canônico) antes mesmo desta rodada; serviu de referência pro fix de (1).

## Ocorrências revisadas e descartadas (falsos positivos, namespace diferente)

| Local | Trecho | Por que não é o bug |
|---|---|---|
| `processarFilaOffline`, skip-list do topo do loop | `item.status === 'SYNCED' \|\| item.status === 'RECONCILED' \|\| item.status === 'DIVERGENT'` | **Status LOCAL do outbox** (campo próprio do item no IndexedDB da fila, `atualizarItemFila`) — já confirmado por D7-02 como namespace diferente do `status` do Log_Central. Coincide o texto (`'SYNCED'` existe nos dois vocabulários), mas é o app decidindo seu PRÓPRIO estado de fila, não lendo o status de uma resposta do backend. |
| `enfileirarChamadaComId` | `status: 'QUEUED'` (atribuição, não comparação) | Mesmo namespace local acima — estado inicial do item na fila. |
| `pollStatusOperacao` (timeout) | `{ encontrado: false, status: 'TIMEOUT' }` | Valor **sintético que o próprio frontend inventa** quando o poll esgota tentativas — não vem do backend, não é comparação. |
| `carregarOferta` | `oferta.status === 'Aceita'` | Status de **negócio da oferta** (`Pendente`/`Aceita`/`Recusada`), campo de `getOfertaAlocacao` — função só-leitura, fora do envelope canônico do Log_Central (`CONTRATO-FRONTEND-ENVELOPE-RECUSA.md`: funções só-leitura "mantêm sua própria convenção de retorno"). Namespace completamente diferente. |
| `renderHome`/`abrirOS` | `os.statusAtual === 'Em andamento'` / `os.status === 'Em andamento'` | Status de **negócio da OS** (`Ordens_Servico.Status`/`Status_Atual`, de `getOsDoTecnico`) — idem, outro domínio, nada a ver com sincronização. |
| `sw.js`, `API.gs`, `manifest.json` | — | Zero ocorrências de `SYNCED`/`SYNC_ERROR`/`DIVERGENT`/`RECONCILED` nesses arquivos. |

## Teste

`test/test-guard-status-synced.js` — transforma este levantamento manual num **guard
permanente**, não só um snapshot do que foi visto hoje: varre o `<script>` de `index.html`
(comentários removidos antes, senão os próprios comentários que documentam o bug já
corrigido contam como falso achado — bug de CRLF no primeiro rascunho deste teste, `.`
não casa `\r` em JS, corrigido) e afirma que a ÚNICA comparação `X.status === 'SYNCED'`
restante é `item.status` (outbox local). Se alguém reintroduzir esse padrão em qualquer
outro lugar do app no futuro, este teste quebra e aponta a linha. 3/3.

Suíte completa revalidada: 12+8+18+11+8+7+11+3 = **78/78**, sem regressão.
