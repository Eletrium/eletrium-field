// Harness Node pra Onda 1 do rollout da Opcao A (token de sessao HMAC) --
// PLANO-ROLLOUT-OPCAO-A-TOKEN-SESSAO.md, aprovado 15/08. Cobre as 9
// funcoes com verificarPosseOS (+ threading pelas wrappers
// iniciarOSComGeo/encerrarOSComKM) com os 4 cenarios pedidos:
// positivo (token valido do proprio tecnico), negativo (token de OUTRO
// tecnico -- o cerne do E-TOCTOU-01), sem token (retrocompat da fase de
// transicao), expirado.
//
// Design de fixture: Ordens_Servico tem 1 linha, ID_Tecnico='TEC-OWNER'
// (NUNCA bate com o tecnicoId usado nas chamadas, 'TEC-1'/'TEC-2') --
// de proposito, pra isolar o comportamento do guard de identidade sem
// precisar de fixture completo (Log_Central/Checklist_Respostas/etc)
// pra cada uma das 9 funcoes: como a posse SEMPRE falha por design,
// toda chamada para ANTES de tocar em executarIdempotente/negocio real.
// - "sem token": cai na posse, recusa com msg de POSSE (comportamento
//   antigo, inalterado).
// - "token valido" (TEC-1): passa no guard de identidade, cai na MESMA
//   recusa de posse de cima -- prova que token valido nao e bloqueado
//   no novo guard.
// - "token de outro tecnico" (emitido pra TEC-2, chamada alega TEC-1):
//   recusa no guard de identidade, NUNCA chega na posse -- prova que
//   "autenticado como X, agindo como Y" e barrado (E-TOCTOU-01).
// - "expirado": recusa no guard de identidade por validade, mesma
//   short-circuit.
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

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

function hmacBytes(payload, secret) {
  const h = crypto.createHmac("sha256", secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}

const SEGREDO = "segredo-onda1-de-teste-nao-e-o-real";
const OS_HEADERS = ['OS_ID', 'ID_Tecnico', 'Tecnico_Nome', 'Status', 'Status_Atual', 'Em_Pausa_Agora', 'Estado_Seguranca', 'Checklist_Execucao_Completo'];

function makeDataValidationBuilder() {
  const b = { requireValueInList() { return b; }, requireFormulaSatisfied() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
  return b;
}

function makeSandbox(agora) {
  const sheets = {
    Ordens_Servico: makeSheet(OS_HEADERS, [['OS-1', 'TEC-OWNER', 'Dono Real', '', '', false, '', false]]),
    OS_Segmentos: makeSheet(
      ['ID', 'OS_ID', 'IDSharePoint', 'Tecnico_ID', 'Tecnico_Nome', 'Tipo', 'Timestamp', 'Dur_Min', 'Horas_Acum', 'Lat', 'Lng', 'Ativo', 'Local'], []
    ),
    Diaria_Tecnico: makeSheet(
      ['Data', 'Tecnico_ID', 'Tecnico_Nome', 'Hora_Entrada', 'Hora_Saida', 'Horas_Produtivas',
       'Horas_Pausadas', 'Total_Horas', 'Qtd_OS', 'OS_Lista', 'Clientes_Atendidos',
       'Qtd_Interrupcoes', 'Status_Dia', 'Custo_MO_Total', 'IDSharePoint'], []
    ),
    Perguntas_Checklist: makeSheet(
      ['ID_Pergunta', 'Fase_Execucao', 'Obrigatoria', 'Ativo', 'Pergunta_Pai', 'Condicao_Exibicao'], []
    ),
    Checklist_Respostas: makeSheet(
      ['ID_OS', 'Pergunta_ID', 'Gerou_NC', 'Timestamp', 'Resposta_Dada'], []
    ),
  };
  const props = { SESSAO_HMAC_SECRET: SEGREDO };
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
    PropertiesService: { getScriptProperties() { return { getProperty: (key) => (props[key] !== undefined ? props[key] : null) }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
      formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(0, 10),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    console,
    Date: agora ? class extends Date { constructor(...a) { super(...(a.length ? a : [agora])); } static now() { return agora; } } : Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: "Código.js" });
  vm.runInContext(API, sandbox, { filename: "API.js" });
  return { sandbox, sheets };
}

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

function ehErroToken(msg) { return typeof msg === "string" && /token de sess[aã]o/i.test(msg); }
function ehErroPosse(msg) { return typeof msg === "string" && /posse/i.test(msg); }

// callFn(sandbox, tokenParaEmitir, tecnicoIdChamada) -> roda os 4 cenarios
// contra uma funcao dada, injetando o token na ULTIMA posicao dos args
// fornecidos por montarArgs(token).
function rodar4Cenarios(nomeFuncao, montarArgs) {
  // 1) sem token
  {
    const { sandbox: sb } = makeSandbox();
    const r = sb[nomeFuncao](...montarArgs(sb, undefined));
    check(nomeFuncao + " 1/4 sem token -- cai na posse (comportamento antigo preservado)",
      r.success === false && ehErroPosse(r.erro), JSON.stringify(r));
  }
  // 2) token valido do proprio tecnico (TEC-1) -- passa identidade, cai na MESMA posse
  {
    const { sandbox: sb } = makeSandbox();
    const sessao = sb.emitirTokenSessao("TEC-1");
    const r = sb[nomeFuncao](...montarArgs(sb, sessao.token));
    check(nomeFuncao + " 2/4 token valido (proprio tecnico) -- nao bloqueado na identidade, cai na posse",
      r.success === false && ehErroPosse(r.erro) && !ehErroToken(r.erro), JSON.stringify(r));
  }
  // 3) token de OUTRO tecnico (TEC-2) usado alegando ser TEC-1 -- E-TOCTOU-01
  {
    const { sandbox: sb } = makeSandbox();
    const sessaoOutro = sb.emitirTokenSessao("TEC-2");
    const r = sb[nomeFuncao](...montarArgs(sb, sessaoOutro.token));
    check(nomeFuncao + " 3/4 token de OUTRO tecnico -- recusado na identidade (E-TOCTOU-01)",
      r.success === false && ehErroToken(r.erro), JSON.stringify(r));
  }
  // 4) token expirado
  {
    const agora = Date.now();
    const { sandbox: sbEmitir } = makeSandbox(agora);
    const sessao = sbEmitir.emitirTokenSessao("TEC-1");
    const depois = agora + 25 * 60 * 60 * 1000;
    const { sandbox: sbVerificar } = makeSandbox(depois);
    const r = sbVerificar[nomeFuncao](...montarArgs(sbVerificar, sessao.token));
    check(nomeFuncao + " 4/4 token expirado -- recusado na identidade",
      r.success === false && ehErroToken(r.erro), JSON.stringify(r));
  }
}

// ============================================================
// As 7 funcoes "diretas" -- token e sempre o ULTIMO argumento.
// ============================================================
rodar4Cenarios("salvarArquivoOS", (sb, token) => ["OS-1", "TEC-1", "Laudo_URL", "base64x", "image/png", "arq.png", "op-1", "DEV-1", token]);
rodar4Cenarios("confirmarSegurancaPreExecucao", (sb, token) => ["OS-1", "TEC-1", { epi: true, aterramento: true, bloqueio_energia: true, sinalizacao_area: true }, false, "op-1", "DEV-1", token]);
rodar4Cenarios("salvarSelfieEPI", (sb, token) => ["OS-1", "TEC-1", "base64x", "image/png", "{}", "diario", "op-1", "DEV-1", token]);
rodar4Cenarios("salvarResposta", (sb, token) => ["OS-1", "SP-1", "PERG-1", "texto", "resp", "", "Carlos", false, "op-1", "DEV-1", "TEC-1", token]);
rodar4Cenarios("fecharFaseChecklist", (sb, token) => ["OS-1", "TEC-1", "Execucao", "op-1", "DEV-1", token]);
rodar4Cenarios("registrarMovimentoFerramental", (sb, token) => ["OS-1", "TEC-1", "PAT-001", "Carga", true, "", "op-1", "DEV-1", token]);
rodar4Cenarios("registrarKMFinalPendente", (sb, token) => ["OS-1", "TEC-1", 100, "", "", "op-1", "DEV-1", token]);

// ============================================================
// encerrarOS -- direto, usa _recusa(null, ...) sempre (sem operationId
// proprio). Mesmo helper rodar4Cenarios funciona igual.
// ============================================================
rodar4Cenarios("encerrarOS", (sb, token) => ["OS-1", "TEC-1", "Carlos", { fotosURL: [] }, token]);

// ============================================================
// iniciarOSComGeo -- wrapper, prova que o threading do token ATE
// iniciarOS (por dentro de executarIdempotente) funciona de verdade.
// ============================================================
rodar4Cenarios("iniciarOSComGeo", (sb, token) => ["OS-1", "TEC-1", "Carlos", "Rua X", -23.5, -46.6, "op-1", "DEV-1", token]);

// ============================================================
// encerrarOSComKM -- wrapper, prova o threading ate encerrarOS.
// ============================================================
rodar4Cenarios("encerrarOSComKM", (sb, token) => ["OS-1", "TEC-1", "Carlos", { fotosURL: [] }, null, null, "op-1", "DEV-1", token]);

// ============================================================
// Confirmacao adicional -- token valido do proprio tecnico, POSSE
// batendo tambem (OS realmente pertence ao tecnico) -- prova que o
// caminho 100% feliz (identidade + posse OK) continua chegando no
// sucesso normal, nao so "nao bloqueado". Só pra fecharFaseChecklist
// (fixture mais simples das 9 pra montar posse positiva).
// ============================================================
{
  const { sandbox: sb, sheets } = makeSandbox();
  sheets.Ordens_Servico.appendRow(['OS-2', 'TEC-1', 'Carlos', '', '', false, '', false]);
  const sessao = sb.emitirTokenSessao("TEC-1");
  const r = sb.fecharFaseChecklist("OS-2", "TEC-1", "Execução", "op-feliz", "DEV-1", sessao.token);
  check("fecharFaseChecklist -- caminho 100% feliz (token valido + posse real) chega no sucesso",
    r.success === true || r.sucesso === true, JSON.stringify(r));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
console.log("\nEscopo nao coberto por este harness (sinalizado, nao escondido):");
console.log("- iniciarOSComKM: threading identico ao de iniciarOSComGeo (mesma linha `iniciarOS(..., token)`),");
console.log("  nao testado isolado aqui porque exige fixture de validarESalvarKMInicial (roda ANTES do guard).");
console.log("- iniciarOSComKM nao possui teste dedicado no dispatcher; revisao de codigo confirma o padrao,");
console.log("  mas nao ha prova empirica separada desta rodada.");
process.exit(fail > 0 ? 1 : 0);
