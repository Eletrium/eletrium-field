// Harness Node pra Log_Central virar Outbox operacional
// (ARQUITETURA-SYNC-LOG-CENTRAL.md, decisao do auditor, pontos 2-4):
// entity_type/entity_id/entity_version, geracao monotonica por OS sob
// LockService, e o cenario explicitamente pedido "entidade alterada +
// Log_Central falhou". Mesmo padrao: codigo real via vm, sheets fake em
// memoria, sem API real.
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
        return {
          setValue(v) {
            if (this._falharEm && this._falharEm(r, c, v)) throw new Error("Sheets indisponivel (simulado)");
            data[r - 1][c - 1] = v;
          },
          getValue() { return data[r - 1][c - 1]; },
        };
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

// Variante instrumentada de getRange que permite injetar falha numa
// coluna especifica (usada no cenario 6, "Log_Central falhou").
function makeSheetComFalhaInjetavel(headers, rows) {
  const s = makeSheet(headers, rows);
  const realGetRange = s.getRange.bind(s);
  let falharNaColuna = null; // {col, apenasUmaVez}
  s._falharNaProximaEscritaDaColuna = (col) => { falharNaColuna = { col, usada: false }; };
  s.getRange = function (r, c, numRows, numCols) {
    if (numRows === undefined && falharNaColuna && falharNaColuna.col === c && !falharNaColuna.usada) {
      falharNaColuna.usada = true;
      return { setValue() { throw new Error("Sheets indisponivel (simulado)"); }, getValue() { return s._dump()[r - 1][c - 1]; } };
    }
    return realGetRange(r, c, numRows, numCols);
  };
  return s;
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

function runScenario(opts) {
  opts = opts || {};
  const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Status_Atual", "Em_Pausa_Agora",
    "Motivo_Pausa_Atual", "Hora_Ultima_Pausa", "Horas_Produtivas", "Qtd_Interrupcoes",
    "Hora_Ultima_Retomada", "Hora_Inicio", "Qtd_Retomadas"];
  const osRows = opts.osRows || [
    ["OS-1", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", "", 0],
    ["OS-2", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", "", 0],
  ];
  const sheets = { Ordens_Servico: makeSheet(OS_HEADERS, osRows) };
  if (opts.comTabelasAppendOnly) {
    sheets.Alocacoes_Ofertas = makeSheet(
      ['Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
       'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'],
      opts.ofertasRows || []
    );
    sheets.Ferramental_Movimentos = makeSheet(
      ['Movimento_ID', 'OS_ID', 'Tecnico_ID', 'Patrimonio_Codigo', 'Tipo_Movimento',
       'Estado_OK', 'Observacao', 'Registrado_Em', 'operation_id'], []
    );
    sheets.Perguntas_Checklist = makeSheet(
      ['ID_Pergunta', 'Disciplina', 'Nivel', 'Texto_Pergunta', 'Tipo_Resposta',
       'Pergunta_Pai', 'Condicao_Exibicao', 'Foto_Obrigatoria', 'Ordem', 'Ativo',
       'Fase_Execucao', 'Obrigatoria'],
      [["P1", "Eletrica", 1, "EPI OK?", "sim_nao", "", "", false, 1, true, "Pré-Execução", true]]
    );
    sheets.Checklist_Respostas = makeSheet(
      ['ID_OS', 'IDSharePoint_OS', 'Pergunta_ID', 'Texto_Pergunta', 'Resposta_Dada',
       'Foto_URL', 'Tecnico', 'Timestamp', 'Gerou_NC', 'Sincronizado'], []
    );
  }
  let logCentralSheet = null;

  const sandbox = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (name) => sheets[name] || null,
          insertSheet: (name) => {
            const headers = ['operation_id', 'OS_ID', 'tecnico_id', 'dispositivo_id', 'tipo_operacao',
              'criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em',
              'status', 'tentativas', 'erro_codigo', 'erro_detalhe', 'resultado_json',
              'entity_type', 'entity_id', 'entity_version'];
            const s = opts.logComFalhaInjetavel ? makeSheetComFalhaInjetavel(headers, []) : makeSheet(headers, []);
            sheets[name] = s;
            if (name === 'Log_Central') logCentralSheet = s;
            return s;
          },
        };
      },
      newDataValidation: makeDataValidationBuilder,
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      formatDate: (d, tz, fmt) => new Date(d).toISOString(),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => (opts.lockIndisponivel ? false : true),
        releaseLock: () => {},
      }),
    },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets, getLogCentral: () => logCentralSheet };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

function linhaLogPorOp(logSheet, operationId) {
  const dump = logSheet._dump();
  const h = dump[0];
  const idx = h.indexOf('operation_id');
  const row = dump.find((r, i) => i > 0 && r[idx] === operationId);
  if (!row) return null;
  const g = (nome) => row[h.indexOf(nome)];
  return { entityType: g('entity_type'), entityId: g('entity_id'), entityVersion: g('entity_version'), status: g('status') };
}

// ============================================================
// 1) entity_type derivado automaticamente de tipo_operacao (sem
//    entidade explicita) -- pausarOS -> APONTAMENTO, entity_id=osId
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();
  sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-1", "DEV-1");
  const linha = linhaLogPorOp(getLogCentral(), "op-1");
  check("1a: entity_type derivado (APONTAMENTO)", linha.entityType === "APONTAMENTO", JSON.stringify(linha));
  check("1b: entity_id default = osId", linha.entityId === "OS-1");
  check("1c: entity_version = 1 (primeira mutacao desta OS)", linha.entityVersion === 1, JSON.stringify(linha));
}

// ============================================================
// 2) segunda operacao DIFERENTE na MESMA OS -> versao 2 (monotonico
//    por OS, nao por tipo de operacao)
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();
  sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-2a", "DEV-1");
  sandbox.retomarOS("OS-1", "TEC-1", "Fulano", "op-2b", "DEV-1");
  const l1 = linhaLogPorOp(getLogCentral(), "op-2a");
  const l2 = linhaLogPorOp(getLogCentral(), "op-2b");
  check("2a: 1a operacao -> versao 1", l1.entityVersion === 1);
  check("2b: 2a operacao (tipo diferente, mesma OS) -> versao 2", l2.entityVersion === 2, JSON.stringify(l2));
}

// ============================================================
// 3) OS DIFERENTE tem contador independente (comeca em 1 de novo)
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();
  sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-3a", "DEV-1");
  sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "Pausa", "", "op-3b", "DEV-1");
  const l1 = linhaLogPorOp(getLogCentral(), "op-3a");
  const l2 = linhaLogPorOp(getLogCentral(), "op-3b");
  check("3a: OS-1 primeira operacao -> versao 1", l1.entityVersion === 1);
  check("3b: OS-2 (OS diferente) tambem comeca em versao 1", l2.entityVersion === 1, JSON.stringify(l2));
}

// ============================================================
// 4) T-LOG-01 -- log criado (Intent Log, LOCAL_PENDING gravado ANTES de
//    fn() rodar), mutacao (fn()) falha. FECHADO (revisao de integracao,
//    mesmo dia): retry com a MESMA operation_id PRECISA reexecutar fn()
//    de verdade -- e exatamente o que processarFilaOffline faz no
//    backoff automatico (reenvia item.params, que ja tem o operationId
//    original). Sem resultado_json (fn() nunca completou), nao ha nada
//    que poderia ser duplicado -- reexecutar e seguro e necessario.
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();
  // 1a chamada: forca fn() a falhar (erro dentro da funcao de escrita) --
  // pausarOS numa OS que EXISTE, mas com o Ordens_Servico "quebrado" de
  // proposito so na 1a tentativa.
  let falhouUmaVez = false;
  const osSheetOriginal = sandbox.SpreadsheetApp.openById().getSheetByName('Ordens_Servico');
  const realGetRange = osSheetOriginal.getRange.bind(osSheetOriginal);
  osSheetOriginal.getRange = function (...args) {
    if (!falhouUmaVez) { falhouUmaVez = true; throw new Error("Falha transitoria simulada (1a tentativa)"); }
    return realGetRange(...args);
  };
  // Contrato canonico (auditor, ajuste 1): erro nao lanca mais excecao,
  // devolve o envelope {success:false, status:'SYNC_ERROR', retryable:true}.
  const r1 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-4", "DEV-1");
  check("4a: 1a tentativa devolve envelope de falha (nao lanca excecao)", r1.success === false && r1.status === "SYNC_ERROR" && r1.retryable === true, JSON.stringify(r1));

  const linhaApos1a = linhaLogPorOp(getLogCentral(), "op-4");
  check("4b: status apos 1a tentativa = SYNC_ERROR", linhaApos1a.status === "SYNC_ERROR", JSON.stringify(linhaApos1a));
  const versaoApos1a = linhaApos1a.entityVersion;

  // MESMA operation_id de novo (sheets ja consertado, exatamente como um
  // backoff real do outbox faria) -- REEXECUTA fn() de verdade e funciona.
  const r2 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-4", "DEV-1");
  check("4c: retry com a MESMA operation_id REEXECUTA e tem sucesso", r2.success === true, JSON.stringify(r2));
  const linhaApos2a = linhaLogPorOp(getLogCentral(), "op-4");
  check("4d: a MESMA linha foi atualizada pra QUEUED (nao criou linha nova; SYNCED e do 1A, nao do Sheets)", linhaApos2a.status === "QUEUED", JSON.stringify(linhaApos2a));
  check("4e: a MESMA linha REUSA a entity_version original (retry da mesma operacao, nao evento novo)", linhaApos2a.entityVersion === versaoApos1a, "antes=" + versaoApos1a + " depois=" + linhaApos2a.entityVersion);
}

// ============================================================
// 5) lock indisponivel -- fn() NAO roda, nada e gravado em Log_Central
// ============================================================
{
  const { sandbox, sheets } = runScenario({ lockIndisponivel: true });
  const osAntes = sheets.Ordens_Servico._dump()[1].slice();
  const r = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-5", "DEV-1");
  check("5a: lock indisponivel -> sucesso:false", r.sucesso === false, JSON.stringify(r));
  check("5b: erro menciona sistema ocupado", /ocupado/i.test(r.erro), JSON.stringify(r));
  const osDepois = sheets.Ordens_Servico._dump()[1];
  check("5c: OS NAO foi alterada (fn() nao rodou)", JSON.stringify(osAntes) === JSON.stringify(osDepois));
  // garantirLogCentral roda ANTES do lock (so cria a estrutura da aba, nao
  // e a operacao em si) -- o que importa e que NENHUMA linha de operacao
  // foi anexada quando o lock nao foi obtido.
  const logDump = sheets.Log_Central ? sheets.Log_Central._dump() : [[]];
  check("5d: nenhuma linha de operacao foi anexada em Log_Central", logDump.length <= 1, "linhas=" + logDump.length);
}

// ============================================================
// 6) T-LOG-02 -- mutacao (fn()) roda com SUCESSO, mas a escrita que
//    marca SYNCED em Log_Central falha logo em seguida. Comportamento
//    NOVO (ajuste 3 do auditor): devolve sucesso pro chamador (a
//    operacao REALMENTE funcionou -- seria desonesto dizer que falhou),
//    mas tenta marcar a linha como SYNC_ERROR (nao deixar presa em
//    LOCAL_PENDING) com um aviso (`log_sync_warning`) pra sinalizar que
//    o registro pode precisar de reconciliacao.
// ============================================================
{
  const { sandbox, sheets, getLogCentral } = runScenario({ logComFalhaInjetavel: true });

  // 1a chamada -- roda normal ate o ponto de gravar SYNCED, que vai falhar.
  // Precisamos que garantirLogCentral ja tenha criado a aba antes de
  // armar a falha (senao a falha pega a criacao da aba tambem).
  sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "Pausa dummy pra criar Log_Central", "", "op-6-setup", "DEV-1");
  const log = getLogCentral();
  const headers = log._dump()[0];
  const idxStatus = headers.indexOf('status');
  log._falharNaProximaEscritaDaColuna(idxStatus + 1); // proxima escrita na coluna 'status' falha

  const r1 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa real", "", "op-6", "DEV-1");
  check("6a: devolve SUCESSO pro chamador (a mutacao realmente funcionou)", r1.success === true, JSON.stringify(r1));
  check("6b: log_sync_warning presente, sinalizando que o registro pode precisar de reconciliacao", typeof r1.log_sync_warning === "string" && r1.log_sync_warning.length > 0, JSON.stringify(r1));

  const osRow = sheets.Ordens_Servico._dump().find(r => r[0] === "OS-1");
  const idxStatusAtual = sheets.Ordens_Servico._dump()[0].indexOf("Status_Atual");
  check("6c: a ENTIDADE REAL foi alterada (fn() rodou e funcionou antes da falha de log)",
    osRow[idxStatusAtual] && osRow[idxStatusAtual].indexOf("Pausada") === 0, JSON.stringify(osRow));

  const linhaLog = linhaLogPorOp(getLogCentral(), "op-6");
  check("6d: a linha NAO fica presa em LOCAL_PENDING -- best-effort marcada SYNC_ERROR pra varredura periodica (ajuste 7) achar", linhaLog.status === "SYNC_ERROR", JSON.stringify(linhaLog));

  // Retry da MESMA operationId depois da falha -- FIX (achado do Geovane,
  // revisao do mesmo dia): resultado_json ja existe nesta linha (gravado
  // no catch de T-LOG-02 mesmo com o status errado), entao o retry
  // reconhece "ja processado" e devolve o CACHED sem rodar fn() de novo.
  const idxQtdInterrupcoes = sheets.Ordens_Servico._dump()[0].indexOf("Qtd_Interrupcoes");
  const qtdAntesDoRetry = sheets.Ordens_Servico._dump().find(r => r[0] === "OS-1")[idxQtdInterrupcoes];
  const r2 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa real", "", "op-6", "DEV-1");
  check("6e: retry com MESMA operationId devolve sucesso (cacheado, nao reexecutado)", r2.success === true, JSON.stringify(r2));
  const qtdDepoisDoRetry = sheets.Ordens_Servico._dump().find(r => r[0] === "OS-1")[idxQtdInterrupcoes];
  check("6f: fn() NAO rodou de novo -- Qtd_Interrupcoes nao mudou (prova de nao-duplicacao)", qtdDepoisDoRetry === qtdAntesDoRetry, "antes=" + qtdAntesDoRetry + " depois=" + qtdDepoisDoRetry);
  const linhaAposRetry = linhaLogPorOp(getLogCentral(), "op-6");
  check("6g: a linha foi AUTO-CURADA pra QUEUED (a prova do resultado_json corrigiu o status)", linhaAposRetry.status === "QUEUED", JSON.stringify(linhaAposRetry));
}

// ============================================================
// 9) T-LOG-09 -- pedido explicito do Geovane: mutacao OK -> escrita do
//    status em Log_Central falha (T-LOG-02) -> retry com a MESMA
//    operation_id -> confirmar ZERO linhas novas nas 3 tabelas
//    append-only de maior risco (aceite-oferta, ferramental, checklist).
//    Antes do fix (revisao do mesmo dia): o retry reexecutava fn()
//    inteira, duplicando a linha. Depois do fix: resultado_json ja
//    presente na linha faz o retry devolver o cache, sem tocar appendRow.
// ============================================================

// 9a: registrarAceiteOferta (Alocacoes_Ofertas)
{
  const { sandbox, sheets, getLogCentral } = runScenario({
    logComFalhaInjetavel: true,
    comTabelasAppendOnly: true,
    // Expira_Em e' texto ISO 8601 (achado real, 15/08: registrarAceiteOferta
    // ganhou checagem de expiracao de verdade -- new Date(valor) precisa
    // de um formato de data real, nao um numero grande arbitrario, que
    // vira uma data em 1973 quando interpretado como epoch-ms).
    ofertasRows: [["OF-9", "OS-1", "TEC-1", "Instalacao", 500, "2026-08-01", new Date(Date.now() + 3600 * 1000).toISOString(), "Pendente", "", "", ""]],
  });

  // dummy call pra criar Log_Central ANTES de armar a falha.
  sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "dummy", "", "op-9a-setup", "DEV-1");
  const log = getLogCentral();
  const idxStatus = log._dump()[0].indexOf('status');

  log._falharNaProximaEscritaDaColuna(idxStatus + 1);
  const r1 = sandbox.registrarAceiteOferta("OF-9", "TEC-1", true, "", "op-9a", "DEV-1");
  check("9a-1: 1a chamada devolve sucesso (mutacao funcionou) apesar da falha de log", r1.success === true, JSON.stringify(r1));
  const linhasApos1a = sheets.Alocacoes_Ofertas._dump().length - 1; // -1 pro header
  check("9a-2: 1 linha nova anexada (a proposta original + o evento de aceite)", linhasApos1a === 2, "linhas=" + linhasApos1a);

  const r2 = sandbox.registrarAceiteOferta("OF-9", "TEC-1", true, "", "op-9a", "DEV-1");
  check("9a-3: retry com a MESMA operation_id devolve sucesso (cacheado)", r2.success === true, JSON.stringify(r2));
  const linhasAposRetry = sheets.Alocacoes_Ofertas._dump().length - 1;
  check("9a-4: ZERO linhas novas apos o retry (nao duplicou o appendRow)", linhasAposRetry === linhasApos1a, "antes=" + linhasApos1a + " depois=" + linhasAposRetry);
}

// 9b: registrarMovimentoFerramental (Ferramental_Movimentos)
{
  const { sandbox, sheets, getLogCentral } = runScenario({
    logComFalhaInjetavel: true,
    comTabelasAppendOnly: true,
  });

  sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "dummy", "", "op-9b-setup", "DEV-1");
  const log = getLogCentral();
  const idxStatus = log._dump()[0].indexOf('status');

  log._falharNaProximaEscritaDaColuna(idxStatus + 1);
  const r1 = sandbox.registrarMovimentoFerramental("OS-1", "TEC-1", "PAT-009", "Carga", null, "", "op-9b", "DEV-1");
  check("9b-1: 1a chamada devolve sucesso apesar da falha de log", r1.success === true, JSON.stringify(r1));
  const linhasApos1a = sheets.Ferramental_Movimentos._dump().length - 1;
  check("9b-2: 1 linha anexada", linhasApos1a === 1, "linhas=" + linhasApos1a);

  const r2 = sandbox.registrarMovimentoFerramental("OS-1", "TEC-1", "PAT-009", "Carga", null, "", "op-9b", "DEV-1");
  check("9b-3: retry com a MESMA operation_id devolve sucesso (cacheado)", r2.success === true, JSON.stringify(r2));
  const linhasAposRetry = sheets.Ferramental_Movimentos._dump().length - 1;
  check("9b-4: ZERO linhas novas apos o retry (nao duplicou o appendRow)", linhasAposRetry === linhasApos1a, "antes=" + linhasApos1a + " depois=" + linhasAposRetry);
}

// 9c: salvarResposta (Checklist_Respostas)
{
  const { sandbox, sheets, getLogCentral } = runScenario({
    logComFalhaInjetavel: true,
    comTabelasAppendOnly: true,
  });

  sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "dummy", "", "op-9c-setup", "DEV-1");
  const log = getLogCentral();
  const idxStatus = log._dump()[0].indexOf('status');

  log._falharNaProximaEscritaDaColuna(idxStatus + 1);
  const r1 = sandbox.salvarResposta("OS-1", "", "P1", "EPI OK?", "Sim", "", "TEC-1", false, "op-9c", "DEV-1", "TEC-1");
  check("9c-1: 1a chamada devolve sucesso apesar da falha de log", r1.success === true, JSON.stringify(r1));
  const linhasApos1a = sheets.Checklist_Respostas._dump().length - 1;
  check("9c-2: 1 linha anexada", linhasApos1a === 1, "linhas=" + linhasApos1a);

  const r2 = sandbox.salvarResposta("OS-1", "", "P1", "EPI OK?", "Sim", "", "TEC-1", false, "op-9c", "DEV-1", "TEC-1");
  check("9c-3: retry com a MESMA operation_id devolve sucesso (cacheado)", r2.success === true, JSON.stringify(r2));
  const linhasAposRetry = sheets.Checklist_Respostas._dump().length - 1;
  check("9c-4: ZERO linhas novas apos o retry (nao duplicou o appendRow)", linhasAposRetry === linhasApos1a, "antes=" + linhasApos1a + " depois=" + linhasAposRetry);
}

// ============================================================
// 10) PEDIDO EXPLICITO DO GEOVANE -- retry automatico de SYNC_ERROR
//     GENUINO (fn() falha de verdade, nao so a gravacao do log) precisa
//     continuar funcionando. O outbox do frontend (processarFilaOffline,
//     eletrium-field-checklist3/index.html:883) reenvia o item com o
//     MESMO operationId em todo ciclo de backoff (confirmado por
//     leitura direta do codigo real, nao suposicao) -- se o backend
//     nunca reexecutar fn() pra um operation_id ja visto, um SYNC_ERROR
//     genuino (fn() nunca completou) ficaria preso pra sempre devolvendo
//     o mesmo erro, mesmo que uma nova tentativa fosse ter sucesso.
//
//     Cenario: fn() falha na 1a chamada (excecao de verdade, SEM
//     resultado_json gravado -- diferente do T-LOG-02/09, onde fn() JA
//     tinha completado). Retry com a MESMA operation_id -- que e
//     exatamente o que o outbox real faz no backoff -- precisa REEXECUTAR
//     fn() de verdade (nao so devolver cache/erro generico), e ter
//     sucesso se a causa da falha nao se repetir.
// ============================================================
{
  const { sandbox, sheets, getLogCentral } = runScenario();

  // fn() (pausarOS) falha de verdade na 1a chamada (excecao real, nao um
  // blip de rede) -- getRange quebrado so na 1a tentativa, normal depois.
  let falhouUmaVez = false;
  const osSheetOriginal = sandbox.SpreadsheetApp.openById().getSheetByName('Ordens_Servico');
  const realGetRange = osSheetOriginal.getRange.bind(osSheetOriginal);
  osSheetOriginal.getRange = function (...args) {
    if (!falhouUmaVez) { falhouUmaVez = true; throw new Error("Falha genuina simulada (ex.: erro real do Sheets, nao so um blip de rede)"); }
    return realGetRange(...args);
  };

  const r1 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-10", "DEV-1");
  check("10a: 1a tentativa falha de verdade (SYNC_ERROR genuino)", r1.success === false && r1.status === "SYNC_ERROR" && r1.retryable === true, JSON.stringify(r1));

  const linhaApos1a = linhaLogPorOp(getLogCentral(), "op-10");
  check("10b: status SYNC_ERROR, fn() nunca completou (diferente do T-LOG-02)", linhaApos1a.status === "SYNC_ERROR", JSON.stringify(linhaApos1a));

  // Retry com a MESMA operation_id -- exatamente o que processarFilaOffline
  // faz de verdade no backoff (item.params ja tem o operationId original,
  // confirmado por leitura do codigo real do outbox). Qtd_Interrupcoes
  // prova que fn() rodou de verdade nesta 2a chamada (nao so devolveu
  // cache/erro generico): a 1a tentativa falhou ANTES de conseguir
  // incrementar (getRange quebrado), entao so a 2a tentativa (com sucesso)
  // e que de fato grava o incremento.
  const idxQtd = sheets.Ordens_Servico._dump()[0].indexOf("Qtd_Interrupcoes");
  const r2 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-10", "DEV-1");
  check("10c: retry com a MESMA operation_id REEXECUTA e tem SUCESSO", r2.success === true, JSON.stringify(r2));
  check("10d: retry NAO devolve a resposta generica 'ja_registrada'", r2.ja_registrada !== true, JSON.stringify(r2));
  const qtdAposRetry = sheets.Ordens_Servico._dump().find(r => r[0] === "OS-1")[idxQtd];
  check("10e: Qtd_Interrupcoes foi incrementado (prova de que fn() rodou de verdade na 2a chamada)", qtdAposRetry === 1, "Qtd_Interrupcoes=" + qtdAposRetry);

  const linhaAposRetry = linhaLogPorOp(getLogCentral(), "op-10");
  check("10f: status final QUEUED", linhaAposRetry.status === "QUEUED", JSON.stringify(linhaAposRetry));
}

// ============================================================
// 11) Achado da Cowork 1 (revisao do router 1A, mesmo dia do fix de
//     QUEUED em _sucesso): a auto-cura de executarIdempotente() NAO PODE
//     mais reescrever incondicionalmente pra QUEUED -- o 1A (ator
//     externo) avanca a MESMA linha por QUEUED->SENDING->RECEIVED->
//     SYNCED->RECONCILED depois que este codigo termina. Simula o 1A ja
//     tendo avancado o status (SENDING, depois SYNCED) e confirma que um
//     retry com a MESMA operation_id NAO reverte esse progresso de volta
//     pra QUEUED.
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();

  sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-11", "DEV-1");
  const log = getLogCentral();
  const dump = log._dump();
  const h = dump[0];
  const idxOpId = h.indexOf("operation_id");
  const idxStatus = h.indexOf("status");
  const linhaIdx = dump.findIndex((r, i) => i > 0 && r[idxOpId] === "op-11");
  check("11a: 1a chamada grava QUEUED (pre-condicao do cenario)", dump[linhaIdx][idxStatus] === "QUEUED", "status=" + dump[linhaIdx][idxStatus]);

  // Simula o 1A tendo avancado a linha pra SENDING (esta ativamente
  // processando) -- mutacao direta no mock, como se fosse o Make.com
  // escrevendo na mesma planilha.
  dump[linhaIdx][idxStatus] = "SENDING";
  const r2 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-11", "DEV-1");
  check("11b: retry com a MESMA operation_id devolve sucesso (cacheado)", r2.success === true, JSON.stringify(r2));
  check("11c: retry NAO reverte SENDING (progresso do 1A) de volta pra QUEUED", dump[linhaIdx][idxStatus] === "SENDING", "status=" + dump[linhaIdx][idxStatus]);

  // Simula o 1A tendo terminado de sincronizar (SYNCED) -- mesmo teste,
  // estado mais avancado ainda.
  dump[linhaIdx][idxStatus] = "SYNCED";
  const r3 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa", "", "op-11", "DEV-1");
  check("11d: retry com a MESMA operation_id devolve sucesso (cacheado)", r3.success === true, JSON.stringify(r3));
  check("11e: retry NAO reverte SYNCED (progresso do 1A) de volta pra QUEUED", dump[linhaIdx][idxStatus] === "SYNCED", "status=" + dump[linhaIdx][idxStatus]);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
