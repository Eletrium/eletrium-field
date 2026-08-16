// Harness Node pra salvarArquivoOS / confirmarSegurancaPreExecucao /
// consultarStatusOperacao (Frente B, fatia prioritaria — Laudo_URL /
// Assinatura_URL / Estado_Seguranca). Mesmo padrao: codigo real via vm,
// sheets fake em memoria, agora com DriveApp tambem mockado.
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
  const pastas = {}; // nome -> pasta fake
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
        const arquivo = {
          _blob: blob,
          setSharing: () => {},
          getUrl: () => "https://drive.google.com/file/d/fake-" + arquivosCriados.length,
        };
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

function runScenario(osHeaders, osRows, opts) {
  opts = opts || {};
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

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca"];

// ============================================================
// 1) salvarArquivoOS — positivo: grava URL na coluna certa
// ============================================================
{
  const { sandbox, sheets, driveMock } = runScenario(OS_HEADERS, [["OS-1", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const base64Fake = Buffer.from("conteudo fake de imagem").toString("base64");
  const r = sandbox.salvarArquivoOS("OS-1", "TEC-1", "Laudo_URL", base64Fake, "image/jpeg", "laudo.jpg", "op-1", "DEV-1");
  check("1a: salvarArquivoOS grava com sucesso", r.sucesso === true, JSON.stringify(r));
  check("1b: URL devolvida aponta pro Drive", /drive\.google\.com/.test(r.url));
  const dump = sheets.Ordens_Servico._dump();
  const h = dump[0];
  check("1c: Laudo_URL gravado na planilha com a URL certa", dump[1][h.indexOf("Laudo_URL")] === r.url);
  check("1d: arquivo foi criado no Drive mock", driveMock.arquivosCriados.length === 1);
}

// ============================================================
// 2) salvarArquivoOS — campo não permitido é recusado
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-2", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const r = sandbox.salvarArquivoOS("OS-2", "TEC-1", "Status", "YWJj", "image/jpeg", "x.jpg", "op-2", "DEV-1");
  check("2a: campo fora da lista permitida é recusado", r.sucesso === false && /nao permitido/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 3) salvarArquivoOS — idempotência: 2a chamada com mesma operation_id
//    não cria um 2o arquivo no Drive.
// ============================================================
{
  const { sandbox, driveMock } = runScenario(OS_HEADERS, [["OS-3", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const base64Fake = Buffer.from("foto").toString("base64");
  const r1 = sandbox.salvarArquivoOS("OS-3", "TEC-1", "Assinatura_URL", base64Fake, "image/jpeg", "a.jpg", "op-3", "DEV-1");
  const r2 = sandbox.salvarArquivoOS("OS-3", "TEC-1", "Assinatura_URL", base64Fake, "image/jpeg", "a.jpg", "op-3", "DEV-1");
  check("3a: retry com mesma operation_id NAO cria 2o arquivo no Drive", driveMock.arquivosCriados.length === 1, "arquivos=" + driveMock.arquivosCriados.length);
  check("3b: retry devolve a MESMA URL", r1.url === r2.url);
}

// ============================================================
// 4) confirmarSegurancaPreExecucao — positivo: tudo confirmado, sem NC
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-4", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const confirmacoes = { epi: true, aterramento: true, bloqueio_energia: true, sinalizacao_area: true };
  const r = sandbox.confirmarSegurancaPreExecucao("OS-4", "TEC-1", confirmacoes, false, "op-4", "DEV-1");
  check("4a: tudo confirmado sem NC -> Liberado", r.sucesso === true && r.estado === "Liberado", JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("4b: Estado_Seguranca gravado como Liberado", dump[1][dump[0].indexOf("Estado_Seguranca")] === "Liberado");
}

// ============================================================
// 5) confirmarSegurancaPreExecucao — com NC -> Bloqueado (mesmo com
//    todas as confirmacoes marcadas)
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-5", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const confirmacoes = { epi: true, aterramento: true, bloqueio_energia: true, sinalizacao_area: true };
  const r = sandbox.confirmarSegurancaPreExecucao("OS-5", "TEC-1", confirmacoes, true, "op-5", "DEV-1");
  check("5a: com nao-conformidade -> Bloqueado mesmo com tudo confirmado", r.sucesso === true && r.estado === "Bloqueado", JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("5b: Estado_Seguranca gravado como Bloqueado", dump[1][dump[0].indexOf("Estado_Seguranca")] === "Bloqueado");
}

// ============================================================
// 6) confirmarSegurancaPreExecucao — negativo: confirmacao faltando
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS, [["OS-6", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const confirmacoes = { epi: true, aterramento: true, bloqueio_energia: false, sinalizacao_area: true };
  const r = sandbox.confirmarSegurancaPreExecucao("OS-6", "TEC-1", confirmacoes, false, "op-6", "DEV-1");
  check("6a: confirmacao faltando -> recusa", r.sucesso === false, JSON.stringify(r));
  check("6b: motivo cita qual confirmacao falta", Array.isArray(r.faltando) && r.faltando.includes("bloqueio_energia"));
  const dump = sheets.Ordens_Servico._dump();
  check("6c: Estado_Seguranca NAO foi gravado quando recusado", dump[1][dump[0].indexOf("Estado_Seguranca")] === "");
}

// ============================================================
// 7) integração: canCloseOS libera de verdade depois que os 3 campos
//    da Frente B sao preenchidos via salvarArquivoOS+confirmarSeguranca
//    (prova de que a fatia prioritaria destrava o gate da Frente C).
// ============================================================
{
  // Checklist_Execucao_Completo=true fixo aqui -- este teste prova o gate
  // da Frente B (laudo/assinatura/seguranca), nao o 5o motivo (checklist
  // 3 fases, testado a parte em test-checklist-3-fases.js).
  const HEADERS_COM_EXEC = OS_HEADERS.concat(["Checklist_Execucao_Completo"]);
  const { sandbox } = runScenario(HEADERS_COM_EXEC, [["OS-7", "TEC-1", "Em Andamento", "", "", "", "", true]]);
  const antes = sandbox.canCloseOS("OS-7");
  check("7a: antes de preencher nada, canCloseOS ainda bloqueia (fotos + os 3 campos vazios)", antes.allowed === false);

  const base64Fake = Buffer.from("x").toString("base64");
  sandbox.salvarArquivoOS("OS-7", "TEC-1", "Laudo_URL", base64Fake, "image/jpeg", "l.jpg", "op-7a", "DEV-1");
  sandbox.salvarArquivoOS("OS-7", "TEC-1", "Assinatura_URL", base64Fake, "image/jpeg", "a.jpg", "op-7b", "DEV-1");
  sandbox.confirmarSegurancaPreExecucao("OS-7", "TEC-1",
    { epi: true, aterramento: true, bloqueio_energia: true, sinalizacao_area: true }, false, "op-7c", "DEV-1");

  const depois = sandbox.canCloseOS("OS-7", { fotosURL: "https://x/f1.jpg;https://x/f2.jpg" });
  check("7b: depois de preencher os 3 campos + fotos pendentes, canCloseOS libera", depois.allowed === true, JSON.stringify(depois));
}

// ============================================================
// 8) consultarStatusOperacao
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS, [["OS-8", "TEC-1", "Em Andamento", "", "", "", ""]]);
  const semLog = sandbox.consultarStatusOperacao("op-nao-existe");
  check("8a: operation_id nunca visto -> encontrado:false", semLog.encontrado === false);

  const base64Fake = Buffer.from("x").toString("base64");
  sandbox.salvarArquivoOS("OS-8", "TEC-1", "Laudo_URL", base64Fake, "image/jpeg", "l.jpg", "op-8", "DEV-1");
  const comLog = sandbox.consultarStatusOperacao("op-8");
  check("8b: apos processar, status QUEUED (Sheets concluiu -- 1A/reconciliacao que marca SYNCED)", comLog.encontrado === true && comLog.status === "QUEUED", JSON.stringify(comLog));
  check("8c: resultado inclui a URL gravada", comLog.resultado && /drive\.google\.com/.test(comLog.resultado.url));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
