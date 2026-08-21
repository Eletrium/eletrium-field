// Endurece o achado da auditoria TOCTOU (AUDITORIA-TOCTOU-FRONTEND.md):
// os 3 botões nomeados pelo dono (encerrar OS, aceitar oferta, KM final)
// tinham proteção contra duplo-clique só IMPLÍCITA (showLoading síncrono
// + overlay #loading bloqueando clique por baixo) -- funcionava, mas
// nenhum teste pegaria a regressão se um futuro editor inserisse um
// await antes do showLoading(). Pedido do dono: tornar isso um lock
// EXPLÍCITO (ACOES_CRITICAS_EM_ANDAMENTO, index.html), testável
// diretamente -- chamar a função 2x em sequência (simulando duplo-clique
// real, sem esperar a 1a resolver) deve gerar só 1 chamada de rede.
//
// Roda o <script> DE VERDADE via vm, gsCallReal mockado.
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
  const classes = new Set();
  return {
    textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    files: null,
    style: {}, dataset: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      contains: c => classes.has(c),
    },
    addEventListener() {}, setAttribute() {}, focus() {}, querySelector() { return makeElement(); },
    insertBefore() {}, remove() {},
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
sandbox.indexedDB = undefined; // caminho ao vivo nao toca o outbox
sandbox.fetch = () => { throw new Error('fetch() não deveria ser chamado neste teste'); };

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr, voltas) {
  const r = ctxCall(expr);
  for (let i = 0; i < (voltas || 4); i++) await flush();
  return r;
}

const chamadasRede = [];
let resolversPendentes = [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  // Não resolve na hora -- simula rede em voo, pra provar que o 2o
  // "clique" (chamada da função de novo) acontece ENQUANTO a 1a ainda
  // está pendente, o cenário real de duplo-clique/rede lenta.
  return new Promise(resolve => { resolversPendentes.push(resolve); });
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

function resolverTodas(resposta) {
  const rs = resolversPendentes; resolversPendentes = [];
  rs.forEach(r => r(resposta));
}

async function main() {
  // ================================================================
  // 1) confirmarEncerramento() -- encerrar OS
  // ================================================================
  await record('confirmarEncerramento(): 2o "clique" enquanto o 1o ainda esta em voo e ignorado (lock explicito, nao so overlay)', async () => {
    chamadasRede.length = 0; resolversPendentes = [];
    ctxSet('APP.osAtiva', { id: 'OS-LOCK-1', cliente: 'Cliente 1' });
    ctxSet('APP.osPausada', null);
    ctxCall('confirmarEncerramento()'); // 1o "clique", nao espera
    await flush();
    ctxCall('confirmarEncerramento()'); // 2o "clique" -- deveria ser no-op
    await flush(); await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'encerrarOSComKM').length, 1, 'so deveria ter 1 chamada de rede, nao 2');
    resolverTodas({ sucesso: true, offline: false, horasFinais: 4 });
    await flush(); await flush();
    // Depois de resolvido, o lock deveria estar liberado -- uma 3a
    // chamada (nova acao legitima, ex. outra OS) deveria funcionar.
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-LOCK-2', cliente: 'Cliente 2' });
    ctxCall('confirmarEncerramento()');
    await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'encerrarOSComKM').length, 1, 'lock deveria ter liberado depois do 1o terminar -- nova acao devia funcionar normalmente');
    resolverTodas({ sucesso: true, offline: false, horasFinais: 2 });
    await flush();
  });

  // ================================================================
  // 2) _registrarAceiteOferta() -- aceitar/recusar oferta (lock
  //    compartilhado -- e a MESMA operacao critica)
  // ================================================================
  await record('aceitarOferta()/recusarOferta(): lock compartilhado -- clicar ACEITAR e RECUSAR em sequencia rapida so manda 1 chamada', async () => {
    chamadasRede.length = 0; resolversPendentes = [];
    ctxSet('APP.ofertaLink', { id: 'OF-1', tecnico: 'T1' });
    ctxSet('APP.ofertaAtual', { osId: 'OS-OF-1' });
    ctxCall('aceitarOferta()'); // dispara confirm() (mockado como true) e entra na chamada
    await flush();
    ctxCall('recusarOferta()'); // 2a tentativa (motivo vazio -- nem chega a tentar, mas o lock protege de qualquer forma)
    ctxSet('document.getElementById("oferta-motivo-recusa").value', 'Motivo qualquer');
    ctxCall('recusarOferta()'); // com motivo preenchido -- ainda assim deveria ser bloqueado pelo lock
    await flush(); await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarAceiteOferta').length, 1, 'so deveria ter 1 chamada -- aceitar ganhou, recusar foi bloqueado pelo lock compartilhado');
    resolverTodas({ success: true });
    await flush(); await flush();
  });

  // ================================================================
  // 3) confirmarKMFinalPendente() -- registrar KM final (o botao
  //    nomeado explicitamente pelo dono)
  // ================================================================
  await record('confirmarKMFinalPendente(): 2o "clique" enquanto o 1o ainda esta em voo e ignorado', async () => {
    chamadasRede.length = 0; resolversPendentes = [];
    ctxSet('APP.osKMPendenteAtual', { osId: 'OS-KM-LOCK-1' });
    ctxSet('APP.kmDesvioFotoUrl', '');
    ctxCall('document.getElementById("iniciar-km-input").value = "500"');
    ctxCall('document.getElementById("iniciar-km-justificativa").value = ""');
    ctxCall('confirmarKMFinalPendente()');
    await flush();
    ctxCall('confirmarKMFinalPendente()'); // 2o "clique"
    await flush(); await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarKMFinalPendente').length, 1, 'so deveria ter 1 chamada de rede');
    resolverTodas({ sucesso: true });
    ctxSet('APP.kmPendenteFila', []);
    await flush(); await flush();
  });

  // ================================================================
  // 4) Regressão: validação normal (sem lock envolvido) continua
  //    funcionando -- o lock não deveria travar o caminho de erro de
  //    validação (campo vazio nunca chega a adquirir o lock).
  // ================================================================
  await record('regressao: confirmarKMFinalPendente() com campo vazio nao trava nada -- nem chega a adquirir o lock', async () => {
    chamadasRede.length = 0; resolversPendentes = [];
    ctxSet('APP.osKMPendenteAtual', { osId: 'OS-KM-VAZIO' });
    ctxCall('document.getElementById("iniciar-km-input").value = ""');
    await act('confirmarKMFinalPendente()');
    assert.strictEqual(chamadasRede.length, 0, 'nao deveria ter chamado rede (validacao falhou antes)');
    // Confirma que uma tentativa legitima LOGO DEPOIS ainda funciona
    // (prova que a tentativa invalida nao deixou o lock preso).
    ctxCall('document.getElementById("iniciar-km-input").value = "300"');
    ctxCall('confirmarKMFinalPendente()');
    await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarKMFinalPendente').length, 1, 'tentativa legitima logo apos uma invalida deveria funcionar normalmente');
    resolverTodas({ sucesso: true });
    ctxSet('APP.kmPendenteFila', []);
    await flush();
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
