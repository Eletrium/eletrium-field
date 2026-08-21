// UX (21/08, achado 4 do red-team da Frente F -- decisão do Geovane):
// aviso PERSISTENTE (não toast) enquanto houver operação(ões) na fila
// local ainda não confirmadas como enviadas -- risco real: se o
// técnico desinstala o app ou troca de aparelho antes do 1º envio bem-
// sucedido, a operação se perde silenciosamente (nunca sai do
// IndexedDB, ninguém sabe que existiu).
//
// Roda o <script> DE VERDADE via vm, IndexedDB fake (a prova central
// deste teste -- "o banner reflete o estado real da fila" -- precisa
// de IndexedDB de verdade, não sandbox.indexedDB=undefined).
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

// ---- fake IndexedDB mínimo (mesmo padrão já usado em várias suítes) --
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
// classList real (Set-backed) -- este teste precisa mesmo confirmar que
// o banner GANHOU/PERDEU a classe "show", não só que o método foi
// chamado (mesma técnica já usada em test-build-id-contrato-api.js).
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
  for (let i = 0; i < (voltas || 6); i++) await flush();
  return r;
}

function bannerVisivel() { return ctxGet('document.getElementById("pendente-envio-banner")').classList.contains('show'); }
function bannerTexto() { return ctxGet('document.getElementById("pendente-envio-banner").textContent'); }

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
  await record('atualizarBannerPendenteEnvio(): fila vazia -- banner escondido', async () => {
    await act('atualizarBannerPendenteEnvio()');
    assert.strictEqual(bannerVisivel(), false);
  });

  await record('gsCallIdempotente(): falha de rede + enfileiravelSeOffline -- banner aparece com a mensagem certa (1 operação)', async () => {
    chamadasRede.length = 0;
    comportamento = { salvarResposta: new Error('Falha de rede (JSONP)') };
    await act("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-1', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'CHECKLIST', osId: 'OS-1' })");
    assert.strictEqual(bannerVisivel(), true, 'banner deveria aparecer -- operacao ficou na fila local');
    const texto = bannerTexto();
    assert.ok(texto.includes('1 operação'), 'deveria estar no singular pra 1 item: ' + texto);
    assert.ok(texto.toLowerCase().includes('não desinstale'), 'deveria conter o aviso explícito: ' + texto);
    assert.ok(texto.toLowerCase().includes('trocar') === false || texto.toLowerCase().includes('troque'), 'deveria mencionar nao trocar de aparelho: ' + texto);
  });

  await record('gsCallIdempotente(): sucesso ao vivo de uma 2a operação -- banner continua mostrando só a 1a ainda pendente (nao esconde por engano)', async () => {
    chamadasRede.length = 0;
    comportamento = { registrarMovimentoFerramental: { sucesso: true } };
    await act("gsCallIdempotente('registrarMovimentoFerramental', (opId, devId) => ['OS-2', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'FERRAMENTAL', osId: 'OS-2' })");
    assert.strictEqual(bannerVisivel(), true, 'ainda deveria estar visivel -- a operacao da OS-1 continua pendente');
  });

  await record('processarFilaOffline(): item sincroniza de verdade -- banner some (confirmação do servidor, não só tentativa)', async () => {
    comportamento = { salvarResposta: { success: true, sucesso: true } };
    await act('processarFilaOffline()');
    assert.strictEqual(bannerVisivel(), false, 'banner deveria sumir -- fila esvaziou de verdade');
  });

  await record('gsCallIdempotente(): 2 operações pendentes -- banner mostra plural e a soma certa', async () => {
    chamadasRede.length = 0;
    comportamento = { salvarResposta: new Error('Falha de rede'), registrarMovimentoFerramental: new Error('Falha de rede') };
    await act("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-3', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'CHECKLIST', osId: 'OS-3' })");
    await act("gsCallIdempotente('registrarMovimentoFerramental', (opId, devId) => ['OS-4', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'FERRAMENTAL', osId: 'OS-4' })");
    const texto = bannerTexto();
    assert.ok(texto.includes('2 operações'), 'deveria estar no plural com a soma certa: ' + texto);
    // limpa pro proximo teste
    comportamento = { salvarResposta: { success: true }, registrarMovimentoFerramental: { success: true } };
    await act('processarFilaOffline()', 20);
    assert.strictEqual(bannerVisivel(), false);
  });

  // Simula o app "morrendo" ENTRE registrar a intenção local e a tentativa
  // ao vivo se resolver -- mesmo cenário que D7-08 cobre (gsCallReal nunca
  // resolve nem rejeita, como uma aba fechada/processo morto no meio de
  // uma chamada em voo). Chamar registrarIntencaoLocal() direto (sem
  // passar por gsCallIdempotente) não dispara o hook do banner -- por
  // isso este teste precisa passar pelo caminho real.
  await record('gsCallIdempotente(): app "morre" em voo (LOCAL_PENDING) -- banner aparece so pela intencao, antes de qualquer desfecho', async () => {
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice ? params.slice() : params });
      return new Promise(() => {}); // nunca resolve -- "app morto" em voo
    });
    ctxCall("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-5', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'CHECKLIST', osId: 'OS-5' })"); // nao espera -- a promessa nunca resolve
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(bannerVisivel(), true, 'banner deveria aparecer so por causa da intencao registrada (antes mesmo de qualquer tentativa ao vivo)');
    ctxSet('gsCallReal', mockGsCallReal);
  });

  await record('reconciliarIntencoesOrfas(): orfã resolvida pelo servidor -- banner reflete o estado pós-reconciliação (some)', async () => {
    comportamento = { consultarStatusOperacao: { encontrado: true, resultado: { success: true } } };
    await act('reconciliarIntencoesOrfas()', 12);
    assert.strictEqual(bannerVisivel(), false, 'servidor confirmou que ja processou -- banner deveria sumir');
  });

  await record('gsCallIdempotente(): app "morre" em voo de novo (2a intencao) -- prepara pro proximo teste', async () => {
    ctxSet('gsCallReal', () => new Promise(() => {}));
    ctxCall("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-6', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'CHECKLIST', osId: 'OS-6' })");
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(bannerVisivel(), true);
    ctxSet('gsCallReal', mockGsCallReal);
  });

  await record('reconciliarIntencoesOrfas(): orfã NAO resolvida -- promovida pra QUEUED, banner continua visivel (nao e "sincronizado" so por ter reconciliado)', async () => {
    comportamento = { consultarStatusOperacao: { encontrado: false } };
    await act('reconciliarIntencoesOrfas()', 12);
    assert.strictEqual(bannerVisivel(), true, 'nao resolvido -- ainda ha algo pendente, banner deveria continuar visivel');
    // limpa
    comportamento = { salvarResposta: { success: true } };
    await act('processarFilaOffline()', 20);
    assert.strictEqual(bannerVisivel(), false);
  });

  await record('capturarEUpload(): marcador de upload em voo (app "morre" antes do poll) -- banner aparece', async () => {
    ctxSet('APP.osAtiva', { id: 'OS-UP-1' });
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice ? params.slice() : params });
      if (action === 'consultarStatusOperacao') return new Promise(() => {}); // nunca resolve -- "app morto"
      return Promise.resolve({});
    });
    ctxSet('fetch', () => Promise.resolve({}));
    ctxSet('FileReader', function () {
      this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
    });
    ctxCall('document.getElementById("enc-laudo-input").files = [{name:"foto.jpg", type:"image/jpeg"}]');
    ctxCall("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')"); // nao espera, como um app real que morre no meio
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(bannerVisivel(), true, 'banner deveria aparecer -- upload em voo, marcador persistido');
    ctxSet('gsCallReal', mockGsCallReal);
  });

  await record('reconciliarUploadsOrfaos(): resolve o marcador do upload -- banner some depois de confirmado', async () => {
    comportamento = { consultarStatusOperacao: { encontrado: true, resultado: { success: true, url: 'https://drive/x.jpg' } } };
    await act('reconciliarUploadsOrfaos()');
    assert.strictEqual(bannerVisivel(), false, 'upload confirmado -- banner deveria sumir');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
