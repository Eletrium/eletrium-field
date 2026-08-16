// Harness Node pra Secao 1 (fundacao) do rollout da Opcao A -- token de
// sessao HMAC (PLANO-ROLLOUT-OPCAO-A-TOKEN-SESSAO.md, aprovado 15/08).
// Zero call site de escrita tocado ainda -- so emitirTokenSessao/
// verificarTokenSessao/validarPinTecnico. Mesmo padrao dos outros:
// codigo real via vm, sheets/PropertiesService fake em memoria.
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

function hmacBytes(payload, secret) {
  const h = crypto.createHmac("sha256", secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}

const SEGREDO = "segredo-sessao-de-teste-nao-e-o-real";

function makeSandbox(props, agora) {
  const sheets = {
    Tecnicos_MEI: makeSheet(
      ['ID_Tecnico', 'Nome', 'PIN', 'PIN_Hash', 'PIN_Salt'],
      [['TEC-1', 'Carlos', '', crypto.createHash("sha256").update("1234" + "salt-fixo").digest("hex"), 'salt-fixo']]
    ),
  };
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: { openById() { return { getSheetByName: (n) => sheets[n] || null }; } },
    PropertiesService: { getScriptProperties() { return { getProperty: (key) => (props[key] !== undefined ? props[key] : null) }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: (algo, str) => Array.from(crypto.createHash("sha256").update(str).digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
    },
    Logger: { log: () => {} },
    console,
    Date: agora ? class extends Date { constructor(...a) { super(...(a.length ? a : [agora])); } static now() { return agora; } } : Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return sandbox;
}

// hashPin/gerarSalt reais do projeto usam Utilities.computeDigest -- o
// fixture de PIN_Hash acima foi montado com sha256 puro do Node, que NAO
// bate com o algoritmo real (salt aplicado de outro jeito). Ajuste: usa
// o proprio hashPin do sandbox pra gerar o fixture, garantindo que bate.
function montarSandboxComTecnicoReal(props, agora) {
  const sandboxTemp = makeSandbox(props, agora);
  const saltFixo = "salt-fixo";
  const hashReal = vm.runInContext(`hashPin(${JSON.stringify("1234")}, ${JSON.stringify(saltFixo)})`, sandboxTemp);
  const sheets = {
    Tecnicos_MEI: makeSheet(
      ['ID_Tecnico', 'Nome', 'PIN', 'PIN_Hash', 'PIN_Salt'],
      [['TEC-1', 'Carlos', '', hashReal, saltFixo]]
    ),
  };
  sandboxTemp.SpreadsheetApp = { openById() { return { getSheetByName: (n) => sheets[n] || null }; } };
  return sandboxTemp;
}

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// ============================================================
// 1) emitirTokenSessao -- fail-closed sem segredo configurado.
// ============================================================
{
  const sandbox = makeSandbox({});
  const r = sandbox.emitirTokenSessao("TEC-1");
  check("1a: sem SESSAO_HMAC_SECRET, emitirTokenSessao devolve null", r === null);
}

// ============================================================
// 2) emitirTokenSessao + verificarTokenSessao -- caminho feliz.
// ============================================================
{
  const sandbox = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO });
  const sessao = sandbox.emitirTokenSessao("TEC-1");
  check("2a: token emitido com segredo configurado", !!sessao && typeof sessao.token === "string");
  check("2b: expiraEm eh um timestamp futuro (unix seconds)", sessao.expiraEm > Math.floor(Date.now() / 1000));

  const v = sandbox.verificarTokenSessao(sessao.token, "TEC-1");
  check("2c: token valido, mesmo tecnicoId -> ok:true", v.ok === true, JSON.stringify(v));
}

// ============================================================
// 3) verificarTokenSessao -- negativos.
// ============================================================
{
  const sandbox = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO });
  const sessao = sandbox.emitirTokenSessao("TEC-1");

  check("3a: token ausente -> recusado", sandbox.verificarTokenSessao(null, "TEC-1").ok === false);
  check("3b: token malformado (sem 3 partes) -> recusado", sandbox.verificarTokenSessao("lixo-sem-pontos", "TEC-1").ok === false);
  check("3c: assinatura adulterada -> recusado", sandbox.verificarTokenSessao(sessao.token.slice(0, -2) + "00", "TEC-1").ok === false);

  // O teste mais importante: token de TEC-1 usado numa chamada alegando
  // ser TEC-2 -- "autenticado como X, agindo como Y", exatamente o
  // buraco do E-TOCTOU-01 que este primitivo fecha.
  const v = sandbox.verificarTokenSessao(sessao.token, "TEC-2");
  check("3d: token de TEC-1 usado alegando ser TEC-2 -> recusado", v.ok === false, JSON.stringify(v));

  // Sem segredo configurado -- fail-closed tambem na verificacao, nao so na emissao.
  const sandboxSemSegredo = makeSandbox({});
  check("3e: verificarTokenSessao sem segredo configurado -> recusado", sandboxSemSegredo.verificarTokenSessao(sessao.token, "TEC-1").ok === false);
}

// ============================================================
// 4) verificarTokenSessao -- expiracao.
// ============================================================
{
  const agora = Date.now();
  const sandboxEmitir = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO }, agora);
  const sessao = sandboxEmitir.emitirTokenSessao("TEC-1");

  // Verifica 25h depois -- passou da validade de 24h.
  const depois = agora + 25 * 60 * 60 * 1000;
  const sandboxVerificar = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO }, depois);
  const v = sandboxVerificar.verificarTokenSessao(sessao.token, "TEC-1");
  check("4a: token emitido, verificado 25h depois -> expirado", v.ok === false, JSON.stringify(v));

  // Verifica 23h depois -- ainda dentro da validade de 24h.
  const antes = agora + 23 * 60 * 60 * 1000;
  const sandboxVerificar2 = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO }, antes);
  const v2 = sandboxVerificar2.verificarTokenSessao(sessao.token, "TEC-1");
  check("4b: token emitido, verificado 23h depois -> ainda valido", v2.ok === true, JSON.stringify(v2));
}

// ============================================================
// 5) tecnicoId com ponto no meio -- garante que o parsing (pop 2x, nao
// split[0]/[1]) nao quebra a extracao do tecnicoId do token.
// ============================================================
{
  const sandbox = makeSandbox({ SESSAO_HMAC_SECRET: SEGREDO });
  const sessao = sandbox.emitirTokenSessao("TEC.COM.PONTO");
  const v = sandbox.verificarTokenSessao(sessao.token, "TEC.COM.PONTO");
  check("5a: tecnicoId com pontos -- token ainda valida corretamente", v.ok === true, JSON.stringify(v));
}

// ============================================================
// 6) validarPinTecnico -- integracao: PIN certo anexa token; PIN errado
// nao quebra (continua so {valido:false}); sem segredo, login continua
// funcionando sem token (fase de transicao).
// ============================================================
{
  const sandbox = montarSandboxComTecnicoReal({ SESSAO_HMAC_SECRET: SEGREDO });
  const rOk = sandbox.validarPinTecnico("TEC-1", "1234");
  check("6a: PIN correto -- valido:true", rOk.valido === true, JSON.stringify(rOk));
  check("6b: PIN correto -- token anexado", typeof rOk.token === "string" && rOk.token.length > 0, JSON.stringify(rOk));
  check("6c: PIN correto -- expiraEm anexado", typeof rOk.expiraEm === "number");

  const rErrado = sandbox.validarPinTecnico("TEC-1", "9999");
  check("6d: PIN errado -- valido:false, sem token", rErrado.valido === false && rErrado.token === undefined, JSON.stringify(rErrado));

  const v = sandbox.verificarTokenSessao(rOk.token, "TEC-1");
  check("6e: token emitido pelo login real passa na verificacao", v.ok === true);
}

// ============================================================
// 7) validarPinTecnico -- sem SESSAO_HMAC_SECRET configurado, login
// continua funcionando (retrocompatibilidade da fase de transicao).
// ============================================================
{
  const sandbox = montarSandboxComTecnicoReal({});
  const r = sandbox.validarPinTecnico("TEC-1", "1234");
  check("7a: PIN correto, sem segredo de sessao -- ainda valido:true", r.valido === true, JSON.stringify(r));
  check("7b: sem segredo de sessao -- nenhum token anexado (nao finge sucesso)", r.token === undefined, JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
