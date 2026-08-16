// Harness Node pra _normalizarTimestampsLogCentral (14/08, apoio ao
// scanner de retry da Cowork 1 -- pergunta sobre formato de data pra
// quem le Log_Central via Make/getSheetContent). Achado: o backend
// original (commit aedc20e) gravava criado_em/recebido_em/
// sincronizado_em como Date NATIVO -- linhas antigas (se existirem em
// producao) ficariam com Date nativo ate hoje, misturado com linhas
// novas (texto ISO 8601), mesmo depois do guard '@' ter sido aplicado
// (setNumberFormat nao reconverte celula ja preenchida). Mesmo padrao
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
        // Achado real (14/08): o padrao usado em outros testes desta
        // sessao fazia .slice(0, numCols) -- correto SO quando c=1 (le
        // do inicio da linha). _normalizarTimestampsLogCentral e' o
        // PRIMEIRO caso desta sessao a ler um range multi-linha
        // comecando de uma coluna != 1 (idx+1 varia por coluna de
        // timestamp) -- .slice(c-1, c-1+numCols) e' a versao correta,
        // que respeita o offset de coluna pedido.
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

const LOG_CENTRAL_HEADERS = [
  'operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
  'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
  'status', 'tentativas', 'erro_codigo', 'erro_detalhe', 'resultado_json',
  'entity_type', 'entity_id', 'entity_version',
  'Teto_Excedido', 'Retry_Manual_Por', 'Retry_Manual_Em',
];

function idx(nome) { return LOG_CENTRAL_HEADERS.indexOf(nome); }

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

// Node vm cria um REALM separado -- o Date do contexto sandbox e' um
// construtor DIFERENTE do Date do script externo (confirmado: new
// Date() instanceof Date entre os dois da' false). Apps Script real nao
// tem essa fronteira (1 unico realm) -- isto e' um artefato SO deste
// harness de teste, nao do codigo de producao. Pra simular fielmente
// uma "celula com Date nativo" (o que aedc20e gravava de verdade),
// preciso construir o Date DENTRO do proprio sandbox.
function dataNoSandbox(sandbox, iso) {
  sandbox.__isoTemp = iso;
  vm.runInContext('__dataTemp = new Date(__isoTemp)', sandbox);
  const d = sandbox.__dataTemp;
  delete sandbox.__isoTemp; delete sandbox.__dataTemp;
  return d;
}

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// ============================================================
// 1) normalizacao real -- linha "legado" com Date nativo em criado_em/
// sincronizado_em, linha "nova" ja em texto ISO -- so a legado deve
// mudar, preservando o MESMO instante.
// ============================================================
{
  const isoLegado = "2026-01-15T10:30:00.000Z";
  const linhaLegado = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  linhaLegado[idx('operation_id')] = 'op-legado';
  linhaLegado[idx('status')] = 'SYNCED';

  const isoNovo = '2026-08-14T22:00:00.000Z';
  const linhaNova = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  linhaNova[idx('operation_id')] = 'op-novo';
  linhaNova[idx('status')] = 'QUEUED';
  linhaNova[idx('criado_em')] = isoNovo;
  linhaNova[idx('sincronizado_em')] = isoNovo;

  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linhaLegado, linhaNova]) };
  const sandbox = makeSandbox(sheets);
  // injeta Date NATIVO construido DENTRO do proprio sandbox (mesmo
  // realm que _normalizarTimestampsLogCentral vai usar no instanceof) --
  // simula fielmente o que aedc20e gravava de verdade.
  const dataLegadoSandbox = dataNoSandbox(sandbox, isoLegado);
  sheets.Log_Central.getRange(2, idx('criado_em') + 1).setValue(dataLegadoSandbox);
  sheets.Log_Central.getRange(2, idx('sincronizado_em') + 1).setValue(dataLegadoSandbox);

  // aba JA EXISTE -> garantirLogCentral cai no caminho de reparo, que
  // agora chama _normalizarTimestampsLogCentral automaticamente.
  sandbox.garantirLogCentral({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; } });

  const dump = sheets.Log_Central._dump();
  const linhaLegadoApos = dump[1];
  const linhaNovaApos = dump[2];

  check("1a: criado_em da linha legado virou string (nao mais Date)", typeof linhaLegadoApos[idx('criado_em')] === 'string', JSON.stringify(linhaLegadoApos[idx('criado_em')]));
  check("1b: sincronizado_em da linha legado virou string", typeof linhaLegadoApos[idx('sincronizado_em')] === 'string');
  check("1c: a string preserva o MESMO instante (toISOString do Date original)", linhaLegadoApos[idx('criado_em')] === isoLegado, "esperado=" + isoLegado + " obtido=" + linhaLegadoApos[idx('criado_em')]);

  check("1d: linha nova (ja texto) permanece EXATAMENTE igual, nao foi tocada", linhaNovaApos[idx('criado_em')] === isoNovo && linhaNovaApos[idx('sincronizado_em')] === isoNovo);
  check("1e: outras colunas da linha legado (operation_id/status) intactas", linhaLegadoApos[idx('operation_id')] === 'op-legado' && linhaLegadoApos[idx('status')] === 'SYNCED');
}

// ============================================================
// 2) celulas vazias (enviado_em/recebido_em sem valor, comum -- nem
// todo status usa esses campos) NAO viram string "" convertida nem
// quebram -- continuam vazias, sem contar como correcao.
// ============================================================
{
  const linha = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  linha[idx('operation_id')] = 'op-vazio';
  // enviado_em/recebido_em ficam '' (fill padrao)

  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);
  sheets.Log_Central.getRange(2, idx('criado_em') + 1).setValue(dataNoSandbox(sandbox, "2026-01-01T00:00:00.000Z"));
  const resultado = sandbox._normalizarTimestampsLogCentral(sheets.Log_Central, LOG_CENTRAL_HEADERS);

  check("2a: so 1 celula corrigida (criado_em) -- enviado_em/recebido_em vazios nao contam", resultado.celulasCorrigidas === 1, JSON.stringify(resultado));
  const dump = sheets.Log_Central._dump();
  check("2b: enviado_em/recebido_em continuam vazios (nao viraram string de Date invalido)", dump[1][idx('enviado_em')] === '' && dump[1][idx('recebido_em')] === '');
}

// ============================================================
// 3) idempotencia -- rodar a normalizacao 2x seguidas nao muda nada na
// 2a (ja e' tudo texto depois da 1a).
// ============================================================
{
  const linha = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  linha[idx('operation_id')] = 'op-idem';

  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);
  sheets.Log_Central.getRange(2, idx('criado_em') + 1).setValue(dataNoSandbox(sandbox, "2026-03-03T03:03:03.000Z"));

  const r1 = sandbox._normalizarTimestampsLogCentral(sheets.Log_Central, LOG_CENTRAL_HEADERS);
  check("3a: 1a rodada corrige 1 celula", r1.celulasCorrigidas === 1);

  const valorApos1 = sheets.Log_Central._dump()[1][idx('criado_em')];
  const r2 = sandbox._normalizarTimestampsLogCentral(sheets.Log_Central, LOG_CENTRAL_HEADERS);
  check("3b: 2a rodada nao corrige nada (ja e' texto)", r2.celulasCorrigidas === 0, JSON.stringify(r2));
  const valorApos2 = sheets.Log_Central._dump()[1][idx('criado_em')];
  check("3c: valor identico entre as 2 rodadas (nao degradou/mudou de novo)", valorApos1 === valorApos2);
}

// ============================================================
// 4) aba sem nenhuma linha de dado (so header) -- nao quebra, retorna
// 0/0.
// ============================================================
{
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, []) };
  const sandbox = makeSandbox(sheets);
  const r = sandbox._normalizarTimestampsLogCentral(sheets.Log_Central, LOG_CENTRAL_HEADERS);
  check("4a: aba so com header -- 0 linhas verificadas, 0 corrigidas, sem excecao", r.linhasVerificadas === 0 && r.celulasCorrigidas === 0, JSON.stringify(r));
}

// ============================================================
// 5) roda automaticamente via garantirLogCentral no caminho de reparo
// (achado real -- nao precisa de acao dispatcher nova, acontece em todo
// rodarSetupSheets() numa aba ja existente).
// ============================================================
{
  const linha = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  linha[idx('operation_id')] = 'op-auto';

  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);
  sheets.Log_Central.getRange(2, idx('Retry_Manual_Em') + 1).setValue(dataNoSandbox(sandbox, "2026-05-05T05:05:05.000Z"));
  sandbox.garantirLogCentral({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { const s = makeSheet([], []); sheets[n] = s; return s; } });

  const dump = sheets.Log_Central._dump();
  check("5a: Retry_Manual_Em (coluna nova de 14/08) tambem normalizada automaticamente", typeof dump[1][idx('Retry_Manual_Em')] === 'string');
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
