// Confirma que criado_em/recebido_em/sincronizado_em sao gravados como
// TEXTO ISO 8601 (string), nunca como objeto Date nativo -- requisito
// critico da spec (Sheets autoconverte Date e aplica timezone
// silenciosamente mesmo com a coluna formatada como texto).
const fs = require("fs");
const vm = require("vm");
const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...(rows || []).map(r => r.slice())];
  return {
    getLastColumn() { return data[0].length; }, getLastRow() { return data.length; },
    getRange(r, c, nr, nc) {
      if (nr === undefined) return { setValue(v) { data[r - 1][c - 1] = v; }, getValue() { return data[r - 1][c - 1]; } };
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) out.push((data[r - 1 + i] || []).slice(0, nc)); return out; },
        setValues(v) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { while (data.length < r - 1 + i + 1) data.push([]); data[r - 1 + i][c - 1 + j] = v[i][j]; } },
        setFontWeight() { return this; }, setNumberFormat() { return this; }, setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(r => r.slice()) }; }, appendRow(a) { data.push(a.slice()); },
    setFrozenRows() {}, setColumnWidth() {}, _dump() { return data; },
  };
}
function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

const sheets = { Ordens_Servico: makeSheet(["OS_ID", "Status"], [["OS-1", "Em Andamento"]]) };
const sandbox = {
  SHEET_ID: "fake",
  SpreadsheetApp: {
    openById() {
      return {
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { const s = makeSheet(['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao', 'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em', 'status', 'tentativas', 'erro_codigo', 'erro_detalhe', 'resultado_json'], []); sheets[n] = s; return s; },
      };
    },
    newDataValidation: makeDataValidationBuilder,
  },
  Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid" },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Logger: { log: () => {} }, console,
};
vm.createContext(sandbox);
vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
vm.runInContext(API, sandbox, { filename: "API.js" });

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

sandbox.executarIdempotente("op-1", "APONTAMENTO", "OS-1", "TEC-1", "DEV-1", () => ({ sucesso: true }));

const log = sheets.Log_Central._dump();
const h = log[0];
const row = log[1];
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

check("1a: criado_em e uma STRING ISO 8601", typeof row[h.indexOf("criado_em")] === "string" && ISO_REGEX.test(row[h.indexOf("criado_em")]), "valor=" + JSON.stringify(row[h.indexOf("criado_em")]) + " tipo=" + typeof row[h.indexOf("criado_em")]);
check("1b: recebido_em e uma STRING ISO 8601", typeof row[h.indexOf("recebido_em")] === "string" && ISO_REGEX.test(row[h.indexOf("recebido_em")]));
check("1c: sincronizado_em e uma STRING ISO 8601", typeof row[h.indexOf("sincronizado_em")] === "string" && ISO_REGEX.test(row[h.indexOf("sincronizado_em")]));
check("1d: NENHUM dos 3 e um objeto Date nativo", ![row[h.indexOf("criado_em")], row[h.indexOf("recebido_em")], row[h.indexOf("sincronizado_em")]].some(v => v instanceof Date));

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
