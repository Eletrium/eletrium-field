// Harness Node pra 5 achados red-team da Cowork 2 (14/08) sobre
// canCloseOS/encerrarOS/fecharFaseChecklist. Cada cenario abaixo
// confirma (com codigo real, nao suposicao) se o achado e' um bug real
// ou nao -- 2 sao bugs reais e corrigidos aqui (TOCTOU em encerrarOS,
// fotos duplicadas contadas 2x, pergunta obrigatoria inalcancavel em
// ramo condicional), 2 sao confirmados como NAO-bug (fotosURL=[] vs
// omitido, Checklist_Execucao_Completo nunca fica inconsistente).
// Mesmo padrao dos outros: codigo real via vm, sheets fake em memoria.
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

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Laudo_URL", "Assinatura_URL",
  "Estado_Seguranca", "Checklist_Execucao_Completo", "Fotos_Evidencia",
  "Hora_Inicio", "Hora_Encerramento", "Horas_Produtivas", "Em_Pausa_Agora",
  "Hora_Ultima_Retomada", "Meta_Dia", "Status_Atual", "Qtd_Realizada",
  "Pct_Acumulado", "Obs_Campo", "Materiais_Dia", "Ocorrencias_Dia",
  "Proximo_Passo", "Nao_Conformidade", "Data_Conclusao"];

const PERG_HEADERS = ['ID_Pergunta', 'Disciplina', 'Nivel', 'Texto_Pergunta', 'Tipo_Resposta',
  'Pergunta_Pai', 'Condicao_Exibicao', 'Foto_Obrigatoria', 'Ordem', 'Ativo',
  'Fase_Execucao', 'Obrigatoria'];
const RESP_HEADERS = ['ID_OS', 'IDSharePoint_OS', 'Pergunta_ID', 'Texto_Pergunta',
  'Resposta_Dada', 'Foto_URL', 'Tecnico', 'Timestamp', 'Gerou_NC', 'Sincronizado'];

function runScenario(osRows, extraSheets, opts) {
  opts = opts || {};
  const sheets = Object.assign({
    Ordens_Servico: makeSheet(OS_HEADERS, osRows || []),
    OS_Segmentos: makeSheet(
      ['ID', 'OS_ID', 'IDSharePoint', 'Tecnico_ID', 'Tecnico_Nome', 'Tipo', 'Timestamp', 'Dur_Min', 'Horas_Acum', 'Lat', 'Lng', 'Ativo', 'Local'], []
    ),
    Diaria_Tecnico: makeSheet(
      ["Data", "Tecnico_ID", "Tecnico_Nome", "Hora_Entrada", "Hora_Saida", "Horas_Produtivas",
       "Horas_Pausadas", "Total_Horas", "Qtd_OS", "OS_Lista", "Clientes_Atendidos",
       "Qtd_Interrupcoes", "Status_Dia", "Custo_MO_Total", "IDSharePoint"], []
    ),
  }, extraSheets || {});

  const sandbox = {
    SHEET_ID: "fake", TZ: "GMT-3",
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
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid",
      formatDate: (d, tz, fmt) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10),
    },
    // LockService com hook opcional -- pra simular a interleaving real
    // (uma chamada concorrente completando ENTRE o precheck sem-lock e a
    // trava nova) sem precisar de concorrencia de verdade (Node e'
    // single-threaded). opts.aoTravar roda DENTRO de tryLock(), ANTES de
    // devolver true -- exatamente o ponto onde uma 2a execucao "real"
    // teria tido chance de terminar o proprio fechamento.
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (opts.aoTravar) { opts.aoTravar(); opts.aoTravar = null; } return true; },
        releaseLock: () => {},
      }),
    },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

const OS_PRONTA_PRA_FECHAR = ["OS-1", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
  "Liberado", true, "https://x/f1.jpg,https://x/f2.jpg",
  new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];

// ============================================================
// ACHADO 1 -- TOCTOU em encerrarOS. CONFIRMADO BUG REAL, corrigido.
// ============================================================
{
  // 1a) caminho normal (sem interleaving) -- continua funcionando,
  // fecha 1x, 1 segmento, sem regressao da correcao.
  const { sandbox, sheets } = runScenario([OS_PRONTA_PRA_FECHAR.slice()]);
  const r = sandbox.encerrarOS("OS-1", "TEC-1", "Fulano", { fotosURL: "https://x/f1.jpg,https://x/f2.jpg", qtdRealizada: 0, pctAcumulado: 100 });
  check("1a: fechamento normal continua funcionando", r.sucesso === true, JSON.stringify(r));
  check("1a-seg: exatamente 1 segmento de Encerramento gravado", sheets.OS_Segmentos._dump().length === 2, JSON.stringify(sheets.OS_Segmentos._dump()));

  // 1b) interleaving simulado: o precheck (canCloseOS, sem lock, dentro
  // de encerrarOS) le Status='Em Andamento' e libera -- mas ENTRE esse
  // precheck e a trava nova, uma "chamada concorrente" fecha a OS por
  // fora (simulado via aoTravar, disparado dentro de tryLock()). Sem a
  // correcao, encerrarOS prosseguiria e duplicaria registrarSegmento/
  // atualizarDiaria. Com a correcao, a trava re-le Status DENTRO do
  // lock, ve 'Concluída', e recusa -- sem tocar segmento/diaria de novo.
  const osRow2 = ["OS-2", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
    "Liberado", true, "https://x/f1.jpg,https://x/f2.jpg",
    new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];
  let sheets2;
  const cenario2 = runScenario([osRow2], null, {
    aoTravar: () => {
      // simula a OUTRA chamada concorrente ja tendo fechado a OS
      const idxStatus = OS_HEADERS.indexOf("Status");
      sheets2.Ordens_Servico.getRange(2, idxStatus + 1).setValue("Concluída");
    },
  });
  sheets2 = cenario2.sheets;
  const r2 = cenario2.sandbox.encerrarOS("OS-2", "TEC-1", "Fulano", { fotosURL: "https://x/f1.jpg,https://x/f2.jpg", qtdRealizada: 0, pctAcumulado: 100 });
  check("1b: interleaving detectado, chamada recusada (nao duplica fechamento)", r2.sucesso === false && /Concluída/.test(JSON.stringify(r2.blockingReasons || r2.motivos)), JSON.stringify(r2));
  check("1b-seg: NENHUM segmento gravado por esta chamada (a 'outra' concorrente e' quem fecharia de verdade, fora deste teste)", sheets2.OS_Segmentos._dump().length === 1, JSON.stringify(sheets2.OS_Segmentos._dump()));
  check("1b-diaria: Diaria_Tecnico NAO foi tocada por esta chamada", sheets2.Diaria_Tecnico._dump().length === 1, JSON.stringify(sheets2.Diaria_Tecnico._dump()));
}

// ============================================================
// ACHADO 2 -- fotosURL=[] explicito vs. omitido. CONFIRMADO NAO-BUG:
// o codigo usa `!== undefined` (nao truthiness), distingue os dois
// corretamente, e contarFotosEvidencia trata ambos como 0 fotos.
// ============================================================
{
  const { sandbox } = runScenario([OS_PRONTA_PRA_FECHAR.slice()]);
  check("2a: contarFotosEvidencia([]) === 0 (array vazio NAO e tratado como truthy-com-fotos)", sandbox.contarFotosEvidencia([]) === 0);
  check("2b: contarFotosEvidencia(undefined) === 0", sandbox.contarFotosEvidencia(undefined) === 0);
  check("2c: contarFotosEvidencia('') === 0", sandbox.contarFotosEvidencia('') === 0);

  // dadosPendentes.fotosURL=[] EXPLICITO -- canCloseOS usa o array vazio
  // (nao cai pro fallback de ler a planilha), fotos=0, bloqueia.
  const rExplicito = sandbox.canCloseOS("OS-1", { fotosURL: [] });
  check("2d: fotosURL=[] explicito -- canCloseOS conta 0 fotos e bloqueia por fotos", !rExplicito.allowed && rExplicito.blockingReasons.some(m => /fotos de evidencia \(0 de 2/.test(m)), JSON.stringify(rExplicito));

  // dadosPendentes OMITIDO -- cai pro fallback de LER a planilha (que
  // tem 2 fotos reais na OS-1), libera por fotos.
  const rOmitido = sandbox.canCloseOS("OS-1", undefined);
  check("2e: dadosPendentes omitido -- cai pro fallback (le a planilha, 2 fotos reais, libera por fotos)", !rOmitido.blockingReasons.some(m => /fotos de evidencia/.test(m)), JSON.stringify(rOmitido));
}

// ============================================================
// ACHADO 3 -- fotos duplicadas contadas 2x. CONFIRMADO BUG REAL,
// corrigido (dedupe via Set antes de contar).
// ============================================================
{
  const osRowX = ["OS-X", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
    "Liberado", true, "", new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];
  const { sandbox } = runScenario([osRowX]);
  check("3a: mesma URL 2x conta como 1 foto UNICA, nao 2", sandbox.contarFotosEvidencia("https://x/f1.jpg,https://x/f1.jpg") === 1);
  check("3b: 2 URLs DIFERENTES ainda contam como 2 (nao quebrou o caso normal)", sandbox.contarFotosEvidencia("https://x/f1.jpg,https://x/f2.jpg") === 2);
  check("3c: 3 ocorrencias mas so 2 URLs unicas -> conta 2", sandbox.contarFotosEvidencia("https://x/f1.jpg,https://x/f2.jpg,https://x/f1.jpg") === 2);

  // canCloseOS: URL duplicada 2x NAO satisfaz mais o piso de 2 (antes
  // do fix, satisfazia).
  const r = sandbox.canCloseOS("OS-X", { fotosURL: "https://x/unica.jpg,https://x/unica.jpg" });
  check("3d: canCloseOS bloqueia com URL duplicada 2x (so 1 foto real)", r.blockingReasons.some(m => /fotos de evidencia \(1 de 2/.test(m)), JSON.stringify(r));
}

// ============================================================
// ACHADO 4 -- Checklist_Execucao_Completo pode ficar "inconsistente"
// se respostas completas mas fase nunca fechada? CONFIRMADO NAO-BUG:
// so e' escrito por fecharFaseChecklist, nunca inferido de respostas.
// consultarFaseChecklist le a MESMA coluna, sem logica propria --
// impossivel divergir.
// ============================================================
{
  const PERGUNTAS_EXEC = [
    ["P1", "Eletrica", 1, "Torque conferido?", "sim_nao", "", "", false, 1, true, "Execução", true],
    ["P2", "Eletrica", 1, "Isolamento testado?", "sim_nao", "", "", false, 2, true, "Execução", true],
  ];
  const RESPOSTAS_TODAS_DADAS = [
    ["OS-4", "", "P1", "Torque conferido?", "Sim", "", "TEC-1", new Date(), false, false],
    ["OS-4", "", "P2", "Isolamento testado?", "Sim", "", "TEC-1", new Date(), false, false],
  ];
  const osRow = ["OS-4", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
    "Liberado", "", "https://x/f1.jpg,https://x/f2.jpg",
    new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];
  const { sandbox, sheets } = runScenario([osRow], {
    Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_EXEC),
    Checklist_Respostas: makeSheet(RESP_HEADERS, RESPOSTAS_TODAS_DADAS),
  });

  // Respostas 100% completas em Checklist_Respostas, mas
  // fecharFaseChecklist('Execução') NUNCA foi chamado.
  const dump = sheets.Ordens_Servico._dump();
  const idxExec = OS_HEADERS.indexOf("Checklist_Execucao_Completo");
  check("4a: Checklist_Execucao_Completo continua vazio (nao inferido das respostas)", dump[1][idxExec] === "", JSON.stringify(dump[1]));

  const checkClose = sandbox.canCloseOS("OS-4", {});
  check("4b: canCloseOS ainda bloqueia pelo 5o motivo (fase nunca fechada, mesmo com respostas completas)", checkClose.blockingReasons.some(m => /checklist de execucao completo/.test(m)), JSON.stringify(checkClose));

  const consulta = sandbox.consultarFaseChecklist("OS-4");
  check("4c: consultarFaseChecklist reflete o MESMO estado (false) -- fonte unica, sem divergencia possivel", consulta.execucaoCompleta === false, JSON.stringify(consulta));

  // Agora fecha a fase de verdade -- confirma que o caminho POSITIVO
  // continua funcionando (nao e' regressao, so estava faltando o passo).
  const fechar = sandbox.fecharFaseChecklist("OS-4", "TEC-1", "Execução", "op-4", "DEV-1");
  check("4d: com fecharFaseChecklist chamado explicitamente, agora sim fecha", fechar.sucesso === true, JSON.stringify(fechar));
  const dump2 = sheets.Ordens_Servico._dump();
  check("4e: Checklist_Execucao_Completo agora true, canCloseOS libera esse motivo", dump2[1][idxExec] === true);
}

// ============================================================
// ACHADO 5 -- pergunta obrigatoria em ramo condicional mutuamente
// exclusivo (N3_TIPO/N4_* do motor CHKV2) trava PERMANENTEMENTE.
// CONFIRMADO BUG REAL ESTRUTURAL, corrigido (_perguntaAlcancavel).
// ============================================================
{
  // Arvore: N3_TIPO (raiz, obrigatoria) escolhe 1 de 2 ramos. Cada ramo
  // tem 1 pergunta filha TAMBEM obrigatoria -- exatamente o padrao do
  // motor CHKV2 real (N3_TIPO -> N4_REAP_*/N4_LIMP_*/etc, cada ramo
  // com Condicao_Exibicao diferente).
  const PERGUNTAS_RAMIFICADAS = [
    ["N3_TIPO", "", 1, "Tipo de Servico", "Unica", "", "", false, 1, true, "Execução", true],
    ["N4_RAMO_A", "", 2, "Pergunta do ramo A", "Unica", "N3_TIPO", "Ramo A", false, 1, true, "Execução", true],
    ["N4_RAMO_B", "", 2, "Pergunta do ramo B", "Unica", "N3_TIPO", "Ramo B", false, 2, true, "Execução", true],
  ];
  const osRow = ["OS-5", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
    "Liberado", "", "https://x/f1.jpg,https://x/f2.jpg",
    new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];

  // 5a) tecnico responde N3_TIPO='Ramo A' e N4_RAMO_A (o caminho
  // COMPLETO do ramo escolhido) -- N4_RAMO_B nunca foi (nem podia ser)
  // alcancado. ANTES da correcao, isso travava pra sempre (N4_RAMO_B
  // sempre "faltando"). Depois da correcao, fecha normalmente.
  {
    const respostas = [
      ["OS-5", "", "N3_TIPO", "Tipo de Servico", "Ramo A", "", "TEC-1", new Date(), false, false],
      ["OS-5", "", "N4_RAMO_A", "Pergunta do ramo A", "Sim", "", "TEC-1", new Date(), false, false],
    ];
    const { sandbox, sheets } = runScenario([osRow.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_RAMIFICADAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostas),
    });
    const r = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Execução", "op-5a", "DEV-1");
    check("5a: ramo A completo (N3_TIPO+N4_RAMO_A) fecha -- N4_RAMO_B (inalcancavel) NAO bloqueia", r.sucesso === true, JSON.stringify(r));
    const dump = sheets.Ordens_Servico._dump();
    check("5a-col: Checklist_Execucao_Completo gravado true", dump[1][OS_HEADERS.indexOf("Checklist_Execucao_Completo")] === true);
  }

  // 5b) mesmo cenario mas escolhendo o Ramo B -- prova que nao e' so
  // "ramo A sempre passa" hardcoded, os dois ramos funcionam
  // simetricamente.
  {
    const respostas = [
      ["OS-5", "", "N3_TIPO", "Tipo de Servico", "Ramo B", "", "TEC-1", new Date(), false, false],
      ["OS-5", "", "N4_RAMO_B", "Pergunta do ramo B", "Sim", "", "TEC-1", new Date(), false, false],
    ];
    const { sandbox } = runScenario([osRow.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_RAMIFICADAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostas),
    });
    const r = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Execução", "op-5b", "DEV-1");
    check("5b: ramo B completo tambem fecha (simetria, nao hardcoded pro ramo A)", r.sucesso === true, JSON.stringify(r));
  }

  // 5c) FAIL-CLOSED preservado: se o tecnico escolheu o Ramo A mas NAO
  // respondeu N4_RAMO_A (a pergunta DELE, genuinamente alcancavel e
  // obrigatoria), ainda tem que bloquear -- a correcao nao pode virar
  // fail-open geral.
  {
    const respostas = [
      ["OS-5", "", "N3_TIPO", "Tipo de Servico", "Ramo A", "", "TEC-1", new Date(), false, false],
      // N4_RAMO_A nao respondida
    ];
    const { sandbox } = runScenario([osRow.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_RAMIFICADAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostas),
    });
    const r = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Execução", "op-5c", "DEV-1");
    check("5c: N4_RAMO_A (alcancavel, obrigatoria, NAO respondida) ainda bloqueia -- fail-closed preservado", r.sucesso === false && Array.isArray(r.faltando) && r.faltando.includes("N4_RAMO_A") && !r.faltando.includes("N4_RAMO_B"), JSON.stringify(r));
  }

  // 5d) nem N3_TIPO foi respondida -- nada e' alcancavel alem da propria
  // raiz, bloqueia pela raiz mesmo (comportamento anterior preservado
  // pra perguntas SEM pai).
  {
    const { sandbox } = runScenario([osRow.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_RAMIFICADAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, []),
    });
    const r = sandbox.fecharFaseChecklist("OS-5", "TEC-1", "Execução", "op-5d", "DEV-1");
    check("5d: nada respondido -- bloqueia so pela raiz (N3_TIPO), ramos filhos nao contam (inalcancaveis)", r.sucesso === false && r.faltando.length === 1 && r.faltando[0] === "N3_TIPO", JSON.stringify(r));
  }

  // 5e) GENERICIDADE (pergunta da Cowork 2, 15/08): o fix e' pontual pro
  // caso N3_TIPO/N4_* encontrado, ou protege qualquer ramo futuro,
  // inclusive mais profundo que 1 nivel? Arvore de 3 NIVEIS (raiz ->
  // filho -> NETO), com 3 ramos na raiz (nao so 2) -- prova que
  // _perguntaAlcancavel nao esta hardcoded pro formato do bug original,
  // e' generico via recursao (Codigo.js: "return _perguntaAlcancavel
  // (paiId, ...)" sobe a cadeia INTEIRA, nao so 1 nivel).
  {
    const PERGUNTAS_PROFUNDAS = [
      ["RAIZ", "", 1, "Tipo", "Unica", "", "", false, 1, true, "Execução", true],
      ["FILHO_A", "", 2, "Ramo A", "Unica", "RAIZ", "A", false, 1, true, "Execução", true],
      ["FILHO_B", "", 2, "Ramo B", "Unica", "RAIZ", "B", false, 2, true, "Execução", true],
      ["FILHO_C", "", 2, "Ramo C", "Unica", "RAIZ", "C", false, 3, true, "Execução", true],
      // NETO -- 3o nivel, so alcancavel se RAIZ='C' E FILHO_C='SubC'.
      ["NETO_C", "", 3, "Sub-ramo C", "Unica", "FILHO_C", "SubC", false, 1, true, "Execução", true],
    ];
    const osRowProf = ["OS-5B", "TEC-1", "Em Andamento", "url-laudo", "url-assinatura",
      "Liberado", "", "https://x/f1.jpg,https://x/f2.jpg",
      new Date(), "", 0, false, "", 0, "", 0, 0, "", "", "", "", false, ""];

    // caminho completo: RAIZ='C' -> FILHO_C='SubC' -> NETO_C respondido.
    // FILHO_A/FILHO_B (outros ramos da raiz) nunca respondidos --
    // corretamente inalcancaveis, nao devem bloquear.
    const respostasCompletas = [
      ["OS-5B", "", "RAIZ", "Tipo", "C", "", "TEC-1", new Date(), false, false],
      ["OS-5B", "", "FILHO_C", "Ramo C", "SubC", "", "TEC-1", new Date(), false, false],
      ["OS-5B", "", "NETO_C", "Sub-ramo C", "Sim", "", "TEC-1", new Date(), false, false],
    ];
    const { sandbox: sb1 } = runScenario([osRowProf.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_PROFUNDAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostasCompletas),
    });
    const r1 = sb1.fecharFaseChecklist("OS-5B", "TEC-1", "Execução", "op-5e-1", "DEV-1");
    check("5e-1: arvore de 3 NIVEIS -- caminho completo (RAIZ->FILHO_C->NETO_C) fecha, FILHO_A/B (outros ramos) nao bloqueiam", r1.sucesso === true, JSON.stringify(r1));

    // caminho incompleto: RAIZ='C' -> FILHO_C='SubC' respondido, mas
    // NETO_C (obrigatoria, genuinamente alcancavel) NAO respondida --
    // tem que bloquear, especificamente por NETO_C.
    const respostasIncompletas = [
      ["OS-5B", "", "RAIZ", "Tipo", "C", "", "TEC-1", new Date(), false, false],
      ["OS-5B", "", "FILHO_C", "Ramo C", "SubC", "", "TEC-1", new Date(), false, false],
    ];
    const { sandbox: sb2 } = runScenario([osRowProf.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_PROFUNDAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostasIncompletas),
    });
    const r2 = sb2.fecharFaseChecklist("OS-5B", "TEC-1", "Execução", "op-5e-2", "DEV-1");
    check("5e-2: NETO_C (3o nivel, alcancavel, obrigatoria, nao respondida) bloqueia especificamente -- fail-closed em profundidade arbitraria", r2.sucesso === false && r2.faltando.length === 1 && r2.faltando[0] === "NETO_C", JSON.stringify(r2));

    // caminho que nunca abre o ramo C: RAIZ='A' -- NETO_C (dependente de
    // FILHO_C, que por sua vez depende de RAIZ='C') fica inalcancavel
    // TRANSITIVAMENTE (nem FILHO_C nem NETO_C deveriam bloquear).
    const respostasRamoA = [
      ["OS-5B", "", "RAIZ", "Tipo", "A", "", "TEC-1", new Date(), false, false],
      ["OS-5B", "", "FILHO_A", "Ramo A", "Sim", "", "TEC-1", new Date(), false, false],
    ];
    const { sandbox: sb3 } = runScenario([osRowProf.slice()], {
      Perguntas_Checklist: makeSheet(PERG_HEADERS, PERGUNTAS_PROFUNDAS),
      Checklist_Respostas: makeSheet(RESP_HEADERS, respostasRamoA),
    });
    const r3 = sb3.fecharFaseChecklist("OS-5B", "TEC-1", "Execução", "op-5e-3", "DEV-1");
    check("5e-3: ramo A completo fecha -- FILHO_C e NETO_C (2 niveis abaixo de um ramo nao escolhido) inalcancaveis TRANSITIVAMENTE, nao so o filho direto", r3.sucesso === true, JSON.stringify(r3));
  }
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
