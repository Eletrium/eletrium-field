// HOMOLOGAÇÃO do interceptor REAUTH_REQUIRED do Field contra o BACKEND
// REAL -- não um mock escrito à mão (esse já existe em
// test-reauth-required.js, 20/20). Pendência levantada pelo dono, 25/08:
// o teste anterior validava só contra respostas que EU digitei à mão;
// faltava provar contra código de backend de verdade rodando.
//
// Reusa o MESMO padrão de sandbox que a suíte real do backend usa
// (tests/g5-token-sessao/test-reauth-required-backend.js, branch
// chatgpt/g5-reauth-backend-20260821 do repo pwa -- ainda não mergeada,
// mas é código real, não uma reconstrução minha): Código.js + HMAC_Onda2.js
// + API.js carregados via vm com só os primitivos GAS necessários
// mockados (PropertiesService/Utilities/SpreadsheetApp/LockService --
// SpreadsheetApp.openById lança 'DOWN' de propósito, igual ao harness
// deles -- os guards de sessão retornam ANTES de qualquer acesso a
// planilha, confirmado lendo getOsDoTecnico/getDiariaHoje/
// pausarOSComSessao/retomarOSComSessao em Código.js/HMAC_Onda2.js: "não
// chega no downstream (SpreadsheetApp) com token expirado" é a mesma
// asserção que o teste deles já faz).
//
// executarAcao(action, params) de API.js (o roteador real usado por
// doGet/doPost) vira o `_jsonpBruto` deste teste -- a MESMA função que o
// GitHub Pages chama de verdade via JSONP, não uma reimplementação minha
// do dispatcher.
//
// Fora do escopo aqui (mesma limitação do harness original deles):
// caminhos que exigem SpreadsheetApp de verdade (ex.: validarPin lendo
// Tecnicos_MEI, ou o caminho de SUCESSO de getOsDoTecnico/pausarOS com
// token válido) batem em 'DOWN' -- não é falha do meu código nem do
// deles, é a mesma limitação intencional do sandbox mínimo. O que este
// teste PROVA é que o ENVELOPE de recusa por sessão (reauth_required/
// retryable) que o backend real emite é reconhecido corretamente pelo
// interceptor do Field, ponta a ponta, incluindo a posição real do
// token nos params de cada action (via o dispatcher real, não minha
// leitura de SESSAO_DISPATCHER_POLITICAS).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const PWA_REPO = 'C:/EletriumERP/pwa';
const BACKEND_BRANCH = 'origin/chatgpt/g5-reauth-backend-20260821';

function gitShow(repo, ref, filePath) {
  return execFileSync('git', ['-C', repo, 'show', ref + ':' + filePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
}

let CODIGO, ONDA2, API_JS, backendCommit;
try {
  CODIGO = gitShow(PWA_REPO, BACKEND_BRANCH, 'Código.js');
  ONDA2 = gitShow(PWA_REPO, BACKEND_BRANCH, 'HMAC_Onda2.js');
  API_JS = gitShow(PWA_REPO, BACKEND_BRANCH, 'API.js');
  backendCommit = execFileSync('git', ['-C', PWA_REPO, 'rev-parse', BACKEND_BRANCH], { encoding: 'utf8' }).trim();
} catch (e) {
  console.log('PULADO -- não foi possível ler o backend real via git show (' + e.message + ').');
  console.log('Este teste depende de acesso de leitura ao repo ' + PWA_REPO + ' e ao branch ' + BACKEND_BRANCH + '.');
  process.exit(0);
}

const KEY = 'test-key-reauth-integracao-field';

function hmacBytes(payload) {
  const crypto = require('crypto');
  return Array.from(crypto.createHmac('sha256', KEY).update(String(payload)).digest()).map(b => (b > 127 ? b - 256 : b));
}
// Mesma construção de sandbox do teste real do backend (test-reauth-
// required-backend.js) -- SpreadsheetApp/LockService lançam 'DOWN' de
// propósito, os guards de sessão devem retornar ANTES de chegar lá.
function backendSandbox(now) {
  const crypto = require('crypto');
  const D = now === undefined ? Date : class extends Date {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  };
  const s = {
    console, Date: D,
    PropertiesService: { getScriptProperties() { return { getProperty: k => (k === 'SESSAO_HMAC_SECRET' ? KEY : null) }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (a, v) => Array.from(crypto.createHash('sha256').update(String(v)).digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: p => hmacBytes(p),
      formatDate() { return '2026-08-25'; }, getUuid() { return 'U'; }, base64Decode() { return []; }, newBlob() { return {}; },
    },
    SpreadsheetApp: { openById() { throw new Error('DOWN'); } },
    LockService: { getScriptLock() { throw new Error('DOWN'); } },
    DriveApp: {}, HtmlService: {}, ContentService: {}, Logger: { log() {} },
  };
  vm.createContext(s);
  vm.runInContext(CODIGO, s);
  vm.runInContext(ONDA2, s);
  vm.runInContext(API_JS, s);
  return s;
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Nenhum <script> encontrado em index.html');
const appScript = scriptMatch[1];

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message + '\n' + (e.stack || '') }); }
}

// ---- fake IndexedDB + document/localStorage (mesmo padrão desta suíte) ----
function makeFakeIndexedDB() {
  const databases = new Map();
  const microtask = fn => Promise.resolve().then(fn);
  const macrotask = fn => setImmediate(fn);
  function makeRequest() { return { result: undefined, onsuccess: null, onerror: null }; }
  function makeStoreHandle(storeObj) {
    return {
      indexNames: { contains: n => storeObj.indexes.has(n) },
      createIndex(name, keyPath, opts) { storeObj.indexes.set(name, { keyPath, unique: !!(opts && opts.unique) }); },
      add(value) {
        const req = makeRequest();
        microtask(() => {
          let key = value[storeObj.keyPath];
          if (key === undefined && storeObj.autoIncrement) key = storeObj.nextKey++;
          else if (storeObj.autoIncrement) storeObj.nextKey = Math.max(storeObj.nextKey, key + 1);
          storeObj.data.set(key, Object.assign({}, value, { [storeObj.keyPath]: key }));
          req.result = key;
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      },
      get(key) {
        const req = makeRequest();
        microtask(() => { req.result = storeObj.data.get(key); if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      put(value) {
        const req = makeRequest();
        microtask(() => { storeObj.data.set(value[storeObj.keyPath], value); req.result = value[storeObj.keyPath]; if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      delete(key) {
        const req = makeRequest();
        microtask(() => { storeObj.data.delete(key); if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
      getAll() {
        const req = makeRequest();
        microtask(() => { req.result = Array.from(storeObj.data.values()); if (req.onsuccess) req.onsuccess({ target: req }); });
        return req;
      },
    };
  }
  function makeTransaction(db, storeName) {
    const storeObj = db.stores.get(storeName);
    const tx = { oncomplete: null, onerror: null, objectStore: () => makeStoreHandle(storeObj) };
    macrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
    return tx;
  }
  return {
    open(name) {
      const req = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      macrotask(() => {
        let db = databases.get(name);
        const isNew = !db;
        if (!db) { db = { stores: new Map() }; databases.set(name, db); }
        const dbHandle = {
          objectStoreNames: { contains: n => db.stores.has(n) },
          createObjectStore(storeName, opts) {
            const storeObj = { data: new Map(), keyPath: opts.keyPath, autoIncrement: !!opts.autoIncrement, nextKey: 1, indexes: new Map() };
            db.stores.set(storeName, storeObj);
            return makeStoreHandle(storeObj);
          },
          transaction(storeName) { return makeTransaction(db, storeName); },
        };
        req.result = dbHandle;
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}
function makeLocalStorage() {
  const store = new Map();
  return { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
}
function makeElement(id) {
  const classes = new Set();
  return {
    id: id || '', textContent: '', innerHTML: '', value: '', disabled: false, style: {}, dataset: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)), remove: (...cs) => cs.forEach(c => classes.delete(c)),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); },
      contains: c => classes.has(c),
    },
    addEventListener() {}, setAttribute() {}, focus() {}, querySelector() { return makeElement(); },
  };
}
function makeDocument() {
  const els = new Map();
  function get(id) { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); }
  return {
    getElementById: get,
    querySelectorAll(sel) { if (sel === '.screen') return Array.from(els.values()).filter(e => e.id.indexOf('scr-') === 0); return []; },
    querySelector(sel) {
      if (sel === '.screen.active') return Array.from(els.values()).find(e => e.id.indexOf('scr-') === 0 && e.classList.contains('active')) || null;
      return makeElement();
    },
    createElement() { return makeElement(); }, body: makeElement(), addEventListener() {},
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.scrollTo = () => {};
sandbox.navigator = { onLine: true };
sandbox.document = makeDocument();
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.indexedDB = makeFakeIndexedDB();
sandbox.fetch = () => { throw new Error('fetch() não deveria ser chamado neste teste'); };

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr, voltas) {
  const r = ctxCall(expr);
  for (let i = 0; i < (voltas || 8); i++) await flush();
  return r;
}
function telaAtivaId() { const t = ctxCall('document.querySelector(".screen.active")'); return t ? t.id : null; }

// Backend REAL fixo (relógio parado em `agora`) fazendo o papel de
// _jsonpBruto -- executarAcao(action, params) é o roteador de verdade
// (API.js), não uma reimplementação minha.
const agora = Date.now();
const backendAgora = backendSandbox(agora);
const backendPassado = backendSandbox(agora - 25 * 60 * 60 * 1000); // só pra MINTAR token já expirado
const chamadasBackend = [];
function jsonpViaBackendReal(action, params) {
  chamadasBackend.push({ action, params: params.slice ? params.slice() : params });
  let resultado;
  try { resultado = backendAgora.executarAcao(action, params); }
  catch (e) { return Promise.reject(e); }
  return Promise.resolve(resultado);
}
ctxSet('_jsonpBruto', jsonpViaBackendReal);

async function main() {
  console.log('Backend real carregado de: ' + BACKEND_BRANCH + ' @ ' + backendCommit);
  console.log('(Código.js/HMAC_Onda2.js/API.js -- 3 arquivos, ' + CODIGO.length + '+' + ONDA2.length + '+' + API_JS.length + ' bytes)');
  console.log('');

  const tokenExpiradoReal = backendPassado.emitirTokenSessao('TEC-1').token;
  const tokenValidoReal = backendAgora.emitirTokenSessao('TEC-1').token;
  assert.ok(tokenExpiradoReal, 'sandbox do backend deveria ter emitido um token (SESSAO_HMAC_SECRET mockado)');
  assert.ok(tokenValidoReal, 'idem, token válido');

  ctxSet('APP.tecnico', { id: 'TEC-1', nome: 'Tecnico Um' });

  await record('pausarOS: token REAL expirado -- executarAcao real devolve reauth_required, interceptor do Field detecta corretamente', async () => {
    await act("salvarTokenSessao('" + tokenExpiradoReal + "')");
    chamadasBackend.length = 0;
    const capturado = await ctxCall("gsCallReal('pausarOS', ['OS-1','TEC-1','Nome','Motivo','','OP-1','DEV-1'])").catch(e => e);
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(capturado, 'deveria ter lançado -- backend real recusou por sessão expirada');
    assert.strictEqual(capturado.reauthRequired, true, 'interceptor deveria ter reconhecido reauth_required=true vindo do backend REAL');
    assert.strictEqual(capturado.recusaOriginal.retryable, false, 'contrato: reauth_required=true implica retryable=false (aqui vindo do backend real, não digitado por mim)');
    // Confirma que o token realmente foi pro ULTIMO parametro que o
    // dispatcher REAL (API.js) espera -- pausarOSComSessao(osId,
    // tecnicoId, tecnicoNome, motivo, osInterrupcaoId, operationId,
    // dispositivoId, token) tem 8 posições, token é a 8a.
    const chamada = chamadasBackend[chamadasBackend.length - 1];
    assert.strictEqual(chamada.params.length, 8);
    assert.strictEqual(chamada.params[7], tokenExpiradoReal);
  });

  await record('retomarOS: token REAL expirado -- mesmo comportamento (executarAcao real -> retomarOSComSessao)', async () => {
    chamadasBackend.length = 0;
    const capturado = await ctxCall("gsCallReal('retomarOS', ['OS-1','TEC-1','Nome','OP-2','DEV-1'])").catch(e => e);
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(capturado);
    assert.strictEqual(capturado.reauthRequired, true);
  });

  await record('pausarOS: token REAL VÁLIDO (não expirado) -- interceptor NÃO marca reauthRequired (o erro que sobra é o "DOWN" esperado da planilha mockada, não sessão)', async () => {
    await act("salvarTokenSessao('" + tokenValidoReal + "')");
    chamadasBackend.length = 0;
    const capturado = await ctxCall("gsCallReal('pausarOS', ['OS-1','TEC-1','Nome','Motivo','','OP-3','DEV-1'])").catch(e => e);
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(capturado, 'ainda lança -- backend real segue pra verificarPosseOS/SpreadsheetApp, que o sandbox mínimo não tem');
    assert.notStrictEqual(capturado.reauthRequired, true, 'token válido não pode disparar reauth -- o guard de sessão passou de verdade');
  });

  await record('pausarOS: token de OUTRO técnico (identidade divergente) -- backend real devolve reauth_required:false por contrato, interceptor não entra em loop de reauth', async () => {
    // Token real e válido, mas emitido pra TEC-1 e usado alegando TEC-2 --
    // contrato (Eixo 2, G5-DECISAO-CONTRATO-REAUTH-REQUIRED.md): spoof
    // NUNCA é reauth_required, mesmo com assinatura válida.
    await act("salvarTokenSessao('" + tokenValidoReal + "')");
    ctxSet('APP.tecnico', { id: 'TEC-2', nome: 'Tecnico Dois' });
    chamadasBackend.length = 0;
    const capturado = await ctxCall("gsCallReal('pausarOS', ['OS-1','TEC-2','Nome','Motivo','','OP-4','DEV-1'])").catch(e => e);
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(capturado);
    assert.notStrictEqual(capturado.reauthRequired, true, 'identidade divergente não é reauth_required, mesmo com token estruturalmente válido -- contrato Eixo 2');
    ctxSet('APP.tecnico', { id: 'TEC-1', nome: 'Tecnico Um' }); // restaura pro resto da suite
  });

  await record('leituraComReauth() + getOsDoTecnico REAL: token expirado -- interrompe, abre reautenticação, replay contra o backend real', async () => {
    await act("salvarTokenSessao('" + tokenExpiradoReal + "')");
    await act("showScreen('scr-home')");
    chamadasBackend.length = 0;
    const promessa = ctxCall("leituraComReauth(() => gsCallReal('getOsDoTecnico', ['TEC-1']))").catch(e => ({ __erro: true, cancelado: e.reauthCancelado }));
    await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar', 'deveria ter interrompido contra a recusa REAL do backend');
    ctxCall('cancelarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    const r = await promessa;
    assert.strictEqual(r.__erro, true);
    assert.strictEqual(r.cancelado, true);
  });

  await record('_tentarGetDiariaHoje() + getDiariaHoje REAL: token expirado -- vai pro login (E3-14b), backend real confirma reauth_required antes de qualquer SpreadsheetApp', async () => {
    await act("salvarTokenSessao('" + tokenExpiradoReal + "')");
    await act("showScreen('scr-pin')");
    ctxSet('APP.tecnico', null);
    chamadasBackend.length = 0;
    let carregarHomeChamado = false;
    ctxSet('carregarHome', () => { carregarHomeChamado = true; });
    ctxCall("_entrarConfirmado({id:'TEC-1', nome:'Tecnico Um'})");
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall('cancelarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    assert.strictEqual(telaAtivaId(), 'scr-login', 'E3-14b contra o backend real -- mesmo comportamento do teste com mock');
    assert.strictEqual(carregarHomeChamado, false, 'bug corrigido -- confirmado tambem contra o backend real, nao so meu mock');
  });

  await record('gsCallIdempotente(registrarInicioDia) + token REAL expirado -- outbox marca REAUTH_BLOQUEADO com a recusa vinda do backend de verdade', async () => {
    ctxSet('APP.tecnico', { id: 'TEC-1', nome: 'Tecnico Um' });
    await act("salvarTokenSessao('" + tokenExpiradoReal + "')");
    chamadasBackend.length = 0;
    await act("gsCallIdempotente('registrarInicioDia', (opId, devId) => ['TEC-1','Tecnico Um', false, '', '', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'APONTAMENTO', osId: '' })", 12);
    await act('processarFilaOffline()', 12);
    const fila = await act('listarFila()');
    assert.strictEqual(fila.length, 1);
    assert.strictEqual(fila[0].status, 'REAUTH_BLOQUEADO', 'contra o backend real: expiração vira bloqueio local, não DIVERGENT/SYNC_ERROR');
    assert.strictEqual(fila[0].tentativas, 0);
    // limpa pro proximo teste
    await act("atualizarItemFila(" + fila[0].id + ", {status:'SYNCED'})");
    await act("removerItemFila(" + fila[0].id + ")");
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
