// Harness Node pra _garantirFormatoFerramentalMovimentos (15/08,
// achado adjacente finalizado -- Registrado_Em gravava Date nativo ate
// o commit 5b7f83c, mesma classe de bug ja corrigida em Log_Central/
// Ordens_Servico/Alocacoes_Ofertas). Mesmo padrao dos outros: codigo
// real via vm, sheets fake em memoria.
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
          for (let i = 0; i < numRows; i++) out.push((data[r - 1 + i] || []).slice(c - 1, c - 1 + numCols));
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) {
            while (data.length < r - 1 + i + 1) data.push([]);
            data[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        setFontWeight() { return this; },
        setNumberFormat(fmt) { this._fmt = fmt; formatChamadas.push({ r, c, numRows, numCols, fmt }); return this; },
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

let formatChamadas = [];

function makeSandbox(sheets) {
  formatChamadas = [];
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (n) => sheets[n] || null,
          insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; },
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

// Node vm cria um realm separado -- Date do script externo falha
// instanceof Date dentro do sandbox (mesmo achado ja documentado no fix
// de normalizacao do Log_Central). Constroi o Date DENTRO do sandbox.
function dataNoSandbox(sandbox, iso) {
  sandbox.__isoTemp = iso;
  vm.runInContext('__dataTemp = new Date(__isoTemp)', sandbox);
  const d = sandbox.__dataTemp;
  delete sandbox.__isoTemp; delete sandbox.__dataTemp;
  return d;
}

const FERRAMENTAL_HEADERS = ['Movimento_ID', 'OS_ID', 'Tecnico_ID', 'Patrimonio_Codigo', 'Tipo_Movimento',
  'Estado_OK', 'Observacao', 'Registrado_Em', 'operation_id'];
function idx(nome) { return FERRAMENTAL_HEADERS.indexOf(nome); }

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// ============================================================
// 1) aba criada do zero (via setupSheets) -- Registrado_Em ja nasce
// formatado como texto '@'.
// ============================================================
{
  const sheets = {};
  const sandbox = makeSandbox(sheets);
  sandbox.setupSheets();
  const chamadaFormato = formatChamadas.find(c => c.fmt === '@' && c.c === idx('Registrado_Em') + 1);
  check("1a: coluna Registrado_Em (aba nova) recebe setNumberFormat('@')", !!chamadaFormato, JSON.stringify(formatChamadas));
}

// ============================================================
// 2) aba JA EXISTENTE, com linhas legado (Date nativo em Registrado_Em,
// gravadas antes do fix de 5b7f83c) -- normalizacao converte pra texto
// ISO, preservando o mesmo instante, sem tocar em linhas ja-texto.
// ============================================================
{
  const linhaLegado = new Array(FERRAMENTAL_HEADERS.length).fill('');
  linhaLegado[idx('Movimento_ID')] = 'mov-legado';
  linhaLegado[idx('OS_ID')] = 'OS-1';

  const isoNovo = '2026-08-14T22:00:00.000Z';
  const linhaNova = new Array(FERRAMENTAL_HEADERS.length).fill('');
  linhaNova[idx('Movimento_ID')] = 'mov-novo';
  linhaNova[idx('OS_ID')] = 'OS-1';
  linhaNova[idx('Registrado_Em')] = isoNovo;

  const sheets = { Ferramental_Movimentos: makeSheet(FERRAMENTAL_HEADERS, [linhaLegado, linhaNova]) };
  const sandbox = makeSandbox(sheets);
  const dataLegadoSandbox = dataNoSandbox(sandbox, '2026-01-15T10:30:00.000Z');
  sheets.Ferramental_Movimentos.getRange(2, idx('Registrado_Em') + 1).setValue(dataLegadoSandbox);

  sandbox.setupSheets();

  const dump = sheets.Ferramental_Movimentos._dump();
  check("2a: linha legado -- Registrado_Em virou string", typeof dump[1][idx('Registrado_Em')] === 'string', JSON.stringify(dump[1]));
  check("2b: preserva o MESMO instante", dump[1][idx('Registrado_Em')] === '2026-01-15T10:30:00.000Z', dump[1][idx('Registrado_Em')]);
  check("2c: linha ja-texto (nova) permanece EXATAMENTE igual", dump[2][idx('Registrado_Em')] === isoNovo);

  const chamadaFormato = formatChamadas.find(c => c.fmt === '@' && c.c === idx('Registrado_Em') + 1);
  check("2d: reparo tambem reaplica o formato '@' na aba ja existente", !!chamadaFormato);
}

// ============================================================
// 3) idempotencia -- 2 execucoes seguidas de setupSheets() nao mudam
// nada na 2a (ja e' tudo texto depois da 1a).
// ============================================================
{
  const sheets = {};
  const sandbox = makeSandbox(sheets);
  sandbox.setupSheets();
  const dataAntes = dataNoSandbox(sandbox, '2026-02-02T02:02:02.000Z');
  sheets.Ferramental_Movimentos.appendRow(['mov-x', 'OS-1', 'TEC-1', 'PAT-1', 'Carga', true, '', dataAntes, 'op-x']);

  sandbox.setupSheets();
  const valor1 = sheets.Ferramental_Movimentos._dump()[1][idx('Registrado_Em')];
  check("3a: 1a execucao pos-append normaliza a celula", typeof valor1 === 'string' && valor1 === '2026-02-02T02:02:02.000Z');

  sandbox.setupSheets();
  const valor2 = sheets.Ferramental_Movimentos._dump()[1][idx('Registrado_Em')];
  check("3b: 2a execucao nao muda o valor de novo (idempotente)", valor2 === valor1);
}

// ============================================================
// 4) fim-a-fim -- registrarMovimentoFerramental (fluxo real) ja grava
// ISO texto direto, sem depender da normalizacao (confirma o fix do
// commit 5b7f83c continua valendo, nao so o backfill de linha legado).
// ============================================================
{
  const os1 = ["OS-1", "TEC-1"];
  const sheets = {
    Ordens_Servico: makeSheet(["OS_ID", "ID_Tecnico"], [os1]),
    Ferramental_Movimentos: makeSheet(FERRAMENTAL_HEADERS, []),
  };
  const sandbox = makeSandbox(sheets);
  const r = sandbox.registrarMovimentoFerramental("OS-1", "TEC-1", "PAT-001", "Carga", true, "", "op-1", "DEV-1");
  check("4a: registrarMovimentoFerramental grava com sucesso", r.sucesso === true, JSON.stringify(r));
  const dump = sheets.Ferramental_Movimentos._dump();
  check("4b: Registrado_Em gravado como texto ISO 8601 (nao Date nativo)", typeof dump[1][idx('Registrado_Em')] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(dump[1][idx('Registrado_Em')]), JSON.stringify(dump[1]));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
