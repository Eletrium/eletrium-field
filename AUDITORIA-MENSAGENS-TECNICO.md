# Auditoria — mensagens de resultado de operação pro técnico

Levantamento pedido pelo dono: não se o app trata o erro tecnicamente (isso já foi
auditado nas rodadas do outbox/envelope canônico), mas se a **mensagem que o técnico vê**
faz sentido pra alguém em campo.

**Atualização (13/08)**: o levantamento original (abaixo, seções sem marcação) ficou como
histórico. Depois de duas rodadas de fix, o estado atual de cada ponto está marcado assim:
✅ **CORRIGIDO** (usa `mensagemRecusa`/`motivosRecusa` agora — blocking_reasons + retryable),
⏭️ **PULADO** (decisão registrada, com o motivo, não é omissão).

## Sobre o caso concreto que motivou isso

> "quando a guarda camada-2 do 1A rejeitar uma operação por OS já concluída (DIVERGENT),
> o técnico vai ver alguma mensagem — ela precisa dizer algo como 'essa OS já foi
> encerrada'."

Duas situações **diferentes**, que dão respostas diferentes:

1. **Rejeição síncrona, no momento da ação** (o técnico está online, tenta agir numa OS
   já concluída — ex. `encerrarOS`/`canCloseOS` recusa na hora): existe hoje, e é
   tratada bem (ver `confirmarEncerramento` na tabela abaixo — é o melhor caso da
   auditoria inteira).
2. **Rejeição assíncrona pela guarda de camada 2** (o técnico já agiu, o Sheets já
   aceitou e mostrou sucesso, e SÓ DEPOIS — quando o cenário 1A tenta sincronizar pro
   SharePoint — a guarda descobre que a OS já estava concluída lá e recusa o PATCH,
   gravando `Trilha_Divergencia_Sync`, per `docs/SPEC-PWA-TECNICO.md` §3): **não existe
   nenhuma tela ou notificação no app pra esse caso hoje.** O técnico já viu "sucesso" e
   seguiu em frente; a divergência fica só no Log/SharePoint, sem caminho de volta pro
   PWA. Isto não é "mensagem genérica demais" — é **ausência total de mensagem**, porque
   não existe superfície nenhuma no app pra reconciliação pós-fato. Acho que é este o
   caso que motivou o pedido, e é o achado mais importante deste levantamento: não é um
   ajuste de texto, é uma lacuna estrutural (precisaria de uma tela tipo "pendências/
   divergências encontradas depois" — fora do escopo de "só levantar mensagens").

## Padrão geral observado

Quase todo fluxo de escrita no app segue a mesma forma:

```js
gsCall('acao', [...], { enfileiravelSeOffline: true }).then(res => {
  if (res.erro) { toast('Erro: ' + res.erro, true); return; }   // (A)
  ...sucesso...
}).catch(() => { toast('Erro ao <ação>', true); });              // (B)
```

- **(A) usa `res.erro`** — o campo legado "mensagem legível" que o contrato canônico
  garante em toda recusa. Quando presente, tende a ser razoável, mas a QUALIDADE da
  mensagem final depende inteiramente do texto que o backend escreveu em `erro` — o
  frontend não adiciona contexto nem reformula pro técnico.
- **(B) é sempre genérico** — dispara em falha de transporte de verdade (rara, já que a
  maioria das chamadas usa `enfileiravelSeOffline:true` e nem chega aqui) ou em exceção
  inesperada dentro do `.then()`. Texto fixo tipo "Erro ao encerrar", sem detalhe.

O achado real, função por função, está na tabela.

## Upload (Laudo / Assinatura / Selfie / Foto de desvio de KM)

`capturarEUpload` (genérico, usado por Laudo/Assinatura/foto de KM) e `enviarSelfieEPI`.

| Situação | Mensagem atual | Veredito |
|---|---|---|
| Sucesso | "Enviado ✓" / "Selfie enviada ✓" + elegibilidade | **Clara** |
| Recusa do backend (`success:false`) | ✅ **CORRIGIDO** — `mensagemRecusa(r, verbo)`: "Não foi possível enviar/salvar: [blocking_reasons ou erro]" (recusa de regra de negócio) ou "Falha ao enviar/salvar (tente novamente): [motivo]" (retryable) | Era o pior caso da auditoria — texto fixo "tente novamente" mesmo quando não adiantava. Fix em `capturarEUpload`/`enviarSelfieEPI`. |
| Timeout do poll (nunca resolve) | "Envio em processamento — confira antes de concluir" | Aceitável — não afirma sucesso nem falha, mas também não dá prazo/o que fazer se continuar assim |
| Exceção (rede) | "Erro: " + err.message | Mediana — inclui detalhe, mas é a mensagem crua do JS (`Failed to fetch`, etc.), não reescrita pro técnico |

## Checklist (Fase 1 segurança, Fase 2 execução — CHKV2/CHK)

| Situação | Mensagem atual | Veredito |
|---|---|---|
| Fase 1: backend recusa `confirmarSegurancaPreExecucao` | ✅ **CORRIGIDO** — `mensagemRecusa(r, 'confirmar a segurança')`: "Não foi possível confirmar a segurança: [motivo]" | Frase contraditória antiga removida; usa blocking_reasons + retryable |
| Fase 2 (CHKV2): NC exige foto que o app não captura | "NC em '[pergunta]' exige foto do item, que este app ainda não captura — não é possível avançar" | **Clara** — explica a limitação real, não finge ser erro do técnico |
| Fase 2 (CHKV2): erro ao salvar respostas (`Promise.all` de N chamadas) | "Erro ao salvar checklist" | ⏭️ **PULADO** — catch de `Promise.all` de N chamadas `salvarResposta` independentes (cada uma já enfileira offline, então na prática só dispara em exceção JS inesperada); não há um envelope único com `blocking_reasons` pra ler ali — a rejeição é da 1ª promise que falhou dentre N. Aplicar o padrão exigiria reestruturar pra `Promise.allSettled` + agregação por item, mudança de comportamento, não só de mensagem. Documentado em comentário no código. |
| Fase 2 (CHK, fallback antigo): erro ao carregar pergunta | "Erro ao carregar pergunta" | ⏭️ **PULADO** — `getProximaPergunta` é função só-leitura (fora do envelope canônico, ver `CONTRATO-FRONTEND-ENVELOPE-RECUSA.md`), não tem `blocking_reasons` pra ler; falha aqui é sempre de transporte. Documentado em comentário no código. |
| Fase 2 (CHK): NC sem foto | "Justificativa e foto são obrigatórias para não conformidade — captura de foto ainda não disponível nesta versão do app" | **Clara** |
| Gate da Fase 3 (`irParaEncerrar`) | "Complete a Fase 1 (Pré-Execução) do checklist antes de encerrar a OS" / "...Fase 2..." | **Clara** — diz exatamente o que falta e o que fazer |
| Validações locais (sem opção selecionada, etc.) | "Selecione uma opção" | **Clara** |

## KM (iniciar OS com KM, KM final pendente)

| Situação | Mensagem atual | Veredito |
|---|---|---|
| Desvio de KM detectado (`exigeJustificativa`) | Mostra `res.mensagem` num bloco dedicado ("Diferença de Xkm detectada...") + toast "justifique abaixo" | **Clara** — o melhor padrão de erro-com-ação-clara do app |
| Erro genérico do backend (`res.erro`, não é exigeJustificativa) | ✅ **CORRIGIDO** — `mensagemRecusa(res, 'iniciar a OS' / 'registrar o KM final')` | Agora usa blocking_reasons (pode ter mais de 1 motivo) + retryable, não só o texto cru de `erro` |
| Exceção (rede) ao iniciar/registrar KM | "Erro ao iniciar OS: " + err.message / "Erro ao registrar KM: " + err.message | Melhorado (inclui `err.message` agora) mas não usa `mensagemRecusa` — é exceção de transporte sem envelope, mesmo caso do catch do checklist |
| Validação local (KM vazio) | "Informe o KM do odômetro" | **Clara** |

## Ferramental

| Situação | Mensagem atual | Veredito |
|---|---|---|
| Backend recusa (`r.success===false`) | ✅ **CORRIGIDO** — `mensagemRecusa(r, 'registrar o movimento')`, check migrado de `r.sucesso` pra `r.success` (consistente com o resto) | blocking_reasons + retryable, fallback "motivo não informado" só quando o backend genuinamente não manda nenhum dos dois |
| Exceção (rede) | "Erro: " + err.message | Já tinha `err.message` — mantido, sem envelope pra ler ali |
| Validações locais (patrimônio vazio, observação obrigatória) | Claras e específicas | **Clara** |
| Sucesso / offline | "Registrado" / "Registrado (offline) — sincroniza quando voltar sinal" | **Clara** |

## Aceite da oferta

| Situação | Mensagem atual | Veredito |
|---|---|---|
| Link inválido | "Link inválido" + oferta.erro (se veio) ou texto padrão | **Clara** |
| Oferta expirada | "Oferta expirada" + data de expiração + "fale com seu gestor" | **Clara — a melhor mensagem de estado do app** |
| Oferta já respondida | "Oferta já respondida" + se foi aceita/recusada | **Clara** |
| PIN incorreto | res.erro ou "PIN incorreto. Tente novamente." | **Clara** |
| Recusa ao registrar aceite/recusa (`r.success===false`) | ✅ **CORRIGIDO** — `motivosRecusa(r)` no corpo (mostrarStatusOferta já tem título próprio) + título muda pra "...( tente novamente)" quando `retryable` | Mesmo padrão, adaptado pro layout de 2 campos (título + mensagem) em vez de 1 toast |
| Exceção ao carregar/registrar | "Erro ao carregar a oferta: " + err.message / "Erro ao registrar: " + err.message | Mantido — já tinha `err.message`, sem envelope pra ler ali |
| Link inválido, oferta expirada/já respondida | "Clara" (ver linhas acima) | ⏭️ **PULADO** — `getOfertaAlocacao` é função só-leitura (fora do envelope canônico), já usa `oferta.erro` quando disponível; nada a melhorar sem inventar campo que a função não tem |
| Offline | "Aceite enfileirado" / "Recusa enfileirada" + explica que sincroniza depois | **Clara** |

## Outras áreas (não pedidas explicitamente, mas mesmo padrão)

- **Encerramento de OS** (`confirmarEncerramento`) — **destaque positivo**: `const motivos
  = Array.isArray(res.blockingReasons) ? res.blockingReasons.join('; ') : (res.erro ||
  'motivo não informado'); toast('OS não pode ser concluída ainda: ' + motivos, true)` —
  é a ÚNICA função do app que lê `blockingReasons`/`blocking_reasons` explicitamente pra
  compor a mensagem. É exatamente o padrão que deveria se espalhar pro resto (upload,
  ferramental, oferta).
- **Início/fim de dia, pausar, retomar, emergência, veículo** — todos seguem o padrão
  "(A) mostra res.erro, (B) catch genérico 'Erro ao X'" já descrito. Nenhum caso
  especialmente ruim nem especialmente bom aqui além do padrão geral.

## Resumo do achado (histórico, ver marcações ✅/⏭️ nas tabelas acima pro estado atual)

1. **Pior caso concreto**: upload (Laudo/Assinatura/Selfie/foto de KM) — a única área que
   **descarta completamente** o motivo real da recusa (`blocking_reasons`/`error_code`
   disponíveis na resposta, mas nunca lidos), mostrando sempre "tente novamente" mesmo
   quando o motivo não é transitório. **✅ Corrigido.**
2. **Padrão a copiar**: `confirmarEncerramento` (usa `blockingReasons`/`erro` de verdade)
   e as mensagens de oferta expirada/já respondida (contextualizam o estado, não só
   "erro"). **✅ Agora espalhado pra checklist, KM, ferramental e oferta** (helper
   `mensagemRecusa`/`motivosRecusa`, blocking_reasons + retryable).
3. **Fallback genérico mais comum**: `'motivo não informado'` quando `r.erro` vem vazio —
   isso é function-dependente (alguma função do backend não está preenchendo `erro`
   sempre) tanto quanto frontend-dependente. Continua existindo como fallback de último
   recurso — não dá pra eliminar do lado do frontend sozinho.
4. **Lacuna estrutural, não de texto**: divergência descoberta pela guarda de camada 2
   (1A) depois que o app já mostrou sucesso — não existe NENHUMA superfície no app pra
   isso hoje. É provavelmente o caso real que motivou o pedido, e é maior que "melhorar
   uma mensagem" — precisa de uma tela nova de pendências/divergências. **Não abordado
   nesta rodada** — segue como lacuna estrutural registrada, fora do escopo de ajuste de
   mensagem.

## O que foi corrigido nas rodadas seguintes (13/08)

- `mensagemRecusa(r, verbo)` / `motivosRecusa(r)` — helpers novos, únicos, usados em
  TODOS os pontos corrigidos (não duplicado por área).
- ✅ Upload (`capturarEUpload`, `enviarSelfieEPI`) — primeira rodada.
- ✅ Checklist Fase 1 (`CHK3F._finalizarFase1`) — remove frase contraditória, usa
  blocking_reasons.
- ✅ KM (`_iniciarOSDeVerdade`, `confirmarKMFinalPendente`) — ramo `res.erro` (não
  exigeJustificativa, que já era bom e não foi tocado).
- ✅ Ferramental (`registrarMovimentoFerramental`) — check migrado de `sucesso` pra
  `success`.
- ✅ Aceite de oferta (`_registrarAceiteOferta`) — adaptado pro layout de
  título+mensagem (`mostrarStatusOferta`), título muda com `retryable`.
- ⏭️ Pulados, com motivo documentado em comentário no código: `CHKV2.finalizar()`
  (catch de `Promise.all` sem envelope único), `carregarPergunta` (função só-leitura,
  sem blocking_reasons), `getOfertaAlocacao` (idem), exceções de rede puras (sem
  envelope, só `err.message` cru).

Testado com rede mockada em todas as 5 fatias — 75/75 no total (contando as suítes
anteriores revalidadas).
