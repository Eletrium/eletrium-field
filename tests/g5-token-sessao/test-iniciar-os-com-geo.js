// Harness Node pra idempotencia de iniciarOSComGeo (fluxo "sem KM").
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
    setFrozenRows() {}, setColumnWidth() {},
    _dump() { return data; },
  };
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

const osHeaders = ["OS_ID", "ID_Tecnico", "Status", "Status_Atual", "Hora_Inicio", "Em_Pausa_Agora"];
// OS-2 (achado da varredura de TOCTOU, 15/08): iniciarOS agora recusa
// iniciar uma OS que ja esta 'Em Andamento' -- o cenario 1e precisa de
// uma OS AINDA NAO iniciada pra testar o caminho backward-compat de
// verdade (sem isso, a 3a chamada bateria na guarda nova, nao no
// comportamento sem-operationId que o teste quer exercitar).
const sheets = { Ordens_Servico: makeSheet(osHeaders, [
  ["OS-1", "TEC-1", "Nao iniciada", "", "", ""],
  ["OS-2", "TEC-1", "Nao iniciada", "", "", ""],
]) };
const sandbox = {
  SHEET_ID: "fake",
  SpreadsheetApp: {
    openById() {
      return {
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { const s = makeSheet(['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao', 'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em', 'status', 'tentativas', 'erro_detalhe', 'resultado_json'], []); sheets[n] = s; return s; },
      };
    },
    newDataValidation: makeDataValidationBuilder,
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid",
    formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(11, 19),
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Logger: { log: () => {} }, console,
};
vm.createContext(sandbox);
vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
vm.runInContext(API, sandbox, { filename: "API.js" });

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

const r1 = sandbox.iniciarOSComGeo("OS-1", "TEC-1", "Fulano", "Local X", -19.9, -43.9, "op-1", "DEV-1");
const r2 = sandbox.iniciarOSComGeo("OS-1", "TEC-1", "Fulano", "Local X", -19.9, -43.9, "op-1", "DEV-1");
check("1a: 1a chamada sucesso", !r1.erro, JSON.stringify(r1));
check("1b: retry com mesma operation_id devolve o mesmo resultado", JSON.stringify(r1) === JSON.stringify(r2));
const dump = sheets.Ordens_Servico._dump();
check("1c: Status gravado como 'Em Andamento' uma vez", dump[1][dump[0].indexOf("Status")] === "Em Andamento");
check("1d: Local_Atendimento nao existe no header de teste, mas Hora_Inicio foi gravada", !!dump[1][dump[0].indexOf("Hora_Inicio")]);

const r3 = sandbox.iniciarOSComGeo("OS-2", "TEC-1", "Fulano", "Local X", -19.9, -43.9);
check("1e: sem operationId ainda funciona (backward-compat)", !r3.erro, JSON.stringify(r3));

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
