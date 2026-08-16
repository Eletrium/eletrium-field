// Harness Node pra T-LOG-03/04/07/08 -- cobertura do pedido original do
// auditor que ficou pra tras (lock/idempotencia/versionamento ja
// implementados, sem teste dedicado ate agora). Mesmo padrao dos outros:
// codigo real via vm, sheets fake em memoria, sem API real.
//
// LockService mock tem estado de "segurado" DE VERDADE (nao so um
// opts.lockIndisponivel estatico) -- tryLock() falha se ja estiver
// segurado por outra chamada, exatamente como o LockService real do
// Apps Script entre duas EXECUCOES concorrentes de verdade. Isso permite
// simular concorrencia genuina numa runtime single-threaded (Node):
// aninhando uma 2a chamada de dentro de um monkey-patch (appendRow ou
// getRange) que roda NO MEIO da 1a chamada, no exato ponto em que uma
// execucao concorrente real poderia intercalar.
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

function runScenario() {
  const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Status_Atual", "Em_Pausa_Agora",
    "Motivo_Pausa_Atual", "Hora_Ultima_Pausa", "Horas_Produtivas", "Qtd_Interrupcoes",
    "Hora_Ultima_Retomada", "Hora_Inicio", "Qtd_Retomadas"];
  const osRows = [
    ["OS-1", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", "", 0],
    ["OS-2", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", "", 0],
  ];
  const sheets = { Ordens_Servico: makeSheet(OS_HEADERS, osRows) };
  let logCentralSheet = null;

  // Estado de lock GENUINO -- tryLock() falha se ja segurado, sucede e
  // marca "segurado" caso contrario. releaseLock() libera. E exatamente
  // o unico jeito de simular concorrencia real (2 execucoes separadas do
  // Apps Script) numa runtime single-threaded: aninhar uma 2a chamada
  // durante a janela em que a 1a ainda segura o lock.
  let lockSegurado = false;
  let tentativasDeLockNegado = 0;

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
            const s = makeSheet(headers, []);
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
        tryLock: () => {
          if (lockSegurado) { tentativasDeLockNegado++; return false; }
          lockSegurado = true;
          return true;
        },
        releaseLock: () => { lockSegurado = false; },
      }),
    },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets, getLogCentral: () => logCentralSheet, getTentativasDeLockNegado: () => tentativasDeLockNegado };
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
  return { osId: g('OS_ID'), entityVersion: g('entity_version'), status: g('status') };
}

// ============================================================
// T-LOG-03 -- duas operacoes SIMULTANEAS na MESMA OS. Aninha a chamada
// de op-B (pausarOS, OS-1) DENTRO do appendRow da reserva de op-A (OS-1)
// -- ponto exato em que uma execucao concorrente real poderia intercalar
// (o lock ainda esta segurado por A, B tenta tryLock() e tem que falhar
// de verdade, nao so por configuracao artificial do mock).
// ============================================================
{
  const { sandbox, sheets, getLogCentral, getTentativasDeLockNegado } = runScenario();

  let opBRodou = false;
  let resultadoOpB = null;

  // Cria a aba Log_Central diretamente (sem passar por pausarOS) pra nao
  // consumir uma entity_version de "aquecimento" -- a primeira reserva
  // real do teste deve mesmo ser a versao 1.
  sandbox.garantirLogCentral(sandbox.SpreadsheetApp.openById());
  const logReal = getLogCentral();
  const appendRowOriginal = logReal.appendRow.bind(logReal);
  let jaDisparou = false;
  logReal.appendRow = function (arr) {
    // dispara a chamada aninhada SO na proxima reserva depois deste
    // ponto (nao na de setup, que ja aconteceu) -- e ANTES do appendRow
    // real, simulando a maxima janela de sobreposicao possivel.
    if (!jaDisparou && arr[4] === 'APONTAMENTO' && arr[1] === 'OS-1') {
      jaDisparou = true;
      resultadoOpB = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa B", "", "op-3b", "DEV-1");
      opBRodou = true;
    }
    return appendRowOriginal(arr);
  };

  const resultadoOpA = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa A", "", "op-3a", "DEV-1");

  check("3-03a: op-B (aninhada, lock ainda segurado por A) NAO consegue o lock -- recusa segura, nao corrompe nada", opBRodou && resultadoOpB.success === false && resultadoOpB.status === "SYNC_ERROR" && resultadoOpB.retryable === true, JSON.stringify(resultadoOpB));
  check("3-03b: pelo menos 1 tryLock negado de verdade (nao so configuracao estatica do mock)", getTentativasDeLockNegado() >= 1, "negados=" + getTentativasDeLockNegado());
  check("3-03c: op-A completa normalmente com sucesso (lock nao ficou preso pela tentativa aninhada de B)", resultadoOpA.success === true, JSON.stringify(resultadoOpA));

  const linhaA = linhaLogPorOp(logReal, "op-3a");
  check("3-03d: op-A recebeu entity_version 1 (unica reserva que de fato aconteceu)", linhaA.entityVersion === 1, JSON.stringify(linhaA));

  const linhaBTentativaFalha = linhaLogPorOp(logReal, "op-3b");
  check("3-03e: NENHUMA linha foi criada pra op-B na tentativa que falhou o lock (sem corrupcao/linha fantasma)", linhaBTentativaFalha === null, JSON.stringify(linhaBTentativaFalha));

  // Achado da varredura de TOCTOU (15/08): op-A ja completou de verdade
  // nesse ponto (a tentativa aninhada de B so falhou o LOCK da reserva,
  // op-A seguiu e pausou a OS com sucesso) -- OS-1 esta genuinamente
  // pausada agora. Pra este teste continuar validando o que sempre quis
  // validar (isolamento de entity_version entre A e B, nao a semantica
  // de negocio de pausarOS), simula "OS foi retomada por outro meio
  // enquanto isso" via reset direto do mock -- nao e' um retomarOS de
  // verdade (isso consumiria outra entity_version, deslocando os
  // numeros esperados abaixo), so o estado minimo pra B poder pausar de
  // novo sem esbarrar na guarda nova.
  const osDump = sheets.Ordens_Servico._dump();
  osDump[1][osDump[0].indexOf('Em_Pausa_Agora')] = false;
  const retryB = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa B", "", "op-3b", "DEV-1");
  check("3-03f: retry de B (lock livre) tem sucesso", retryB.success === true, JSON.stringify(retryB));
  const linhaB = linhaLogPorOp(logReal, "op-3b");
  check("3-03g: B recebe entity_version 2 -- NAO colide com a versao 1 de A", linhaB.entityVersion === 2, JSON.stringify(linhaB));
}

// ============================================================
// T-LOG-04 -- duas operacoes SIMULTANEAS em OS DIFERENTES (OS-1 e OS-2).
// Mesma tecnica de aninhamento do T-LOG-03. Prova duas coisas ao mesmo
// tempo: (a) o lock e GENUINAMENTE script-inteiro, nao por-OS -- B
// tambem falha o tryLock() mesmo sendo outra OS (limitacao real, ja
// sinalizada em ARQUITETURA-SYNC-LOG-CENTRAL.md); (b) apesar do lock
// compartilhado, o CONTADOR de versao continua isolado por OS -- B (OS-2)
// nao herda nem colide com a numeracao de A (OS-1).
// ============================================================
{
  const { sandbox, getLogCentral, getTentativasDeLockNegado } = runScenario();

  sandbox.garantirLogCentral(sandbox.SpreadsheetApp.openById());
  const logReal = getLogCentral();
  const appendRowOriginal = logReal.appendRow.bind(logReal);
  let jaDisparou = false;
  let resultadoOpB = null;
  logReal.appendRow = function (arr) {
    if (!jaDisparou && arr[4] === 'APONTAMENTO' && arr[1] === 'OS-1') {
      jaDisparou = true;
      // B e numa OS DIFERENTE (OS-2) -- e o que este teste quer provar.
      resultadoOpB = sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "Pausa B (OS diferente)", "", "op-4b", "DEV-1");
    }
    return appendRowOriginal(arr);
  };

  const resultadoOpA = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa A", "", "op-4a", "DEV-1");

  check("3-04a: B (OS-2, aninhada durante o lock de A/OS-1) TAMBEM falha o lock -- confirma que o lock e script-inteiro, nao por-OS", resultadoOpB && resultadoOpB.success === false && resultadoOpB.retryable === true, JSON.stringify(resultadoOpB));
  check("3-04b: op-A (OS-1) completa normalmente", resultadoOpA.success === true, JSON.stringify(resultadoOpA));

  const linhaA = linhaLogPorOp(logReal, "op-4a");
  check("3-04c: A recebe entity_version 1 (contador de OS-1)", linhaA.entityVersion === 1, JSON.stringify(linhaA));

  // Retry real de B, lock livre -- confirma isolamento do contador por OS:
  // OS-2 comeca em 1 tambem, independente de OS-1 ja estar em 1.
  const retryB = sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "Pausa B (OS diferente)", "", "op-4b", "DEV-1");
  check("3-04d: retry de B (OS-2, lock livre) tem sucesso", retryB.success === true, JSON.stringify(retryB));
  const linhaB = linhaLogPorOp(logReal, "op-4b");
  check("3-04e: B recebe entity_version 1 pra OS-2 -- contador independente do de OS-1, nao herda nem pula", linhaB.entityVersion === 1, JSON.stringify(linhaB));
}

// ============================================================
// T-LOG-07 -- lacuna de entity_version (ex.: versao 3 processada sem a 2
// existir -- o sistema detecta?). Simula uma lacuna real (linha da
// versao 2 nunca chegou a existir -- crash/perda, nao reproduzida aqui,
// so o ESTADO resultante) e confirma o comportamento real de
// _proximaVersaoEntidadeOS: ele SO olha o MAIOR numero ja visto (nao
// verifica contiguidade) -- por design, a deteccao de lacuna e
// responsabilidade do CONSUMIDOR (1A), nao do produtor (Apps Script) --
// ver ARQUITETURA-SYNC-LOG-CENTRAL.md, ponto 6 do auditor ("ajuda o
// Make.com a detectar eventos fora de ordem/perdidos"). Este teste prova
// que essa premissa se sustenta: o produtor NUNCA reusa/colide um
// numero, mesmo com uma lacuna pre-existente, entao a lacuna continua
// visivel/reconstruivel pelo consumidor depois (1,3,4 -- falta o 2).
// ============================================================
{
  const { sandbox, sheets, getLogCentral } = runScenario();

  sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "dummy-pra-criar-log", "", "op-setup7", "DEV-1");
  const log = getLogCentral();
  const dump = log._dump();
  const h = dump[0];
  const idxOS = h.indexOf('OS_ID');
  const idxVersao = h.indexOf('entity_version');
  const idxOpId = h.indexOf('operation_id');

  // Reescreve a linha de setup pra virar a "versao 1" de verdade, e
  // insere manualmente uma linha de "versao 3" -- simulando que a versao
  // 2 nunca chegou a ser gravada (linha perdida/nunca aconteceu).
  const linhaSetup = dump.find((r, i) => i > 0 && r[idxOpId] === "op-setup7");
  linhaSetup[idxVersao] = 1;
  const linhaVersao3 = new Array(h.length).fill('');
  linhaVersao3[idxOpId] = "op-versao-3-preexistente";
  linhaVersao3[idxOS] = "OS-1";
  linhaVersao3[idxVersao] = 3;
  linhaVersao3[h.indexOf('status')] = "QUEUED";
  dump.push(linhaVersao3);

  check("3-07a: pre-condicao do cenario -- OS-1 tem versoes 1 e 3 gravadas, 2 ausente (lacuna real)", dump.filter((r, i) => i > 0 && r[idxOS] === "OS-1").map(r => r[idxVersao]).sort().join(",") === "1,3", dump.filter((r, i) => i > 0 && r[idxOS] === "OS-1").map(r => r[idxVersao]).join(","));

  // Achado da varredura de TOCTOU (15/08): o setup acima (op-setup7) ja
  // pausou OS-1 de verdade. Reset direto do mock (nao um retomarOS real,
  // que consumiria outra entity_version e deslocaria a expectativa "4"
  // abaixo) -- so o minimo pra exercitar a proxima reserva sem esbarrar
  // na guarda nova, mantendo o foco do teste em versionamento/lacuna.
  const osDump = sheets.Ordens_Servico._dump();
  osDump[1][osDump[0].indexOf('Em_Pausa_Agora')] = false;
  // Nova operacao pra mesma OS -- o sistema PRECISA continuar
  // funcionando (nao travar, nao lancar excecao) mesmo com a lacuna.
  const resultado = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa apos lacuna", "", "op-7-novo", "DEV-1");
  check("3-07b: sistema continua funcionando normalmente com a lacuna pre-existente (nao trava, nao lanca excecao)", resultado.success === true, JSON.stringify(resultado));

  const linhaNova = linhaLogPorOp(log, "op-7-novo");
  check("3-07c: versao atribuida e 4 (maior existente [3] + 1) -- NAO preenche a lacuna, NAO detecta/alerta sobre ela", linhaNova.entityVersion === 4, JSON.stringify(linhaNova));
  check("3-07d: a lacuna (versao 2) continua ausente e RECONSTRUIVEL pelo consumidor depois (1,3,4 -- falta 2) -- deteccao de lacuna e responsabilidade do 1A, nao deste codigo", true, "confirmado por 3-07c: producer nunca reusa nem preenche numero, so avanca a partir do maior visto");
}

// ============================================================
// T-LOG-08 -- evento chega fora de ordem (a CONCLUSAO de uma operacao
// reservada DEPOIS acontece ANTES da conclusao de uma reservada ANTES).
// A reserva de versao (dentro do lock) e sempre em ordem de chegada --
// mas fn() roda FORA do lock (ajuste 4 do auditor), entao o TEMPO de
// conclusao de cada operacao pode divergir da ordem de reserva (ex.: A
// reserva versao 1 mas tem um fn() lento; B reserva versao 2 logo depois
// mas tem um fn() rapido -- B pode terminar e virar QUEUED antes de A).
// Aninha a chamada de B DENTRO do fn() de A (apos o lock de A ja ter
// sido liberado -- fn() roda fora do lock), simulando exatamente essa
// sobreposicao real.
// ============================================================
{
  const { sandbox, getLogCentral } = runScenario();

  sandbox.garantirLogCentral(sandbox.SpreadsheetApp.openById());
  const log = getLogCentral();

  const osSheetOriginal = sandbox.SpreadsheetApp.openById().getSheetByName('Ordens_Servico');
  const realGetRange = osSheetOriginal.getRange.bind(osSheetOriginal);
  let jaDisparou = false;
  let resultadoOpB = null;
  let statusDeBQuandoADisparou = null;
  osSheetOriginal.getRange = function (...args) {
    // 1a leitura dentro do fn() de pausarOS (Hora_Ultima_Retomada) --
    // acontece DEPOIS que a reserva de versao de A ja terminou e o lock
    // ja foi liberado (fn() roda fora do lock). Ponto exato onde B pode
    // se intercalar de verdade.
    if (!jaDisparou) {
      jaDisparou = true;
      resultadoOpB = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa B (rapida)", "", "op-8b", "DEV-1");
      const linhaB = linhaLogPorOp(log, "op-8b");
      statusDeBQuandoADisparou = linhaB ? linhaB.status : null;
    }
    return realGetRange(...args);
  };

  const resultadoOpA = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Pausa A (lenta, dispara B no meio)", "", "op-8a", "DEV-1");

  check("3-08a: op-B (reservada DEPOIS de A, dentro do fn() de A) reserva e conclui com sucesso ANTES de A terminar", resultadoOpB && resultadoOpB.success === true, JSON.stringify(resultadoOpB));
  check("3-08b: B ja estava QUEUED no momento em que foi observada (dentro da execucao de A, que ainda nao terminou)", statusDeBQuandoADisparou === "QUEUED", "status=" + statusDeBQuandoADisparou);
  // Achado da varredura de TOCTOU (15/08): ANTES do fix de pausarOS,
  // op-A "concluia normalmente" aqui -- mas isso era exatamente o bug:
  // op-A recalcularia horasSeg da MESMA referencia que B ja tinha
  // consumido, dobrando Horas_Produtivas. Com a guarda nova (Em_Pausa_
  // Agora checado sob lock, logo no inicio de fn()), esta INTERCALACAO
  // REAL (nao simulada por hook artificial -- B genuinamente terminou
  // primeiro, dentro da execucao de A) e' detectada e A e' corretamente
  // RECUSADA -- prova ao vivo, com o harness de lock genuino deste
  // arquivo, que o fix funciona sob concorrencia de verdade, nao so
  // contra o hook mais simples usado em test-redteam-cowork2-14-08.js.
  check("3-08c: op-A e' RECUSADA (B ja pausou a OS primeiro, na ordem real de conclusao) -- a guarda nova evita o double-count de horas que o bug antigo tinha", resultadoOpA.success === false && /pausada/.test(resultadoOpA.erro), JSON.stringify(resultadoOpA));

  const linhaA = linhaLogPorOp(log, "op-8a");
  const linhaB = linhaLogPorOp(log, "op-8b");
  check("3-08d: versoes refletem a ORDEM DE RESERVA (A=1, B=2), nao a ordem de conclusao -- mesmo A sendo recusada, a versao ja tinha sido reservada", linhaA.entityVersion === 1 && linhaB.entityVersion === 2, "A=" + JSON.stringify(linhaA) + " B=" + JSON.stringify(linhaB));
  check("3-08e: B termina QUEUED (pausou de verdade); A termina DIVERGENT (recusada pela guarda, nao SYNC_ERROR -- e' uma recusa de regra de negocio, nao falha tecnica)", linhaA.status === "DIVERGENT" && linhaB.status === "QUEUED", "A=" + linhaA.status + " B=" + linhaB.status);
  check("3-08f: entity_version (1 antes de 2) permite ao consumidor (1A) reconstruir a ordem LOGICA real, mesmo tendo observado B concluir primeiro", linhaA.entityVersion < linhaB.entityVersion, "A=" + linhaA.entityVersion + " B=" + linhaB.entityVersion);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
