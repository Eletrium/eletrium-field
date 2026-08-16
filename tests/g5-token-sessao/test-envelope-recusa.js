// Harness Node pro envelope canonico de recusa (_recusa/sucesso:false).
// Achado do Code 2 (revisao das 5 fatias em conjunto): processarFilaOffline
// so reconhecia DIVERGENT via blockingReasons -- formato exclusivo de
// canCloseOS/encerrarOS. exigeJustificativa (KM), erro+faltando
// (checklist), e as funcoes mais antigas (iniciarOS/pausarOS/retomarOS/
// registrarInicioDia/registrarFimDia/criarOSEmergencia/
// validarESalvarKMInicial/registrarKMFinalPendente) nem tinham
// sucesso:false -- passavam batido e o item era marcado SYNCED mesmo
// tendo sido recusado. Este arquivo prova que TODA rejeicao de escrita
// agora tem sucesso:false + erro (string) + motivos (array), sem
// remover os campos legados (blockingReasons/faltando/exigeJustificativa).
const fs = require("fs");
const vm = require("vm");

const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...(rows || []).map(r => r.slice())];
  return {
    getLastColumn() { return data[0].length; },
    getLastRow() { return data.length; },
    getRange(r, c, numRows, numCols) {
      if (numRows === undefined) {
        return { setValue(v) { data[r - 1][c - 1] = v; }, getValue() { return data[r - 1][c - 1]; } };
      }
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) out.push((data[r - 1 + i] || []).slice(0, numCols));
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) {
            while (data.length < r - 1 + i + 1) data.push([]);
            data[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        setFontWeight() { return this; },
        setNumberFormat() { return this; },
        setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    appendRow(arr) { data.push(arr.slice()); },
    setFrozenRows() {},
    setColumnWidth() {},
    _dump() { return data; },
  };
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

// Coluna 0 nomeada 'ID_OS' (nao 'OS_ID') de proposito -- getUltimaOSDoTecnicoHoje/
// DiaAnterior (usadas por validarESalvarKMInicial) leem por ESSE nome exato,
// diferente de encontrarLinha() (que e por indice, tolera qualquer nome).
const OS_HEADERS = [
  "ID_OS", "ID_Tecnico", "Status", "Status_Atual", "Estado_Seguranca",
  "Checklist_Execucao_Completo", "Laudo_URL", "Assinatura_URL", "Fotos_Evidencia",
  "Em_Pausa_Agora", "Hora_Inicio", "KM_Inicial_OS", "KM_Final_OS", "Veiculo_ID_OS",
  "KM_Justificativa_Desvio", "KM_Foto_Desvio_URL", "KM_Flag_Revisao", "Hora_Encerramento",
];

// Datas nas linhas de mock nao podem ser `new Date()` construido FORA do
// vm -- objetos de outro realm falham `instanceof Date` DENTRO do vm
// (gotcha real do modulo vm do Node, nao bug do app). Linhas de teste
// usam o marcador "__HOJE__"; resolveHoje troca pelo Date do PROPRIO
// contexto, depois que vm.createContext ja rodou.
function runScenario(osRows, opts) {
  opts = opts || {};
  const sandboxPre = { SHEET_ID: "fake", LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
 Logger: { log: () => {} }, console };
  vm.createContext(sandboxPre);
  // vm.createContext nao expoe Date/Array/etc como propriedade acessivel
  // de FORA (so pro codigo rodando DENTRO do contexto) -- precisa pedir
  // explicitamente via runInContext.
  const VmDate = vm.runInContext('Date', sandboxPre);
  const resolveHoje = (rows) => (rows || []).map(row => row.map(v => (v === "__HOJE__" ? new VmDate() : v)));
  osRows = resolveHoje(osRows);

  const sheets = {
    Ordens_Servico: makeSheet(OS_HEADERS, osRows || []),
    Perguntas_Checklist: makeSheet(
      ['ID_Pergunta', 'Disciplina', 'Nivel', 'Texto_Pergunta', 'Tipo_Resposta',
       'Pergunta_Pai', 'Condicao_Exibicao', 'Foto_Obrigatoria', 'Ordem', 'Ativo',
       'Fase_Execucao', 'Obrigatoria'],
      [["P1", "Eletrica", 1, "EPI OK?", "sim_nao", "", "", false, 1, true, "Pré-Execução", true]]
    ),
    Checklist_Respostas: makeSheet(
      ['ID_OS', 'IDSharePoint_OS', 'Pergunta_ID', 'Texto_Pergunta', 'Resposta_Dada',
       'Foto_URL', 'Tecnico', 'Timestamp', 'Gerou_NC', 'Sincronizado'], []
    ),
    Diaria_Tecnico: opts.semDiaria ? null : makeSheet(
      ['Data', 'Tecnico_ID', 'Tecnico_Nome', 'Hora_Entrada', 'Hora_Saida',
       'Horas_Produtivas', 'Horas_Pausadas', 'Total_Horas', 'Qtd_OS', 'OS_Lista',
       'Clientes_Atendidos', 'Qtd_Interrupcoes', 'Status_Dia', 'Custo_MO_Total',
       'IDSharePoint', 'Usa_Veiculo_Hoje', 'KM_Inicial', 'KM_Final', 'KM_Rodado', 'Veiculo_ID'],
      []
    ),
    Alocacoes_Ofertas: makeSheet(
      ['Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
       'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'],
      opts.ofertasRows || []
    ),
    Ferramental_Movimentos: makeSheet(
      ['Movimento_ID', 'OS_ID', 'Tecnico_ID', 'Patrimonio_Codigo', 'Tipo_Movimento',
       'Estado_OK', 'Observacao', 'Registrado_Em', 'operation_id'], []
    ),
  };
  if (!sheets.Diaria_Tecnico) delete sheets.Diaria_Tecnico;

  // sandboxPre ja foi contextificado (vm.createContext) antes de resolveHoje
  // -- so ACRESCENTA propriedades nele, nao cria um contexto novo.
  const sandbox = sandboxPre;
  sandbox.SpreadsheetApp = {
    openById() {
      return {
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => {
          const s = makeSheet(
            ['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
             'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
             'status', 'tentativas', 'erro_detalhe', 'resultado_json'], []
          );
          sheets[name] = s;
          return s;
        },
      };
    },
    newDataValidation: makeDataValidationBuilder,
  };
  sandbox.Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
    computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
    formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(0, 10),
  };
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

// Confere o envelope canonico completo: sucesso===false, erro string
// nao-vazia, motivos array nao-vazio. Isso e o que processarFilaOffline
// (frontend) agora deveria checar, um campo so, nao mais blockingReasons
// especifico de uma funcao so.
// Contrato canonico do auditor (ajuste 1) -- {success, status,
// operation_id, error_code, retryable, blocking_reasons} -- ALEM dos
// campos legados (sucesso/erro/motivos), que continuam presentes por
// compatibilidade mas nao sao mais o contrato principal.
function checkEnvelope(nomeCaso, r) {
  check(nomeCaso + " -- success===false", r && r.success === false, JSON.stringify(r));
  check(nomeCaso + " -- status e DIVERGENT ou SYNC_ERROR (vocabulario aprovado)", r.status === "DIVERGENT" || r.status === "SYNC_ERROR", JSON.stringify(r));
  check(nomeCaso + " -- error_code e string nao-vazia (lista aprovada)", typeof r.error_code === "string" && r.error_code.length > 0, JSON.stringify(r));
  check(nomeCaso + " -- retryable e booleano", typeof r.retryable === "boolean", JSON.stringify(r));
  check(nomeCaso + " -- blocking_reasons e array nao-vazio", Array.isArray(r.blocking_reasons) && r.blocking_reasons.length > 0, JSON.stringify(r));
  // legado (compat, nao removido)
  check(nomeCaso + " -- sucesso===false (legado, compat)", r && r.sucesso === false, JSON.stringify(r));
  check(nomeCaso + " -- erro e string nao-vazia (legado, compat)", typeof r.erro === "string" && r.erro.length > 0, JSON.stringify(r));
  check(nomeCaso + " -- motivos e array nao-vazio (legado, compat)", Array.isArray(r.motivos) && r.motivos.length > 0, JSON.stringify(r));
}

// ============================================================
// 1) iniciarOSComGeo -- OS inexistente (achado real: nao tinha sucesso:false antes)
// ============================================================
{
  const { sandbox } = runScenario([]);
  const r = sandbox.iniciarOSComGeo("OS-NAO-EXISTE", "TEC-1", "Fulano", "Local", null, null, "op-1", "DEV-1");
  checkEnvelope("1", r);
}

// ============================================================
// 2) iniciarOSComGeo -- posse negada
// ============================================================
{
  const { sandbox } = runScenario([["OS-2", "TEC-1", "Nao iniciada", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-2", "TEC-INTRUSO", "Fulano", "Local", null, null, "op-2", "DEV-1");
  checkEnvelope("2", r);
}

// ============================================================
// 3) pausarOS -- OS inexistente
// ============================================================
{
  const { sandbox } = runScenario([]);
  const r = sandbox.pausarOS("OS-NAO-EXISTE", "TEC-1", "Fulano", "Pausa tecnica", "", "op-3", "DEV-1");
  checkEnvelope("3", r);
}

// ============================================================
// 4) retomarOS -- OS inexistente
// ============================================================
{
  const { sandbox } = runScenario([]);
  const r = sandbox.retomarOS("OS-NAO-EXISTE", "TEC-1", "Fulano", "op-4", "DEV-1");
  checkEnvelope("4", r);
}

// ============================================================
// 5) registrarInicioDia -- sem aba Diaria_Tecnico
// ============================================================
{
  const { sandbox } = runScenario([], { semDiaria: true });
  const r = sandbox.registrarInicioDia("TEC-1", "Fulano", false, "", "", "op-5", "DEV-1");
  checkEnvelope("5", r);
}

// ============================================================
// 6) registrarFimDia -- registro do dia nao encontrado
// ============================================================
{
  const { sandbox } = runScenario([]);
  const r = sandbox.registrarFimDia("TEC-SEM-REGISTRO", "", "op-6", "DEV-1");
  checkEnvelope("6", r);
}

// ============================================================
// 7) encerrarOSComKM -- bloqueado por canCloseOS (blockingReasons
//    PRESERVADO, motivos espelha o mesmo conteudo)
// ============================================================
{
  const { sandbox } = runScenario([["OS-7", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.encerrarOSComKM("OS-7", "TEC-1", "Fulano", {}, null, null, "op-7", "DEV-1");
  checkEnvelope("7", r);
  check("7 -- blockingReasons preservado (compat)", Array.isArray(r.blockingReasons) && r.blockingReasons.length > 0, JSON.stringify(r));
  check("7 -- motivos espelha blockingReasons", JSON.stringify(r.motivos) === JSON.stringify(r.blockingReasons));
}

// ============================================================
// 8) salvarArquivoOS -- campo nao permitido
// ============================================================
{
  const { sandbox } = runScenario([["OS-8", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.salvarArquivoOS("OS-8", "TEC-1", "Status", "YWJj", "image/jpeg", "x.jpg", "op-8", "DEV-1");
  checkEnvelope("8", r);
}

// ============================================================
// 9) confirmarSegurancaPreExecucao -- confirmacoes incompletas
//    (faltando PRESERVADO, motivos espelha o mesmo conteudo)
// ============================================================
{
  const { sandbox } = runScenario([["OS-9", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.confirmarSegurancaPreExecucao("OS-9", "TEC-1", { epi: true }, false, "op-9", "DEV-1");
  checkEnvelope("9", r);
  check("9 -- faltando preservado (compat)", Array.isArray(r.faltando) && r.faltando.length > 0, JSON.stringify(r));
  check("9 -- motivos espelha faltando", JSON.stringify(r.motivos) === JSON.stringify(r.faltando));
}

// ============================================================
// 10) fecharFaseChecklist -- fase incompleta (faltando PRESERVADO)
// ============================================================
{
  const { sandbox } = runScenario([["OS-10", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.fecharFaseChecklist("OS-10", "TEC-1", "Pré-Execução", "op-10", "DEV-1");
  checkEnvelope("10", r);
  check("10 -- faltando preservado (compat)", Array.isArray(r.faltando) && r.faltando.length > 0, JSON.stringify(r));
  check("10 -- completa:false preservado (compat)", r.completa === false);
}

// ============================================================
// 11) fecharFaseChecklist -- fase invalida
// ============================================================
{
  const { sandbox } = runScenario([["OS-11", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.fecharFaseChecklist("OS-11", "TEC-1", "Fase-Fantasma", "op-11", "DEV-1");
  checkEnvelope("11", r);
}

// ============================================================
// 12) iniciarOSComKM -- exigeJustificativa (KM, PRESERVADO + mensagem)
// ============================================================
{
  // Hora_Encerramento precisa ser Date real de HOJE, no nome de coluna certo
  // (ID_OS, ver OS_HEADERS) -- e o que getUltimaOSDoTecnicoHoje exige pra
  // achar essa OS como "referencia de hoje" e comparar o desvio de KM.
  const osComKmAnterior = ["OS-12A", "TEC-1", "Concluída", "", "", "", "", "", "", "", "", "0", "10", "VEI-1", "", "", "", "__HOJE__"];
  const { sandbox } = runScenario([
    osComKmAnterior,
    ["OS-12B", "TEC-1", "Nao iniciada", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  // desvio de 50km (> limiar de 5km intra-dia), sem foto nem texto
  const r = sandbox.iniciarOSComKM("OS-12B", "TEC-1", "Fulano", "Local", null, null, 60, "VEI-1", "", "", "op-12", "DEV-1");
  checkEnvelope("12", r);
  check("12 -- exigeJustificativa preservado (compat)", r.exigeJustificativa === true, JSON.stringify(r));
  check("12 -- mensagem preservado (compat)", typeof r.mensagem === "string" && r.mensagem.length > 0);
}

// ============================================================
// 13) registrarKMFinalPendente -- OS nao concluida ainda
// ============================================================
{
  const { sandbox } = runScenario([["OS-13", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "0", "", "", "", "", ""]]);
  const r = sandbox.registrarKMFinalPendente("OS-13", "TEC-1", 50, "", "", "op-13", "DEV-1");
  checkEnvelope("13", r);
}

// ============================================================
// 14) registrarKMFinalPendente -- KM final menor que o inicial
// ============================================================
{
  const { sandbox } = runScenario([["OS-14", "TEC-1", "Concluída", "", "", "", "", "", "", "", "", "100", "", "", "", "", ""]]);
  const r = sandbox.registrarKMFinalPendente("OS-14", "TEC-1", 50, "", "", "op-14", "DEV-1");
  checkEnvelope("14", r);
}

// ============================================================
// 15) registrarMovimentoFerramental -- tipo invalido
// ============================================================
{
  const { sandbox } = runScenario([["OS-15", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.registrarMovimentoFerramental("OS-15", "TEC-1", "PAT-1", "TipoInvalido", null, "", "op-15", "DEV-1");
  checkEnvelope("15", r);
}

// ============================================================
// 16) registrarAceiteOferta -- motivo de recusa obrigatorio
// ============================================================
{
  const { sandbox } = runScenario([], {
    ofertasRows: [["OF-16", "OS-16", "TEC-1", "X", 100, "2026-08-01", 99999999999, "Pendente", "", "", ""]],
  });
  const r = sandbox.registrarAceiteOferta("OF-16", "TEC-1", false, "", "op-16", "DEV-1");
  checkEnvelope("16", r);
}

// ============================================================
// 17) criarOSEmergencia -- sem aba Ordens_Servico (achado real: nao
//     tinha sucesso:false antes)
// ============================================================
{
  const sheets = { Ordens_Servico: null };
  const sandbox2 = {
    SHEET_ID: "fake",
    SpreadsheetApp: { openById() { return { getSheetByName: () => null, insertSheet: () => makeSheet(['x'], []) }; }, newDataValidation: makeDataValidationBuilder },
    Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid", formatDate: () => "20260101120000" },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} }, console,
  };
  vm.createContext(sandbox2);
  vm.runInContext(CODIGO, sandbox2, { filename: "Código.js" });
  vm.runInContext(API, sandbox2, { filename: "API.js" });
  const r = sandbox2.criarOSEmergencia({ clienteNome: "X", tecnicoId: "TEC-1" });
  checkEnvelope("17", r);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
