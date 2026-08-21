# Fix P0 — fecharFaseChecklist nunca era chamada (15/08)

Achado durante o levantamento de call sites pro rollout do token de sessão
(`LEVANTAMENTO-CALL-SITES-TOKEN-SESSAO.md`), classificado pelo ChatGPT como cross-front finding
P0. Dono recomendado: Code 2 (frontend/QA). Critério de aceite dado pelo dono: *"checklist
concluído → fecharFaseChecklist efetivamente executada → estado persistido → canCloseOS
reconhece a fase → fechamento avança. Checklist incompleto → fechamento continua bloqueado."*

## O achado

`fecharFaseChecklist` (backend, `Código.js:2463-2565`) não era chamada em NENHUM lugar do
frontend. O próprio `DIRETRIZ-V1.1-FRENTES-BCDE.md` já tinha previsto exatamente esse risco ao
implementar a função: *"como o 5º motivo [de `canCloseOS`] é fail-closed, depois deste deploy
nenhuma OS fecha pelo PWA até `fecharFaseChecklist('Execução', ...)` ser chamado pelo menos uma
vez por OS -- ou seja, depende do frontend (CHK3F) estar integrado e rodando de verdade."*

Confirmado, lendo o código real:
- **Fase 1 (Pré-Execução)**: `CHK3F._finalizarFase1()` chamava `confirmarSegurancaPreExecucao`
  — a função INTERIM que o próprio comentário do backend já dizia que devia ser substituída
  quando o checklist 3 fases fosse portado. Foi portado (é o CHK3F) — a troca nunca aconteceu.
- **Fase 2 (Execução)**: `concluirChecklist()` só gravava `localStorage` — nenhuma chamada de
  rede acontecia.

**Consequência real**: `canCloseOS` nunca via `Checklist_Execucao_Completo=true` — nenhuma OS
que passasse pelo checklist 3 fases conseguia satisfazer o 5º motivo de fechamento, mesmo com
Laudo/Assinatura/Fotos/Segurança todos corretos.

## O fix

- **`CHK3F._finalizarFase1()`**: as 5 respostas de auditoria (`salvarResposta`) agora são
  coletadas num array e aguardadas via `Promise.all` ANTES de chamar
  `fecharFaseChecklist(os.id, tecnicoId, 'Pré-Execução', opId, devId)` — `fecharFaseChecklist`
  só enxerga respostas já gravadas em `Checklist_Respostas`; chamar cedo demais devolveria
  "incompleta" mesmo com o técnico tendo respondido tudo. Substitui
  `confirmarSegurancaPreExecucao` como escritor real de `Estado_Seguranca`.
- **`_fecharFase2Execucao()`** (nova função, compartilhada pelos 2 motores de checklist —
  `CHKV2` fat-client e `CHK` legado ao vivo): mesma disciplina — `Promise.all` das respostas da
  fase antes de chamar `fecharFaseChecklist(..., 'Execução', ...)`. Grava
  `Checklist_Execucao_Completo=true` de verdade.
- **`CHK.chamadasPendentes`**: o motor legado (`_gravarResposta`) agora coleta as promises de
  cada resposta individual (antes eram fire-and-forget, sem rastro) — necessário porque esse
  motor responde uma pergunta de cada vez, não em lote como o `CHKV2`.
- **Offline-safe**: como as chamadas de resposta são enfileiradas ANTES de `fecharFaseChecklist`
  (mesma ordem, `enfileiravelSeOffline:true`), e `processarFilaOffline()` já é FIFO, um técnico
  offline tem a sequência sincronizada na ordem certa quando a conexão voltar — sem duplicar.
- **Recusa não trava a navegação**: se `fecharFaseChecklist` recusar (schema divergente, caso
  raro), o toast mostra o motivo real (`mensagemRecusa`) mas o app segue em frente — a barreira
  de verdade é `canCloseOS`, que corretamente bloqueia o fechamento se o campo não foi gravado.
  Travar a navegação do checklist não ajudaria (o app local não tem mais nada a pedir).
- **Comentários "GAP CONHECIDO" desatualizados** (documentavam a ausência da barreira
  server-side, escritos antes do backend implementar `fecharFaseChecklist`/o 5º motivo)
  atualizados pra refletir que a barreira agora existe de verdade.

## Teste

`test-p0-checklist-cancloseos.js` (4/4, novo) — prova o critério de aceite ponta a ponta com um
mock que **persiste estado de verdade** entre chamadas (um "servidor" simulado que
`fecharFaseChecklist` escreve e `canCloseOS` lê, exatamente como `Ordens_Servico` real seria):
1. Checklist completo → as 2 fases fecham no backend → `canCloseOS` (chamada nova e
   independente, sem reaproveitar nada da chamada anterior) reconhece e libera.
2. Só Fase 1 fechada (Execução nunca chamada) → `canCloseOS` bloqueia com o motivo real
   (`Checklist_Execucao_Completo`).
3. Nenhuma fase fechada → bloqueia com os 2 motivos do checklist.
4. Integração com o gate local (`irParaEncerrar`) — confirma que o wizard chega na tela de
   encerrar depois do fluxo completo.

`test-checklist-3-fases.js` e `test-integracao-frente-b.js` (mocks atualizados pra
`fecharFaseChecklist`, alguns cenários redesenhados porque o momento em que `fase2` fica
persistida mudou — antes só no botão "voltar", agora assim que o servidor confirma).

Suíte completa revalidada, zero regressão: **146/146** (19 arquivos).

## Fora desta rodada, sinalizado

- `consultarFaseChecklist(osId)` (leitura pontual, já existe no backend) ainda não é chamada
  pelo frontend — permitiria recuperar o estado de Fase 1/2 ao trocar de aparelho, em vez de
  depender só de `localStorage`. Melhoria de robustez separada do achado P0 fechado aqui.
