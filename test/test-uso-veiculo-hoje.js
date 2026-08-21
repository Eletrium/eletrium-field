// Wire-up de registrarUsoVeiculo (21/08) -- pedido do dono, independente
// do timeline do REAUTH: a action existe no backend (Código.js:1658) mas
// não tinha NENHUM call site real no Field (achado em aberto desde o
// levantamento da Onda 3, 15/08). Tela "Meu Veiculo" ganha um card
// SIM/NAO que chama a action -- roda o <script> DE VERDADE via vm.
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

// ---- fake IndexedDB mínimo (mesmo padrão de outras suítes deste worktree) ----
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
function makeElement() {
  const classes = new Set();
  return {
    textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    files: null, style: {}, dataset: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; if (on) classes.add(c); else classes.delete(c); },
      contains: c => classes.has(c),
    },
    addEventListener() {}, setAttribute() {}, focus() {}, querySelector() { return makeElement(); },
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

const chamadasRede = [];
let comportamento = {};
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  if (comportamento[action] !== undefined) {
    const r = comportamento[action];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  }
  throw new Error('Chamada de rede inesperada não coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

async function main() {
  await record('_renderizarUsoVeiculoHoje(): dia nao comecado (usaVeiculoHoje=null) -- botoes desabilitados, mensagem de aviso', async () => {
    ctxSet('APP.usaVeiculoHoje', null);
    ctxCall('_renderizarUsoVeiculoHoje()');
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-sim").disabled'), true);
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-nao").disabled'), true);
    assert.ok(ctxGet('document.getElementById("uso-veiculo-hoje-msg").textContent').toLowerCase().includes('inicie o dia'));
  });

  await record('atualizarUsoVeiculoHoje(): bloqueado quando o dia nao comecou -- nenhuma chamada de rede disparada', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.usaVeiculoHoje', null);
    await act('atualizarUsoVeiculoHoje(true)');
    assert.strictEqual(chamadasRede.length, 0, 'nao deveria ter tentado nenhuma chamada de rede');
  });

  await record('_renderizarUsoVeiculoHoje(): dia comecado com usaVeiculoHoje=true -- SIM destacado, botoes habilitados', async () => {
    ctxSet('APP.usaVeiculoHoje', true);
    ctxCall('_renderizarUsoVeiculoHoje()');
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-sim").disabled'), false);
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-sim").classList.contains("btn-green")'), true);
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-nao").classList.contains("btn-green")'), false);
  });

  await record('atualizarUsoVeiculoHoje(): clicar no estado ja ativo -- no-op, nenhuma chamada de rede', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.usaVeiculoHoje', true);
    await act('atualizarUsoVeiculoHoje(true)');
    assert.strictEqual(chamadasRede.length, 0);
  });

  await record('atualizarUsoVeiculoHoje(): sucesso ao vivo -- chama registrarUsoVeiculo(tecnicoId, usa) e atualiza o estado', async () => {
    chamadasRede.length = 0;
    comportamento = { registrarUsoVeiculo: { sucesso: true } };
    ctxSet('APP.usaVeiculoHoje', true);
    await act('atualizarUsoVeiculoHoje(false)');
    assert.strictEqual(chamadasRede.length, 1);
    assert.strictEqual(chamadasRede[0].action, 'registrarUsoVeiculo');
    // Comparação elemento-a-elemento em vez de deepStrictEqual num array
    // literal -- params veio de dentro do contexto vm (realm diferente),
    // deepStrictEqual falha nesse caso mesmo com os valores idênticos
    // porque os protótipos de Array são de realms diferentes.
    const params = chamadasRede[0].params;
    assert.strictEqual(params.length, 2, 'assinatura deveria ser exatamente (tecnicoId, usaVeiculo) -- mesma do backend, Código.js:1658, sem operationId/dispositivoId (a action nao aceita hoje)');
    assert.strictEqual(params[0], 'T1');
    assert.strictEqual(params[1], false);
    assert.strictEqual(ctxGet('APP.usaVeiculoHoje'), false, 'estado local deveria refletir a mudanca confirmada pelo servidor');
    assert.strictEqual(ctxGet('document.getElementById("btn-uso-veiculo-nao").classList.contains("btn-green")'), true, 'render deveria ter sido re-disparado apos o sucesso');
  });

  await record('atualizarUsoVeiculoHoje(): falha de rede -- enfileira offline (enfileiravelSeOffline), estado local ainda atualiza otimisticamente', async () => {
    chamadasRede.length = 0;
    comportamento = { registrarUsoVeiculo: new Error('Falha de rede') };
    ctxSet('APP.usaVeiculoHoje', false);
    await act('atualizarUsoVeiculoHoje(true)');
    assert.strictEqual(chamadasRede.length, 1, 'deveria ter tentado ao vivo antes de cair pro offline');
    assert.strictEqual(ctxGet('APP.usaVeiculoHoje'), true, 'gsCall com enfileiravelSeOffline devolve sucesso:true mesmo offline -- estado local deveria refletir a intencao salva');
    const fila = await act('listarFila()');
    assert.strictEqual(fila.length, 1, 'a intencao deveria ter sido persistida na fila local (enfileirarChamada)');
    assert.strictEqual(fila[0].action, 'registrarUsoVeiculo');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
