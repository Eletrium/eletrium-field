// Harness Node pra testar hashPin/gerarSalt/validarPinTecnico (Frente E)
// sem depender do runtime real do Apps Script. Carrega os arquivos reais
// (Código.js + API.js) via vm, com SpreadsheetApp/Utilities/Logger mockados.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

// ---- fake sheet: matriz 2D em memória, linha 0 = headers ----
function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    getLastColumn() { return data[0].length; },
    getRange(r, c, numRows, numCols) {
      if (numRows === undefined) {
        // getRange(row, col) — célula única, usado em setValue/getValue
        return {
          setValue(v) { data[r - 1][c - 1] = v; },
          getValue() { return data[r - 1][c - 1]; },
        };
      }
      // getRange(1,1,1,lastCol) — linha de headers
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            out.push(data[r - 1 + i].slice(0, numCols));
          }
          return out;
        },
      };
    },
    getDataRange() {
      return { getValues: () => data.map(row => row.slice()) };
    },
    _dump() { return data; },
  };
}

function computeDigestReal(algo, str) {
  const buf = crypto.createHash("sha256").update(str, "utf8").digest();
  // Apps Script devolve bytes SIGNED (-128..127), não unsigned.
  return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
}

function runScenario(tecSheetHeaders, tecSheetRows) {
  const sheets = { Tecnicos_MEI: makeSheet(tecSheetHeaders, tecSheetRows) };
  const logs = [];
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return { getSheetByName: (name) => sheets[name] || null };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest: (algo, str) => computeDigestReal(algo, str),
      getUuid: () => "uuid-" + Math.random().toString(36).slice(2, 10),
    },
    // Onda 1 do token de sessao (15/08): validarPinTecnico agora chama
    // emitirTokenSessao, que le PropertiesService -- precisa existir no
    // sandbox mesmo sem SESSAO_HMAC_SECRET configurado (mesmo shape de
    // "propriedade ausente" real do Apps Script, nao um bug novo).
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: (...a) => logs.push(a.join(" ")) },
    console,
  };
  vm.createContext(sandbox);
  // só precisamos de hashPin/gerarSalt do Código.js — mas o arquivo
  // inteiro tem que rodar (declarações no topo), então avaliamos tudo.
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheet: sheets.Tecnicos_MEI, logs };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

// ============================================================
// 1) POSITIVO — PIN legado correto migra e valida
// ============================================================
{
  const { sandbox, sheet } = runScenario(
    ["ID_Tecnico", "PIN", "PIN_Hash", "PIN_Salt"],
    [["TEC-1", "4821", "", ""]]
  );
  const r1 = sandbox.validarPinTecnico("TEC-1", "4821");
  check("1a: legado correto -> valido:true", r1.valido === true, JSON.stringify(r1));
  const row = sheet._dump()[1];
  check("1b: PIN legado limpo apos migracao", row[1] === "", "PIN ainda=" + row[1]);
  check("1c: PIN_Hash preenchido apos migracao", !!row[2] && row[2].length === 64, "hash=" + row[2]);
  check("1d: PIN_Salt preenchido apos migracao", !!row[3], "salt=" + row[3]);

  // idempotência: logar de novo com o MESMO pin agora tem que usar o
  // caminho de hash (PIN já foi limpo) e continuar validando certo.
  const r2 = sandbox.validarPinTecnico("TEC-1", "4821");
  check("1e: segundo login pos-migracao ainda valido (consistencia hash)", r2.valido === true, JSON.stringify(r2));
  const row2 = sheet._dump()[1];
  check("1f: nao re-migra (hash nao muda no segundo login)", row2[2] === row[2] && row2[3] === row[3]);
}

// ============================================================
// 2) NEGATIVO — PIN legado errado não migra, não valida
// ============================================================
{
  const { sandbox, sheet } = runScenario(
    ["ID_Tecnico", "PIN", "PIN_Hash", "PIN_Salt"],
    [["TEC-2", "1111", "", ""]]
  );
  const r = sandbox.validarPinTecnico("TEC-2", "9999");
  check("2a: legado errado -> valido:false", r.valido === false, JSON.stringify(r));
  const row = sheet._dump()[1];
  check("2b: PIN legado NAO foi limpo (nao migrou em tentativa errada)", row[1] === "1111", "PIN=" + row[1]);
  check("2c: PIN_Hash continua vazio (nao migrou em tentativa errada)", row[2] === "", "hash=" + row[2]);
}

// ============================================================
// 3) POSITIVO — técnico já migrado (só hash, sem PIN legado)
// ============================================================
{
  const salt = "salt-fixo-teste";
  const hash = computeDigestReal("SHA_256", salt + ":2468")
    .map(b => ("0" + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join("");
  const { sandbox } = runScenario(
    ["ID_Tecnico", "PIN", "PIN_Hash", "PIN_Salt"],
    [["TEC-3", "", hash, salt]]
  );
  const rOk = sandbox.validarPinTecnico("TEC-3", "2468");
  check("3a: ja migrado, pin certo -> valido:true", rOk.valido === true, JSON.stringify(rOk));
  const rBad = sandbox.validarPinTecnico("TEC-3", "0000");
  check("3b: ja migrado, pin errado -> valido:false", rBad.valido === false, JSON.stringify(rBad));
}

// ============================================================
// 4) EDGE — técnico sem PIN configurado (nem legado nem hash)
// ============================================================
{
  const { sandbox } = runScenario(
    ["ID_Tecnico", "PIN", "PIN_Hash", "PIN_Salt"],
    [["TEC-4", "", "", ""]]
  );
  const r = sandbox.validarPinTecnico("TEC-4", "1234");
  check("4a: sem PIN configurado -> valido:false com erro", r.valido === false && /nao cadastrado/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 5) EDGE — técnico inexistente
// ============================================================
{
  const { sandbox } = runScenario(
    ["ID_Tecnico", "PIN", "PIN_Hash", "PIN_Salt"],
    [["TEC-5", "1234", "", ""]]
  );
  const r = sandbox.validarPinTecnico("TEC-NAO-EXISTE", "1234");
  check("5a: tecnico inexistente -> valido:false com erro", r.valido === false && /nao encontrado/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 6) COMPATIBILIDADE — planilha sem colunas PIN_Hash/PIN_Salt ainda
//    (setupSheets nao rodou) continua funcionando no modo legado puro,
//    sem quebrar (so nao migra, porque idxHash/idxSalt = -1).
// ============================================================
{
  const { sandbox, sheet } = runScenario(
    ["ID_Tecnico", "PIN"],
    [["TEC-6", "5555"]]
  );
  const r = sandbox.validarPinTecnico("TEC-6", "5555");
  check("6a: sem colunas de hash ainda -> continua validando pelo legado", r.valido === true, JSON.stringify(r));
  const row = sheet._dump()[1];
  check("6b: sem colunas de hash, nao tenta migrar (nao quebra)", row[1] === "5555");
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
