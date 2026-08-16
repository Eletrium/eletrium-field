// Harness Node pra fecharFaseChecklist / consultarFaseChecklist / 5o
// motivo de canCloseOS (CONTRATO-BACKEND-CHECKLIST-3-FASES.md, sessao
// de frontend). Mesmo padrao: codigo real via vm, sheets fake em
// memoria, sem API real.
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

// Schema real de Perguntas_Checklist (initChecklistSheets(), Checklist.js)
// + Fase_Execucao/Obrigatoria (novas colunas desta fatia).
const PERG_HEADERS = ['ID_Pergunta', 'Disciplina', 'Nivel', 'Texto_Pergunta', 'Tipo_Resposta',
  'Pergunta_Pai', 'Condicao_Exibicao', 'Foto_Obrigatoria', 'Ordem', 'Ativo',
  'Fase_Execucao', 'Obrigatoria'];
// Schema real de Checklist_Respostas (initChecklistSheets(), Checklist.js).
const RESP_HEADERS = ['ID_OS', 'IDSharePoint_OS', 'Pergunta_ID', 'Texto_Pergunta',
  'Resposta_Dada', 'Foto_URL', 'Tecnico', 'Timestamp', 'Gerou_NC', 'Sincronizado'];

function runScenario(osHeaders, osRows, pergRows, respRows) {
  const sheets = {
    Ordens_Servico: makeSheet(osHeaders, osRows),
    Perguntas_Checklist: makeSheet(PERG_HEADERS, pergRows || []),
    Checklist_Respostas: makeSheet(RESP_HEADERS, respRows || []),
  };
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
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
    },
    Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid" },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Estado_Seguranca", "Checklist_Execucao_Completo", "Laudo_URL", "Assinatura_URL", "Fotos_Evidencia"];

// Perguntas: 2 obrigatorias na Pre-Execucao (P1, P2), 1 opcional na
// mesma fase (P3), 2 obrigatorias na Execucao (P4, P5).
const PERGUNTAS_PADRAO = [
  ["P1", "Eletrica", 1, "EPI OK?", "sim_nao", "", "", false, 1, true, "Pré-Execução", true],
  ["P2", "Eletrica", 1, "Aterramento OK?", "sim_nao", "", "", false, 2, true, "Pré-Execução", true],
  ["P3", "Eletrica", 1, "Observacao livre", "texto", "", "", false, 3, true, "Pré-Execução", false],
  ["P4", "Eletrica", 1, "Torque conferido?", "sim_nao", "", "", false, 4, true, "Execução", true],
  ["P5", "Eletrica", 1, "Isolamento testado?", "sim_nao", "", "", false, 5, true, "Execução", true],
];

// ============================================================
// 1) fecharFaseChecklist -- Pre-Execucao incompleta (falta P2)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS,
    [["OS-1", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [["OS-1", "", "P1", "EPI OK?", "Sim", "", "TEC-1", new Date(), false, false]]
  );
  const r = sandbox.fecharFaseChecklist("OS-1", "TEC-1", "Pré-Execução", "op-1", "DEV-1");
  check("1a: incompleta -> sucesso:false, completa:false", r.sucesso === false && r.completa === false, JSON.stringify(r));
  check("1b: faltando cita P2 (obrigatoria nao respondida)", Array.isArray(r.faltando) && r.faltando.includes("P2"), JSON.stringify(r));
  check("1c: faltando NAO cita P3 (opcional, nao exigida)", !r.faltando.includes("P3"));
  const dump = sheets.Ordens_Servico._dump();
  check("1d: Estado_Seguranca NAO foi gravado (fase incompleta)", dump[1][dump[0].indexOf("Estado_Seguranca")] === "");
}

// ============================================================
// 2) fecharFaseChecklist -- Pre-Execucao completa, sem NC -> Liberado
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS,
    [["OS-2", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-2", "", "P1", "EPI OK?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-2", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  const r = sandbox.fecharFaseChecklist("OS-2", "TEC-1", "Pré-Execução", "op-2", "DEV-1");
  check("2a: completa sem NC -> sucesso, Liberado", r.sucesso === true && r.completa === true && r.estado === "Liberado", JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("2b: Estado_Seguranca gravado como Liberado na planilha", dump[1][dump[0].indexOf("Estado_Seguranca")] === "Liberado");
}

// ============================================================
// 3) fecharFaseChecklist -- Pre-Execucao completa, COM NC -> Bloqueado
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS,
    [["OS-3", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-3", "", "P1", "EPI OK?", "Nao", "", "TEC-1", new Date(), true, false],
      ["OS-3", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  const r = sandbox.fecharFaseChecklist("OS-3", "TEC-1", "Pré-Execução", "op-3", "DEV-1");
  check("3a: completa com NC -> sucesso, Bloqueado", r.sucesso === true && r.completa === true && r.estado === "Bloqueado", JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("3b: Estado_Seguranca gravado como Bloqueado na planilha", dump[1][dump[0].indexOf("Estado_Seguranca")] === "Bloqueado");
}

// ============================================================
// 4) fecharFaseChecklist -- Execucao completa -> Checklist_Execucao_Completo
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS,
    [["OS-4", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-4", "", "P4", "Torque conferido?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-4", "", "P5", "Isolamento testado?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  const r = sandbox.fecharFaseChecklist("OS-4", "TEC-1", "Execução", "op-4", "DEV-1");
  check("4a: Execucao completa -> sucesso", r.sucesso === true && r.completa === true, JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("4b: Checklist_Execucao_Completo gravado como true", dump[1][dump[0].indexOf("Checklist_Execucao_Completo")] === true);
}

// ============================================================
// 5) idempotencia -- retry com mesma operation_id nao reprocessa
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS,
    [["OS-5", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-5", "", "P1", "EPI OK?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-5", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  const r1 = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Pré-Execução", "op-5", "DEV-1");
  const r2 = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Pré-Execução", "op-5", "DEV-1");
  check("5a: retry com mesma operation_id devolve o MESMO resultado", JSON.stringify(r1) === JSON.stringify(r2));
}

// ============================================================
// 6) Frente E, Opcao C -- intruso nao consegue fechar fase de outra OS
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS,
    [["OS-6", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-6", "", "P1", "EPI OK?", "Sim", "", "TEC-INTRUSO", new Date(), false, false],
      ["OS-6", "", "P2", "Aterramento OK?", "Sim", "", "TEC-INTRUSO", new Date(), false, false],
    ]
  );
  const r = sandbox.fecharFaseChecklist("OS-6", "TEC-INTRUSO", "Pré-Execução", "op-6", "DEV-1");
  check("6a: tecnico que nao e dono da OS e recusado", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("6b: Estado_Seguranca NAO foi gravado", dump[1][dump[0].indexOf("Estado_Seguranca")] === "");
}

// ============================================================
// 7) fase invalida -- recusa antes de tocar em qualquer planilha
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-7", "TEC-1", "Em Andamento", "", "", "", "", ""]], PERGUNTAS_PADRAO, []);
  const r = sandbox.fecharFaseChecklist("OS-7", "TEC-1", "Fase-Que-Nao-Existe", "op-7", "DEV-1");
  check("7a: fase invalida recusada", r.sucesso === false && /nvalida/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 8) consultarFaseChecklist -- antes de qualquer fase fechada
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-8", "TEC-1", "Em Andamento", "", "", "", "", ""]], PERGUNTAS_PADRAO, []);
  const r = sandbox.consultarFaseChecklist("OS-8");
  check("8a: preExecucaoCompleta false antes de fechar nada", r.preExecucaoCompleta === false);
  check("8b: execucaoCompleta false antes de fechar nada", r.execucaoCompleta === false);
  check("8c: estadoSeguranca null antes de fechar nada", r.estadoSeguranca === null);
}

// ============================================================
// 9) consultarFaseChecklist -- depois de fechar as 2 fases
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS,
    [["OS-9", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-9", "", "P1", "EPI OK?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-9", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-9", "", "P4", "Torque conferido?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-9", "", "P5", "Isolamento testado?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  sandbox.fecharFaseChecklist("OS-9", "TEC-1", "Pré-Execução", "op-9a", "DEV-1");
  sandbox.fecharFaseChecklist("OS-9", "TEC-1", "Execução", "op-9b", "DEV-1");
  const r = sandbox.consultarFaseChecklist("OS-9");
  check("9a: preExecucaoCompleta true depois de fechar", r.preExecucaoCompleta === true, JSON.stringify(r));
  check("9b: execucaoCompleta true depois de fechar", r.execucaoCompleta === true, JSON.stringify(r));
  check("9c: estadoSeguranca reflete Liberado", r.estadoSeguranca === "Liberado");
}

// ============================================================
// 10) canCloseOS -- 5o motivo bloqueia sozinho quando so falta a
//     Execucao (os outros 4 requisitos ja preenchidos)
// ============================================================
{
  const { sandbox } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status", "Estado_Seguranca", "Checklist_Execucao_Completo", "Laudo_URL", "Assinatura_URL", "Fotos_Evidencia"],
    [["OS-10", "TEC-1", "Em Andamento", "Liberado", "", "url-laudo", "url-assinatura", "https://x/f1.jpg;https://x/f2.jpg"]],
    PERGUNTAS_PADRAO, []
  );
  const antes = sandbox.canCloseOS("OS-10");
  check("10a: bloqueia SO pelo 5o motivo (checklist de execucao)", antes.allowed === false && antes.blockingReasons.length === 1 && /checklist de execucao/.test(antes.blockingReasons[0]), JSON.stringify(antes));
}

// ============================================================
// 11) canCloseOS -- integracao completa: libera so depois que TODAS as
//     5 exigencias (as 4 antigas + a nova) estao satisfeitas
// ============================================================
{
  const { sandbox } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status", "Estado_Seguranca", "Checklist_Execucao_Completo", "Laudo_URL", "Assinatura_URL", "Fotos_Evidencia"],
    [["OS-11", "TEC-1", "Em Andamento", "Liberado", "", "url-laudo", "url-assinatura", "https://x/f1.jpg;https://x/f2.jpg"]],
    PERGUNTAS_PADRAO,
    [
      ["OS-11", "", "P4", "Torque conferido?", "Sim", "", "TEC-1", new Date(), false, false],
      ["OS-11", "", "P5", "Isolamento testado?", "Sim", "", "TEC-1", new Date(), false, false],
    ]
  );
  sandbox.fecharFaseChecklist("OS-11", "TEC-1", "Execução", "op-11", "DEV-1");
  const depois = sandbox.canCloseOS("OS-11");
  check("11a: libera depois que Checklist_Execucao_Completo foi gravado", depois.allowed === true, JSON.stringify(depois));
}

// ============================================================
// 12) Achado real (13/08): correcao legitima de resposta (Timestamp
// novo, mesma Pergunta_ID) tem que ser tratada como a resposta VIGENTE,
// nao se somar a historica. Antes do fix, .some() sobre TODAS as
// respostas nunca deixava uma correcao que RESOLVE uma NC destravar
// Estado_Seguranca -- a linha antiga (NC=true) continuava contando.
// ============================================================
{
  // 12a: P1 respondida com NC=true (10:00), depois CORRIGIDA pra NC=false
  // (10:05) -- resposta vigente (maior Timestamp) resolve a NC.
  const t1 = new Date("2026-08-13T10:00:00Z");
  const t2 = new Date("2026-08-13T10:05:00Z");
  const { sandbox: s1, sheets: sh1 } = runScenario(OS_HEADERS,
    [["OS-12A", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-12A", "", "P1", "EPI OK?", "Nao", "", "TEC-1", t1, true, false],   // resposta original, com NC
      ["OS-12A", "", "P1", "EPI OK?", "Sim", "", "TEC-1", t2, false, false],  // correcao, resolve a NC
      ["OS-12A", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", t1, false, false],
    ]
  );
  const r1 = s1.fecharFaseChecklist("OS-12A", "TEC-1", "Pré-Execução", "op-12a", "DEV-1");
  check("12a: correcao que RESOLVE a NC destrava Estado_Seguranca (Liberado, nao Bloqueado)", r1.sucesso === true && r1.estado === "Liberado", JSON.stringify(r1));
  const dump1 = sh1.Ordens_Servico._dump();
  check("12b: Estado_Seguranca gravado como Liberado", dump1[1][dump1[0].indexOf("Estado_Seguranca")] === "Liberado");

  // 12c: inverso -- P1 respondida OK (10:00), depois CORRIGIDA pra NC=true
  // (10:05) -- resposta vigente introduz a NC, tem que bloquear.
  const { sandbox: s2, sheets: sh2 } = runScenario(OS_HEADERS,
    [["OS-12B", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-12B", "", "P1", "EPI OK?", "Sim", "", "TEC-1", t1, false, false],  // resposta original, sem NC
      ["OS-12B", "", "P1", "EPI OK?", "Nao", "", "TEC-1", t2, true, false],   // correcao, introduz NC
      ["OS-12B", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", t1, false, false],
    ]
  );
  const r2 = s2.fecharFaseChecklist("OS-12B", "TEC-1", "Pré-Execução", "op-12b", "DEV-1");
  check("12d: correcao que INTRODUZ a NC bloqueia Estado_Seguranca (Bloqueado)", r2.sucesso === true && r2.estado === "Bloqueado", JSON.stringify(r2));
  const dump2 = sh2.Ordens_Servico._dump();
  check("12e: Estado_Seguranca gravado como Bloqueado", dump2[1][dump2[0].indexOf("Estado_Seguranca")] === "Bloqueado");

  // 12f: duas respostas pra mesma pergunta (correcao) nao faz a pergunta
  // contar 2x nem falsamente "faltar" -- fase continua completa.
  check("12f: fase continua completa com pergunta corrigida (nao falta nem duplica)", r1.completa === true && r2.completa === true, JSON.stringify({ r1, r2 }));

  // 12g: Timestamp igual (empate) ou ausente nao trava -- cai pra ordem
  // de insercao (ultima no array), sem lancar excecao.
  const { sandbox: s3 } = runScenario(OS_HEADERS,
    [["OS-12C", "TEC-1", "Em Andamento", "", "", "", "", ""]],
    PERGUNTAS_PADRAO,
    [
      ["OS-12C", "", "P1", "EPI OK?", "Nao", "", "TEC-1", "", true, false],   // Timestamp ausente
      ["OS-12C", "", "P1", "EPI OK?", "Sim", "", "TEC-1", "", false, false], // idem, insercao posterior vence
      ["OS-12C", "", "P2", "Aterramento OK?", "Sim", "", "TEC-1", t1, false, false],
    ]
  );
  const r3 = s3.fecharFaseChecklist("OS-12C", "TEC-1", "Pré-Execução", "op-12c", "DEV-1");
  check("12g: Timestamp ausente nao trava -- cai pra ordem de insercao, ultima resposta vence", r3.sucesso === true && r3.estado === "Liberado", JSON.stringify(r3));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
