// Harness Node pra verificarPosseOS (Frente E, Opcao C, Diretriz v1.1) --
// checagem de posse aplicada em iniciarOS/encerrarOS/salvarArquivoOS/
// confirmarSegurancaPreExecucao/salvarSelfieEPI. Mesmo padrao: codigo
// real via vm, sheets fake em memoria.
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

function runScenario(osHeaders, osRows, extraSheets) {
  const sheets = Object.assign({ Ordens_Servico: makeSheet(osHeaders, osRows) }, extraSheets || {});
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
      formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(11, 19),
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

const OS_HEADERS_COM_DONO = ["OS_ID", "ID_Tecnico", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca", "Hora_Inicio", "Status_Atual", "Em_Pausa_Agora", "Selfie_URL", "EPI_Checklist_OK", "EPI_Checklist_JSON", "Diario_Tecnico", "Diario_Preenchido"];
const OS_HEADERS_SEM_COLUNA = ["OS_ID", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca", "Hora_Inicio", "Status_Atual"];

// ============================================================
// 1) iniciarOSComGeo -- tecnico dono da OS -> aceita
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_COM_DONO, [["OS-1", "TEC-1", "Nao iniciada", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-1", "TEC-1", "Fulano", "Local", -19, -43, "op-1", "DEV-1");
  check("1a: tecnico dono consegue iniciar a OS", !r.erro, JSON.stringify(r));
}

// ============================================================
// 2) iniciarOSComGeo -- tecnico DIFERENTE do dono -> recusa
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_COM_DONO, [["OS-2", "TEC-1", "Nao iniciada", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-2", "TEC-INTRUSO", "Fulano", "Local", -19, -43, "op-2", "DEV-1");
  check("2a: tecnico que NAO e dono da OS e recusado", !!r.erro && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("2b: Status_Atual NAO foi alterado (OS continua intocada)", dump[1][dump[0].indexOf("Status_Atual")] === "");
}

// ============================================================
// 3) encerrarOS (via encerrarOSComKM) -- dono aceita, intruso recusa
// ============================================================
{
  // Checklist_Execucao_Completo=true fixo aqui -- este teste prova posse
  // (Frente E), nao o 5o motivo de canCloseOS (testado a parte).
  const HEADERS_COM_EXEC = OS_HEADERS_COM_DONO.concat(["Checklist_Execucao_Completo"]);
  const { sandbox } = runScenario(HEADERS_COM_EXEC, [["OS-3", "TEC-1", "Em Andamento", "https://x/f1.jpg;https://x/f2.jpg", "url-laudo", "url-assinatura", "Liberado", "", "", "", "", "", "", "", "", true]]);
  const rIntruso = sandbox.encerrarOSComKM("OS-3", "TEC-INTRUSO", "Fulano", {}, null, null, "op-3a", "DEV-1");
  check("3a: intruso recusado ao tentar encerrar", rIntruso.sucesso === false && /posse/.test(rIntruso.erro), JSON.stringify(rIntruso));

  const rDono = sandbox.encerrarOSComKM("OS-3", "TEC-1", "Fulano", { fotosURL: "https://x/f1.jpg;https://x/f2.jpg" }, null, null, "op-3b", "DEV-1");
  check("3b: dono consegue encerrar normalmente", rDono.sucesso === true, JSON.stringify(rDono));
}

// ============================================================
// 4) salvarArquivoOS -- intruso nao consegue subir laudo/assinatura
//    em nome de outro tecnico, e nao cria arquivo no Drive
// ============================================================
{
  const { sandbox, driveMock } = runScenario(OS_HEADERS_COM_DONO, [["OS-4", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const base64Fake = Buffer.from("x").toString("base64");
  const r = sandbox.salvarArquivoOS("OS-4", "TEC-INTRUSO", "Laudo_URL", base64Fake, "image/jpeg", "l.jpg", "op-4", "DEV-1");
  check("4a: salvarArquivoOS recusa tecnico que nao e dono", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  check("4b: nenhum arquivo foi criado no Drive (recusado antes do upload)", driveMock.arquivosCriados.length === 0);
}

// ============================================================
// 5) confirmarSegurancaPreExecucao -- intruso recusado, Estado_Seguranca
//    nao gravado
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_COM_DONO, [["OS-5", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const confirmacoes = { epi: true, aterramento: true, bloqueio_energia: true, sinalizacao_area: true };
  const r = sandbox.confirmarSegurancaPreExecucao("OS-5", "TEC-INTRUSO", confirmacoes, false, "op-5", "DEV-1");
  check("5a: confirmarSegurancaPreExecucao recusa tecnico que nao e dono", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("5b: Estado_Seguranca NAO foi gravado", dump[1][dump[0].indexOf("Estado_Seguranca")] === "");
}

// ============================================================
// 6) salvarSelfieEPI -- intruso recusado, nada gravado
// ============================================================
{
  const { sandbox, sheets, driveMock } = runScenario(OS_HEADERS_COM_DONO, [["OS-6", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const base64Fake = Buffer.from("selfie").toString("base64");
  const r = sandbox.salvarSelfieEPI("OS-6", "TEC-INTRUSO", base64Fake, "image/jpeg", { capacete: true }, "diario", "op-6", "DEV-1");
  check("6a: salvarSelfieEPI recusa tecnico que nao e dono", r.sucesso === false && /posse/.test(r.erro), JSON.stringify(r));
  check("6b: nenhum arquivo criado no Drive", driveMock.arquivosCriados.length === 0);
  const dump = sheets.Ordens_Servico._dump();
  check("6c: Selfie_URL NAO foi gravada", dump[1][dump[0].indexOf("Selfie_URL")] === "");
}

// ============================================================
// 7) OS inexistente -- recusa com motivo, independente de quem chama
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_COM_DONO, [["OS-7", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-NAO-EXISTE", "TEC-1", "Fulano", "Local", -19, -43, "op-7", "DEV-1");
  check("7a: OS inexistente recusada com motivo claro", !!r.erro && /OS nao encontrada/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 8) FAIL-CLOSED (auditor, ajuste 2 -- substitui a decisao anterior de
//    fail-open): planilha AINDA SEM a coluna ID_Tecnico bloqueia a
//    escrita, nao autoriza. "Nao consigo determinar posse" nunca pode
//    significar "deixa passar" em producao.
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_SEM_COLUNA, [["OS-8", "Em Andamento", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-8", "QUALQUER-TEC", "Fulano", "Local", -19, -43, "op-8", "DEV-1");
  check("8a: sem coluna ID_Tecnico ainda, BLOQUEIA (fail-closed)", !!r.erro && /posse/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 9) coluna existe mas vazia (OS sem tecnico atribuido) -- NAO e
//    fail-open, continua bloqueando (so string vazia == string vazia
//    aceitaria; tecnicoId real nunca bate com "")
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_COM_DONO, [["OS-9", "", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]]);
  const r = sandbox.iniciarOSComGeo("OS-9", "TEC-1", "Fulano", "Local", -19, -43, "op-9", "DEV-1");
  check("9a: OS com ID_Tecnico vazio na planilha bloqueia tecnicoId nao-vazio", !!r.erro && /posse/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 10) salvarResposta -- achado do cross-check do plano de deploy
// (13/08): faltava posse aqui. Intruso recusado, nada gravado em
// Checklist_Respostas.
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_COM_DONO,
    [["OS-10", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]],
    { Checklist_Respostas: makeSheet(
        ["ID_OS", "IDSharePoint_OS", "Pergunta_ID", "Texto_Pergunta", "Resposta_Dada", "Foto_URL", "Tecnico", "Timestamp", "Gerou_NC", "Sincronizado"], []
      ) }
  );
  const r = sandbox.salvarResposta("OS-10", "", "P1", "EPI OK?", "Sim", "", "Fulano", false, "op-10", "DEV-1", "TEC-INTRUSO");
  check("10a: salvarResposta recusa tecnicoId que nao e dono da OS", r.success === false && /posse/.test(r.erro), JSON.stringify(r));
  check("10b: nenhuma linha gravada em Checklist_Respostas", sheets.Checklist_Respostas._dump().length === 1, "linhas=" + (sheets.Checklist_Respostas._dump().length - 1));

  const rDono = sandbox.salvarResposta("OS-10", "", "P1", "EPI OK?", "Sim", "", "Fulano", false, "op-10b", "DEV-1", "TEC-1");
  check("10c: dono consegue gravar normalmente", rDono.success === true, JSON.stringify(rDono));
}

// ============================================================
// 11) registrarKMFinalPendente -- mesmo achado. Intruso recusado,
// KM_Final_OS nao gravado.
// ============================================================
{
  const HEADERS_KM = OS_HEADERS_COM_DONO.concat(["KM_Inicial_OS", "KM_Final_OS"]);
  const { sandbox, sheets } = runScenario(HEADERS_KM,
    [["OS-11", "TEC-1", "Concluída", "", "", "", "", "", "", "", "", "", "", "", "", 1000, ""]]
  );
  const r = sandbox.registrarKMFinalPendente("OS-11", "TEC-INTRUSO", "1003", "", "", "op-11", "DEV-1");
  check("11a: registrarKMFinalPendente recusa tecnico que nao e dono", r.success === false && /posse/.test(r.erro), JSON.stringify(r));
  const dump = sheets.Ordens_Servico._dump();
  check("11b: KM_Final_OS NAO foi gravado", dump[1][dump[0].indexOf("KM_Final_OS")] === "", JSON.stringify(dump[1]));

  const rDono = sandbox.registrarKMFinalPendente("OS-11", "TEC-1", "1003", "", "", "op-11b", "DEV-1");
  check("11c: dono consegue gravar normalmente", rDono.success === true, JSON.stringify(rDono));
}

// ============================================================
// 12) salvarResposta via executarAcao (API.js) -- achado real: os testes
// acima chamam sandbox.salvarResposta() DIRETO, contornando o
// dispatcher. O case 'salvarResposta' no API.js so repassava p[0]..p[9]
// (esqueceu p[10]=tecnicoId quando o parametro foi adicionado) -- toda
// chamada REAL via HTTP perderia o tecnicoId no meio do caminho e seria
// recusada por posse mesmo vindo do dono legitimo. Fail-closed protegeu
// contra o sintoma errado (bloqueou todo mundo, nao so intrusos), mas o
// bug so aparece testando o caminho que o frontend realmente usa.
// ============================================================
{
  const { sandbox, sheets } = runScenario(OS_HEADERS_COM_DONO,
    [["OS-12", "TEC-1", "Em Andamento", "", "", "", "", "", "", "", "", "", "", "", ""]],
    { Checklist_Respostas: makeSheet(
        ["ID_OS", "IDSharePoint_OS", "Pergunta_ID", "Texto_Pergunta", "Resposta_Dada", "Foto_URL", "Tecnico", "Timestamp", "Gerou_NC", "Sincronizado"], []
      ) }
  );
  const r = sandbox.executarAcao('salvarResposta', ["OS-12", "", "P1", "EPI OK?", "Sim", "", "Fulano", false, "op-12", "DEV-1", "TEC-1"]);
  check("12a: dono consegue gravar via executarAcao (dispatcher repassa tecnicoId=p[10])", r.success === true, JSON.stringify(r));

  const rIntruso = sandbox.executarAcao('salvarResposta', ["OS-12", "", "P1", "EPI OK?", "Sim", "", "Fulano", false, "op-12b", "DEV-1", "TEC-INTRUSO"]);
  check("12b: intruso recusado via executarAcao", rIntruso.success === false && /posse/.test(rIntruso.erro), JSON.stringify(rIntruso));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
