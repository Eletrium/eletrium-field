// Harness Node pra salvarSelfieEPI (Frente B, fatia 2). Mesmo padrao
// do test-frente-b-slice1.js.
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

function makeDriveMock() {
  const arquivosCriados = [];
  function novaFolder(nome) {
    const subpastas = {};
    return {
      getFoldersByName: (n) => {
        const achou = subpastas[n]; let usado = false;
        return { hasNext: () => !usado && !!achou, next: () => { usado = true; return achou; } };
      },
      createFolder: (n) => { const f = novaFolder(nome + ":" + n); subpastas[n] = f; return f; },
      createFile: (blob) => {
        const arquivo = { setSharing: () => {}, getUrl: () => "https://drive.google.com/file/d/fake-" + arquivosCriados.length };
        arquivosCriados.push({ nome: blob.getName ? blob.getName() : "arquivo" });
        return arquivo;
      },
    };
  }
  return { DriveApp: {
    getFileById: () => ({ getParents: () => ({ hasNext: () => true, next: () => novaFolder("raiz") }) }),
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" }, Permission: { VIEW: "VIEW" },
  }, arquivosCriados };
}

function runScenario(osHeaders, osRows) {
  const sheets = { Ordens_Servico: makeSheet(osHeaders, osRows) };
  const driveMock = makeDriveMock();
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
            sheets[name] = s; return s;
          },
        };
      },
      newDataValidation: makeDataValidationBuilder,
    },
    DriveApp: driveMock.DriveApp,
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid",
      base64Decode: (s) => Buffer.from(s, "base64"),
      newBlob: (bytes, mime, nome) => ({ getName: () => nome, getMime: () => mime, getBytes: () => bytes }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets, driveMock };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Selfie_URL", "EPI_Checklist_OK", "EPI_Checklist_JSON", "Diario_Tecnico", "Diario_Preenchido"];
const EPI_COMPLETO = { capacete: true, luvas_isolantes: true, oculos_protecao: true, calcado_seguranca: true, cinto_seguranca: true };

// ============================================================
// 1) positivo: selfie + EPI completo + diario -> elegivel financeiro
// ============================================================
{
  const { sandbox, sheets, driveMock } = runScenario(OS_HEADERS, [["OS-1", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const base64 = Buffer.from("foto fake").toString("base64");
  const r = sandbox.salvarSelfieEPI("OS-1", "TEC-1", base64, "image/jpeg", EPI_COMPLETO, "Dia tranquilo, sem intercorrencias", "op-1", "DEV-1");
  check("1a: sucesso", r.sucesso === true, JSON.stringify(r));
  check("1b: epiOk true com checklist completo", r.epiOk === true);
  check("1c: diarioPreenchido true", r.diarioPreenchido === true);
  check("1d: elegivelFinanceiro true (selfie + diario)", r.elegivelFinanceiro === true);
  check("1e: url aponta pro drive", /drive\.google\.com/.test(r.url));
  check("1f: arquivo criado no drive mock", driveMock.arquivosCriados.length === 1);
  const dump = sheets.Ordens_Servico._dump();
  const h = dump[0];
  check("1g: Selfie_URL gravada na planilha", dump[1][h.indexOf("Selfie_URL")] === r.url);
  check("1h: EPI_Checklist_OK gravado true", dump[1][h.indexOf("EPI_Checklist_OK")] === true);
  check("1i: EPI_Checklist_JSON gravado", JSON.parse(dump[1][h.indexOf("EPI_Checklist_JSON")])["capacete"] === true);
  check("1j: Diario_Preenchido gravado true", dump[1][h.indexOf("Diario_Preenchido")] === true);
}

// ============================================================
// 2) EPI incompleto -> epiOk false, mas ainda grava (nao e um gate,
//    so um dado — quem trava pagamento e medicao.html no admin)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-2", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const epiIncompleto = Object.assign({}, EPI_COMPLETO, { luvas_isolantes: false });
  const r = sandbox.salvarSelfieEPI("OS-2", "TEC-1", "", "", epiIncompleto, "diario", "op-2", "DEV-1");
  check("2a: sucesso mesmo com EPI incompleto (nao e recusa)", r.sucesso === true);
  check("2b: epiOk false", r.epiOk === false);
  const dump = sheets.Ordens_Servico._dump();
  check("2c: EPI_Checklist_OK gravado false", dump[1][dump[0].indexOf("EPI_Checklist_OK")] === false);
}

// ============================================================
// 3) sem selfie e sem diario -> elegivelFinanceiro false
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-3", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const r = sandbox.salvarSelfieEPI("OS-3", "TEC-1", "", "", EPI_COMPLETO, "", "op-3", "DEV-1");
  check("3a: sucesso (nao e recusa, so nao fica elegivel ainda)", r.sucesso === true);
  check("3b: elegivelFinanceiro false sem selfie/diario", r.elegivelFinanceiro === false, JSON.stringify(r));
}

// ============================================================
// 4) idempotencia: retry com mesma operation_id nao cria 2o arquivo
// ============================================================
{
  const { sandbox, driveMock } = runScenario(OS_HEADERS, [["OS-4", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const base64 = Buffer.from("foto").toString("base64");
  const r1 = sandbox.salvarSelfieEPI("OS-4", "TEC-1", base64, "image/jpeg", EPI_COMPLETO, "diario", "op-4", "DEV-1");
  const r2 = sandbox.salvarSelfieEPI("OS-4", "TEC-1", base64, "image/jpeg", EPI_COMPLETO, "diario", "op-4", "DEV-1");
  check("4a: retry nao cria 2o arquivo", driveMock.arquivosCriados.length === 1, "arquivos=" + driveMock.arquivosCriados.length);
  check("4b: retry devolve o mesmo resultado", JSON.stringify(r1) === JSON.stringify(r2));
}

// ============================================================
// 5) OS inexistente
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-5", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const r = sandbox.salvarSelfieEPI("OS-NAO-EXISTE", "TEC-1", "", "", EPI_COMPLETO, "diario", "op-5", "DEV-1");
  check("5a: OS inexistente -> recusa com motivo", r.sucesso === false && /nao encontrada/.test(r.erro));
}

// ============================================================
// 6) 2a chamada só atualizando o diário não sobrescreve a selfie já
//    enviada antes (base64Selfie vazio nesta chamada).
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-6", "TEC-1", "Em Andamento", "", "", "", "", ""]]);
  const base64 = Buffer.from("foto").toString("base64");
  sandbox.salvarSelfieEPI("OS-6", "TEC-1", base64, "image/jpeg", EPI_COMPLETO, "", "op-6a", "DEV-1");
  const urlAntes = sheets.Ordens_Servico._dump()[1][sheets.Ordens_Servico._dump()[0].indexOf("Selfie_URL")];
  const r2 = sandbox.salvarSelfieEPI("OS-6", "TEC-1", "", "", EPI_COMPLETO, "agora com diario", "op-6b", "DEV-1");
  check("6a: 2a chamada sem selfie nova preserva a URL da 1a", r2.url === urlAntes, "urlAntes=" + urlAntes + " r2.url=" + r2.url);
  check("6b: elegivelFinanceiro true (selfie da 1a chamada + diario da 2a)", r2.elegivelFinanceiro === true);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
