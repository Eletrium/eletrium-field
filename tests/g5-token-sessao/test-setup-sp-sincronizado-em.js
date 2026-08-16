// Harness Node pra SP_Sincronizado_Em em setupSheets() -- protecao
// anti-sobrescrita do 1B (DESENHO-1B-ANTI-SOBRESCRITA.md, aprovado
// 13/08). So a parte de schema, adiantada enquanto o caso de borda
// (edicao admin pos-fechamento) aguarda confirmacao final do dono.
// Mesmo padrao dos outros: codigo real via vm, sheets fake em memoria.
const fs = require("fs");
const vm = require("vm");

const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...(rows || []).map(r => r.slice())];
  const chamadasFormato = [];
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
        setNumberFormat(fmt) { chamadasFormato.push({ r, c, numRows, numCols, fmt }); return this; },
        setFontWeight() { return this; },
        setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    appendRow(arr) { data.push(arr.slice()); },
    setFrozenRows() {},
    setColumnWidth() {},
    _dump() { return data; },
    _chamadasFormato: chamadasFormato,
  };
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

function runScenario(osHeaders, osRows) {
  const sheets = { Ordens_Servico: makeSheet(osHeaders, osRows) };
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (name) => sheets[name] || null,
          insertSheet: (name) => {
            // sheets genericos o suficiente pra setupSheets() nao quebrar
            // ao criar OS_Segmentos/Diaria_Tecnico/Alocacoes_Ofertas/
            // Ferramental_Movimentos/Log_Central -- nao e o foco deste teste.
            const s = makeSheet([], []);
            sheets[name] = s;
            return s;
          },
        };
      },
      newDataValidation: makeDataValidationBuilder,
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid",
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
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

const OS_HEADERS_BASE = ["OS_ID", "ID_Tecnico", "Status"];

// ============================================================
// 1) coluna nao existe -- setupSheets() adiciona, formatada como texto
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_BASE, [["OS-1", "TEC-1", "Em Andamento"]]);
  sandbox.setupSheets();
  const headers = sheets.Ordens_Servico._dump()[0];
  const idx = headers.indexOf("SP_Sincronizado_Em");
  check("1a: SP_Sincronizado_Em adicionada em Ordens_Servico", idx >= 0, JSON.stringify(headers));
  check("1b: coluna formatada como texto '@' (nunca Date nativo)", sheets.Ordens_Servico._chamadasFormato.some(f => f.c === idx + 1 && f.fmt === "@"), JSON.stringify(sheets.Ordens_Servico._chamadasFormato));
}

// ============================================================
// 2) idempotente -- coluna ja existe, setupSheets() nao duplica
// ============================================================
{
  const headersComColuna = OS_HEADERS_BASE.concat(["SP_Sincronizado_Em"]);
  const { sandbox, sheets } = runScenario(headersComColuna, [["OS-1", "TEC-1", "Em Andamento", "2026-08-13T10:00:00.000Z"]]);
  sandbox.setupSheets();
  const headers = sheets.Ordens_Servico._dump()[0];
  const ocorrencias = headers.filter(h => h === "SP_Sincronizado_Em").length;
  check("2a: nao duplica a coluna se ja existir", ocorrencias === 1, JSON.stringify(headers));
  const linha = sheets.Ordens_Servico._dump()[1];
  check("2b: valor pre-existente preservado (setupSheets nao mexe em dado ja gravado)", linha[headers.indexOf("SP_Sincronizado_Em")] === "2026-08-13T10:00:00.000Z", JSON.stringify(linha));
}

// ============================================================
// 3) rodar setupSheets() 2x seguidas nao duplica nem quebra (idempotencia real)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_BASE, [["OS-1", "TEC-1", "Em Andamento"]]);
  sandbox.setupSheets();
  sandbox.setupSheets();
  const headers = sheets.Ordens_Servico._dump()[0];
  const ocorrencias = headers.filter(h => h === "SP_Sincronizado_Em").length;
  check("3a: 2 execucoes seguidas de setupSheets() -- ainda so 1 coluna", ocorrencias === 1, JSON.stringify(headers));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
