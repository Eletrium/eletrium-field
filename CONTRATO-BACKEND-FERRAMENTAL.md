# Contrato proposto — Backend para Ferramental (carga/desmobilização)

Escrito pela sessão de frontend (`eletrium-field`, branch `checklist-3-fases`) para a
sessão de backend avaliar. Não implementado por aqui — Apps Script fora do escopo desta
sessão. Nenhuma linha de `Código.js`/`API.js` foi tocada.

## Estado real, confirmado por leitura (não suposição)

- `pwa/Código.js`/`pwa/API.js`: **zero** menção a ferramenta/patrimônio/calibração —
  grep vazio, confirmado (não é ausência de busca, é ausência de dado).
- `docs/INVENTARIO-PWA-0805.md:57`: "Ferramental — Nada, zero menção em qualquer arquivo
  [do PWA] — Tela nova — Sem ponto de partida no código atual."
- A referência de negócio real, `web/ferramental.html`, roda sobre **SharePoint via
  Graph** (não Apps Script) e gerencia 3 listas: `Ferramentas_Catalogo`,
  `Ferramentas_Patrimonio`, `Servico_Ferramenta_Obrigatoria` — schema completo também
  documentado em `docs/SPEC-MODULO-OS-MEI.md:109-120`.
- `docs/SPEC-PWA-TECNICO.md` §2 (tabela) já registra a direção: aba nova
  `Ferramental_Movimentos`, "precisa sync novo ou leitura embarcada", **movimento
  append-only** — diferente do padrão mutável do SharePoint (`Status_Ferramenta`
  sobrescrito in-place), que é exatamente o tipo de padrão que a lição do 1F (citada no
  mesmo doc) recomenda evitar em favor de eventos.

## Por que esta fatia NÃO tenta portar catálogo/calibração/obrigatoriedade

As 3 travas de segurança reais do fluxo do gestor (`web/ferramental.html`) — só item
`Status_Ferramenta==="Disponível"` aparece selecionável, calibração vencida bloqueia,
ferramenta obrigatória por `Tipo_OS_Completo` trava o botão de confirmar — dependem de
dado que **só existe no SharePoint hoje**. Portá-las exige um sync novo
(SharePoint→Sheets, mesma família de decisão do sync `Alocacoes_Ofertas` da fatia
anterior) — decisão de dono + Cowork, não uma linha de código isolada. Sem esse dado,
mostrar uma lista de "ferramentas disponíveis" no PWA seria ou (a) uma lista vazia sem
sentido, ou (b) dado inventado — nenhuma das duas opções é aceitável. Por isso esta fatia
não tenta simular essas 3 travas; documenta a lacuna em vez de escondê-la.

**Achado adicional, útil pra quando o sync for desenhado**: `getOsDoTecnico`
(`Código.js:756-829`) já teria como devolver `Tipo_OS_Completo` pro frontend — a coluna
existe na planilha (`Código.js:42`, `setupSheets`) e já é escrita em outros pontos
(`Código.js:1321`), só não está no `result.push` de `getOsDoTecnico` hoje. É uma adição
pequena quando/se a obrigatoriedade por tipo de OS for portada — mas não bate 1:1 com o
`Tipo_OS_Completo_Valor` texto-livre do SharePoint (fontes podem divergir, ver
`docs/VERIFICACAO-PARCIAIS-0408.md:53-113` sobre a dívida `Catalogo`(lookup) vs
`Alvo_Codigo`(raiz estável) nessa mesma lista).

## O que esta fatia entrega: registro append-only mínimo

O técnico digita o **código do patrimônio** (a etiqueta física da ferramenta —
equivalente ao `Codigo_Interno`/`Title` do catálogo real) em vez de escolher de uma
lista. Sem validação de calibração, sem checagem de obrigatoriedade — só um evento de
carga ou desmobilização, com trilha de auditoria.

### Aba nova `Ferramental_Movimentos` (append-only, mesma filosofia de
`Checklist_Respostas`/`Log_Central` — nunca edita uma linha existente)

| Coluna | Tipo | Observação |
|---|---|---|
| `Movimento_ID` | texto (uuid) | gerado no backend |
| `OS_ID` | texto | |
| `Tecnico_ID` | texto | |
| `Patrimonio_Codigo` | texto | digitado pelo técnico, sem validação contra catálogo |
| `Tipo_Movimento` | texto | `Carga` \| `Desmobilizacao` |
| `Estado_OK` | boolean | só relevante em `Desmobilizacao` |
| `Observacao` | texto | obrigatória se `Estado_OK=false` (validado no backend, não só no front) |
| `Registrado_Em` | datetime | `new Date()` no momento da gravação |
| `operation_id` | texto | idempotência (Frente D) |

### `registrarMovimentoFerramental(osId, tecnicoId, patrimonioCodigo, tipoMovimento,
estadoOk, observacao, operationId, dispositivoId)`

Passa por `executarIdempotente` (`tipoOperacao: 'FERRAMENTAL'`, mesmo padrão das outras
escritas críticas). Fail-closed: `tipoMovimento` fora de `['Carga','Desmobilizacao']` ou
`estadoOk===false` sem `observacao` preenchida → recusa (`{sucesso:false, erro:...}`),
mesma disciplina de "backend valida de novo, não confia só no frontend" já usada em
`confirmarSegurancaPreExecucao`/`validarESalvarKMInicial`.

### `getFerramentalDaOS(osId)` (só leitura)

Devolve os movimentos já registrados nesta OS (`[{patrimonioCodigo, tipoMovimento,
estadoOk, observacao, registradoEm}]`) — usado pelo frontend só pra mostrar "o que já foi
registrado", não pra validar nada (não há estado "atual" derivável com segurança sem
saber a ordem/exclusividade entre OSes, que é exatamente o que a trava real do
SharePoint resolve e que está fora desta fatia).

### Dispatcher (`API.js::executarAcao`)

Adicionar `case 'registrarMovimentoFerramental'` e `case 'getFerramentalDaOS'`, mesmo
padrão dos outros cases.

## Fora do escopo deste contrato

- Catálogo de ferramentas, calibração, obrigatoriedade por tipo de OS — dependem do sync
  SharePoint→Sheets (decisão do dono + Cowork, já registrada como pendência em
  `docs/SPEC-PWA-TECNICO.md`).
- Leitura de QR Code por câmera — a própria referência (`web/ferramental.html:83-85`)
  trata isso como integração futura, não implementada nem lá.
- Qualquer sincronização `Ferramental_Movimentos` → SharePoint — mesma família de decisão
  do sync de `Alocacoes_Ofertas`, não desenhada aqui.

## Teste

`test/test-ferramental.js` — roda o `<script>` de verdade via `vm`, rede 100% mockada.
Cobre: alternância Carga/Desmobilização: obrigatoriedade de observação quando estado não
OK; código de patrimônio vazio não chama o backend; registro bem-sucedido limpa o
formulário e recarrega a lista; offline enfileira; erro do backend não trava o app.
