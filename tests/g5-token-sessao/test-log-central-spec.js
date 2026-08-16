// Harness Node pra garantirLogCentral() contra a especificacao exata
// aprovada Geovane/Cowork 2 (12/08): 13 colunas A-M na ordem certa,
// larguras, negrito+freeze, F-I texto ISO 8601, K inteiro, 4 validacoes
// Reject input com as listas de valores exatas aprovadas.
const fs = require("fs");
const vm = require("vm");
const CODIGO = fs.readFileSync("C:\\EletriumERP\\pwa\\Código.js", "utf8");
const API = fs.readFileSync("C:\\EletriumERP\\pwa\\API.js", "utf8");

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// Mock instrumentado: grava TODA chamada de formatacao/validacao numa
// trilha, pra eu poder inspecionar exatamente o que foi pedido pro
// Sheets -- nao só "nao quebrou", mas "pediu a coisa certa".
function makeInstrumentedSheet() {
  const chamadas = { setColumnWidth: [], setFrozenRows: [], setFontWeight: [], setNumberFormat: [], setDataValidation: [] };
  const headerData = [];
  const sheet = {
    getRange(r, c, nr, nc) {
      const rangeInfo = { r, c, nr, nc };
      // getRange(r, c) sem largura/altura -- caso de celula unica, usado
      // pelo backfill de coluna nova (_garantirColunasOutboxLogCentral:
      // setValue do nome do header, uma coluna de cada vez).
      if (nr === undefined) {
        return {
          setValue(v) { if (r === 1) { headerData[0] = headerData[0] || []; headerData[0][c - 1] = v; } },
          getValue() { return headerData[0] ? headerData[0][c - 1] : undefined; },
          setNumberFormat(fmt) { chamadas.setNumberFormat.push({ ...rangeInfo, fmt }); return this; },
        };
      }
      return {
        setValues(vals) { if (r === 1 && (nr === undefined || nr === 1)) headerData.push(vals[0]); },
        setFontWeight(w) { chamadas.setFontWeight.push({ ...rangeInfo, w }); return this; },
        setNumberFormat(fmt) { chamadas.setNumberFormat.push({ ...rangeInfo, fmt }); return this; },
        setDataValidation(rule) { chamadas.setDataValidation.push({ ...rangeInfo, rule }); return this; },
      };
    },
    setFrozenRows(n) { chamadas.setFrozenRows.push(n); },
    setColumnWidth(col, w) { chamadas.setColumnWidth.push({ col, w }); },
    // getLastRow -- achado real (14/08): _normalizarTimestampsLogCentral
    // chama isto no caminho de reparo. Este fixture nunca semeia linha
    // de DADO nenhuma (so o header), entao 1 e' sempre a resposta certa
    // (mesmo apos o header ser escrito via setValues).
    getLastRow() { return headerData.length ? 1 : 0; },
  };
  return { sheet, chamadas, headerData };
}

const instr = makeInstrumentedSheet();
const dataValidationChamadas = [];
const sandbox = {
  SHEET_ID: "fake",
  SpreadsheetApp: {
    openById() {
      return {
        getSheetByName: () => null, // forca o caminho de CRIACAO em garantirLogCentral
        insertSheet: (nome) => { instr.nomeCriado = nome; return instr.sheet; },
      };
    },
    newDataValidation() {
      const registro = { lista: null, formula: null, allowInvalid: null };
      dataValidationChamadas.push(registro);
      const builder = {
        requireValueInList(lista, mostrarDropdown) { registro.lista = lista; registro.mostrarDropdown = mostrarDropdown; return builder; },
        requireFormulaSatisfied(f) { registro.formula = f; return builder; },
        setAllowInvalid(v) { registro.allowInvalid = v; return builder; },
        build() { return registro; },
      };
      return builder;
    },
  },
  Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid" },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Logger: { log: () => {} }, console,
};
vm.createContext(sandbox);
vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
vm.runInContext(API, sandbox, { filename: "API.js" });

const resultSheet = sandbox.garantirLogCentral({ getSheetByName: () => null, insertSheet: (n) => { instr.nomeCriado = n; return instr.sheet; } });

// 1) nome da aba exato
check("1a: aba criada com o nome exato 'Log_Central'", instr.nomeCriado === "Log_Central");

// 2) 13 colunas + resultado_json (14a) + entity_type/entity_id/
// entity_version (15a-17a, Outbox -- ARQUITETURA-SYNC-LOG-CENTRAL.md) +
// Teto_Excedido (18a, retry -- PROPOSTA-TETO-RETRY.md) + Retry_Manual_Por/
// Retry_Manual_Em (19a-20a, retry manual -- espec fechada Geovane 14/08),
// ordem A-M exata seguida das novas no final.
const ORDEM_ESPERADA = [
  "operation_id", "OS_ID", "tecnico_id", "dispositivo_id", "tipo_operacao",
  "criado_em", "enviado_em", "recebido_em", "sincronizado_em",
  "status", "tentativas", "erro_codigo", "erro_detalhe", "resultado_json",
  "entity_type", "entity_id", "entity_version", "Teto_Excedido",
  "Retry_Manual_Por", "Retry_Manual_Em",
];
check("2a: 20 colunas gravadas (13 da spec + resultado_json + 3 do Outbox + Teto_Excedido + Retry_Manual_Por/Em)", instr.headerData[0] && instr.headerData[0].length === 20, JSON.stringify(instr.headerData[0]));
check("2b: ordem A-M EXATA conforme spec (+ resultado_json + Outbox + retry no final)", JSON.stringify(instr.headerData[0]) === JSON.stringify(ORDEM_ESPERADA), JSON.stringify(instr.headerData[0]));

// 3) larguras conforme a tabela (A=220...M=300) + colunas novas do Outbox (15-17) + retry (18-20)
const LARGURAS_ESPERADAS = { 1: 220, 2: 100, 3: 100, 4: 160, 5: 160, 6: 160, 7: 160, 8: 160, 9: 160, 10: 130, 11: 80, 12: 170, 13: 300, 15: 140, 16: 200, 17: 110, 18: 110, 19: 140, 20: 160 };
let larguraOk = true, larguraDetalhe = "";
Object.keys(LARGURAS_ESPERADAS).forEach(col => {
  const chamada = instr.chamadas.setColumnWidth.find(c => c.col === Number(col));
  if (!chamada || chamada.w !== LARGURAS_ESPERADAS[col]) {
    larguraOk = false;
    larguraDetalhe += `col${col}:esperado=${LARGURAS_ESPERADAS[col]},achado=${chamada ? chamada.w : "nenhum"}; `;
  }
});
check("3a: todas as 13 larguras batem com a tabela A-M", larguraOk, larguraDetalhe);

// 4) negrito + freeze na linha 1
check("4a: setFrozenRows(1) chamado", instr.chamadas.setFrozenRows.includes(1));
check("4b: header (linha 1) recebeu setFontWeight('bold')", instr.chamadas.setFontWeight.some(c => c.r === 1 && c.w === "bold"));

// 5) F,G,H,I como texto simples ('@') -- colunas 6,7,8,9 (criado_em..sincronizado_em)
[6, 7, 8, 9].forEach(col => {
  check(`5a: coluna ${col} (F-I) formatada como texto '@'`, instr.chamadas.setNumberFormat.some(c => c.c === col && c.fmt === "@"));
});
// 5b) Retry_Manual_Em (coluna 20) -- mesma cautela critica, texto '@'
// ANTES de qualquer dado, senao o Sheets autoconverte ISO 8601 em Date.
check("5b: coluna 20 (Retry_Manual_Em) formatada como texto '@'", instr.chamadas.setNumberFormat.some(c => c.c === 20 && c.fmt === "@"));

// 6) K (tentativas, coluna 11) como inteiro '0'
check("6a: coluna 11 (K, tentativas) formatada como inteiro '0'", instr.chamadas.setNumberFormat.some(c => c.c === 11 && c.fmt === "0"));

// 7) validacoes Reject input -- 4 chamadas a newDataValidation, com as listas EXATAS aprovadas
const STATUS_ESPERADO = ["LOCAL_PENDING", "QUEUED", "SENDING", "RECEIVED", "SYNCED", "RECONCILED", "SYNC_ERROR", "DIVERGENT"];
const TIPO_OP_ESPERADO = ["CHECKLIST_RESPOSTA", "UPLOAD_FOTO", "ACEITE_CLIENTE", "REGISTRO_KM", "APONTAMENTO", "ASSINATURA", "REGISTRO_MEDICAO", "CONCLUSAO_OS"];
const ERRO_CODIGO_ESPERADO = ["TIMEOUT", "PAYLOAD_INVALIDO", "CONFLITO_VERSAO", "PERMISSAO_NEGADA", "QUOTA_EXCEDIDA", "CONEXAO_INDISPONIVEL", "REFERENCIA_INVALIDA", "DUPLICADO", "DIVERGENCIA_VALOR", "DIVERGENCIA_AUSENCIA", "ERRO_DESCONHECIDO"];

const validacaoStatus = dataValidationChamadas.find(v => JSON.stringify(v.lista) === JSON.stringify(STATUS_ESPERADO));
check("7a: validacao de status com a lista EXATA aprovada (8 valores)", !!validacaoStatus, JSON.stringify(dataValidationChamadas.map(v => v.lista)));
check("7b: validacao de status com allowInvalid:false (reject input)", validacaoStatus && validacaoStatus.allowInvalid === false);

const validacaoTipoOp = dataValidationChamadas.find(v => JSON.stringify(v.lista) === JSON.stringify(TIPO_OP_ESPERADO));
check("7c: validacao de tipo_operacao com a lista EXATA aprovada (8 valores)", !!validacaoTipoOp);
check("7d: validacao de tipo_operacao com allowInvalid:false", validacaoTipoOp && validacaoTipoOp.allowInvalid === false);

const validacaoErroCodigo = dataValidationChamadas.find(v => JSON.stringify(v.lista) === JSON.stringify(ERRO_CODIGO_ESPERADO));
check("7e: validacao de erro_codigo com a lista EXATA aprovada (11 valores)", !!validacaoErroCodigo);
check("7f: validacao de erro_codigo com allowInvalid:false", validacaoErroCodigo && validacaoErroCodigo.allowInvalid === false);

const validacaoTentativas = dataValidationChamadas.find(v => v.formula);
// Formula com ';' (nao ',') -- planilha real e locale pt-BR, confirmado
// ao vivo que virgula quebra requireFormulaSatisfied ("argumento da regra
// de validacao de dados e invalido"). Mesmo valor logico da spec aprovada.
check("8a: validacao de tentativas usa a formula EXATA aprovada (separador ';', locale pt-BR)", validacaoTentativas && validacaoTentativas.formula === "=AND(ISNUMBER(K2); K2>=0; K2=INT(K2))", JSON.stringify(validacaoTentativas));
check("8b: validacao de tentativas com allowInvalid:false", validacaoTentativas && validacaoTentativas.allowInvalid === false);

// 8c) entity_version (coluna 17, Outbox) como inteiro '0', mesmo
// tratamento de tentativas.
check("8c: coluna 17 (entity_version) formatada como inteiro '0'", instr.chamadas.setNumberFormat.some(c => c.c === 17 && c.fmt === "0"));

// 8d) entity_type (Outbox) com Reject input, lista fechada dos 6
// destinos de roteamento (ARQUITETURA-SYNC-LOG-CENTRAL.md, ponto 6).
const ENTITY_TYPE_ESPERADO = ["OS_ESTADO", "FOTO", "CHECKLIST", "ASSINATURA", "MEDICAO", "APONTAMENTO"];
const validacaoEntityType = dataValidationChamadas.find(v => JSON.stringify(v.lista) === JSON.stringify(ENTITY_TYPE_ESPERADO));
check("8e: validacao de entity_type com a lista EXATA (6 valores)", !!validacaoEntityType, JSON.stringify(dataValidationChamadas.map(v => v.lista)));
check("8f: validacao de entity_type com allowInvalid:false", validacaoEntityType && validacaoEntityType.allowInvalid === false);

// 9) consistencia: TODO valor de tipo_operacao/status que o codigo real
// ESCREVE em algum lugar tem que estar dentro da lista aprovada -- senao
// a propria escrita do meu codigo seria rejeitada pela validacao real.
const tiposEscritosNoCodigo = [...CODIGO.matchAll(/executarIdempotente\(operationId,\s*(?:'([A-Z_]+)'|tipoOp)/g)].map(m => m[1]).filter(Boolean);
const foraDaLista = tiposEscritosNoCodigo.filter(t => !TIPO_OP_ESPERADO.includes(t));
check("9a: todo tipo_operacao hardcoded no codigo esta na lista aprovada", foraDaLista.length === 0, "fora da lista: " + JSON.stringify(foraDaLista) + " | encontrados: " + JSON.stringify(tiposEscritosNoCodigo));

const statusEscritos = [...CODIGO.matchAll(/setValue\('([A-Z_]+)'\)/g)].map(m => m[1]).filter(s => STATUS_ESPERADO.includes(s) || /^(SENDING|SYNCED|SYNC_ERROR)$/.test(s));
const statusForaDaLista = statusEscritos.filter(s => !STATUS_ESPERADO.includes(s));
check("9b: todo status hardcoded (SENDING/SYNCED/SYNC_ERROR) esta na lista aprovada", statusForaDaLista.length === 0, JSON.stringify(statusForaDaLista));

const codigosErroPossiveis = [...CODIGO.matchAll(/return '([A-Z_]+)';/g)].map(m => m[1]).filter(c => /^[A-Z_]+$/.test(c) && c !== c.toLowerCase());
const codigosForaDaLista = codigosErroPossiveis.filter(c => ERRO_CODIGO_ESPERADO.includes(c) === false && /ERRO|TIMEOUT|QUOTA|PERMISSAO|REFERENCIA|DUPLICADO|CONFLITO|CONEXAO|PAYLOAD/.test(c));
check("9c: classificarErroLogCentral só devolve códigos da lista aprovada", codigosForaDaLista.every(c => ERRO_CODIGO_ESPERADO.includes(c)), JSON.stringify(codigosForaDaLista));

// ============================================================
// 10) REPARO -- achado real (12/08): setupSheets() travou no bug de
// locale pt-BR bem na formula de tentativas, deixando a aba Log_Central
// criada mas SEM essa validacao. A rodada seguinte, que teve sucesso, so
// verificava as 3 colunas outbox via _garantirColunasOutboxLogCentral --
// nao revisitava o resto. Simula uma aba JA EXISTENTE (todas as 18
// colunas no header, como se a criacao tivesse terminado) e confirma que
// chamar garantirLogCentral() de novo REAPLICA as 5 validacoes, nao so
// verifica as colunas outbox/retry.
// ============================================================
{
  const instr2 = makeInstrumentedSheet();
  // getLastColumn DINAMICO (nao mais fixo em 18) -- o backfill real
  // (_garantirColunasOutboxLogCentral) chama getLastColumn() de novo
  // DENTRO do forEach, uma vez por coluna faltando, esperando que cresca
  // a cada setValue de header novo (mesmo comportamento do Sheets real).
  // Fixo em 18 fazia 2 colunas faltando (Retry_Manual_Por/Em, 14/08)
  // colidirem na mesma posicao 19.
  instr2.sheet.getLastColumn = () => (instr2.headerData[0] || []).length;
  instr2.headerData.push([
    "operation_id", "OS_ID", "tecnico_id", "dispositivo_id", "tipo_operacao",
    "criado_em", "enviado_em", "recebido_em", "sincronizado_em",
    "status", "tentativas", "erro_codigo", "erro_detalhe", "resultado_json",
    "entity_type", "entity_id", "entity_version", "Teto_Excedido",
  ]);
  const realGetRange2 = instr2.sheet.getRange.bind(instr2.sheet);
  instr2.sheet.getRange = function (r, c, nr, nc) {
    if (r === 1 && c === 1 && nr === 1 && nc === instr2.sheet.getLastColumn()) return { getValues: () => [instr2.headerData[0]] };
    return realGetRange2(r, c, nr, nc);
  };

  const dataValidationChamadas2 = [];
  const sandbox2 = {
    SHEET_ID: "fake",
    SpreadsheetApp: {
      openById() { return { getSheetByName: () => instr2.sheet }; }, // aba JA EXISTE
      newDataValidation() {
        const registro = { lista: null, formula: null, allowInvalid: null };
        dataValidationChamadas2.push(registro);
        const builder = {
          requireValueInList(lista, mostrarDropdown) { registro.lista = lista; registro.mostrarDropdown = mostrarDropdown; return builder; },
          requireFormulaSatisfied(f) { registro.formula = f; return builder; },
          setAllowInvalid(v) { registro.allowInvalid = v; return builder; },
          build() { return registro; },
        };
        return builder;
      },
    },
    Utilities: { DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" }, computeDigest: () => [], getUuid: () => "uuid" },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} }, console,
  };
  vm.createContext(sandbox2);
  vm.runInContext(CODIGO, sandbox2, { filename: "Código.js" });
  vm.runInContext(API, sandbox2, { filename: "API.js" });

  sandbox2.garantirLogCentral({ getSheetByName: () => instr2.sheet });

  const validacaoTentativas2 = dataValidationChamadas2.find(v => v.formula);
  check("10a: reparo de aba ja existente REAPLICA a formula de tentativas", validacaoTentativas2 && validacaoTentativas2.formula === "=AND(ISNUMBER(K2); K2>=0; K2=INT(K2))", JSON.stringify(validacaoTentativas2));
  check("10b: reparo reaplica validacao de status (nao so as colunas outbox)", dataValidationChamadas2.some(v => JSON.stringify(v.lista) === JSON.stringify(STATUS_ESPERADO)));
  check("10c: reparo reaplica validacao de tipo_operacao", dataValidationChamadas2.some(v => JSON.stringify(v.lista) === JSON.stringify(TIPO_OP_ESPERADO)));
  check("10d: reparo reaplica validacao de entity_type", dataValidationChamadas2.some(v => JSON.stringify(v.lista) === JSON.stringify(ENTITY_TYPE_ESPERADO)));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
