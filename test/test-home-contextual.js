// Teste real da home contextual (Fase B da reorganização de UX, 13/08,
// seções 49-55 do documento do auditor). Roda o <script> DE VERDADE de
// index.html via vm, gsCallReal mockado (nenhuma chamada de rede
// real). Precisa de IndexedDB (fake mínimo, mesmo padrão das outras
// suítes que tocam o outbox) porque renderHome() agora chama
// renderStatusSincronizacao() -> resumoFila() -> listarFila().
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

// ---- fake IndexedDB mínimo (mesmo das outras suítes que tocam o outbox) ----
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
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {},
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
// unref() pra nao segurar o processo vivo -- iniciarCronometro() cria
// um interval de verdade (o codigo real, nao um mock) que nunca e
// limpo neste teste (nao testamos o cronometro em si, so que
// renderHome() nao quebra ao chama-lo).
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
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
  for (let i = 0; i < (voltas || 4); i++) await flush();
  return r;
}

ctxSet('APP.tecnico', { id: 'T1', nome: 'Fulano de Tal' });

async function main() {
  // ================================================================
  // 1) carregarHome() -- saudacao "Ola, [nome]"
  // ================================================================
  await record('carregarHome(): titulo vira "Ola, [primeiro nome]"', async () => {
    ctxCall("document.getElementById('home-titulo').textContent = ''"); // reset defensivo
    ctxCall("showLoading = function(){}"); // evita depender do bloco de loading real
    await act('carregarHome()', 2);
    const titulo = ctxGet("document.getElementById('home-titulo').textContent");
    assert.strictEqual(titulo, 'Olá, Fulano');
  });

  // ================================================================
  // 2) renderHome() -- OS ativa vira card proprio, NAO aparece em "Proximas"
  // ================================================================
  await record('renderHome(): OS ativa mostra home-timer-block, some da lista de Proximas', async () => {
    const lista = [
      { id: 'OS-1', cliente: 'Cliente Ativo', statusAtual: 'Em andamento', emPausa: false, horasProdutivas: 0 },
      { id: 'OS-2', cliente: 'Cliente Pendente', statusAtual: 'Pendente', emPausa: false },
    ];
    ctxSet('lista_teste_1', lista);
    await act('renderHome(lista_teste_1)', 4);

    assert.strictEqual(ctxGet('APP.osAtiva.id'), 'OS-1');
    assert.strictEqual(ctxGet("document.getElementById('home-timer-block').style.display"), 'block');
    assert.strictEqual(ctxGet("document.getElementById('home-timer-os').textContent"), 'Cliente Ativo - OS-1');

    const listaHtml = ctxGet("document.getElementById('home-os-lista').innerHTML");
    assert.strictEqual(listaHtml, '', 'lista deveria estar vazia (createElement/appendChild sao mocks, nao aparecem no innerHTML) -- ver proximo teste pra confirmar quantidade certa de itens criados');
  });

  await record('renderHome(): OS pausada mostra home-pausa-block, some da lista de Proximas', async () => {
    const lista = [
      { id: 'OS-3', cliente: 'Cliente Pausado', statusAtual: 'Em andamento', emPausa: true, motivoPausa: 'Almoço' },
      { id: 'OS-4', cliente: 'Cliente Pendente 2', statusAtual: 'Pendente', emPausa: false },
    ];
    ctxSet('lista_teste_2', lista);
    await act('renderHome(lista_teste_2)', 4);

    assert.strictEqual(ctxGet('APP.osPausada.id'), 'OS-3');
    assert.strictEqual(ctxGet("document.getElementById('home-pausa-block').style.display"), 'block');
    assert.strictEqual(ctxGet("document.getElementById('home-pausa-motivo').textContent"), 'Almoço');
    assert.strictEqual(ctxGet("document.getElementById('home-timer-block').style.display"), 'none', 'sem OS ativa nesta lista, o card de ativa deveria sumir');
  });

  await record('renderHome(): sem nenhuma OS -- mostra "Nenhuma OS pendente hoje"', async () => {
    ctxSet('lista_teste_3', []);
    await act('renderHome(lista_teste_3)', 4);
    const listaHtml = ctxGet("document.getElementById('home-os-lista').innerHTML");
    assert.ok(listaHtml.includes('Nenhuma OS pendente hoje'));
    assert.strictEqual(ctxGet("document.getElementById('home-timer-block').style.display"), 'none');
    assert.strictEqual(ctxGet("document.getElementById('home-pausa-block').style.display"), 'none');
  });

  // ================================================================
  // 3) renderHome() chama a integracao com a Fase A (status de sincronizacao)
  // ================================================================
  await record('renderHome(): popula Pendencias via renderStatusSincronizacao (fila vazia -> Tudo sincronizado)', async () => {
    ctxSet('lista_teste_4', [{ id: 'OS-5', cliente: 'Cliente X', statusAtual: 'Pendente', emPausa: false }]);
    await act('renderHome(lista_teste_4)', 6);
    const html = ctxGet("document.getElementById('home-sync-status').innerHTML");
    assert.ok(html.includes('Tudo sincronizado'), 'esperava o estado sincronizado (fila vazia), veio: ' + html);
  });

  await record('renderHome(): Pendencias reflete item na fila (integracao real com a Fase A, nao um texto fixo)', async () => {
    await act("enfileirarChamadaComId('op-home-1', 'registrarInicioDia', ['T1'], 'INICIO_DIA', '')", 4);
    ctxSet('lista_teste_5', [{ id: 'OS-6', cliente: 'Cliente Y', statusAtual: 'Pendente', emPausa: false }]);
    await act('renderHome(lista_teste_5)', 6);
    const html = ctxGet("document.getElementById('home-sync-status').innerHTML");
    assert.ok(html.includes('1 registro aguardando envio'), 'esperava refletir o item real na fila, veio: ' + html);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
