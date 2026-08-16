// Harness Node pra FIELD_API_CONTRACT / getFieldApiContract (Seção 19,
// CONTRATO-BACKEND-FIELD-API-CONTRACT.md, sessão de frontend). Leitura
// publica de metadado, sem parametro, sem posse -- mesmo padrao dos
// outros testes: codigo real via vm.
const fs = require("fs");
const vm = require("vm");

const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

function makeSandbox() {
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: { openById() { return { getSheetByName: () => null }; } },
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
// 1) getFieldApiContract() direto -- devolve o valor atual da constante.
// ============================================================
{
  const sandbox = makeSandbox();
  const r = sandbox.getFieldApiContract();
  check("1a: devolve field_api_contract = 'v1' (valor atual da constante)", r.field_api_contract === 'v1', JSON.stringify(r));
}

// ============================================================
// 2) via executarAcao (API.js) -- exatamente o caminho que o frontend
// real usa no boot (mesma disciplina do achado do dispatcher em
// salvarResposta: testar so a funcao direto nao pega erro de dispatch).
// ============================================================
{
  const sandbox = makeSandbox();
  const r = sandbox.executarAcao('getFieldApiContract', []);
  check("2a: dispatcher expõe a acao e devolve o formato esperado pelo frontend", r.field_api_contract === 'v1', JSON.stringify(r));
}

// ============================================================
// 3) sem parametro nenhum -- chamando com params undefined/vazio nao
// quebra (o frontend chama sem argumentos).
// ============================================================
{
  const sandbox = makeSandbox();
  const r = sandbox.executarAcao('getFieldApiContract', undefined);
  check("3a: funciona mesmo sem array de params", r.field_api_contract === 'v1', JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
