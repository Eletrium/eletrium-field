# Contrato proposto — Backend para o Checklist da OS em 3 Fases

Escrito pela sessão de frontend (`eletrium-field`, branch `checklist-3-fases`) para a
sessão de backend (Apps Script, `C:\EletriumERP\pwa`) avaliar. Não implementado por
aqui — Apps Script está fora do escopo desta sessão (regra de isolamento em vigor
durante o incidente aberto de sincronização, ver `docs/DIRETRIZ-V1.1-FRENTES-BCDE.md`
no repo `ERPEletrium`). Nenhuma linha de `Código.js`/`API.js` foi tocada.

## Por que este documento existe

O frontend (`index.html`, motor `CHK3F`) agora guia o técnico por uma sequência real
de 3 fases — Pré-Execução → Execução → Pós-Execução (Encerramento) — em vez dos 3
pontos desconectados que existiam antes (segurança era um card de checkboxes solto na
tela de encerrar; o checklist de execução era um botão à parte, sem ordem nem trava
com nada). Essa sequência hoje é **100% aplicada no cliente**, via estado salvo em
`localStorage` por `OS_ID`. Não existe barreira equivalente no servidor:

- `confirmarSegurancaPreExecucao` (interim, Frente B fatia prioritária) só verifica os
  4 booleans de segurança — não sabe que "Fase 2 (Execução) foi completada" é um
  conceito que existe.
- `canCloseOS` (Frente C) verifica `Estado_Seguranca === 'Liberado'` +
  `Laudo_URL`/`Assinatura_URL`/`Fotos_Evidencia` — **não verifica** se
  `Checklist_Respostas` desta OS tem qualquer resposta da Fase 2 (Execução) gravada.

Ou seja: hoje é tecnicamente possível concluir uma OS sem nunca ter aberto a Fase 2 —
bastaria chamar `confirmarSegurancaPreExecucao` direto (app desatualizado, cache
antigo, ou qualquer chamador que conheça a action, já que o dispatcher não tem
autenticação de transporte — achado registrado à parte na Frente E). `canCloseOS` não
bloquearia por causa disso.

## O que existe hoje (confirmado por leitura do código real, não suposição)

- A planilha do PWA (`Perguntas_Checklist`, Google Sheets) tem colunas `ID_Pergunta,
  Disciplina, Pergunta_Pai, Condicao_Exibicao, Ordem, Ativo` — **sem** `Fase_Execucao`,
  `Obrigatoria`, nem versionamento (`Versao_Criacao`/`Versao_Fim`).
- O motor completo com fases (`Pré-Execução / Execução / Pós-Execução`),
  obrigatoriedade por pergunta, NC e versões congeladas — referenciado no comentário B4
  do código como a fonte de verdade — existe **só** em `web/checklist.html`, e fala com
  **SharePoint via Microsoft Graph** (`EG.listItems/createItem/patchItemFields`), não
  com a planilha do PWA. É outro sistema, outra base de dados (Frente A/F, Cowork, fora
  do escopo de ambas as sessões atuais).
- `FASES` real (`web/checklist.html:357`): `["Pré-Execução", "Execução", "Pós-Execução"]`,
  `FASE_DEFAULT = "Execução"`.
- `sincronizarEstadoSeguranca` em `web/checklist.html` já implementa a regra real: ao
  completar a fase "Pré-Execução" (toda pergunta ativa e obrigatória da fase
  respondida), grava `Estado_Seguranca` = `Bloqueado` se houver NC pendente, senão
  `Liberado`. Essa é a lógica que o backend do PWA precisaria espelhar.

## Contrato proposto (não implementado, só desenhado)

1. **Colunas novas em `Perguntas_Checklist`** (planilha do PWA, idempotente via
   `setupSheets()`, mesmo padrão já usado para as outras colunas novas do projeto):
   - `Fase_Execucao` (texto: `"Pré-Execução"` | `"Execução"` | `"Pós-Execução"`)
   - `Obrigatoria` (boolean)
   Sem elas, não há como o servidor saber quais perguntas pertencem a qual fase, nem
   quais são obrigatórias para considerar a fase "completa".

2. **Função nova, ex. `fecharFaseChecklist(osId, tecnicoId, fase, operationId,
   dispositivoId)`**, passando por `executarIdempotente` (mesmo padrão da Frente D):
   - Lê `Checklist_Respostas` da OS, filtra por `Fase_Execucao === fase`.
   - Verifica se toda pergunta ativa+obrigatória da fase tem resposta gravada.
   - Se `fase === 'Pré-Execução'` e completa: grava `Estado_Seguranca` (`Bloqueado` se
     alguma resposta da fase tiver `geraNC=true`, senão `Liberado`) — isto **substitui**
     `confirmarSegurancaPreExecucao` como escritor real da coluna (exatamente o que o
     comentário do interim já anuncia: "quando o checklist 3 fases for portado, ele deve
     virar o escritor real desta coluna").
   - Se `fase === 'Execução'` e completa: marca um sinal equivalente (ex. coluna
     `Checklist_Execucao_Completo` em `Ordens_Servico`, boolean) que `canCloseOS` passa a
     exigir.

3. **`canCloseOS` ganha um 5º motivo de bloqueio**: `Checklist_Execucao_Completo !==
   true` — mesmo padrão fail-closed dos outros 4 motivos já implementados (Frente C).
   Isso fecha o gap real: hoje nada no servidor exige que a Fase 2 tenha acontecido.

4. **Um endpoint de leitura pontual** (ex. `consultarFaseChecklist(osId)`) para o
   frontend perguntar ao servidor "essa OS já tem Fase 1/2 completas?" antes de decidir
   qual fase mostrar — hoje o `CHK3F` decide isso só pelo `localStorage`, que não
   sobrevive a troca de aparelho ou limpeza de dados do navegador.

## O que o frontend já faz hoje, sem esperar o backend

- `CHK3F` (Fase 1) chama o `confirmarSegurancaPreExecucao` **existente**, sem mudança
  de assinatura — só troca a UX de "4 checkboxes numa tela" para "uma pergunta por vez,
  com bloqueio de avanço se a resposta for Não", e grava cada resposta via
  `salvarResposta` (já existente) para haver trilha de auditoria por pergunta.
- A sequência Fase 1 → Fase 2 → Fase 3 (Encerramento) é aplicada no cliente
  (`irParaEncerrar()` recusa navegar para a tela de encerramento se as fases 1/2 não
  estiverem completas no `localStorage`).
- Nenhuma coluna nova, nenhuma função nova, nenhum `clasp push`/deploy — zero mudança
  em Apps Script.

Quando este contrato for avaliado e (se aprovado) implementado no backend, o
`CHK3F.iniciar()` no frontend precisa trocar a fonte de verdade de `localStorage` para
o endpoint de leitura pontual (item 4 acima) — fica marcado no código com o mesmo
padrão de aviso já usado nas outras fatias interim deste projeto.
