// Harness Node pra 2 achados red-team de registrarAceiteOferta (Cowork
// 2, 15/08) -- mesma categoria do TOCTOU ja corrigido em encerrarOS:
// 1. Resposta duplicada: releitura fresca SEM lock nao impedia 2
//    chamadas quase simultaneas (mesmo tecnico, 2 operationId
//    diferentes) de ambas verem Status='Pendente' e ambas anexarem
//    linha. "Dois tecnicos diferentes" nao se aplica aqui -- posse
//    (Tecnico_ID fixo por oferta) ja bloqueia isso estruturalmente,
//    independente de timing.
// 2. Expiracao nunca era checada em registrarAceiteOferta -- so em
//    getOfertaAlocacao (leitura, no momento de abrir o link). Oferta
//    expirada continuava aceitavel indefinidamente enquanto
//    Status='Pendente'.
// Mesmo padrao dos outros: codigo real via vm, sheets fake em memoria.
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

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
        setFontWeight() { return this; }, setNumberFormat() { return this; }, setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    appendRow(arr) { data.push(arr.slice()); },
    setFrozenRows() {}, setColumnWidth() {},
    _dump() { return data; },
  };
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

function hmacBytes(payload, secret) {
  const h = crypto.createHmac("sha256", secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}

const SEGREDO = "segredo-de-teste-nao-e-o-real";
const ALOCACOES_HEADERS = ['Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
  'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'];

function runScenario(linhasIniciais, opts) {
  opts = opts || {};
  const sheets = {
    Alocacoes_Ofertas: makeSheet(ALOCACOES_HEADERS, linhasIniciais || []),
    Log_Central: makeSheet(
      ['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
       'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
       'status', 'tentativas', 'erro_detalhe', 'resultado_json'], []
    ),
  };
  const props = { OFERTA_HMAC_SECRET: SEGREDO };
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
    PropertiesService: { getScriptProperties() { return { getProperty: (key) => (props[key] !== undefined ? props[key] : null) }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
      formatDate: (d, tz, fmt) => new Date(d).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
    },
    // LockService com hook opcional -- mesma tecnica ja usada pra provar
    // o fix de TOCTOU em encerrarOS: aoTravar dispara DENTRO de
    // tryLock(), simulando uma "outra chamada concorrente" tendo
    // terminado exatamente no ponto onde uma execucao real teria tido
    // a chance.
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (opts.aoTravar) { opts.aoTravar(); opts.aoTravar = null; } return true; },
        releaseLock: () => {},
      }),
    },
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

const AGORA_MS = Date.now();
const EXPIRA_FUTURO_ISO = new Date(AGORA_MS + 3600 * 1000).toISOString();
const EXPIRA_PASSADO_ISO = new Date(AGORA_MS - 3600 * 1000).toISOString();

// ============================================================
// ACHADO 1 -- resposta duplicada via corrida (2 operationId diferentes,
// mesmo tecnico). CONFIRMADO BUG REAL, corrigido (trava atomica).
// ============================================================
{
  // 1a) caminho normal (sem interleaving) continua funcionando.
  const linha = ["OF-1", "OS-1", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_FUTURO_ISO, "Pendente", "", "", ""];
  const { sandbox, sheets } = runScenario([linha]);
  const r = sandbox.registrarAceiteOferta("OF-1", "TEC-1", true, "", "op-1", "DEV-1");
  check("1a: aceite normal continua funcionando", r.sucesso === true && r.status === "Aceita", JSON.stringify(r));
  check("1a-linhas: exatamente 1 linha nova (header + original + 1 resposta)", sheets.Alocacoes_Ofertas._dump().length === 3);

  // 1b) interleaving simulado: a chamada B "termina" (grava Recusada)
  // EXATAMENTE no momento em que a chamada A esta pra adquirir a trava
  // -- sem a correcao, A leria Status='Pendente' (stale) e duplicaria a
  // resposta. Com a correcao, A so le Status DEPOIS que B ja escreveu
  // (mesma trava serializa as duas), entao A encontra 'Recusada' e e'
  // recusada por "ja foi respondida".
  const linha2 = ["OF-2", "OS-2", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_FUTURO_ISO, "Pendente", "", "", ""];
  let sheets2, sandbox2;
  const cenario2 = runScenario([linha2], {
    aoTravar: () => {
      // simula a chamada B (operationId diferente) tendo COMPLETADO seu
      // proprio ciclo de lock+append ANTES de A conseguir a trava.
      sheets2.Alocacoes_Ofertas.appendRow(["OF-2", "OS-2", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_FUTURO_ISO, "Recusada", new Date().toISOString(), "Mudou de ideia", "op-2-concorrente"]);
    },
  });
  sandbox2 = cenario2.sandbox; sheets2 = cenario2.sheets;
  const rA = sandbox2.registrarAceiteOferta("OF-2", "TEC-1", true, "", "op-2-A", "DEV-1");
  check("1b: chamada A recusada -- oferta ja tinha sido respondida pela 'concorrente' B", rA.sucesso === false && /respondida/.test(rA.erro), JSON.stringify(rA));
  const dump2 = sheets2.Alocacoes_Ofertas._dump();
  check("1b-linhas: so 3 linhas no total (header + original + a resposta da B) -- A NAO duplicou", dump2.length === 3, JSON.stringify(dump2));
  check("1b-status: a resposta que sobrevive e' a da B (Recusada), nao uma 2a de A", dump2[2][ALOCACOES_HEADERS.indexOf("Status")] === "Recusada" && dump2[2][ALOCACOES_HEADERS.indexOf("operation_id")] === "op-2-concorrente");
}

// ============================================================
// ACHADO 2 -- expiracao nunca era checada no aceite. CONFIRMADO BUG
// REAL, corrigido (checagem de Expira_Em sob a mesma trava).
// ============================================================
{
  // 2a) oferta EXPIRADA, Status ainda Pendente (ninguem respondeu) --
  // antes do fix, isso era aceitavel indefinidamente. Agora e' recusada.
  const linha = ["OF-3", "OS-3", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_PASSADO_ISO, "Pendente", "", "", ""];
  const { sandbox, sheets } = runScenario([linha]);
  const r = sandbox.registrarAceiteOferta("OF-3", "TEC-1", true, "", "op-3", "DEV-1");
  check("2a: oferta expirada recusada mesmo com Status ainda Pendente", r.sucesso === false && /[Ee]xpirad/.test(r.erro), JSON.stringify(r));
  check("2b: nenhuma linha nova foi anexada (so header + original)", sheets.Alocacoes_Ofertas._dump().length === 2);

  // 2c) oferta DENTRO do prazo continua aceitavel normalmente (nao virou
  // fail-open nem fail-closed geral).
  const linhaOk = ["OF-4", "OS-4", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_FUTURO_ISO, "Pendente", "", "", ""];
  const cenarioOk = runScenario([linhaOk]);
  const rOk = cenarioOk.sandbox.registrarAceiteOferta("OF-4", "TEC-1", true, "", "op-4", "DEV-1");
  check("2c: oferta dentro do prazo continua aceitavel normalmente", rOk.sucesso === true, JSON.stringify(rOk));
}

// ============================================================
// ACHADO 2b -- recusa (nao so aceite) de oferta expirada tambem e'
// bloqueada -- a checagem de expiracao vale pros dois desfechos.
// ============================================================
{
  const linha = ["OF-5", "OS-5", "TEC-1", "Instalacao", 500, "2026-01-01", EXPIRA_PASSADO_ISO, "Pendente", "", "", ""];
  const { sandbox, sheets } = runScenario([linha]);
  const r = sandbox.registrarAceiteOferta("OF-5", "TEC-1", false, "Nao quero mais", "op-5", "DEV-1");
  check("2b-1: RECUSA de oferta expirada tambem bloqueada", r.sucesso === false && /[Ee]xpirad/.test(r.erro), JSON.stringify(r));
  check("2b-2: nenhuma linha nova foi anexada (so header + original)", sheets.Alocacoes_Ofertas._dump().length === 2);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
