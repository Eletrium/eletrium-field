// Harness Node pra criarOfertaAlocacao (Seção 25, decisão de produto
// fechada 14/08: gestor solicita, backend gera offer_id + define
// tecnico/OS/validade + assina HMAC + retorna link; frontend só
// apresenta). Mesmo padrão dos outros: código real via vm, sheets fake
// em memória, HMAC real (Node crypto) pra provar que o link gerado
// VALIDA de verdade contra getOfertaAlocacao, não só que os campos
// existem na resposta.
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

// HMAC real -- mesmo formato de bytes que Utilities.computeHmacSha256Signature devolve.
function hmacBytes(payload, secret) {
  const h = crypto.createHmac("sha256", secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}

const SEGREDO = "segredo-de-teste-nao-e-o-real";
const ALOCACOES_HEADERS = ['Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
  'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'];

function runScenario(opts) {
  opts = opts || {};
  const sheets = { Alocacoes_Ofertas: makeSheet(ALOCACOES_HEADERS, opts.linhasIniciais || []) };
  if (opts.semAba) delete sheets.Alocacoes_Ofertas;
  const props = { OFERTA_HMAC_SECRET: opts.semSegredo ? undefined : SEGREDO };
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
    PropertiesService: {
      getScriptProperties() { return { getProperty: (key) => (props[key] !== undefined ? props[key] : null) }; },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      computeDigest: () => [], getUuid: () => "uuid-" + Math.floor(Math.random() * 1e9),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
      formatDate: (d, tz, fmt) => new Date(d).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
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
function check(name, cond, detail) { if (cond) { pass++; console.log("OK   " + name); } else { fail++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); } }

// ============================================================
// 1) caminho principal -- cria a linha Pendente, devolve link que
// VALIDA de verdade (end-to-end via getOfertaAlocacao, HMAC real).
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const r = sandbox.criarOfertaAlocacao("OS-1", "TEC-1", "Instalacao eletrica", 500);
  check("1a: sucesso, devolve ofertaId/exp/sig", r.sucesso === true && !!r.ofertaId && !!r.exp && !!r.sig, JSON.stringify(r));

  const dump = sheets.Alocacoes_Ofertas._dump();
  check("1b: 1 linha nova gravada", dump.length === 2, JSON.stringify(dump));
  const linha = dump[1];
  const h = dump[0];
  const g = (col) => linha[h.indexOf(col)];
  check("1c: OS_ID/Tecnico_ID/Escopo_Resumo/Valor_Proposto corretos", g("OS_ID") === "OS-1" && g("Tecnico_ID") === "TEC-1" && g("Escopo_Resumo") === "Instalacao eletrica" && g("Valor_Proposto") === 500, JSON.stringify(linha));
  check("1d: Status = Pendente", g("Status") === "Pendente");
  check("1e: Respondida_Em/Motivo_Recusa vazios (ainda nao respondida)", g("Respondida_Em") === "" && g("Motivo_Recusa") === "");
  check("1f: Criada_Em/Expira_Em sao TEXTO ISO 8601, nao Date nativo", typeof g("Criada_Em") === "string" && /^\d{4}-\d{2}-\d{2}T/.test(g("Criada_Em")) && typeof g("Expira_Em") === "string" && /^\d{4}-\d{2}-\d{2}T/.test(g("Expira_Em")), JSON.stringify([g("Criada_Em"), g("Expira_Em")]));

  // end-to-end: o link devolvido tem que VALIDAR de verdade.
  const consulta = sandbox.getOfertaAlocacao(r.ofertaId, "TEC-1", r.exp, r.sig);
  check("1g: link gerado valida via getOfertaAlocacao (HMAC real bate)", consulta.encontrada === true && consulta.status === "Pendente", JSON.stringify(consulta));
  check("1h: dados devolvidos por getOfertaAlocacao batem com o que foi criado", consulta.osId === "OS-1" && consulta.escopoResumo === "Instalacao eletrica" && consulta.valorProposto === 500, JSON.stringify(consulta));
}

// ============================================================
// 2) linkFragmento no formato exato que o frontend real espera
// (eletrium-field-checklist3/index.html: "oferta&id=...&tecnico=...&exp=...&sig=...")
// ============================================================
{
  const { sandbox } = runScenario();
  const r = sandbox.criarOfertaAlocacao("OS-2", "TEC-2", "Manutencao", 300);
  const esperado = "oferta&id=" + encodeURIComponent(r.ofertaId) + "&tecnico=TEC-2&exp=" + r.exp + "&sig=" + r.sig;
  check("2a: linkFragmento no formato exato esperado pelo frontend", r.linkFragmento === esperado, JSON.stringify(r));

  // simula o parse real do frontend (URLSearchParams sobre o fragmento
  // apos remover o prefixo "oferta&") pra provar que casa de verdade.
  const params = new URLSearchParams(r.linkFragmento.replace(/^oferta&?/, ""));
  check("2b: URLSearchParams extrai os 4 campos exatamente como o frontend faz", params.get("id") === r.ofertaId && params.get("tecnico") === "TEC-2" && params.get("exp") === String(r.exp) && params.get("sig") === r.sig);
}

// ============================================================
// 3) validade padrao (48h) quando validadeHoras nao informado.
// ============================================================
{
  const { sandbox } = runScenario();
  const antes = Date.now();
  const r = sandbox.criarOfertaAlocacao("OS-3", "TEC-3", "Escopo", 100);
  const depois = Date.now();
  const expMs = r.exp * 1000;
  const min48h = antes + 48 * 60 * 60 * 1000 - 2000; // folga de 2s pro tempo de execucao do teste
  const max48h = depois + 48 * 60 * 60 * 1000 + 2000;
  check("3a: exp ~48h no futuro (default)", expMs >= min48h && expMs <= max48h, "exp=" + r.exp + " expMs=" + expMs + " esperado entre " + min48h + " e " + max48h);
}

// ============================================================
// 4) validade customizada respeitada.
// ============================================================
{
  const { sandbox } = runScenario();
  const antes = Date.now();
  const r = sandbox.criarOfertaAlocacao("OS-4", "TEC-4", "Escopo", 100, 2); // 2 horas
  const expMs = r.exp * 1000;
  const min2h = antes + 2 * 60 * 60 * 1000 - 2000;
  const max2h = antes + 2 * 60 * 60 * 1000 + 5000;
  check("4a: validadeHoras customizado (2h) respeitado", expMs >= min2h && expMs <= max2h, "exp=" + r.exp);
}

// ============================================================
// 5) validacao de entrada -- fail-closed ANTES de tocar a planilha.
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const r1 = sandbox.criarOfertaAlocacao("", "TEC-5", "Escopo", 100);
  check("5a: osId vazio recusado", r1.sucesso === false && /osId/.test(r1.erro), JSON.stringify(r1));
  const r2 = sandbox.criarOfertaAlocacao("OS-5", "", "Escopo", 100);
  check("5b: tecnicoId vazio recusado", r2.sucesso === false && /tecnicoId/.test(r2.erro), JSON.stringify(r2));
  const r3 = sandbox.criarOfertaAlocacao("OS-5", "TEC-5", "", 100);
  check("5c: escopoResumo vazio recusado", r3.sucesso === false && /escopoResumo/.test(r3.erro), JSON.stringify(r3));
  check("5d: nada foi gravado nas 3 recusas", sheets.Alocacoes_Ofertas._dump().length === 1);
}

// ============================================================
// 6) sem OFERTA_HMAC_SECRET configurado -- fail-closed, nunca gera um
// link com assinatura vazia/inutil.
// ============================================================
{
  const { sandbox, sheets } = runScenario({ semSegredo: true });
  const r = sandbox.criarOfertaAlocacao("OS-6", "TEC-6", "Escopo", 100);
  check("6a: sem segredo configurado, recusa clara", r.sucesso === false && /HMAC_SECRET/.test(r.erro), JSON.stringify(r));
  check("6b: nada foi gravado", sheets.Alocacoes_Ofertas._dump().length === 1);
}

// ============================================================
// 7) aba Alocacoes_Ofertas inexistente -- recusa clara, nao quebra.
// ============================================================
{
  const { sandbox } = runScenario({ semAba: true });
  const r = sandbox.criarOfertaAlocacao("OS-7", "TEC-7", "Escopo", 100);
  check("7a: aba inexistente recusada com motivo claro", r.sucesso === false && /Alocacoes_Ofertas/.test(r.erro), JSON.stringify(r));
}

// ============================================================
// 8) valorProposto omitido -- nao quebra, grava vazio.
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const r = sandbox.criarOfertaAlocacao("OS-8", "TEC-8", "Escopo sem valor definido");
  check("8a: sucesso mesmo sem valorProposto", r.sucesso === true, JSON.stringify(r));
  const dump = sheets.Alocacoes_Ofertas._dump();
  check("8b: Valor_Proposto gravado vazio", dump[1][dump[0].indexOf("Valor_Proposto")] === "");
}

// ============================================================
// 9) via executarAcao (API.js) -- prova que o dispatcher repassa os 5
// parametros corretamente.
// ============================================================
{
  const { sandbox } = runScenario();
  const r = sandbox.executarAcao('criarOfertaAlocacao', ["OS-9", "TEC-9", "Escopo via dispatcher", 700, 24]);
  check("9a: dispatcher repassa todos os parametros corretamente", r.sucesso === true && r.ofertaId, JSON.stringify(r));
  const expMs = r.exp * 1000;
  check("9b: validadeHoras (24) do dispatcher chegou certo na funcao", expMs <= Date.now() + 25 * 60 * 60 * 1000, "exp=" + r.exp);
}

// ============================================================
// 10) fluxo completo -- gerar oferta e o tecnico DONO aceitando de
// verdade (registrarAceiteOferta), provando integracao ponta a ponta
// entre criacao e resposta.
// ============================================================
{
  const { sandbox, sheets } = runScenario();
  const criada = sandbox.criarOfertaAlocacao("OS-10", "TEC-10", "Instalacao completa", 1200);
  check("10a: oferta criada com sucesso", criada.sucesso === true, JSON.stringify(criada));

  const aceite = sandbox.registrarAceiteOferta(criada.ofertaId, "TEC-10", true, null, "op-aceite-10", "DEV-1");
  check("10b: tecnico dono consegue aceitar a oferta recem-criada", aceite.sucesso === true && aceite.status === "Aceita", JSON.stringify(aceite));

  const intruso = sandbox.registrarAceiteOferta(criada.ofertaId, "TEC-INTRUSO", true, null, "op-aceite-10b", "DEV-1");
  check("10c: intruso recusado (oferta ja respondida, alem de nao ser dono)", intruso.sucesso === false, JSON.stringify(intruso));
}

console.log("\n" + pass + " passou / " + fail + " falhou");
process.exit(fail > 0 ? 1 : 0);
