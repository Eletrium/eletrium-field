// Harness Node pra registrarMovimentoFerramental / getFerramentalDaOS
// (CONTRATO-BACKEND-FERRAMENTAL.md, sessao de frontend). Mesmo padrao:
// codigo real via vm, sheets fake em memoria, sem API real.
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

function runScenario(osHeaders, osRows, ferramentalRows) {
  const sheets = {
    Ordens_Servico: makeSheet(osHeaders, osRows),
    Ferramental_Movimentos: makeSheet(
      ['Movimento_ID', 'OS_ID', 'Tecnico_ID', 'Patrimonio_Codigo', 'Tipo_Movimento',
       'Estado_OK', 'Observacao', 'Registrado_Em', 'operation_id'],
      ferramentalRows || []
    ),
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
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "movimento-" + Math.floor(Math.random() * 1e9),
    },
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

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status"];

// ============================================================
// 1) Carga -- registro feliz, sem Estado_OK (nao relevante em Carga)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-1", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-1", "TEC-1", "PAT-001", "Carga", null, "", "op-1", "DEV-1");
  check("1a: Carga grava com sucesso", r.sucesso === true, JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("1b: linha gravada com Tipo_Movimento=Carga", dump[1][dump[0].indexOf("Tipo_Movimento")] === "Carga");
  check("1c: Patrimonio_Codigo gravado", dump[1][dump[0].indexOf("Patrimonio_Codigo")] === "PAT-001");
}

// ============================================================
// 2) Desmobilizacao -- estado OK, sem observacao (nao exigida quando OK)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-2", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-2", "TEC-1", "PAT-002", "Desmobilizacao", true, "", "op-2", "DEV-1");
  check("2a: Desmobilizacao com estado OK e sem observacao grava normalmente", r.sucesso === true, JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("2b: Estado_OK gravado como true", dump[1][dump[0].indexOf("Estado_OK")] === true);
}

// ============================================================
// 3) Desmobilizacao -- estado NAO ok, sem observacao -> recusa (fail-closed)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-3", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-3", "TEC-1", "PAT-003", "Desmobilizacao", false, "", "op-3", "DEV-1");
  check("3a: estado nao-OK sem observacao e recusado", r.sucesso === false && /[Oo]bservacao/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("3b: nenhuma linha gravada", dump.length === 1);
}

// ============================================================
// 4) Desmobilizacao -- estado NAO ok, COM observacao -> grava normalmente
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-4", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-4", "TEC-1", "PAT-004", "Desmobilizacao", false, "Cabo desgastado, retirar de uso", "op-4", "DEV-1");
  check("4a: estado nao-OK com observacao grava normalmente", r.sucesso === true, JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("4b: Observacao gravada", dump[1][dump[0].indexOf("Observacao")] === "Cabo desgastado, retirar de uso");
}

// ============================================================
// 5) tipo de movimento invalido -- recusado antes de tocar na planilha
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-5", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-5", "TEC-1", "PAT-005", "TipoQueNaoExiste", null, "", "op-5", "DEV-1");
  check("5a: tipo invalido recusado", r.sucesso === false && /invalido/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("5b: nenhuma linha gravada", dump.length === 1);
}

// ============================================================
// 6) codigo de patrimonio vazio -- recusado antes de tocar na planilha
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-6", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-6", "TEC-1", "", "Carga", null, "", "op-6", "DEV-1");
  check("6a: codigo de patrimonio vazio recusado", r.sucesso === false && /[Pp]atrimonio/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("6b: nenhuma linha gravada", dump.length === 1);
}

// ============================================================
// 7) posse (Frente E, Opcao C) -- intruso nao registra movimento em OS
//    que nao e dele
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-7", "TEC-1", "Em Andamento"]]);
  const r = sandbox.registrarMovimentoFerramental("OS-7", "TEC-INTRUSO", "PAT-007", "Carga", null, "", "op-7", "DEV-1");
  check("7a: tecnico que nao e dono da OS e recusado", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("7b: nenhuma linha gravada", dump.length === 1);
}

// ============================================================
// 8) idempotencia -- retry com mesma operation_id nao duplica linha
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-8", "TEC-1", "Em Andamento"]]);
  const r1 = sandbox.registrarMovimentoFerramental("OS-8", "TEC-1", "PAT-008", "Carga", null, "", "op-8", "DEV-1");
  const r2 = sandbox.registrarMovimentoFerramental("OS-8", "TEC-1", "PAT-008", "Carga", null, "", "op-8", "DEV-1");
  check("8a: retry devolve o MESMO resultado", JSON.stringify(r1) === JSON.stringify(r2));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("8b: so 1 linha gravada (nao 2)", dump.length === 2, "linhas=" + dump.length);
}

// ============================================================
// 9) getFerramentalDaOS -- devolve TODOS os movimentos da OS (carga E
//    desmobilizacao), nao so o ultimo
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-9", "TEC-1", "Em Andamento"]]);
  sandbox.registrarMovimentoFerramental("OS-9", "TEC-1", "PAT-009A", "Carga", null, "", "op-9a", "DEV-1");
  sandbox.registrarMovimentoFerramental("OS-9", "TEC-1", "PAT-009B", "Carga", null, "", "op-9b", "DEV-1");
  sandbox.registrarMovimentoFerramental("OS-9", "TEC-1", "PAT-009A", "Desmobilizacao", true, "", "op-9c", "DEV-1");
  const r = sandbox.getFerramentalDaOS("OS-9");
  check("9a: devolve os 3 movimentos, nao so o ultimo", Array.isArray(r) && r.length === 3, JSON.stringify(r));
  check("9b: campos certos no primeiro movimento", r[0].patrimonioCodigo === "PAT-009A" && r[0].tipoMovimento === "Carga");
}

// ============================================================
// 10) getFerramentalDaOS -- OS sem movimentos ainda -> array vazio
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-10", "TEC-1", "Em Andamento"]]);
  const r = sandbox.getFerramentalDaOS("OS-10");
  check("10a: OS sem movimentos -> array vazio", Array.isArray(r) && r.length === 0);
}

// ============================================================
// 11) getFerramentalDaOS -- so devolve movimentos DESTA OS, nao de outra
// ============================================================
{
  const { sandbox } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status"],
    [["OS-11A", "TEC-1", "Em Andamento"], ["OS-11B", "TEC-1", "Em Andamento"]]
  );
  sandbox.registrarMovimentoFerramental("OS-11A", "TEC-1", "PAT-A", "Carga", null, "", "op-11a", "DEV-1");
  sandbox.registrarMovimentoFerramental("OS-11B", "TEC-1", "PAT-B", "Carga", null, "", "op-11b", "DEV-1");
  const r = sandbox.getFerramentalDaOS("OS-11A");
  check("11a: so devolve o movimento da OS-11A", r.length === 1 && r[0].patrimonioCodigo === "PAT-A", JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
