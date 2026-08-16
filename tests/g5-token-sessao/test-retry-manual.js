// Harness Node pra reprocessarOperacaoManual -- retry manual acionado por
// humano quando uma linha SYNC_ERROR esgota o teto de 5 tentativas
// automaticas (Teto_Excedido=true). Especificacao fechada (Geovane,
// 14/08): reseta Teto_Excedido->false, status->QUEUED, preserva
// tentativas/erro_codigo/erro_detalhe, registra Retry_Manual_Por/
// Retry_Manual_Em. DIVERGENT nao e afetado por essa logica em nenhum
// caminho. Mesmo padrao dos outros: codigo real via vm, sheets fake em
// memoria.
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

const LOG_CENTRAL_HEADERS = [
  'operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
  'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
  'status', 'tentativas', 'erro_codigo', 'erro_detalhe', 'resultado_json',
  'entity_type', 'entity_id', 'entity_version',
  'Teto_Excedido', 'Retry_Manual_Por', 'Retry_Manual_Em',
];

function idx(nome) { return LOG_CENTRAL_HEADERS.indexOf(nome); }

function linhaLogCentral(overrides) {
  const linha = new Array(LOG_CENTRAL_HEADERS.length).fill('');
  Object.keys(overrides).forEach(k => { linha[idx(k)] = overrides[k]; });
  return linha;
}

function makeSandbox(sheets) {
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (name) => sheets[name] || null,
          insertSheet: (name) => { const s = makeSheet(LOG_CENTRAL_HEADERS, []); sheets[name] = s; return s; },
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
// 1) caso principal -- SYNC_ERROR + Teto_Excedido=true: reseta pra
// QUEUED, Teto_Excedido->false, preserva tentativas e erro anterior,
// registra quem pediu e quando.
// ============================================================
{
  const linha = linhaLogCentral({
    operation_id: 'op-1', OS_ID: 'OS-1', status: 'SYNC_ERROR', tentativas: 5,
    erro_codigo: 'CONEXAO_INDISPONIVEL', erro_detalhe: 'Falha de rede (JSONP)', Teto_Excedido: true,
  });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);

  const r = sandbox.reprocessarOperacaoManual('op-1', 'gestor-fulano');
  check("1a: retry manual aceito", r.sucesso === true && r.status === 'QUEUED', JSON.stringify(r));

  const dump = sheets.Log_Central._dump();
  const linhaApos = dump[1];
  check("1b: status virou QUEUED", linhaApos[idx('status')] === 'QUEUED');
  check("1c: Teto_Excedido virou false", linhaApos[idx('Teto_Excedido')] === false);
  check("1d: tentativas PRESERVADAS (nao zerou)", linhaApos[idx('tentativas')] === 5, "tentativas=" + linhaApos[idx('tentativas')]);
  check("1e: erro_codigo/erro_detalhe PRESERVADOS (erro anterior fica registrado)", linhaApos[idx('erro_codigo')] === 'CONEXAO_INDISPONIVEL' && linhaApos[idx('erro_detalhe')] === 'Falha de rede (JSONP)');
  check("1f: Retry_Manual_Por registrado", linhaApos[idx('Retry_Manual_Por')] === 'gestor-fulano');
  check("1g: Retry_Manual_Em registrado, ISO 8601, nao Date nativo", typeof linhaApos[idx('Retry_Manual_Em')] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(linhaApos[idx('Retry_Manual_Em')]), JSON.stringify(linhaApos[idx('Retry_Manual_Em')]));
}

// ============================================================
// 2) DIVERGENT nunca e afetado -- recusado, nada tocado.
// ============================================================
{
  const linha = linhaLogCentral({
    operation_id: 'op-2', OS_ID: 'OS-2', status: 'DIVERGENT', tentativas: 1,
    erro_codigo: 'DIVERGENCIA_VALOR', erro_detalhe: 'Motivo de recusa obrigatorio', Teto_Excedido: false,
  });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);

  const r = sandbox.reprocessarOperacaoManual('op-2', 'gestor-fulano');
  check("2a: DIVERGENT recusado (status nao e SYNC_ERROR)", r.sucesso === false, JSON.stringify(r));

  const dump = sheets.Log_Central._dump();
  check("2b: status continua DIVERGENT, nada foi alterado", dump[1][idx('status')] === 'DIVERGENT');
}

// ============================================================
// 3) DIVERGENT com Teto_Excedido=true "por engano" (nao deveria
// acontecer na pratica, mas prova que a checagem e sobre STATUS, nao so
// sobre a flag) -- ainda recusado.
// ============================================================
{
  const linha = linhaLogCentral({
    operation_id: 'op-3', OS_ID: 'OS-3', status: 'DIVERGENT', tentativas: 1, Teto_Excedido: true,
  });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);

  const r = sandbox.reprocessarOperacaoManual('op-3', 'gestor-fulano');
  check("3a: DIVERGENT com Teto_Excedido=true tambem recusado (status errado)", r.sucesso === false, JSON.stringify(r));
  const dump = sheets.Log_Central._dump();
  check("3b: nada foi alterado", dump[1][idx('status')] === 'DIVERGENT' && dump[1][idx('Teto_Excedido')] === true);
}

// ============================================================
// 4) SYNC_ERROR mas AINDA DENTRO do teto (Teto_Excedido=false) -- ainda
// nao e elegivel, o scanner automatico ja cobre esse caso.
// ============================================================
{
  const linha = linhaLogCentral({
    operation_id: 'op-4', OS_ID: 'OS-4', status: 'SYNC_ERROR', tentativas: 2, Teto_Excedido: false,
  });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);

  const r = sandbox.reprocessarOperacaoManual('op-4', 'gestor-fulano');
  check("4a: SYNC_ERROR sem teto excedido ainda e recusado", r.sucesso === false, JSON.stringify(r));
  const dump = sheets.Log_Central._dump();
  check("4b: nada foi alterado (tentativas continuam 2)", dump[1][idx('tentativas')] === 2 && dump[1][idx('status')] === 'SYNC_ERROR');
}

// ============================================================
// 5) operationId inexistente -- recusa clara.
// ============================================================
{
  const linha = linhaLogCentral({ operation_id: 'op-5', status: 'SYNC_ERROR', Teto_Excedido: true });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);
  const r = sandbox.reprocessarOperacaoManual('op-NAO-EXISTE', 'gestor-fulano');
  check("5a: operationId inexistente recusado com motivo claro", r.sucesso === false && /nao encontrada/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 6) validacao de entrada -- operationId/solicitanteId obrigatorios,
// fail-closed ANTES de tocar a planilha (mesmo padrao do resto do
// projeto pra entrada mal formada).
// ============================================================
{
  const sheets = {};
  const sandbox = makeSandbox(sheets);
  const r1 = sandbox.reprocessarOperacaoManual('', 'gestor-fulano');
  check("6a: operationId vazio recusado", r1.sucesso === false && /operationId/.test(r1.erro), JSON.stringify(r1));
  const r2 = sandbox.reprocessarOperacaoManual('op-6', '');
  check("6b: solicitanteId vazio recusado", r2.sucesso === false && /solicitanteId/.test(r2.erro), JSON.stringify(r2));
}

// ============================================================
// 7) idempotencia natural -- clicar "Tentar novamente" 2x seguidas: a
// 2a chamada ja nao bate mais a condicao (status agora QUEUED), entao e
// recusada sem sobrescrever quem pediu a 1a vez.
// ============================================================
{
  const linha = linhaLogCentral({
    operation_id: 'op-7', status: 'SYNC_ERROR', tentativas: 5, Teto_Excedido: true,
  });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);

  const r1 = sandbox.reprocessarOperacaoManual('op-7', 'gestor-A');
  check("7a: 1o clique aceito", r1.sucesso === true, JSON.stringify(r1));

  const r2 = sandbox.reprocessarOperacaoManual('op-7', 'gestor-B');
  check("7b: 2o clique (duplo-clique) recusado -- ja nao esta mais SYNC_ERROR", r2.sucesso === false, JSON.stringify(r2));

  const dump = sheets.Log_Central._dump();
  check("7c: Retry_Manual_Por continua sendo quem pediu a 1a vez (gestor-A), nao sobrescrito", dump[1][idx('Retry_Manual_Por')] === 'gestor-A');
}

// ============================================================
// 8) via executarAcao (API.js) -- prova que o dispatcher repassa os 2
// parametros corretamente (mesma classe de bug achado em
// salvarResposta: teste direto na funcao nao pega erro de dispatch).
// ============================================================
{
  const linha = linhaLogCentral({ operation_id: 'op-8', status: 'SYNC_ERROR', tentativas: 5, Teto_Excedido: true });
  const sheets = { Log_Central: makeSheet(LOG_CENTRAL_HEADERS, [linha]) };
  const sandbox = makeSandbox(sheets);
  const r = sandbox.executarAcao('reprocessarOperacaoManual', ['op-8', 'gestor-fulano']);
  check("8a: dispatcher repassa operationId/solicitanteId corretamente", r.sucesso === true && r.status === 'QUEUED', JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
