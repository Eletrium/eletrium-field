// Teste real do registro de ferramental (Frente B, fatia 6 -- Diretriz
// v1.1). Roda o <script> DE VERDADE de index.html via vm, gsCallReal
// mockado (qualquer action não coberta derruba o teste -- nenhuma
// chamada de rede real).
//
// registrarMovimentoFerramental/getFerramentalDaOS AINDA NÃO EXISTEM no
// backend -- este teste prova que o FRONTEND está correto contra o
// contrato proposto (CONTRATO-BACKEND-FERRAMENTAL.md), não que o fluxo
// já funciona em produção.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Nenhum <script> encontrado em index.html');
const appScript = scriptMatch[1];

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message + '\n' + (e.stack || '') }); }
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}
function makeElement() {
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, setAttribute() {}, focus() {},
  };
}
function makeDocument() {
  const els = new Map();
  return {
    getElementById(id) { if (!els.has(id)) els.set(id, makeElement()); return els.get(id); },
    querySelectorAll() { return []; },
    querySelector() { return makeElement(); },
    createElement() { return makeElement(); },
    body: makeElement(),
    addEventListener() {},
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.scrollTo = () => {};
sandbox.confirm = () => true;
sandbox.navigator = { onLine: true };
sandbox.document = makeDocument();
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.location = { hash: '', pathname: '/index.html', search: '' };
sandbox.history = { replaceState() {} };
sandbox.fetch = () => { throw new Error('fetch() não deveria ser chamado neste teste'); };
sandbox.indexedDB = undefined;

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr) { const r = ctxCall(expr); await flush(); return r; }

const chamadasRede = [];
let respostaRegistro = null;
let respostaLista = [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (action === 'getFerramentalDaOS') return Promise.resolve(respostaLista);
  if (action === 'registrarMovimentoFerramental') {
    if (!respostaRegistro) throw new Error('respostaRegistro nao configurada');
    const r = respostaRegistro; respostaRegistro = null; return Promise.resolve(r);
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Técnico Teste' });

function osFalsa(id) { return { id, cliente: 'Cliente ' + id }; }

async function main() {
  // ================================================================
  // 1) Abrir a tela: carrega os registros já feitos, começa em Carga
  // ================================================================
  await record('irParaFerramental(): abre em modo Carga e carrega a lista existente', async () => {
    chamadasRede.length = 0;
    respostaLista = [{ patrimonioCodigo: 'FER-001', tipoMovimento: 'Carga', estadoOk: true, observacao: '' }];
    ctxSet('APP.osAtiva', osFalsa('OS-700'));
    await act('irParaFerramental()');
    assert.strictEqual(ctxGet('APP.ferramentalTipo'), 'Carga');
    const chamada = chamadasRede.find(c => c.action === 'getFerramentalDaOS');
    assert.ok(chamada);
    assert.strictEqual(chamada.params[0], 'OS-700');
    const lista = ctxGet("document.getElementById('ferramental-lista').innerHTML");
    assert.ok(lista.includes('FER-001'), 'deveria ter renderizado o registro ja existente');
  });

  // ================================================================
  // 2) Alternar tipo mostra/esconde o bloco de desmobilização
  // ================================================================
  await record('selecionarTipoFerramental("Desmobilizacao"): mostra o bloco de estado/observacao', async () => {
    ctxCall("selecionarTipoFerramental('Desmobilizacao')");
    assert.strictEqual(ctxGet('APP.ferramentalTipo'), 'Desmobilizacao');
    assert.strictEqual(ctxGet("document.getElementById('ferramental-desmob-bloco').style.display"), 'block');
  });

  // ================================================================
  // 3) Validações client-side antes de chamar o backend
  // ================================================================
  await record('registrarMovimentoFerramental(): sem codigo de patrimonio, nao chama o backend', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Carga')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', '');
    await act('registrarMovimentoFerramental()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarMovimentoFerramental').length, 0);
  });

  await record('registrarMovimentoFerramental(): desmobilizacao com estado nao-OK exige observacao', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Desmobilizacao')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-002');
    ctxSet('document.getElementById("ferramental-estado-ok").checked', false);
    ctxSet('document.getElementById("ferramental-observacao").value', '');
    await act('registrarMovimentoFerramental()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarMovimentoFerramental').length, 0, 'sem observacao, nao deveria ter chamado o backend');
  });

  // ================================================================
  // 4) Fluxo feliz -- Carga
  // ================================================================
  await record('registrarMovimentoFerramental(): Carga bem-sucedida limpa o formulario e recarrega a lista', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Carga')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-003');
    respostaRegistro = { sucesso: true };
    respostaLista = [
      { patrimonioCodigo: 'FER-001', tipoMovimento: 'Carga', estadoOk: true, observacao: '' },
      { patrimonioCodigo: 'FER-003', tipoMovimento: 'Carga', estadoOk: true, observacao: '' },
    ];
    await act('registrarMovimentoFerramental()');
    const chamada = chamadasRede.find(c => c.action === 'registrarMovimentoFerramental');
    assert.ok(chamada);
    const [osId, tecnicoId, patrimonio, tipo, estadoOk, observacao] = chamada.params;
    assert.strictEqual(osId, 'OS-700');
    assert.strictEqual(tecnicoId, 'T1');
    assert.strictEqual(patrimonio, 'FER-003');
    assert.strictEqual(tipo, 'Carga');
    assert.strictEqual(estadoOk, true); // Carga nao le o checkbox -- so relevante em Desmobilizacao
    assert.strictEqual(observacao, '');
    assert.strictEqual(ctxGet("document.getElementById('ferramental-patrimonio').value"), '', 'deveria ter limpado o campo apos sucesso');
    const lista = ctxGet("document.getElementById('ferramental-lista').innerHTML");
    assert.ok(lista.includes('FER-003'), 'lista deveria ter recarregado com o novo item');
  });

  // ================================================================
  // 5) Fluxo feliz -- Desmobilizacao com problema relatado
  // ================================================================
  await record('registrarMovimentoFerramental(): Desmobilizacao com estado nao-OK e observacao preenchida passa', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Desmobilizacao')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-004');
    ctxSet('document.getElementById("ferramental-estado-ok").checked', false);
    ctxSet('document.getElementById("ferramental-observacao").value', 'Cabo desgastado');
    respostaRegistro = { sucesso: true };
    respostaLista = [];
    await act('registrarMovimentoFerramental()');
    const chamada = chamadasRede.find(c => c.action === 'registrarMovimentoFerramental');
    assert.ok(chamada);
    assert.strictEqual(chamada.params[3], 'Desmobilizacao');
    assert.strictEqual(chamada.params[4], false);
    assert.strictEqual(chamada.params[5], 'Cabo desgastado');
  });

  // ================================================================
  // 6) Backend recusa / offline / erro de rede -- nao trava o app
  // ================================================================
  await record('registrarMovimentoFerramental(): backend recusa (success:false) mostra erro, nao finge sucesso', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Carga')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-005');
    respostaRegistro = { success: false, erro: 'Campo invalido (simulado)' };
    await act('registrarMovimentoFerramental()');
    // campo nao deveria ter sido limpo numa falha
    assert.strictEqual(ctxGet("document.getElementById('ferramental-patrimonio').value"), 'FER-005');
  });

  // ================================================================
  // Achado da auditoria de mensagens (12/08), extensao do fix ja
  // aplicado em capturarEUpload/enviarSelfieEPI: usa mensagemRecusa
  // (blocking_reasons + retryable), nao mais so r.erro cru.
  // ================================================================
  await record('registrarMovimentoFerramental(): recusa de regra de negocio (retryable:false) mostra o motivo real via blocking_reasons', async () => {
    chamadasRede.length = 0;
    ctxCall("selecionarTipoFerramental('Carga')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-007');
    respostaRegistro = { success: false, retryable: false, blocking_reasons: ['Patrimonio ja alocado em outra OS'] };
    await act('registrarMovimentoFerramental()');
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Não foi possível registrar o movimento: Patrimonio ja alocado em outra OS');
  });

  await record('registrarMovimentoFerramental(): falha transitoria (retryable:true) enquadra como "tente novamente" com o motivo', async () => {
    chamadasRede.length = 0;
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-008');
    respostaRegistro = { success: false, retryable: true, blocking_reasons: ['Sistema ocupado, tente novamente em instantes'] };
    await act('registrarMovimentoFerramental()');
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Falha ao registrar o movimento (tente novamente): Sistema ocupado, tente novamente em instantes');
  });

  await record('registrarMovimentoFerramental(): sem blocking_reasons, cai no fallback erro/"motivo nao informado"', async () => {
    chamadasRede.length = 0;
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-009');
    respostaRegistro = { success: false, retryable: false };
    await act('registrarMovimentoFerramental()');
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Não foi possível registrar o movimento: motivo não informado');
  });

  await record('registrarMovimentoFerramental(): offline enfileira sem travar', async () => {
    chamadasRede.length = 0;
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-006');
    respostaRegistro = { sucesso: true, offline: true };
    respostaLista = [];
    await act('registrarMovimentoFerramental()');
    assert.strictEqual(ctxGet("document.getElementById('ferramental-patrimonio').value"), '', 'offline tambem conta como sucesso local (enfileirado) e limpa o formulario');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
