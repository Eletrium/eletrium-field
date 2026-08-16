// Harness Node pra getOfertaAlocacao / registrarAceiteOferta
// (CONTRATO-BACKEND-ACEITE-OFERTA.md, sessao de frontend). Mesmo padrao:
// codigo real via vm, sheets fake em memoria, sem API real. HMAC real
// (Node crypto), nao um mock burro -- senao o teste nao provaria que
// adulterar o link de verdade invalida a assinatura.
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

// HMAC real (bytes assinados, mesmo formato que Utilities.computeHmacSha256Signature
// do Apps Script devolve -- valores > 127 viram negativos).
function hmacBytes(payload, secret) {
  const h = crypto.createHmac("sha256", secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}
function hmacHex(payload, secret) {
  return hmacBytes(payload, secret).map(b => ("0" + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join("");
}
function mintSig(ofertaId, tecnicoId, exp, secret) {
  return hmacHex(String(ofertaId) + "|" + String(tecnicoId) + "|" + String(exp), secret);
}

const SEGREDO = "segredo-de-teste-nao-e-o-real";

function runScenario(ofertasRows, opts) {
  opts = opts || {};
  const sheets = { Alocacoes_Ofertas: makeSheet(
    ['Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
     'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'],
    ofertasRows || []
  ) };
  const props = { OFERTA_HMAC_SECRET: opts.semSegredo ? undefined : SEGREDO };
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
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (key) => (props[key] !== undefined ? props[key] : null) };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
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

const AGORA = Math.floor(Date.now() / 1000);
const EXP_FUTURO = AGORA + 3600;
const EXP_PASSADO = AGORA - 3600;
// Achado real (15/08): a coluna Expira_Em (linha da planilha) e' texto
// ISO 8601 -- criarOfertaAlocacao grava .toISOString(), e
// registrarAceiteOferta agora CHECA essa coluna de verdade (achado
// red-team: expiracao nunca era validada no aceite, so na leitura).
// EXP_FUTURO/EXP_PASSADO (unix seconds) continuam certos pro parametro
// `exp` assinado na URL (getOfertaAlocacao/mintSig) -- formato
// DIFERENTE, mesmo instante. Constantes ISO separadas so pra popular a
// COLUNA Expira_Em nas linhas de teste.
const EXP_FUTURO_ISO = new Date(EXP_FUTURO * 1000).toISOString();
const EXP_PASSADO_ISO = new Date(EXP_PASSADO * 1000).toISOString();

// ============================================================
// 1) getOfertaAlocacao -- assinatura valida, Pendente, nao expirada
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-1", "OS-1", "TEC-1", "Instalacao eletrica", 500, "2026-08-01", EXP_FUTURO, "Pendente", "", "", ""],
  ]);
  const sig = mintSig("OF-1", "TEC-1", EXP_FUTURO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-1", "TEC-1", EXP_FUTURO, sig);
  check("1a: encontrada:true, status:Pendente", r.encontrada === true && r.status === "Pendente", JSON.stringify(r));
  check("1b: osId devolvido", r.osId === "OS-1");
  check("1c: escopoResumo devolvido", r.escopoResumo === "Instalacao eletrica");
  check("1d: valorProposto devolvido", r.valorProposto === 500);
}

// ============================================================
// 2) getOfertaAlocacao -- assinatura errada -> nao revela existencia
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-2", "OS-2", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO, "Pendente", "", "", ""],
  ]);
  const r = sandbox.getOfertaAlocacao("OF-2", "TEC-1", EXP_FUTURO, "sig-forjada-qualquer-coisa");
  check("2a: sig errada -> encontrada:false, 'Link invalido'", r.encontrada === false && r.erro === "Link invalido", JSON.stringify(r));
}

// ============================================================
// 3) getOfertaAlocacao -- tecnicoId adulterado invalida a assinatura
//    (sig foi mintada pro TEC-1, chamada tenta se passar por TEC-2)
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-3", "OS-3", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO, "Pendente", "", "", ""],
  ]);
  const sigDoTec1 = mintSig("OF-3", "TEC-1", EXP_FUTURO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-3", "TEC-2", EXP_FUTURO, sigDoTec1);
  check("3a: tecnicoId adulterado invalida a sig (nao e a mesma que foi mintada)", r.encontrada === false && r.erro === "Link invalido", JSON.stringify(r));
}

// ============================================================
// 4) getOfertaAlocacao -- exp no passado -> expirada
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-4", "OS-4", "TEC-1", "X", 100, "2026-08-01", EXP_PASSADO, "Pendente", "", "", ""],
  ]);
  const sig = mintSig("OF-4", "TEC-1", EXP_PASSADO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-4", "TEC-1", EXP_PASSADO, sig);
  check("4a: exp no passado -> encontrada:true, expirada:true", r.encontrada === true && r.expirada === true, JSON.stringify(r));
}

// ============================================================
// 5) getOfertaAlocacao -- oferta ja respondida (nao Pendente)
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-5", "OS-5", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO, "Aceita", "2026-08-02", "", ""],
  ]);
  const sig = mintSig("OF-5", "TEC-1", EXP_FUTURO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-5", "TEC-1", EXP_FUTURO, sig);
  check("5a: status ja respondido -> encontrada:true, status:Aceita (sem outros campos)", r.encontrada === true && r.status === "Aceita" && r.osId === undefined, JSON.stringify(r));
}

// ============================================================
// 6) getOfertaAlocacao -- ofertaId inexistente, mas sig valida pra ele
//    (edge: nao e falha de seguranca, e inconsistencia de dado)
// ============================================================
{
  const { sandbox } = runScenario([]);
  const sig = mintSig("OF-FANTASMA", "TEC-1", EXP_FUTURO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-FANTASMA", "TEC-1", EXP_FUTURO, sig);
  check("6a: oferta inexistente -> encontrada:false, motivo distinto de 'Link invalido'", r.encontrada === false && r.erro === "Oferta nao encontrada", JSON.stringify(r));
}

// ============================================================
// 7) fail-closed: sem segredo configurado, NUNCA valida
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-7", "OS-7", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO, "Pendente", "", "", ""],
  ], { semSegredo: true });
  const sig = mintSig("OF-7", "TEC-1", EXP_FUTURO, SEGREDO);
  const r = sandbox.getOfertaAlocacao("OF-7", "TEC-1", EXP_FUTURO, sig);
  check("7a: sem segredo configurado -> sempre invalido (fail-closed)", r.encontrada === false, JSON.stringify(r));
}

// ============================================================
// 8) registrarAceiteOferta -- aceite grava evento novo (append)
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-8", "OS-8", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Pendente", "", "", ""],
  ]);
  const r = sandbox.registrarAceiteOferta("OF-8", "TEC-1", true, "", "op-8", "DEV-1");
  check("8a: aceite grava com sucesso", r.sucesso === true && r.status === "Aceita", JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("8b: linha ORIGINAL preservada (append, nao edicao)", dump[1][dump[0].indexOf("Status")] === "Pendente");
  check("8c: nova linha anexada com Status=Aceita", dump[2][dump[0].indexOf("Status")] === "Aceita");
  check("8d: nova linha tem Respondida_Em preenchido", !!dump[2][dump[0].indexOf("Respondida_Em")]);
}

// ============================================================
// 9) registrarAceiteOferta -- recusa com motivo grava evento novo
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-9", "OS-9", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Pendente", "", "", ""],
  ]);
  const r = sandbox.registrarAceiteOferta("OF-9", "TEC-1", false, "Sem disponibilidade essa semana", "op-9", "DEV-1");
  check("9a: recusa com motivo grava com sucesso", r.sucesso === true && r.status === "Recusada", JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("9b: Motivo_Recusa gravado na nova linha", dump[2][dump[0].indexOf("Motivo_Recusa")] === "Sem disponibilidade essa semana");
}

// ============================================================
// 10) registrarAceiteOferta -- recusa SEM motivo e recusada (fail-closed)
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-10", "OS-10", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Pendente", "", "", ""],
  ]);
  const r = sandbox.registrarAceiteOferta("OF-10", "TEC-1", false, "", "op-10", "DEV-1");
  check("10a: recusa sem motivo -> sucesso:false", r.sucesso === false && /[Mm]otivo/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("10b: nenhuma linha nova foi anexada", dump.length === 2);
}

// ============================================================
// 11) registrarAceiteOferta -- oferta ja respondida (corrida entre 2
//     operation_id DIFERENTES) -> recusa, nao sobrescreve
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-11", "OS-11", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Aceita", "2026-08-02", "", "op-ja-processado"],
  ]);
  const r = sandbox.registrarAceiteOferta("OF-11", "TEC-1", false, "Mudei de ideia", "op-11-novo", "DEV-1");
  check("11a: oferta ja respondida -> recusa (nao sobrescreve)", r.sucesso === false && /respondida/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("11b: nenhuma linha nova foi anexada", dump.length === 2);
}

// ============================================================
// 12) idempotencia -- retry com mesma operation_id devolve o mesmo
//     resultado, sem gravar 2a linha
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-12", "OS-12", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Pendente", "", "", ""],
  ]);
  const r1 = sandbox.registrarAceiteOferta("OF-12", "TEC-1", true, "", "op-12", "DEV-1");
  const r2 = sandbox.registrarAceiteOferta("OF-12", "TEC-1", true, "", "op-12", "DEV-1");
  check("12a: retry devolve o MESMO resultado", JSON.stringify(r1) === JSON.stringify(r2));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("12b: so 1 linha nova foi anexada (nao 2)", dump.length === 3, "linhas=" + dump.length);
}

// ============================================================
// 13) posse -- tecnicoId diferente do Tecnico_ID da oferta e recusado
// ============================================================
{
  const { sandbox, sheets } = runScenario([
    ["OF-13", "OS-13", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO, "Pendente", "", "", ""],
  ]);
  const r = sandbox.registrarAceiteOferta("OF-13", "TEC-INTRUSO", true, "", "op-13", "DEV-1");
  check("13a: tecnico que nao e dono da oferta e recusado", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("13b: nenhuma linha nova foi anexada", dump.length === 2);
}

// ============================================================
// 14) oferta inexistente -- recusa com erro claro
// ============================================================
{
  const { sandbox } = runScenario([]);
  const r = sandbox.registrarAceiteOferta("OF-FANTASMA", "TEC-1", true, "", "op-14", "DEV-1");
  check("14a: oferta inexistente recusada com motivo claro", r.sucesso === false && /nao encontrada/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 15) integracao -- getOfertaAlocacao reflete o novo status depois do
//     registrarAceiteOferta
// ============================================================
{
  const { sandbox } = runScenario([
    ["OF-15", "OS-15", "TEC-1", "X", 100, "2026-08-01", EXP_FUTURO_ISO, "Pendente", "", "", ""],
  ]);
  const sig = mintSig("OF-15", "TEC-1", EXP_FUTURO, SEGREDO);
  const antes = sandbox.getOfertaAlocacao("OF-15", "TEC-1", EXP_FUTURO, sig);
  check("15a: antes -> Pendente", antes.status === "Pendente");

  sandbox.registrarAceiteOferta("OF-15", "TEC-1", true, "", "op-15", "DEV-1");
  const depois = sandbox.getOfertaAlocacao("OF-15", "TEC-1", EXP_FUTURO, sig);
  check("15b: depois -> Aceita (le a ULTIMA linha, nao a original)", depois.encontrada === true && depois.status === "Aceita", JSON.stringify(depois));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
