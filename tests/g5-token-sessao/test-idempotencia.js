// Harness Node pra executarIdempotente/Log_Central + integração com
// encerrarOSComKM (Frente D, Diretriz v1.1). Mesmo padrao dos outros:
// código real via vm, sheets fake em memória.
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
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) {
              while (data.length < r - 1 + i + 1) data.push([]);
              data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        },
        // stubs pra formatacao/validacao real do Log_Central (spec
        // Geovane/Cowork 2) -- so-op no mock, o que importa e nao quebrar.
        setFontWeight() { return this; },
        setNumberFormat() { return this; },
        setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    appendRow(arr) { data.push(arr.slice()); },
    setFrozenRows() {},
    setColumnWidth() {},
    insertSheet_marker: false,
    _dump() { return data; },
  };
}

function makeDataValidationBuilder() {
  const b = {
    requireValueInList() { return b; },
    requireFormulaSatisfied() { return b; },
    setAllowInvalid() { return b; },
    build() { return {}; },
  };
  return b;
}

function runScenario(osHeaders, osRows, opts) {
  opts = opts || {};
  const sheets = { Ordens_Servico: makeSheet(osHeaders, osRows) };
  if (opts.comLogCentral) sheets.Log_Central = makeSheet(
    ['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
     'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
     'status', 'tentativas', 'erro_detalhe', 'resultado_json'], []
  );
  const insertedSheets = [];
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
            insertedSheets.push(name);
            return s;
          },
        };
      },
      newDataValidation: makeDataValidationBuilder,
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid",
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets, insertedSheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

// ============================================================
// 1) executarIdempotente isolado — sem depender de encerrarOS
// ============================================================
{
  const { sandbox } = runScenario(["OS_ID", "Status"], [["OS-1", "Em Andamento"]]);
  let chamadas = 0;
  const fn = () => { chamadas++; return { valor: chamadas }; };

  const r1 = sandbox.executarIdempotente("op-A", "TESTE", "OS-1", "TEC-1", "DEV-1", fn);
  check("1a: primeira chamada executa fn()", chamadas === 1 && r1.valor === 1);

  const r2 = sandbox.executarIdempotente("op-A", "TESTE", "OS-1", "TEC-1", "DEV-1", fn);
  check("1b: mesma operation_id NAO reexecuta fn()", chamadas === 1, "chamadas=" + chamadas);
  check("1c: mesma operation_id devolve o MESMO resultado gravado", r2.valor === 1, JSON.stringify(r2));

  const r3 = sandbox.executarIdempotente("op-B", "TESTE", "OS-1", "TEC-1", "DEV-1", fn);
  check("1d: operation_id DIFERENTE executa de novo", chamadas === 2 && r3.valor === 2);
}

// ============================================================
// 2) sem operationId — comportamento antigo preservado, sem Log_Central
// ============================================================
{
  const { sandbox, sheets } = runScenario(["OS_ID", "Status"], [["OS-2", "Em Andamento"]]);
  let chamadas = 0;
  const fn = () => { chamadas++; return { ok: true }; };
  sandbox.executarIdempotente(null, "TESTE", "OS-2", "TEC-1", "DEV-1", fn);
  sandbox.executarIdempotente(undefined, "TESTE", "OS-2", "TEC-1", "DEV-1", fn);
  check("2a: sem operationId, executa toda vez (sem dedup)", chamadas === 2);
  check("2b: Log_Central nem chega a ser criado sem operationId", !sheets.Log_Central);
}

// ============================================================
// 3) erro em fn() -> SYNC_ERROR. FECHADO (revisao de integracao, mesmo
//    dia): retry com o MESMO operation_id PRECISA reexecutar fn() de
//    verdade quando fn() nunca completou (sem resultado_json gravado) --
//    e exatamente o que o outbox do frontend faz no backoff automatico
//    (reenvia com o MESMO operationId, esperando que uma nova tentativa
//    RODE de novo). Só quando ja existe resultado_json (mutacao
//    PROVADAMENTE completa) e que o retry NAO reexecuta -- ver T-LOG-09
//    (test-outbox-log-central.js) pra esse outro caso.
// ============================================================
{
  const { sandbox, sheets } = runScenario(["OS_ID", "Status"], [["OS-3", "Em Andamento"]]);
  let tentativa = 0;
  const fnFalhaUmaVez = () => {
    tentativa++;
    if (tentativa === 1) throw new Error("falha simulada de rede");
    return { ok: true, tentativa };
  };

  // Contrato canonico (auditor, ajuste 1): erro de fn() NAO lanca mais
  // excecao pro chamador -- devolve o envelope {success:false,
  // status:'SYNC_ERROR', retryable:true, ...} de volta, sempre.
  const r1 = sandbox.executarIdempotente("op-C", "TESTE", "OS-3", "TEC-1", "DEV-1", fnFalhaUmaVez);
  check("3a: erro na 1a tentativa devolve envelope canonico (nao lanca excecao)", r1.success === false && r1.status === "SYNC_ERROR" && r1.retryable === true && /falha simulada/.test(r1.erro), JSON.stringify(r1));

  const dump = sheets.Log_Central._dump();
  const h = dump[0];
  const linha = dump.find(r => r[h.indexOf("operation_id")] === "op-C");
  check("3b: status gravado como SYNC_ERROR apos falha", linha[h.indexOf("status")] === "SYNC_ERROR");
  check("3c: erro_detalhe gravado", /falha simulada/.test(linha[h.indexOf("erro_detalhe")]));

  // MESMA operation_id de novo (exatamente o que o backoff do outbox faz)
  // -- REEXECUTA fn() de verdade, ja que fn() nunca completou na 1a
  // tentativa (sem resultado_json pra devolver).
  const r2 = sandbox.executarIdempotente("op-C", "TESTE", "OS-3", "TEC-1", "DEV-1", fnFalhaUmaVez);
  check("3d: retry com MESMA operation_id REEXECUTA fn()", tentativa === 2, "tentativa=" + tentativa);
  check("3e: retry com MESMA operation_id devolve o resultado de fn() (nao um erro generico)", r2.success === true && r2.ok === true && r2.tentativa === 2, JSON.stringify(r2));
  const dump2 = sheets.Log_Central._dump();
  const linha2 = dump2.find(r => r[h.indexOf("operation_id")] === "op-C");
  check("3f: status da MESMA linha atualizado pra QUEUED apos o retry ter sucesso (SYNCED e do 1A, nao do Sheets)", linha2[h.indexOf("status")] === "QUEUED");

  // operation_id NOVA -- tambem funciona (independente, nao precisa
  // reusar a mesma pra ter um retry de verdade).
  const r3 = sandbox.executarIdempotente("op-C-retry", "TESTE", "OS-3", "TEC-1", "DEV-1", () => ({ ok: true, novo: true }));
  check("3g: operation_id NOVA tambem funciona normalmente (independente)", r3.success === true && r3.ok === true, JSON.stringify(r3));
  const linha3 = sheets.Log_Central._dump().find(r => r[h.indexOf("operation_id")] === "op-C-retry");
  check("3h: status da nova linha QUEUED", linha3[h.indexOf("status")] === "QUEUED");
}

// ============================================================
// 4) INTEGRAÇÃO — encerrarOSComKM com operation_id: chamar 2x com o
//    MESMO operation_id só grava Status=Concluída UMA vez de verdade
//    (a 2a chamada devolve o resultado cacheado sem tocar a planilha
//    de novo).
// ============================================================
{
  const { sandbox, sheets } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca",
     "Checklist_Execucao_Completo",
     "Hora_Encerramento", "Em_Pausa_Agora", "Horas_Produtivas", "Status_Atual", "Qtd_Realizada",
     "Pct_Acumulado", "Obs_Campo", "Materiais_Dia", "Ocorrencias_Dia", "Proximo_Passo", "Nao_Conformidade"],
    [["OS-4", "TEC-1", "Em Andamento", "", "https://x/l.pdf", "https://x/a.png", "Liberado", true, "", false, 0, "", 0, 0, "", "", "", "", false]],
    { comLogCentral: true }
  );
  const dadosEnc = { fotosURL: "https://x/f1.jpg;https://x/f2.jpg", pctAcumulado: 100 };

  const r1 = sandbox.encerrarOSComKM("OS-4", "TEC-1", "Fulano", dadosEnc, null, null, "op-conclusao-1", "DEV-1");
  check("4a: 1a chamada com operation_id conclui de verdade", r1.sucesso === true, JSON.stringify(r1));
  const statusApos1a = sheets.Ordens_Servico._dump()[1][sheets.Ordens_Servico._dump()[0].indexOf("Status")];
  check("4b: Status gravado Concluída apos 1a chamada", statusApos1a === "Concluída");

  // simula reenvio (retry de rede que na verdade já tinha chegado) com
  // o MESMO operation_id — nao deveria rodar encerrarOS() de novo.
  const r2 = sandbox.encerrarOSComKM("OS-4", "TEC-1", "Fulano", dadosEnc, null, null, "op-conclusao-1", "DEV-1");
  check("4c: retry com mesmo operation_id devolve sucesso (cacheado)", r2.sucesso === true, JSON.stringify(r2));
  check("4d: retry com mesmo operation_id devolve o MESMO resultado", JSON.stringify(r2) === JSON.stringify(r1));

  // prova concreta de que NAO reexecutou: canCloseOS ja bloquearia por
  // "OS ja esta Concluída" na 2a passada SE tivesse tentado rodar de
  // novo por dentro — como o resultado bateu identico ao da 1a chamada
  // (sucesso:true, nao um erro de "ja concluida"), confirma que a 2a
  // chamada nunca chegou a chamar encerrarOS() again.
  const rNovoOpId = sandbox.encerrarOSComKM("OS-4", "TEC-1", "Fulano", dadosEnc, null, null, "op-conclusao-2", "DEV-1");
  check("4e: operation_id DIFERENTE na OS ja concluida -> bloqueia de verdade (canCloseOS pega)",
    rNovoOpId.sucesso === false && /ja esta/.test(JSON.stringify(rNovoOpId.blockingReasons)),
    JSON.stringify(rNovoOpId));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
