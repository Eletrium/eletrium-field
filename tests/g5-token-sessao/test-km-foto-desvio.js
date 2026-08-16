// Harness Node pra KM_Foto_Desvio_URL liberado em salvarArquivoOS
// (CONTRATO-BACKEND-FOTO-DESVIO-KM.md, sessao de frontend). Confere o
// estado ATUAL (antes/depois do contrato) + regressao de Laudo/Assinatura.
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
  const pastas = {};
  function novaFolder(nome) {
    if (pastas[nome]) return pastas[nome];
    const subpastas = {};
    const folder = {
      getFoldersByName: (n) => {
        const achou = subpastas[n];
        let usado = false;
        return { hasNext: () => !usado && !!achou, next: () => { usado = true; return achou; } };
      },
      createFolder: (n) => { const f = novaFolder("sub:" + nome + ":" + n); subpastas[n] = f; return f; },
      createFile: (blob) => {
        const arquivo = { _blob: blob, setSharing: () => {}, getUrl: () => "https://drive.google.com/file/d/fake-" + arquivosCriados.length };
        arquivosCriados.push({ nome: blob.getName ? blob.getName() : "arquivo", pasta: nome });
        return arquivo;
      },
    };
    pastas[nome] = folder;
    return folder;
  }
  return {
    DriveApp: {
      getFileById: () => ({ getParents: () => ({ hasNext: () => true, next: () => novaFolder("raiz") }) }),
      getRootFolder: () => novaFolder("raiz"),
      Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
      Permission: { VIEW: "VIEW" },
    },
    arquivosCriados,
  };
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
            sheets[name] = s;
            return s;
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

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Laudo_URL", "Assinatura_URL", "KM_Foto_Desvio_URL", "KM_Justificativa_Desvio"];

// ============================================================
// 1) KM_Foto_Desvio_URL agora aceito -- grava com sucesso
// ============================================================
{
  const { sandbox, sheets, driveMock } = runScenario(OS_HEADERS, [["OS-1", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const base64Fake = Buffer.from("foto do odometro").toString("base64");
  const r = sandbox.salvarArquivoOS("OS-1", "TEC-1", "KM_Foto_Desvio_URL", base64Fake, "image/jpeg", "odometro.jpg", "op-1", "DEV-1");
  check("1a: KM_Foto_Desvio_URL aceito (nao recusa mais)", r.sucesso === true, JSON.stringify(r));
  check("1b: URL devolvida aponta pro Drive", /drive\.google\.com/.test(r.url));
  const dump = sheets.Ordens_Servico._dump();
  check("1c: KM_Foto_Desvio_URL gravado na planilha", dump[1][dump[0].indexOf("KM_Foto_Desvio_URL")] === r.url);
  check("1d: arquivo foi criado no Drive mock", driveMock.arquivosCriados.length === 1);
}

// ============================================================
// 2) idempotencia -- retry com mesma operation_id nao sobe 2o arquivo
// ============================================================
{
  const { sandbox, driveMock } = runScenario(OS_HEADERS, [["OS-2", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const base64Fake = Buffer.from("foto").toString("base64");
  const r1 = sandbox.salvarArquivoOS("OS-2", "TEC-1", "KM_Foto_Desvio_URL", base64Fake, "image/jpeg", "o.jpg", "op-2", "DEV-1");
  const r2 = sandbox.salvarArquivoOS("OS-2", "TEC-1", "KM_Foto_Desvio_URL", base64Fake, "image/jpeg", "o.jpg", "op-2", "DEV-1");
  check("2a: retry com mesma operation_id NAO cria 2o arquivo", driveMock.arquivosCriados.length === 1, "arquivos=" + driveMock.arquivosCriados.length);
  check("2b: retry devolve a MESMA URL", r1.url === r2.url);
}

// ============================================================
// 3) regressao -- Laudo_URL/Assinatura_URL continuam funcionando
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-3", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const base64Fake = Buffer.from("x").toString("base64");
  const rLaudo = sandbox.salvarArquivoOS("OS-3", "TEC-1", "Laudo_URL", base64Fake, "image/jpeg", "l.jpg", "op-3a", "DEV-1");
  const rAssin = sandbox.salvarArquivoOS("OS-3", "TEC-1", "Assinatura_URL", base64Fake, "image/jpeg", "a.jpg", "op-3b", "DEV-1");
  check("3a: Laudo_URL continua aceito (sem regressao)", rLaudo.sucesso === true);
  check("3b: Assinatura_URL continua aceito (sem regressao)", rAssin.sucesso === true);
  const dump = sheets.Ordens_Servico._dump();
  check("3c: Laudo_URL gravado", dump[1][dump[0].indexOf("Laudo_URL")] === rLaudo.url);
  check("3d: Assinatura_URL gravado", dump[1][dump[0].indexOf("Assinatura_URL")] === rAssin.url);
}

// ============================================================
// 4) campo ainda fora da allow-list continua recusado (negativo)
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-4", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const r = sandbox.salvarArquivoOS("OS-4", "TEC-1", "Status", "YWJj", "image/jpeg", "x.jpg", "op-4", "DEV-1");
  check("4a: campo fora da lista continua recusado", r.sucesso === false && /nao permitido/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 5) integracao -- registrarKMFinalPendente aceita a foto que veio de
//    salvarArquivoOS como fotoDesvioUrl (fluxo real ponta a ponta)
// ============================================================
{
  const osHeadersKM = OS_HEADERS.concat(["KM_Inicial_OS", "KM_Final_OS"]);
  const { sandbox } = runScenario(osHeadersKM, [["OS-5", "TEC-1", "Concluída", "", "", "", "", "100", ""]]);
  const base64Fake = Buffer.from("odometro final").toString("base64");
  const upload = sandbox.salvarArquivoOS("OS-5", "TEC-1", "KM_Foto_Desvio_URL", base64Fake, "image/jpeg", "final.jpg", "op-5a", "DEV-1");
  check("5a: upload da foto de desvio funciona", upload.sucesso === true, JSON.stringify(upload));

  // desvio de 20km (> limiar de 5km) -- exige foto + texto, ambos agora disponiveis
  const r = sandbox.registrarKMFinalPendente("OS-5", "TEC-1", 120, "Rota alternativa por obra na via principal", upload.url, "op-5b", "DEV-1");
  check("5b: registrarKMFinalPendente aceita com a foto real recem enviada", r.sucesso !== false && !r.exigeJustificativa, JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
