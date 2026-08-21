// Teste real do aceite da oferta via link profundo (Frente B, fatia 5
// -- Diretriz v1.1, SPEC-PWA-TECNICO.md §1). Roda o <script> DE
// VERDADE de index.html via vm, gsCallReal mockado (qualquer action
// não coberta derruba o teste -- nenhuma chamada de rede real).
//
// getOfertaAlocacao/registrarAceiteOferta AINDA NÃO EXISTEM no backend
// -- este teste prova que o FRONTEND está correto contra o contrato
// proposto (CONTRATO-BACKEND-ACEITE-OFERTA.md), não que o fluxo já
// funciona em produção.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { URLSearchParams } = require('url');
const crypto = require('crypto');

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
    classList: { add() {}, remove() {}, contains() { return false; } },
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
sandbox.URLSearchParams = URLSearchParams;
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

// Simula o backend assinando um link (algoritmo do contrato -- só pra
// dar um sig plausível nos testes; o app nunca faz esse cálculo).
function assinar(id, tecnico, exp, segredo) {
  return crypto.createHmac('sha256', segredo).update(id + '|' + tecnico + '|' + exp).digest('hex');
}
const SEGREDO_TESTE = 'segredo-de-teste-nao-real';

const chamadasRede = [];
let respostaOferta = null;
let respostaAceite = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (action === 'validarPin') {
    const [tecnicoId, pin] = params;
    if (tecnicoId === 'T-900' && pin === '1234') return Promise.resolve({ valido: true });
    return Promise.resolve({ valido: false, erro: 'PIN incorreto. Tente novamente.' });
  }
  if (action === 'getOfertaAlocacao') {
    if (!respostaOferta) throw new Error('respostaOferta nao configurada');
    const r = respostaOferta; respostaOferta = null; return Promise.resolve(r);
  }
  if (action === 'registrarAceiteOferta') {
    if (!respostaAceite) throw new Error('respostaAceite nao configurada');
    const r = respostaAceite; respostaAceite = null; return Promise.resolve(r);
  }
  // getTecnicos etc. (login normal) -- só usado no teste de regressão.
  if (action === 'getTecnicos') return Promise.resolve([{ id: 'T-1', nome: 'Fulano de Tal' }]);
  if (action === 'getDiariaHoje') return Promise.resolve({ existe: false });
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);

async function main() {
  // ================================================================
  // 1) parseLinkOferta -- formatos válido/inválido/ausente
  // ================================================================
  await record('parseLinkOferta: link completo e bem formado', async () => {
    ctxSet('location.hash', '#oferta&id=OF-1&tecnico=T-900&exp=9999999999&sig=abc123');
    const link = ctxCall('parseLinkOferta()');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(link)), { id: 'OF-1', tecnico: 'T-900', exp: '9999999999', sig: 'abc123' });
  });

  await record('parseLinkOferta: hash sem prefixo "oferta" -> null (app abre normal)', async () => {
    ctxSet('location.hash', '#qualquercoisa');
    assert.strictEqual(ctxCall('parseLinkOferta()'), null);
  });

  await record('parseLinkOferta: hash vazio -> null', async () => {
    ctxSet('location.hash', '');
    assert.strictEqual(ctxCall('parseLinkOferta()'), null);
  });

  await record('parseLinkOferta: faltando campo obrigatorio (sig) -> null, nao tenta prosseguir com link incompleto', async () => {
    ctxSet('location.hash', '#oferta&id=OF-1&tecnico=T-900&exp=9999999999');
    assert.strictEqual(ctxCall('parseLinkOferta()'), null);
  });

  // ================================================================
  // 2) Gate de PIN dedicado -- nao usa o fluxo normal de login
  // ================================================================
  await record('confirmarPinOferta: PIN errado mostra erro e nao chama getOfertaAlocacao', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.ofertaLink', { id: 'OF-1', tecnico: 'T-900', exp: '9999999999', sig: 'x' });
    ctxSet('document.getElementById("oferta-pin-input").value', '0000');
    await act('confirmarPinOferta()');
    const erro = ctxGet("document.getElementById('oferta-pin-erro').style.display");
    assert.strictEqual(erro, 'flex');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'getOfertaAlocacao').length, 0);
    assert.strictEqual(ctxGet('APP.tecnico'), null, 'PIN da oferta nao deveria logar o tecnico na sessao normal do app');
  });

  await record('confirmarPinOferta: PIN certo chama getOfertaAlocacao com os 4 campos do link', async () => {
    chamadasRede.length = 0;
    ctxSet('document.getElementById("oferta-pin-input").value', '1234');
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-900', escopoResumo: 'Reaperto de conexoes', valorProposto: '', expiraEm: '13/08 18:00' };
    await act('confirmarPinOferta()');
    const chamada = chamadasRede.find(c => c.action === 'getOfertaAlocacao');
    assert.ok(chamada, 'deveria ter chamado getOfertaAlocacao apos PIN valido');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(chamada.params)), ['OF-1', 'T-900', '9999999999', 'x']);
    const osId = ctxGet("document.getElementById('oferta-os-id').textContent");
    assert.strictEqual(osId, 'OS-900');
  });

  // ================================================================
  // 3) Os 3 desfechos de getOfertaAlocacao que o frontend precisa tratar
  // ================================================================
  await record('getOfertaAlocacao: link invalido (assinatura errada) mostra erro, sem vazar se a oferta existe', async () => {
    ctxSet('APP.ofertaLink', { id: 'OF-2', tecnico: 'T-900', exp: '9999999999', sig: 'invalida' });
    respostaOferta = { encontrada: false, erro: 'Link inválido' };
    await act('carregarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Link inválido');
  });

  await record('getOfertaAlocacao: oferta expirada mostra tela de expirada, nao a de aceite', async () => {
    respostaOferta = { encontrada: true, expirada: true, expiraEm: '10/08 12:00' };
    await act('carregarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Oferta expirada');
  });

  await record('getOfertaAlocacao: oferta ja respondida (Aceita) mostra aviso, nao deixa responder de novo', async () => {
    respostaOferta = { encontrada: true, status: 'Aceita' };
    await act('carregarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Oferta já respondida');
  });

  // ================================================================
  // 4) Aceite e recusa
  // ================================================================
  await record('aceitarOferta(): registra com aceito=true e motivo vazio', async () => {
    chamadasRede.length = 0;
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-901', escopoResumo: 'Diagnostico', valorProposto: '350,00', expiraEm: '13/08 18:00' };
    await act('carregarOferta()');
    const valorTxt = ctxGet("document.getElementById('oferta-valor').textContent");
    assert.strictEqual(valorTxt, 'R$ 350,00');

    respostaAceite = { sucesso: true, operationId: 'x' };
    await act('aceitarOferta()');
    const chamada = chamadasRede.find(c => c.action === 'registrarAceiteOferta');
    assert.ok(chamada);
    const [ofertaId, tecnicoId, aceito, motivo] = chamada.params;
    assert.strictEqual(ofertaId, 'OF-2'); // ainda a osKMPendenteAtual... na verdade ofertaLink foi setado no teste anterior (OF-2)
    assert.strictEqual(tecnicoId, 'T-900');
    assert.strictEqual(aceito, true);
    assert.strictEqual(motivo, '');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Oferta aceita!');
  });

  await record('recusarOferta(): exige motivo -- sem motivo nao chama o backend', async () => {
    chamadasRede.length = 0;
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-902', escopoResumo: 'Limpeza', valorProposto: '', expiraEm: '' };
    await act('carregarOferta()');
    ctxSet('document.getElementById("oferta-motivo-recusa").value', '');
    await act('recusarOferta()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarAceiteOferta').length, 0, 'sem motivo, nao deveria ter chamado o backend');
  });

  await record('recusarOferta(): com motivo, registra aceito=false e o motivo', async () => {
    ctxSet('document.getElementById("oferta-motivo-recusa").value', 'Sem disponibilidade nesse dia');
    respostaAceite = { sucesso: true };
    await act('recusarOferta()');
    const chamada = chamadasRede.find(c => c.action === 'registrarAceiteOferta');
    assert.ok(chamada);
    assert.strictEqual(chamada.params[2], false);
    assert.strictEqual(chamada.params[3], 'Sem disponibilidade nesse dia');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Oferta recusada');
  });

  await record('registrarAceiteOferta offline: enfileira e avisa, nao trata como erro', async () => {
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-903', escopoResumo: 'Medicao', valorProposto: '', expiraEm: '' };
    await act('carregarOferta()');
    respostaAceite = { sucesso: true, offline: true };
    await act('aceitarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    assert.strictEqual(titulo, 'Aceite enfileirado');
  });

  // ================================================================
  // 4b) Achado da auditoria de mensagens (12/08): recusa de regra de
  //     negocio agora usa motivosRecusa (blocking_reasons + retryable),
  //     mesmo padrao do fix em capturarEUpload/ferramental/checklist/KM.
  //     mostrarStatusOferta ja tem titulo proprio, entao so o motivo
  //     entra no corpo -- mas retryable ainda distingue o titulo.
  // ================================================================
  await record('_registrarAceiteOferta: recusa de regra de negocio (retryable:false) mostra o motivo real, titulo sem "tente novamente"', async () => {
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-904', escopoResumo: 'Reaperto', valorProposto: '', expiraEm: '' };
    await act('carregarOferta()');
    respostaAceite = { sucesso: false, success: false, retryable: false, erro: 'Oferta ja foi retirada pelo gestor', blocking_reasons: ['Oferta ja foi retirada pelo gestor'] };
    await act('aceitarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    const msg = ctxGet("document.getElementById('oferta-status-msg').textContent");
    assert.strictEqual(titulo, 'Não foi possível registrar');
    assert.strictEqual(msg, 'Oferta ja foi retirada pelo gestor');
  });

  await record('_registrarAceiteOferta: falha transitoria (retryable:true) muda o titulo pra convidar a tentar de novo', async () => {
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-905', escopoResumo: 'Medicao', valorProposto: '', expiraEm: '' };
    await act('carregarOferta()');
    respostaAceite = { sucesso: false, success: false, retryable: true, erro: 'Sistema ocupado, tente novamente em instantes', blocking_reasons: ['Sistema ocupado, tente novamente em instantes'] };
    await act('aceitarOferta()');
    const titulo = ctxGet("document.getElementById('oferta-status-titulo').textContent");
    const msg = ctxGet("document.getElementById('oferta-status-msg').textContent");
    assert.strictEqual(titulo, 'Não foi possível registrar (tente novamente)');
    assert.strictEqual(msg, 'Sistema ocupado, tente novamente em instantes');
  });

  await record('_registrarAceiteOferta: sem blocking_reasons, cai no fallback erro/"motivo nao informado"', async () => {
    respostaOferta = { encontrada: true, status: 'Pendente', osId: 'OS-906', escopoResumo: 'Instalacao', valorProposto: '', expiraEm: '' };
    await act('carregarOferta()');
    respostaAceite = { sucesso: false, success: false, retryable: false };
    await act('aceitarOferta()');
    const msg = ctxGet("document.getElementById('oferta-status-msg').textContent");
    assert.strictEqual(msg, 'motivo não informado');
  });

  // ================================================================
  // 5) Assinatura HMAC do contrato -- so documenta o algoritmo (o app
  //    nunca calcula isso; é o que o backend faria pra emitir/validar).
  // ================================================================
  await record('algoritmo de assinatura do contrato produz HMAC estavel e sensivel a cada campo', async () => {
    const sig1 = assinar('OF-9', 'T-9', '1000', SEGREDO_TESTE);
    const sig2 = assinar('OF-9', 'T-9', '1000', SEGREDO_TESTE);
    assert.strictEqual(sig1, sig2, 'mesmo input -> mesma assinatura');
    assert.notStrictEqual(assinar('OF-9', 'T-9', '1001', SEGREDO_TESTE), sig1, 'exp diferente -> assinatura diferente');
    assert.notStrictEqual(assinar('OF-9', 'T-8', '1000', SEGREDO_TESTE), sig1, 'tecnico diferente -> assinatura diferente');
  });

  // ================================================================
  // 6) Regressao: login normal (Frente E, protegido) continua intacto
  // ================================================================
  await record('regressao: login normal (getTecnicos/validarPin/getDiariaHoje) nao foi alterado', async () => {
    chamadasRede.length = 0;
    ctxSet('location.hash', '');
    ctxSet('APP.tecnico', null);
    await act('carregarTecnicos()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'getTecnicos').length, 1);
    await act("entrarComoTecnico({ id: 'T-1', nome: 'Fulano de Tal' })");
    ctxSet('document.getElementById("pin-input").value', '1234');
    await act('confirmarPin()'); // validarPin nao mockado pra T-1 -> valido:false, so confirma que o fluxo normal ainda roda sem erro
    assert.strictEqual(chamadasRede.filter(c => c.action === 'validarPin').length, 1);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
