// Harness Node pra canCloseOS + encerrarOS (Frente C, Diretriz v1.1).
// Mesmo padrao do test-pin-hash.js: carrega os arquivos REAIS via vm,
// com SpreadsheetApp/Utilities/Logger mockados e um sheet fake em memoria.
const fs = require("fs");
const vm = require("vm");

const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

function makeSheet(headers, rows) {
  const data = [headers.slice(), ...rows.map(r => r.slice())];
  return {
    getLastColumn() { return data[0].length; },
    getRange(r, c, numRows, numCols) {
      if (numRows === undefined) {
        return { setValue(v) { data[r - 1][c - 1] = v; }, getValue() { return data[r - 1][c - 1]; } };
      }
      return { getValues() {
        const out = [];
        for (let i = 0; i < numRows; i++) out.push(data[r - 1 + i].slice(0, numCols));
        return out;
      } };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    _dump() { return data; },
  };
}

function runScenario(osHeaders, osRows) {
  const sheets = { Ordens_Servico: makeSheet(osHeaders, osRows) };
  const logs = [];
  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: { openById() { return { getSheetByName: (name) => sheets[name] || null }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid",
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: (...a) => logs.push(a.join(" ")) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheet: sheets.Ordens_Servico, logs };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

const OS_HEADERS_HOJE = ["OS_ID", "Status", "Fotos_Evidencia"];
// Checklist_Execucao_Completo (5o motivo, CONTRATO-BACKEND-CHECKLIST-3-FASES.md)
// incluido aqui como coluna existente+true -- cenarios desta secao testam os
// 4 motivos ORIGINAIS da Frente C, nao o novo; sem a coluna, o novo motivo
// (fail-closed) bloquearia todo mundo e mascararia o que cada teste quer provar.
const OS_HEADERS_POS_FRENTE_B = ["OS_ID", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca", "Checklist_Execucao_Completo"];

// ============================================================
// 1) ESTADO ATUAL (sem Laudo/Assinatura/Estado_Seguranca no schema):
//    canCloseOS SEMPRE bloqueia, com motivo explicito de "coluna nao existe".
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_HOJE, [["OS-1", "Em Andamento", ""]]);
  const r = sandbox.canCloseOS("OS-1");
  check("1a: schema atual -> allowed:false", r.allowed === false);
  check("1b: motivo de laudo cita 'escopo da Frente B'", r.blockingReasons.some(m => m.includes("Laudo_URL") && m.includes("Frente B")));
  check("1c: motivo de assinatura cita 'escopo da Frente B'", r.blockingReasons.some(m => m.includes("Assinatura_URL") && m.includes("Frente B")));
  check("1d: motivo de seguranca cita 'escopo da Frente B'", r.blockingReasons.some(m => m.includes("Estado_Seguranca") && m.includes("Frente B")));
  check("1e: motivo de fotos aparece (0 de 2)", r.blockingReasons.some(m => m.includes("0 de 2")));
}

// ============================================================
// 2) POSITIVO — simulando pós-Frente-B: todas as colunas existem e
//    estao satisfeitas -> allowed:true, sem motivos.
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_POS_FRENTE_B, [
    ["OS-2", "Em Andamento", "https://x/f1.jpg;https://x/f2.jpg", "https://x/laudo.pdf", "https://x/assin.png", "Liberado", true],
  ]);
  const r = sandbox.canCloseOS("OS-2");
  check("2a: tudo preenchido -> allowed:true", r.allowed === true, JSON.stringify(r));
  check("2b: nenhum motivo de bloqueio", r.blockingReasons.length === 0);
}

// ============================================================
// 3) NEGATIVO — pós-Frente-B mas faltando 1 item de cada vez
// ============================================================
{
  const base = ["OS-3", "Em Andamento", "https://x/f1.jpg;https://x/f2.jpg", "https://x/laudo.pdf", "https://x/assin.png", "Liberado", true];
  const semLaudo = base.slice(); semLaudo[3] = "";
  const { sandbox: s1 } = runScenario(OS_HEADERS_POS_FRENTE_B, [semLaudo]);
  check("3a: sem laudo -> bloqueia so por laudo", !s1.canCloseOS("OS-3").allowed && s1.canCloseOS("OS-3").blockingReasons.length === 1);

  const semAssin = base.slice(); semAssin[4] = "";
  const { sandbox: s2 } = runScenario(OS_HEADERS_POS_FRENTE_B, [semAssin]);
  check("3b: sem assinatura -> bloqueia so por assinatura", !s2.canCloseOS("OS-3").allowed && s2.canCloseOS("OS-3").blockingReasons.length === 1);

  const semSeg = base.slice(); semSeg[5] = "Pendente";
  const { sandbox: s3 } = runScenario(OS_HEADERS_POS_FRENTE_B, [semSeg]);
  const r3 = s3.canCloseOS("OS-3");
  check("3c: seguranca Pendente -> bloqueia so por seguranca", !r3.allowed && r3.blockingReasons.length === 1 && r3.blockingReasons[0].includes("Pendente"));

  const poucaFoto = base.slice(); poucaFoto[2] = "https://x/f1.jpg";
  const { sandbox: s4 } = runScenario(OS_HEADERS_POS_FRENTE_B, [poucaFoto]);
  const r4 = s4.canCloseOS("OS-3");
  check("3d: so 1 foto -> bloqueia so por fotos (1 de 2)", !r4.allowed && r4.blockingReasons.length === 1 && r4.blockingReasons[0].includes("1 de 2"));
}

// ============================================================
// 4) EDGE — OS inexistente / OS ja concluida
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_POS_FRENTE_B, [
    ["OS-4", "Concluída", "https://x/f1.jpg;https://x/f2.jpg", "https://x/l.pdf", "https://x/a.png", "Liberado", true],
  ]);
  const rNaoExiste = sandbox.canCloseOS("OS-NAO-EXISTE");
  check("4a: OS inexistente -> allowed:false com motivo claro", !rNaoExiste.allowed && /nao encontrada/.test(rNaoExiste.blockingReasons[0]));
  const rConcluida = sandbox.canCloseOS("OS-4");
  check("4b: OS ja Concluída -> allowed:false mesmo com tudo preenchido", !rConcluida.allowed && rConcluida.blockingReasons.some(m => m.includes("ja esta")));
}

// ============================================================
// 5) FOTOS PENDENTES — a distinção crítica: Fotos_Evidencia só é
//    gravada por encerrarOS (não existe upload incremental hoje). O
//    precheck do FRONTEND (sem 2º parametro) tem que ver o que já
//    está salvo; a checagem INTERNA de encerrarOS tem que ver o que
//    está prestes a ser gravado nesta mesma chamada.
// ============================================================
{
  const { sandbox } = runScenario(OS_HEADERS_POS_FRENTE_B, [
    ["OS-5", "Em Andamento", "", "https://x/l.pdf", "https://x/a.png", "Liberado", true],
  ]);
  const semPend = sandbox.canCloseOS("OS-5");
  check("5a: sem 2o parametro, fotos vazias na planilha -> bloqueia por fotos", !semPend.allowed && semPend.blockingReasons.some(m => m.includes("0 de 2")));

  const comPend = sandbox.canCloseOS("OS-5", { fotosURL: "https://x/nova1.jpg;https://x/nova2.jpg" });
  check("5b: com fotosURL pendente (2 fotos) -> libera mesmo com planilha vazia", comPend.allowed === true, JSON.stringify(comPend));
}

// ============================================================
// 6) INTEGRAÇÃO — encerrarOS recusa a escrita quando bloqueado, e
//    grava de verdade quando tudo esta ok (incluindo fotos desta
//    própria chamada).
// ============================================================
{
  // 6a: bloqueado (schema de hoje, sem Laudo/Assinatura/Seguranca)
  const { sandbox: sBlk, sheet: shBlk } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status", "Fotos_Evidencia", "Hora_Encerramento", "Em_Pausa_Agora", "Horas_Produtivas"],
    [["OS-6", "TEC-1", "Em Andamento", "", "", false, 0]]
  );
  const rBlk = sBlk.encerrarOS("OS-6", "TEC-1", "Fulano", { fotosURL: "https://x/f1.jpg;https://x/f2.jpg" });
  check("6a: encerrarOS recusa quando canCloseOS bloqueia", rBlk.sucesso === false && Array.isArray(rBlk.blockingReasons) && rBlk.blockingReasons.length > 0, JSON.stringify(rBlk));
  const rowBlk = shBlk._dump()[1];
  const idxStatusBlk = shBlk._dump()[0].indexOf("Status");
  check("6b: Status NAO foi alterado quando recusado", rowBlk[idxStatusBlk] === "Em Andamento", "Status=" + rowBlk[idxStatusBlk]);

  // 6b: liberado (schema pós-Frente-B, tudo preenchido + fotos desta chamada)
  const { sandbox: sOk, sheet: shOk } = runScenario(
    ["OS_ID", "ID_Tecnico", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca",
     "Checklist_Execucao_Completo",
     "Hora_Encerramento", "Em_Pausa_Agora", "Horas_Produtivas", "Status_Atual", "Qtd_Realizada",
     "Pct_Acumulado", "Obs_Campo", "Materiais_Dia", "Ocorrencias_Dia", "Proximo_Passo", "Nao_Conformidade"],
    [["OS-7", "TEC-1", "Em Andamento", "", "https://x/l.pdf", "https://x/a.png", "Liberado", true, "", false, 0, "", 0, 0, "", "", "", "", false]]
  );
  const rOk = sOk.encerrarOS("OS-7", "TEC-1", "Fulano", { fotosURL: "https://x/f1.jpg;https://x/f2.jpg", pctAcumulado: 100 });
  check("6c: encerrarOS aceita e grava quando canCloseOS libera", rOk.sucesso === true, JSON.stringify(rOk));
  const dump = shOk._dump();
  const h = dump[0], row = dump[1];
  check("6d: Status gravado como Concluída", row[h.indexOf("Status")] === "Concluída");
  check("6e: Fotos_Evidencia gravada com as 2 fotos desta chamada", row[h.indexOf("Fotos_Evidencia")] === "https://x/f1.jpg;https://x/f2.jpg");
}

// ============================================================
// 7) 5o MOTIVO (Checklist_Execucao_Completo, CONTRATO-BACKEND-
//    CHECKLIST-3-FASES.md item 3) -- isolado, mesmo padrao da secao 3.
//    Gap de cobertura apontado pela Cowork 2: as secoes 2-6 sempre
//    neutralizam este motivo (coluna=true) pra isolar os outros 4;
//    nenhum cenario ate agora provava que ELE bloqueia sozinho.
// ============================================================
{
  const base = ["OS-8", "Em Andamento", "https://x/f1.jpg;https://x/f2.jpg", "https://x/laudo.pdf", "https://x/assin.png", "Liberado", true];

  const semColChecklist = ["OS_ID", "Status", "Fotos_Evidencia", "Laudo_URL", "Assinatura_URL", "Estado_Seguranca"];
  const { sandbox: s5 } = runScenario(semColChecklist, [base.slice(0, 6)]);
  const r5 = s5.canCloseOS("OS-8");
  check("7a: coluna Checklist_Execucao_Completo ausente -> bloqueia so por ela (coluna nao existe)",
    !r5.allowed && r5.blockingReasons.length === 1 &&
    r5.blockingReasons[0].includes("Checklist_Execucao_Completo") && r5.blockingReasons[0].includes("coluna ainda nao existe"),
    JSON.stringify(r5));

  const naoFechada = base.slice(); naoFechada[6] = false;
  const { sandbox: s6 } = runScenario(OS_HEADERS_POS_FRENTE_B, [naoFechada]);
  const r6 = s6.canCloseOS("OS-8");
  check("7b: Checklist_Execucao_Completo=false -> bloqueia so por ela (fase execucao nao fechada)",
    !r6.allowed && r6.blockingReasons.length === 1 && r6.blockingReasons[0].includes("fase de execucao ainda nao foi fechada"),
    JSON.stringify(r6));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
