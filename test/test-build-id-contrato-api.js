// Teste real do build ID (seção 30) + gate de compatibilidade de
// contrato de API (seção 19), pedidos na diretriz de congelamento de
// funcionalidade nova / foco em compatibilidade PWA/backend (14/08).
// Ver CONTRATO-BACKEND-FIELD-API-CONTRACT.md -- o backend AINDA NÃO
// EXPÕE getFieldApiContract, então o cenário "backend antigo" (mock
// devolvendo o mesmo formato de "Acao desconhecida" que o dispatcher
// real já usa hoje pra qualquer action não implementada) é o cenário
// PRINCIPAL a provar: o app não pode quebrar pra todo mundo antes do
// backend publicar o contrato.
//
// Roda o boot real (o handler de DOMContentLoaded de verdade, não uma
// reimplementação) via vm, gsCallReal mockado.
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

// Boot real chama processarFilaOffline() (quando o contrato é
// compatível) -- precisa de IndexedDB de verdade, mesmo fake mínimo já
// usado em test-processar-fila-offline.js (open com onupgradeneeded/
// onsuccess, 1 object store, get/put/add/delete/getAll; microtask pros
// callbacks de request, macrotask pro oncomplete da transação).
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
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}
// classList real (Set-backed, não o no-op usado no resto da suíte) --
// este teste precisa mesmo confirmar que o overlay de bloqueio
// GANHOU/NÃO GANHOU a classe "show", não só que o método foi chamado.
function makeElement() {
  const classes = new Set();
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    style: {}, dataset: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      contains: c => classes.has(c),
    },
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

// Ao contrário do resto da suíte (que usa addEventListener() {} como
// no-op porque testa funções isoladas), este teste PRECISA rodar o
// boot real -- captura o handler registrado em vez de descartá-lo.
const listeners = {};
const sandbox = {};
sandbox.window = sandbox;
sandbox.addEventListener = (evt, fn) => { listeners[evt] = fn; };
sandbox.scrollTo = () => {};
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
sandbox.indexedDB = makeFakeIndexedDB();

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
let respostaContrato = null; // controlado por cada teste
let mockGetTecnicos = () => [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice() });
  if (action === 'getFieldApiContract') {
    if (respostaContrato === 'REDE_INDISPONIVEL') return Promise.reject(new Error('Falha de rede (JSONP)'));
    return Promise.resolve(respostaContrato);
  }
  if (action === 'getTecnicos') return Promise.resolve(mockGetTecnicos());
  throw new Error('Chamada de rede inesperada não coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);

async function bootar() {
  // classList agora é stateful (precisa ser, pra provar que "show" foi
  // de fato ligado/desligado) -- reseta o overlay antes de cada boot
  // simulado, senão o "show" de um cenário anterior vaza pro próximo.
  ctxCall('document.getElementById("scr-bloqueio-contrato").classList.remove("show")');
  const handler = listeners['DOMContentLoaded'];
  if (!handler) throw new Error('DOMContentLoaded não foi registrado -- addEventListener não capturou o handler real');
  await handler();
  for (let i = 0; i < 8; i++) await flush();
}

// ---- backend REAL (leitura, C:\EletriumERP\pwa é território do Code 1,
// clone local read-only) -- carrega Código.js/API.js DE VERDADE via vm
// e chama executarAcao('getFieldApiContract', []) de verdade, não uma
// reimplementação assumindo a forma da resposta. Pedido explícito do
// dono (14/08): depois do achado de que o Code 1 já implementou
// getFieldApiContract (commit 85493b1) exatamente igual à proposta
// deste worktree, confirmar contra o código real, não só contra mock.
// Se o clone não estiver disponível (outra máquina/ambiente), o teste
// avisa e pula em vez de falhar por um motivo alheio ao próprio gate.
const PWA_DIR = 'C:\\EletriumERP\\pwa';
function carregarBackendReal() {
  const codigoPath = path.join(PWA_DIR, 'Código.js');
  const apiPath = path.join(PWA_DIR, 'API.js');
  if (!fs.existsSync(codigoPath) || !fs.existsSync(apiPath)) return null;
  const src = fs.readFileSync(codigoPath, 'utf8') + '\n' + fs.readFileSync(apiPath, 'utf8');
  const stubApps = () => new Proxy(function () {}, { get: () => stubApps(), apply: () => undefined });
  const beSandbox = {
    SpreadsheetApp: stubApps(), Utilities: stubApps(), DriveApp: stubApps(),
    PropertiesService: stubApps(), UrlFetchApp: { fetch: () => {} }, Logger: { log() {} },
    ContentService: stubApps(), console,
  };
  const beContext = vm.createContext(beSandbox);
  vm.runInContext(src, beContext);
  return beContext;
}

async function main() {
  await record('atualizarBuildIdBadge(): popula o texto do badge com versao, commit e contrato esperado', async () => {
    await act('atualizarBuildIdBadge()', 1);
    const texto = ctxGet('document.getElementById("build-id").textContent');
    assert.ok(texto.includes(ctxGet('APP_BUILD_VERSAO')), 'deveria conter a versao');
    assert.ok(texto.includes(ctxGet('APP_BUILD_COMMIT')), 'deveria conter o commit');
    assert.ok(texto.includes(ctxGet('FIELD_API_CONTRACT_ESPERADO')), 'deveria conter o contrato esperado');
  });

  // ================================================================
  // O CENARIO PRINCIPAL: backend real hoje (sem getFieldApiContract).
  // Mesmo formato de erro que o dispatcher ja devolve pra qualquer
  // action desconhecida (Acao.js:172-173: {erro:'Acao desconhecida: '+action}).
  // ================================================================
  await record('verificarContratoAPI(): backend sem a action (formato real de "Acao desconhecida") NAO bloqueia -- fail-open', async () => {
    chamadasRede.length = 0;
    respostaContrato = { erro: 'Acao desconhecida: getFieldApiContract' };
    mockGetTecnicos = () => [{ id: 'T1', nome: 'Tecnico Um' }];
    await bootar();
    const overlay = ctxGet('document.getElementById("scr-bloqueio-contrato")');
    assert.strictEqual(overlay.classList.contains('show'), false, 'overlay de bloqueio NAO deveria aparecer');
    const chamouTecnicos = chamadasRede.some(c => c.action === 'getTecnicos');
    assert.ok(chamouTecnicos, 'boot deveria ter seguido ate carregarTecnicos() (login normal)');
  });

  await record('verificarContratoAPI(): contrato batendo (v1 === v1) NAO bloqueia', async () => {
    chamadasRede.length = 0;
    respostaContrato = { field_api_contract: 'v1' };
    mockGetTecnicos = () => [{ id: 'T1', nome: 'Tecnico Um' }];
    await bootar();
    const overlay = ctxGet('document.getElementById("scr-bloqueio-contrato")');
    assert.strictEqual(overlay.classList.contains('show'), false);
    assert.ok(chamadasRede.some(c => c.action === 'getTecnicos'), 'login deveria seguir normalmente');
  });

  // ================================================================
  // CONFIRMAÇÃO CONTRA O BACKEND REAL (não mock) -- Código.js/API.js
  // de C:\EletriumERP\pwa carregados e EXECUTADOS de verdade via vm,
  // commit 85493b1 (Code 1, "FIELD_API_CONTRACT + getFieldApiContract").
  // ================================================================
  await record('verificarContratoAPI() contra o BACKEND REAL (pwa\\Código.js/API.js, commit 85493b1) -- mesma constante, mesmo formato, gate nao bloqueia', async () => {
    const beContext = carregarBackendReal();
    if (!beContext) {
      console.warn('  [SKIP] clone de C:\\EletriumERP\\pwa não encontrado neste ambiente -- os outros 5 testes (mock) continuam cobrindo o gate.');
      return;
    }
    const respostaReal = vm.runInContext("executarAcao('getFieldApiContract', [])", beContext);
    // Não assume a forma -- confirma contra o que o código real devolveu.
    assert.strictEqual(typeof respostaReal, 'object');
    assert.strictEqual(respostaReal.field_api_contract, 'v1', 'backend real deveria responder com a mesma constante FIELD_API_CONTRACT esperada pelo frontend');

    chamadasRede.length = 0;
    respostaContrato = respostaReal; // a resposta REAL do backend, não um objeto digitado a mão
    mockGetTecnicos = () => [{ id: 'T1', nome: 'Tecnico Um' }];
    await bootar();
    const overlay = ctxGet('document.getElementById("scr-bloqueio-contrato")');
    assert.strictEqual(overlay.classList.contains('show'), false, 'gate nao deveria bloquear contra o backend real de hoje');
    assert.ok(chamadasRede.some(c => c.action === 'getTecnicos'), 'login deveria seguir normalmente contra o backend real');
  });

  // ================================================================
  // O ACHADO PEDIDO: incompatibilidade CONFIRMADA bloqueia com
  // mensagem clara, nunca segue silenciosamente.
  // ================================================================
  await record('verificarContratoAPI(): contrato divergente (v2 != v1) BLOQUEIA -- login nunca roda', async () => {
    chamadasRede.length = 0;
    respostaContrato = { field_api_contract: 'v2' };
    mockGetTecnicos = () => { throw new Error('carregarTecnicos() NAO deveria ter sido chamado -- boot deveria ter parado no bloqueio'); };
    await bootar();
    const overlay = ctxGet('document.getElementById("scr-bloqueio-contrato")');
    assert.strictEqual(overlay.classList.contains('show'), true, 'overlay de bloqueio deveria aparecer');
    const chamouTecnicos = chamadasRede.some(c => c.action === 'getTecnicos');
    assert.strictEqual(chamouTecnicos, false, 'login NAO deveria ter sido tentado depois do bloqueio');
    const detalhe = ctxGet('document.getElementById("bloqueio-contrato-detalhe").textContent');
    assert.ok(detalhe.includes('v1'), 'deveria mostrar o esperado (v1)');
    assert.ok(detalhe.includes('v2'), 'deveria mostrar o recebido (v2), nao esconder o motivo real');
  });

  await record('verificarContratoAPI(): rede indisponivel (timeout/offline) NAO bloqueia -- fail-open, app continua offline-first', async () => {
    chamadasRede.length = 0;
    respostaContrato = 'REDE_INDISPONIVEL';
    mockGetTecnicos = () => [{ id: 'T1', nome: 'Tecnico Um' }];
    await bootar();
    const overlay = ctxGet('document.getElementById("scr-bloqueio-contrato")');
    assert.strictEqual(overlay.classList.contains('show'), false, 'sem sinal nao deveria travar o app fora do ar');
    assert.ok(chamadasRede.some(c => c.action === 'getTecnicos'), 'boot deveria ter seguido mesmo sem confirmar o contrato');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
