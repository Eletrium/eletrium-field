// Harness Node pra idempotencia das 7 operacoes migradas nesta rodada
// (Frente D: pausarOS, retomarOS, salvarResposta, registrarInicioDia,
// registrarFimDia, iniciarOSComKM, registrarKMFinalPendente). Mesmo
// padrao: codigo real via vm, sheets fake em memoria.
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

function runScenario(extraSheets) {
  const sheets = Object.assign({
    Ordens_Servico: makeSheet(
      ["OS_ID", "ID_Tecnico", "Status", "Em_Pausa_Agora", "Motivo_Pausa_Atual", "Hora_Ultima_Pausa",
       "Horas_Produtivas", "Qtd_Interrupcoes", "Status_Atual", "OS_Interrupcao_ID",
       "Hora_Ultima_Retomada", "Qtd_Retomadas", "Hora_Inicio", "Local_Atendimento",
       "KM_Inicial_OS", "Veiculo_ID_OS", "KM_Justificativa_Desvio", "KM_Foto_Desvio_URL", "KM_Flag_Revisao"],
      [["OS-1", "TEC-1", "Em Andamento", false, "", "", 0, 0, "", "", "", 0, new Date(), "", "", "", "", "", ""]]
    ),
    Checklist_Respostas: makeSheet(
      ["OS_ID", "IDSharePoint_OS", "Pergunta_ID", "Texto_Pergunta", "Resposta_Dada", "Foto_URL", "Tecnico", "Timestamp", "Gerou_NC", "Sincronizado"], []
    ),
    Diaria_Tecnico: makeSheet(
      ["Data", "Tecnico_ID", "Tecnico_Nome", "Hora_Entrada", "Hora_Saida", "Horas_Produtivas",
       "Horas_Pausadas", "Total_Horas", "Qtd_OS", "OS_Lista", "Clientes_Atendidos",
       "Qtd_Interrupcoes", "Status_Dia", "Custo_MO_Total", "IDSharePoint",
       "Usa_Veiculo_Hoje", "KM_Inicial", "KM_Final", "KM_Rodado", "Veiculo_ID"], []
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
      formatDate: (d, tz, fmt) => {
        // só o suficiente pro yyyy-MM-dd usado em registrarInicioDia/FimDia
        const dt = d instanceof Date ? d : new Date(d);
        return dt.toISOString().slice(0, 10);
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("OK   " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}

// ============================================================
// 1) pausarOS — idempotencia: retry com mesma operation_id nao
//    incrementa Qtd_Interrupcoes duas vezes.
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const r1 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Almoco", "", "op-1", "DEV-1");
  const r2 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Almoco", "", "op-1", "DEV-1");
  check("1a: 1a chamada sucesso", r1.sucesso === true, JSON.stringify(r1));
  check("1b: retry devolve o mesmo resultado (nao reprocessou)", JSON.stringify(r1) === JSON.stringify(r2));
  const dump = sheets.Ordens_Servico._dump();
  const h = dump[0];
  check("1c: Qtd_Interrupcoes incrementou só 1 vez", dump[1][h.indexOf("Qtd_Interrupcoes")] === 1, "valor=" + dump[1][h.indexOf("Qtd_Interrupcoes")]);
}

// ============================================================
// 2) retomarOS — idempotencia: retry nao incrementa Qtd_Retomadas 2x
// (achado da varredura de TOCTOU, 15/08: retomarOS agora exige
// Em_Pausa_Agora=true pra aceitar -- fixture precisa comecar pausada,
// senao nem a 1a chamada roda de verdade)
// ============================================================
{
  const { sandbox, sheets } = runScenario({
    Ordens_Servico: makeSheet(
      ["OS_ID", "ID_Tecnico", "Status", "Em_Pausa_Agora", "Motivo_Pausa_Atual", "Hora_Ultima_Pausa",
       "Horas_Produtivas", "Qtd_Interrupcoes", "Status_Atual", "OS_Interrupcao_ID",
       "Hora_Ultima_Retomada", "Qtd_Retomadas", "Hora_Inicio", "Local_Atendimento",
       "KM_Inicial_OS", "Veiculo_ID_OS", "KM_Justificativa_Desvio", "KM_Foto_Desvio_URL", "KM_Flag_Revisao"],
      [["OS-1", "TEC-1", "Em Andamento", true, "Pausa de teste", new Date(), 0, 1, "", "", "", 0, new Date(), "", "", "", "", "", ""]]
    ),
  });
  const r1 = sandbox.retomarOS("OS-1", "TEC-1", "Fulano", "op-2", "DEV-1");
  const r2 = sandbox.retomarOS("OS-1", "TEC-1", "Fulano", "op-2", "DEV-1");
  check("2a-pre: 1a chamada teve sucesso de verdade (fixture comecou pausada)", r1.sucesso === true, JSON.stringify(r1));
  check("2a-retry: retry com mesmo operationId devolve o mesmo resultado (cache, nao reprocessa)", JSON.stringify(r1) === JSON.stringify(r2));
  const dump = sheets.Ordens_Servico._dump();
  check("2a: Qtd_Retomadas incrementou só 1 vez", dump[1][dump[0].indexOf("Qtd_Retomadas")] === 1);
}

// ============================================================
// 3) salvarResposta — idempotencia: retry NAO duplica a linha no
//    Checklist_Respostas (appendRow sem guarda propria — a protecao
//    vem inteira do executarIdempotente).
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  sandbox.salvarResposta("OS-1", "SP-1", "P1", "Aterramento OK?", "Sim", "", "TEC-1", false, "op-3", "DEV-1", "TEC-1");
  sandbox.salvarResposta("OS-1", "SP-1", "P1", "Aterramento OK?", "Sim", "", "TEC-1", false, "op-3", "DEV-1", "TEC-1");
  const dump = sheets.Checklist_Respostas._dump();
  check("3a: só 1 linha gravada apesar de 2 chamadas com mesma operation_id", dump.length === 2, "linhas=" + (dump.length - 1)); // 1 header + 1 dado
}
{
  // negativo/controle: operation_id DIFERENTE de fato grava 2 linhas
  const { sandbox, sheets } = runScenario();
  sandbox.salvarResposta("OS-1", "SP-1", "P1", "Aterramento OK?", "Sim", "", "TEC-1", false, "op-3a", "DEV-1", "TEC-1");
  sandbox.salvarResposta("OS-1", "SP-1", "P1", "Aterramento OK?", "Sim", "", "TEC-1", false, "op-3b", "DEV-1", "TEC-1");
  const dump = sheets.Checklist_Respostas._dump();
  check("3b: operation_id diferente grava 2 linhas de verdade (nao e um bug de dedup universal)", dump.length === 3);
}

// ============================================================
// 4) registrarInicioDia / registrarFimDia — idempotencia
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const r1 = sandbox.registrarInicioDia("TEC-1", "Fulano", false, "", "", "op-4", "DEV-1");
  const r2 = sandbox.registrarInicioDia("TEC-1", "Fulano", false, "", "", "op-4", "DEV-1");
  check("4a: registrarInicioDia idempotente (mesmo resultado no retry)", JSON.stringify(r1) === JSON.stringify(r2));
  check("4b: só 1 linha criada em Diaria_Tecnico", sheets.Diaria_Tecnico._dump().length === 2);

  const r3 = sandbox.registrarFimDia("TEC-1", "150", "op-5", "DEV-1");
  const r4 = sandbox.registrarFimDia("TEC-1", "150", "op-5", "DEV-1");
  check("4c: registrarFimDia idempotente", JSON.stringify(r3) === JSON.stringify(r4), JSON.stringify(r3) + " vs " + JSON.stringify(r4));
}

// ============================================================
// 5) iniciarOSComKM — idempotencia (composto: valida KM + inicia OS)
// ============================================================
{
  const osHeaders = ["OS_ID", "Status", "Local_Atendimento", "Hora_Inicio", "KM_Inicial_OS", "Veiculo_ID_OS", "KM_Justificativa_Desvio", "KM_Foto_Desvio_URL", "KM_Flag_Revisao"];
  const { sandbox, sheets } = runScenario({
    Ordens_Servico: makeSheet(osHeaders, [["OS-2", "Nao iniciada", "", "", "", "", "", "", ""]]),
  });
  const r1 = sandbox.iniciarOSComKM("OS-2", "TEC-1", "Fulano", "Local X", null, null, "1000", "PLACA-1", "", "", "op-6", "DEV-1");
  const r2 = sandbox.iniciarOSComKM("OS-2", "TEC-1", "Fulano", "Local X", null, null, "1000", "PLACA-1", "", "", "op-6", "DEV-1");
  check("5a: iniciarOSComKM idempotente (mesmo resultado no retry)", JSON.stringify(r1) === JSON.stringify(r2), JSON.stringify(r1) + " vs " + JSON.stringify(r2));
  const dump = sheets.Ordens_Servico._dump();
  check("5b: KM_Inicial_OS gravado uma vez, valor correto", parseFloat(dump[1][dump[0].indexOf("KM_Inicial_OS")]) === 1000);
}

// ============================================================
// 6) registrarKMFinalPendente — idempotencia
// ============================================================
{
  const osHeaders = ["OS_ID", "ID_Tecnico", "Status", "KM_Inicial_OS", "KM_Final_OS", "KM_Justificativa_Desvio", "KM_Foto_Desvio_URL"];
  const { sandbox, sheets } = runScenario({
    Ordens_Servico: makeSheet(osHeaders, [["OS-3", "TEC-1", "Concluída", 1000, "", "", ""]]),
  });
  // diferenca de 3km fica ABAIXO do limiar (KM_LIMIAR_INTRA_DIA_KM=5) —
  // nao exige justificativa, testa só o caminho feliz + idempotencia.
  const r1 = sandbox.registrarKMFinalPendente("OS-3", "TEC-1", "1003", "", "", "op-7", "DEV-1");
  const r2 = sandbox.registrarKMFinalPendente("OS-3", "TEC-1", "1003", "", "", "op-7", "DEV-1");
  check("6a: registrarKMFinalPendente idempotente", JSON.stringify(r1) === JSON.stringify(r2), JSON.stringify(r1) + " vs " + JSON.stringify(r2));
  const dump = sheets.Ordens_Servico._dump();
  check("6b: KM_Final_OS gravado corretamente", parseFloat(dump[1][dump[0].indexOf("KM_Final_OS")]) === 1003);
}

// ============================================================
// 7) sem operationId — todas as 7 continuam funcionando (backward-compat)
// ============================================================
{
  const { sandbox } = runScenario();
  const r1 = sandbox.pausarOS("OS-1", "TEC-1", "Fulano", "Almoco", "");
  check("7a: pausarOS sem operationId ainda funciona", r1.sucesso === true, JSON.stringify(r1));
  const r2 = sandbox.retomarOS("OS-1", "TEC-1", "Fulano");
  check("7b: retomarOS sem operationId ainda funciona", r2.sucesso === true);
  const r3 = sandbox.salvarResposta("OS-1", "SP-1", "P1", "T", "Sim", "", "TEC-1", false, undefined, undefined, "TEC-1");
  check("7c: salvarResposta sem operationId ainda funciona", r3.sucesso === true, JSON.stringify(r3));
  const r4 = sandbox.registrarInicioDia("TEC-1", "Fulano", false, "", "");
  check("7d: registrarInicioDia sem operationId ainda funciona", r4.sucesso === true);
}

// Header real de Ordens_Servico pro proposito de criarOSEmergencia --
// achado ao escrever este teste (13/08, nao um bug, so uma correcao de
// mock): a coluna e' `ID_OS` (confirmado por incidente real de producao,
// DIRETRIZ-V1.1-FRENTES-BCDE.md linha 378, "Ordens_Servico, ID_OS=..."),
// NAO `OS_ID` como o resto dos mocks deste arquivo usa como rotulo pra
// coluna 0. Nunca deu problema em nenhum outro teste porque toda outra
// funcao usa encontrarLinha(osSheet, osId, 0) -- posicao, nao nome --
// so criarOSEmergencia escreve por NOME (`set('ID_OS', novoId)`), entao
// so aqui o rotulo errado ('OS_ID') faria o valor cair fora de qualquer
// coluna existente (set() no-opa silenciosamente se o nome nao bate).
const OS_HEADERS_ID_OS = ["ID_OS", "ID_Tecnico", "Nome_Cliente", "ID_Cliente", "Nome_Tecnico", "Descricao", "Status", "Status_Atual", "Prioridade_OS", "Tipo_OS_Completo", "Data_Abertura", "Hora_Inicio", "Em_Pausa_Agora", "OS_Interrupcao_ID", "Local"];

// ============================================================
// 8) criarOSEmergencia -- migrada pra executarIdempotente (achado do
// cross-check do plano de deploy, 13/08): retry de rede com o MESMO
// operationId nao cria uma 2a OS de emergencia. operationId/
// dispositivoId chegam como propriedades de `dados` (mesma convencao
// ja usada por esta funcao -- objeto unico), nao parametros posicionais.
// ============================================================
{
  const { sandbox, sheets } = runScenario({ Ordens_Servico: makeSheet(OS_HEADERS_ID_OS, []) });
  const dados = { clienteNome: "Cliente X", tecnicoId: "TEC-1", tecnicoNome: "Fulano", descricao: "Vazamento", operationId: "op-8", dispositivoId: "DEV-1" };
  const r1 = sandbox.criarOSEmergencia(dados);
  check("8a: 1a chamada cria a OS com sucesso", r1.success === true && !!r1.osId, JSON.stringify(r1));
  const r2 = sandbox.criarOSEmergencia(dados);
  check("8b: retry com o MESMO operationId devolve sucesso (cacheado)", r2.success === true, JSON.stringify(r2));
  check("8c: retry devolve o MESMO osId da 1a chamada (nao gerou um novo)", r2.osId === r1.osId, "1a=" + r1.osId + " retry=" + r2.osId);
  const idxIdOs = sheets.Ordens_Servico._dump()[0].indexOf("ID_OS");
  const linhasEMG = sheets.Ordens_Servico._dump().filter((r, i) => i > 0 && String(r[idxIdOs]).indexOf("EMG-") === 0).length;
  check("8d: SO 1 OS de emergencia foi criada de verdade (nao duplicou)", linhasEMG === 1, "linhas EMG=" + linhasEMG);

  // controle negativo: operationId DIFERENTE de fato cria uma 2a OS --
  // prova que o teste acima nao passa so porque nada nunca duplica.
  const dados2 = Object.assign({}, dados, { operationId: "op-8-outro" });
  const r3 = sandbox.criarOSEmergencia(dados2);
  check("8e: operationId DIFERENTE cria uma OS de verdade, nova", r3.success === true && r3.osId !== r1.osId, JSON.stringify(r3));
  const linhasEMGDepois = sheets.Ordens_Servico._dump().filter((r, i) => i > 0 && String(r[idxIdOs]).indexOf("EMG-") === 0).length;
  check("8f: agora sao 2 OS de emergencia (a 2a e legitima, nao duplicata)", linhasEMGDepois === 2, "linhas EMG=" + linhasEMGDepois);
}

// ============================================================
// 9) criarOSEmergencia -- sem operationId (backward-compat): continua
// funcionando exatamente como antes (fn() roda direto, sem passar por
// Log_Central) -- confirma que a migracao nao quebrou o caminho antigo.
// ============================================================
{
  const { sandbox, sheets } = runScenario({ Ordens_Servico: makeSheet(OS_HEADERS_ID_OS, []) });
  const dados = { clienteNome: "Cliente Y", tecnicoId: "TEC-1", tecnicoNome: "Fulano", descricao: "Sem ID" };
  const r = sandbox.criarOSEmergencia(dados);
  check("9a: criarOSEmergencia sem operationId ainda funciona", r.sucesso === true && !!r.osId, JSON.stringify(r));
  check("9b: Log_Central nao chega a ser criado (sem operationId, sem passagem pelo Outbox)", !sheets.Log_Central);
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
