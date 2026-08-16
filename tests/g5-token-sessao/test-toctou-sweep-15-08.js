// Harness Node pra varredura deliberada de TOCTOU (Cowork 2, 15/08,
// elevada a prioridade real -- 3a+ ocorrencia do mesmo padrao no dia:
// encerrarOS, registrarAceiteOferta x2). Cobre os 4 achados novos desta
// rodada: pausarOS (double-count de horas), retomarOS (Qtd_Retomadas
// inflado + retomar sem estar pausado), iniciarOS (reset de Hora_Inicio
// + duplicacao de segmento), encontrarOuCriarLinhaDiaria (linha
// duplicada em Diaria_Tecnico). Mesmo padrao dos outros: codigo real
// via vm, sheets fake em memoria, hook de interleaving via
// LockService.tryLock() (mesma tecnica do fix de encerrarOS/aceite-oferta).
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
          for (let i = 0; i < numRows; i++) out.push((data[r - 1 + i] || []).slice(c - 1, c - 1 + numCols));
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) {
            while (data.length < r - 1 + i + 1) data.push([]);
            data[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        setFontWeight() { return this; }, setNumberFormat() { return this; }, setDataValidation() { return this; },
      };
    },
    getDataRange() { return { getValues: () => data.map(row => row.slice()) }; },
    appendRow(arr) { data.push(arr.slice()); },
    setFrozenRows() {}, setColumnWidth() {},
    _dump() { return data; },
  };
}

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

const OS_HEADERS = ["OS_ID", "ID_Tecnico", "Status", "Status_Atual", "Em_Pausa_Agora",
  "Motivo_Pausa_Atual", "Hora_Ultima_Pausa", "Horas_Produtivas", "Qtd_Interrupcoes",
  "Hora_Ultima_Retomada", "Hora_Inicio", "Qtd_Retomadas", "OS_Interrupcao_ID"];
const DIARIA_HEADERS = ["Data", "Tecnico_ID", "Tecnico_Nome", "Hora_Entrada", "Hora_Saida",
  "Horas_Produtivas", "Horas_Pausadas", "Total_Horas", "Qtd_OS", "OS_Lista",
  "Clientes_Atendidos", "Qtd_Interrupcoes", "Status_Dia", "Custo_MO_Total", "IDSharePoint"];

function runScenario(osRows, opts) {
  opts = opts || {};
  const sheets = {
    Ordens_Servico: makeSheet(OS_HEADERS, osRows || []),
    OS_Segmentos: makeSheet(
      ['ID', 'OS_ID', 'IDSharePoint', 'Tecnico_ID', 'Tecnico_Nome', 'Tipo', 'Timestamp', 'Dur_Min', 'Horas_Acum', 'Lat', 'Lng', 'Ativo', 'Local'], []
    ),
    Diaria_Tecnico: makeSheet(DIARIA_HEADERS, []),
    Tecnicos_MEI: makeSheet(["ID_Tecnico", "Nome"], [["TEC-1", "Fulano"]]),
  };
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
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      formatDate: (d, tz, fmt) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10),
    },
    // Mesma tecnica de interleaving simulado ja usada nos fixes de
    // encerrarOS/registrarAceiteOferta: aoTravar dispara DENTRO de
    // tryLock(), no ponto exato onde uma execucao concorrente real teria
    // tido a chance.
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
function idx(h, nome) { return h.indexOf(nome); }

// ============================================================
// ACHADO -- pausarOS: sem guarda, double-pause dobrava Horas_Produtivas.
// ============================================================
{
  // 1a) caminho normal continua funcionando.
  const os1 = ["OS-1", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", new Date(), 0, ""];
  const { sandbox, sheets } = runScenario([os1]);
  const r = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Almoco", "", "op-1", "DEV-1");
  check("pausarOS-1a: pausa normal continua funcionando", r.sucesso === true, JSON.stringify(r));
  check("pausarOS-1a-seg: 1 segmento de pausa gravado", sheets.OS_Segmentos._dump().length === 2);

  // 1b) interleaving simulado -- chamada B "termina" de pausar a MESMA
  // OS exatamente no momento em que A esta pra adquirir a trava. Sem a
  // correcao, A prosseguiria e dobraria Horas_Produtivas (recalculando
  // horasSeg da MESMA referencia que B ja consumiu).
  const os2 = ["OS-2", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", new Date(Date.now() - 3600 * 1000), 0, ""];
  let sheets2;
  const cenario2 = runScenario([os2], {
    aoTravar: () => {
      const idxCol = OS_HEADERS.indexOf("Em_Pausa_Agora");
      sheets2.Ordens_Servico.getRange(2, idxCol + 1).setValue(true);
      const idxProd = OS_HEADERS.indexOf("Horas_Produtivas");
      sheets2.Ordens_Servico.getRange(2, idxProd + 1).setValue(1.0); // B ja somou 1h
    },
  });
  sheets2 = cenario2.sheets;
  const rA = cenario2.sandbox.pausarOS("OS-2", "TEC-1", "Fulano", "Pausa A", "", "op-2a", "DEV-1");
  check("pausarOS-1b: A recusada -- B ja pausou primeiro (interleaving detectado)", rA.sucesso === false && /pausada/.test(rA.erro), JSON.stringify(rA));
  const dump2 = sheets2.Ordens_Servico._dump();
  check("pausarOS-1b-horas: Horas_Produtivas continua em 1.0 (de B) -- A NAO somou por cima", dump2[1][idx(OS_HEADERS, "Horas_Produtivas")] === 1.0, "valor=" + dump2[1][idx(OS_HEADERS, "Horas_Produtivas")]);
  check("pausarOS-1b-seg: NENHUM segmento gravado por A", sheets2.OS_Segmentos._dump().length === 1);
}

// ============================================================
// ACHADO -- retomarOS: sem guarda, retomar 2x inflava Qtd_Retomadas;
// retomar uma OS que NAO esta pausada nao deveria fazer nada.
// ============================================================
{
  // 2a) retomar uma OS NAO pausada e' recusado (nao havia essa checagem
  // antes -- achado novo, nao so a corrida).
  const os1 = ["OS-1", "TEC-1", "Em Andamento", "", false, "", "", 0, 0, "", "", 0, ""];
  const { sandbox, sheets } = runScenario([os1]);
  const r = sandbox.retomarOS("OS-1", "TEC-1", "Fulano", "op-1", "DEV-1");
  check("retomarOS-2a: retomar OS que NAO esta pausada e' recusado", r.sucesso === false && /nao esta pausada/.test(r.erro), JSON.stringify(r));
  check("retomarOS-2a-qtd: Qtd_Retomadas continua 0", sheets.Ordens_Servico._dump()[1][idx(OS_HEADERS, "Qtd_Retomadas")] === 0);

  // 2b) caminho normal (OS genuinamente pausada) funciona.
  const os2 = ["OS-2", "TEC-1", "Em Andamento", "", true, "Pausa", new Date(), 2, 1, "", "", 0, ""];
  const cenario2 = runScenario([os2]);
  const r2 = cenario2.sandbox.retomarOS("OS-2", "TEC-1", "Fulano", "op-2", "DEV-1");
  check("retomarOS-2b: retomar OS genuinamente pausada funciona", r2.sucesso === true, JSON.stringify(r2));
  check("retomarOS-2b-qtd: Qtd_Retomadas vai pra 1", cenario2.sheets.Ordens_Servico._dump()[1][idx(OS_HEADERS, "Qtd_Retomadas")] === 1);

  // 2c) interleaving -- B ja retomou, A tenta retomar de novo (sem
  // guarda, dobraria Qtd_Retomadas + duplicaria segmento).
  const os3 = ["OS-3", "TEC-1", "Em Andamento", "", true, "Pausa", new Date(), 0, 1, "", "", 0, ""];
  let sheets3;
  const cenario3 = runScenario([os3], {
    aoTravar: () => {
      const idxPausa = OS_HEADERS.indexOf("Em_Pausa_Agora");
      sheets3.Ordens_Servico.getRange(2, idxPausa + 1).setValue(false); // B ja retomou
      const idxQtd = OS_HEADERS.indexOf("Qtd_Retomadas");
      sheets3.Ordens_Servico.getRange(2, idxQtd + 1).setValue(1);
    },
  });
  sheets3 = cenario3.sheets;
  const rA3 = cenario3.sandbox.retomarOS("OS-3", "TEC-1", "Fulano", "op-3a", "DEV-1");
  check("retomarOS-2c: A recusada -- B ja retomou primeiro", rA3.sucesso === false && /nao esta pausada/.test(rA3.erro), JSON.stringify(rA3));
  check("retomarOS-2c-qtd: Qtd_Retomadas continua 1 (de B), nao virou 2", sheets3.Ordens_Servico._dump()[1][idx(OS_HEADERS, "Qtd_Retomadas")] === 1);
}

// ============================================================
// ACHADO -- iniciarOS: sem guarda NENHUMA, uma 2a chamada (nem
// precisava de corrida real) resetava Hora_Inicio e duplicava segmento.
// ============================================================
{
  // 3a) caminho normal funciona.
  const os1 = ["OS-1", "TEC-1", "Nao iniciada", "", "", "", "", 0, 0, "", "", 0, ""];
  const { sandbox, sheets } = runScenario([os1]);
  const r = sandbox.iniciarOSComGeo("OS-1", "TEC-1", "Fulano", "Local", -19, -43, "op-1", "DEV-1");
  check("iniciarOS-3a: inicio normal funciona", !r.erro, JSON.stringify(r));
  check("iniciarOS-3a-seg: 1 segmento de Inicio gravado", sheets.OS_Segmentos._dump().length === 2);

  // 3b) 2a chamada SEQUENCIAL (nem precisa de interleaving -- o bug
  // original nao tinha NENHUMA checagem) e' recusada, Hora_Inicio
  // original preservada.
  const horaOriginal = sheets.Ordens_Servico._dump()[1][idx(OS_HEADERS, "Hora_Inicio")];
  const r2 = sandbox.iniciarOSComGeo("OS-1", "TEC-1", "Fulano", "Local", -19, -43, "op-1-retry-manual", "DEV-1");
  check("iniciarOS-3b: 2a chamada (OS ja em andamento) e' recusada", r2.success === false && /Em Andamento/.test(r2.erro), JSON.stringify(r2));
  const horaDepois = sheets.Ordens_Servico._dump()[1][idx(OS_HEADERS, "Hora_Inicio")];
  check("iniciarOS-3b-hora: Hora_Inicio NAO foi resetada pela 2a chamada", horaOriginal.getTime() === horaDepois.getTime());
  check("iniciarOS-3b-seg: continua so 1 segmento (nao duplicou)", sheets.OS_Segmentos._dump().length === 2);

  // 3c) OS ja concluida tambem nao pode ser "reiniciada".
  const os2 = ["OS-2", "TEC-1", "Concluída", "", "", "", "", 0, 0, "", new Date(), 0, ""];
  const cenario2 = runScenario([os2]);
  const r3 = cenario2.sandbox.iniciarOSComGeo("OS-2", "TEC-1", "Fulano", "Local", -19, -43, "op-3", "DEV-1");
  check("iniciarOS-3c: OS Concluída nao pode ser reiniciada", r3.success === false && /Concluída/.test(r3.erro), JSON.stringify(r3));
}

// ============================================================
// ACHADO -- encontrarOuCriarLinhaDiaria: find-or-create sem lock podia
// criar 2 linhas pro mesmo tecnico+dia numa corrida.
// ============================================================
{
  const os1 = ["OS-1", "TEC-1", "Nao iniciada", "", "", "", "", 0, 0, "", "", 0, ""];
  let sheets4;
  const cenario = runScenario([os1], {
    aoTravar: () => {
      // simula uma chamada B (ex.: registrarUsoVeiculo) tendo criado a
      // linha do dia ANTES de A conseguir a trava.
      const hoje = new Date().toISOString().slice(0, 10);
      sheets4.Diaria_Tecnico.appendRow([hoje, "TEC-1", "Fulano", "", "", 0, 0, 0, 0, "", "", 0, "Em campo", 0, ""]);
    },
  });
  sheets4 = cenario.sheets;
  cenario.sandbox.registrarInicioDia("TEC-1", "Fulano", false, "", "", "op-1", "DEV-1");
  const dump = sheets4.Diaria_Tecnico._dump();
  check("diaria-4a: so 1 linha de Diaria_Tecnico pro tecnico+dia (nao duplicou)", dump.length === 2, JSON.stringify(dump));
  check("diaria-4b: a linha e' a que 'B' criou (Hora_Entrada de A foi escrita NELA, nao numa 2a)", !!dump[1][3], JSON.stringify(dump[1]));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
