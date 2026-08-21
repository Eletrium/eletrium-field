# Auditoria — linguagem técnica vazando pro técnico (seção 51 do auditor)

Pedido do dono, 13/08: reaplicar o mesmo tipo de auditoria já feita pras mensagens de erro
(`AUDITORIA-MENSAGENS-TECNICO.md`), agora atrás de **linguagem técnica/nomenclatura de
sistema** vazando pra qualquer tela do PWA — nunca mostrar `LOCAL_PENDING`/`QUEUED`/
`SYNC_ERROR` crus, IDs de operação, nomenclatura de sistema. As Fases A/B/C da
reorganização de UX (Home + Wizard de encerramento) já cobriram esse ponto nessas duas
telas especificamente (`resumoFila`/`renderStatusSincronizacao` — Fase A). Esta rodada
cobre **o resto do app**: login/PIN, dia (início/fim), pausar/retomar, emergência,
veículo, checklist (Fase 1 e Fase 2), upload (Laudo/Assinatura/Selfie/foto de KM), tela de
KM, ferramental, aceite de oferta, resumo do dia.

## Metodologia

1. Grep pelos termos literais do vocabulário interno (`LOCAL_PENDING`, `QUEUED`,
   `SENDING`, `RECEIVED`, `SYNCED`, `RECONCILED`, `SYNC_ERROR`, `DIVERGENT`,
   `operationId`/`operation_id`, `error_code` e os 11 códigos de erro do vocabulário
   aprovado — `TIMEOUT`, `PAYLOAD_INVALIDO`, `CONFLITO_VERSAO`, `PERMISSAO_NEGADA`,
   `QUOTA_EXCEDIDA`, `CONEXAO_INDISPONIVEL`, `REFERENCIA_INVALIDA`, `DUPLICADO`,
   `DIVERGENCIA_VALOR`, `DIVERGENCIA_AUSENCIA`, `ERRO_DESCONHECIDO`) em `index.html`
   inteiro.
2. Grep por todo `.textContent =`/`.innerHTML =`/`toast(...)` cujo valor vem de uma
   **variável** (não string literal) — é aí que um valor do backend/outbox poderia
   vazar sem eu ter escrito o texto errado de propósito.
3. Grep por nomes de função/campo internos (`Log_Central`, `resultado_json`,
   `dispositivoId`, `executarIdempotente`, `canCloseOS`, `gsCallIdempotente`,
   `blocking_reasons`) pra confirmar que nenhum aparece dentro de um `toast`/
   `textContent`/`innerHTML`.
4. Checagem cruzada automatizada: toda linha do script (comentários removidos) que
   contém um dos termos do item 1 **e** uma chamada de escrita de UI na mesma linha —
   candidato a leak real, não falso positivo de comentário.
5. Cada candidato revisado individualmente contra o código-fonte real (não suposição).

## Resultado: nenhum caso novo encontrado

A checagem automatizada (item 4) devolveu **zero linhas** combinando vocabulário interno
com escrita de UI. Todas as ocorrências de `.status` fora do outbox interno são
comparações (`item.status === 'DIVERGENT'`, filtros) — nunca renderizadas — **exceto
uma**, investigada em detalhe abaixo.

### O único candidato real: `salvarVeiculo()` → `toast(res.status || 'Enviado para aprovacao!')`

Achado inicial preocupante: se `res` viesse do envelope canônico (`_sucesso()`/
`_recusa()`, que sempre grava `status: 'QUEUED'`), esse toast mostraria literalmente
**"QUEUED"** pro técnico em vez de uma mensagem amigável.

**Verificado por leitura direta do backend** (`pwa/Código.js:2448-2504`,
`cadastrarOuEditarVeiculo`): a função **não** passa por `executarIdempotente`/
`_sucesso()` — devolve seu próprio objeto literal:
```js
return {
  sucesso: true,
  status: linhaExistente ? 'Alteracao enviada para aprovacao' : 'Cadastro enviado para aprovacao'
};
```
O campo `status` aqui é uma **frase amigável escrita à mão por esta função
especificamente** — não o vocabulário do Log_Central. Confirmado: **falso positivo**, o
toast já mostra exatamente o que deveria. Não corrigido porque não há nada errado.

Documentado com um teste-guarda (ver abaixo) que quebra especificamente se essa função
migrar pro envelope canônico no futuro sem o toast ser revisado junto — não é "confia e
esquece", é uma trava pra essa suposição não silenciosamente parar de valer.

## Por que não achei mais nada

- Todo uso de `err.message` (upload, KM, checklist, ferramental, oferta, encerramento)
  vem de `Error` objects que o próprio app constrói com texto em português
  (`'Falha de rede (JSONP)'`, `'Tempo esgotado'`, em `gsCallReal`) — não são exceções
  JS cruas do tipo `TypeError: Cannot read properties of undefined`.
- `erroDetalhe` (campo do outbox local, guarda `blocking_reasons` serializado) é
  **escrito em 4 lugares, lido em nenhum** — não existe tela/detalhe que exiba esse
  campo pro técnico hoje.
- Os demais campos `.status`/`.statusAtual` no app são de **outros domínios de
  negócio** (`Status_Aprovacao` de veículo — Pendente/Aprovado/Rejeitado;
  `Status_Alocacao`/status de oferta — Pendente/Aceita/Recusada; `Estado_Seguranca` —
  Liberado/Bloqueado; status de OS — Em andamento/Pausada/Pendente), já em português,
  já pensados pra aparecer na tela — não é o mesmo problema que motivou a seção 51.

## Teste

`test/test-guard-nomenclatura-sistema.js` (2/2) — transforma a varredura manual num
guard permanente:
1. Confirma que nenhuma linha do script combina um termo do vocabulário interno com uma
   chamada de escrita de UI (a mesma checagem automatizada do item 4, agora executável).
2. Confirma especificamente que `salvarVeiculo()` continua chamando `toast(res.status)`
   sem que `cadastrarOuEditarVeiculo` tenha migrado pra `gsCallIdempotente` — se migrar,
   este teste quebra e sinaliza que o toast precisa ser revisado antes do `status` virar
   `QUEUED`/`SYNCED`/etc.

Suíte completa revalidada: 12+8+18+11+8+7+11+3+7+6+10+2 = **103/103**, sem regressão.
