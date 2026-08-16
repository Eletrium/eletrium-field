// Harness Node pra Teto_Excedido em Log_Central -- so o schema da
// decisao fechada pela Cowork 2 (PROPOSTA-TETO-RETRY.md: 5 tentativas
// uniforme pra SYNC_ERROR, backoff crescente, alerta via campo novo em
// vez de mexer no catalogo aprovado de erro_codigo). A logica do
// scanner (contagem, backoff, QUANDO marcar true) e escopo do cenario
// Make que a Cowork 1 vai construir -- nao testada aqui. Mesmo padrao
// dos outros: codigo real via vm, sheets fake em memoria.
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

function makeSandbox(sheets) {
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (name) => sheets[name] || null,
          insertSheet: (name) => { const s = makeSheet([], []); sheets[name] = s; return s; },
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
  return sandbox;
}

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// ============================================================
// 1) aba nova -- Teto_Excedido nasce junto com o resto do schema
// ============================================================
{
  const sheets = {};
  const sandbox = makeSandbox(sheets);
  sandbox.garantirLogCentral({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; } });
  const headers = sheets.Log_Central._dump()[0];
  check("1a: Teto_Excedido presente numa aba criada do zero", headers.includes("Teto_Excedido"), JSON.stringify(headers));
  // Retry_Manual_Por/Retry_Manual_Em (14/08) vieram DEPOIS de Teto_Excedido
  // no grupo RETRY -- agora sao as 2 ultimas colunas, nao mais Teto_Excedido.
  check("1b: Retry_Manual_Por/Retry_Manual_Em presentes, como as 2 ultimas colunas", headers[headers.length - 2] === "Retry_Manual_Por" && headers[headers.length - 1] === "Retry_Manual_Em", JSON.stringify(headers));
}

// ============================================================
// 2) aba JA EXISTENTE, schema anterior (17 colunas, sem Teto_Excedido)
// -- caso real: Log_Central criado antes desta rodada. Confirma
// backfill idempotente, sem mexer em dado ja gravado nas outras colunas
// nem duplicar entity_type/entity_id/entity_version (que ja existiam).
// ============================================================
{
  const headers17 = ['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
    'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
    'status', 'tentativas', 'erro_codigo', 'erro_detalhe', 'resultado_json',
    'entity_type', 'entity_id', 'entity_version'];
  const linhaExistente = new Array(17).fill('');
  linhaExistente[0] = 'op-preexistente'; linhaExistente[9] = 'QUEUED'; linhaExistente[16] = 3;
  const sheets = { Log_Central: makeSheet(headers17, [linhaExistente]) };
  const sandbox = makeSandbox(sheets);

  sandbox.garantirLogCentral({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; } });

  const dump = sheets.Log_Central._dump();
  const headers = dump[0];
  check("2a: Teto_Excedido foi adicionada na aba pre-existente", headers.includes("Teto_Excedido"), JSON.stringify(headers));
  check("2b: nao duplicou entity_type/entity_id/entity_version (ja existiam)", headers.filter(h => h === "entity_version").length === 1, JSON.stringify(headers));
  const idxOpId = headers.indexOf('operation_id');
  const idxStatus = headers.indexOf('status');
  const idxVersao = headers.indexOf('entity_version');
  const linhaAposReparo = dump.find((r, i) => i > 0 && r[idxOpId] === 'op-preexistente');
  check("2c: dado ja gravado na linha existente foi preservado (status QUEUED, versao 3)", linhaAposReparo[idxStatus] === 'QUEUED' && linhaAposReparo[idxVersao] === 3, JSON.stringify(linhaAposReparo));
  const idxTeto = headers.indexOf('Teto_Excedido');
  check("2d: Teto_Excedido da linha pre-existente fica vazia (backfill so cria a coluna, nao inventa valor)", linhaAposReparo[idxTeto] === '' || linhaAposReparo[idxTeto] === undefined, "valor=" + JSON.stringify(linhaAposReparo[idxTeto]));
  check("2e: Retry_Manual_Por/Retry_Manual_Em tambem foram adicionadas no backfill", headers.includes("Retry_Manual_Por") && headers.includes("Retry_Manual_Em"), JSON.stringify(headers));
}

// ============================================================
// 3) idempotencia -- 2 chamadas seguidas de garantirLogCentral() numa
// aba ja com Teto_Excedido nao duplicam a coluna.
// ============================================================
{
  const sheets = {};
  const sandbox = makeSandbox(sheets);
  const ssStub = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; } };
  sandbox.garantirLogCentral(ssStub);
  sandbox.garantirLogCentral(ssStub);
  const headers = sheets.Log_Central._dump()[0];
  const ocorrencias = headers.filter(h => h === "Teto_Excedido").length;
  check("3a: 2 chamadas seguidas -- ainda so 1 coluna Teto_Excedido", ocorrencias === 1, JSON.stringify(headers));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
