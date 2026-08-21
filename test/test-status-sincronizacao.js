// Teste real do status de sincronização humanizado (reorganização de
// UX, 13/08) -- resumoFila/renderStatusSincronizacao/
// tentarNovamenteDivergentes. Roda o <script> DE VERDADE de index.html
// via vm, gsCallReal mockado (nenhuma chamada de rede real).
//
// Achado do dono ANTES da implementação (mesma classe do bug já
// confirmado sobre retry de SYNC_ERROR genuíno): reusar o MESMO
// operationId num retry de item DIVERGENT nunca reprocessaria de
// verdade -- resultado_json já está preenchido (é assim que a recusa
// foi cacheada), o contrato de idempotência bloqueia reexecução de
// fn() pro mesmo operationId e devolve a mesma recusa cacheada. Este
// teste prova (não só afirma) que tentarNovamenteDivergentes() gera um
// operationId NOVO e que isso genuinamente faz fn() rodar de novo no
// backend -- não só que o status muda visualmente.
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

// ---- fake IndexedDB mínimo (mesmo de test-processar-fila-offline.js) ----
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
  return {
    textContent: '', innerHTML: '', value: '', checked: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
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
  for (let i = 0; i < (voltas || 4); i++) await flush();
  return r;
}

const chamadasRede = [];
let proximaResposta = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: JSON.parse(JSON.stringify(params)) });
  if (!proximaResposta) throw new Error('proximaResposta nao configurada pra ' + action);
  const r = proximaResposta; proximaResposta = null;
  if (r instanceof Error) return Promise.reject(r);
  return Promise.resolve(r);
}
ctxSet('gsCallReal', mockGsCallReal);

async function enfileirar(action, params, tipoOperacao, osId, operationId) {
  return ctxCall(
    `enfileirarChamadaComId(${JSON.stringify(operationId)}, ${JSON.stringify(action)}, ${JSON.stringify(params)}, ${JSON.stringify(tipoOperacao)}, ${JSON.stringify(osId)})`
  );
}
async function lerFila() {
  const r = await act('listarFila()', 4);
  return JSON.parse(JSON.stringify(r));
}

async function main() {
  // ================================================================
  // 1) resumoFila() -- os 3 estados
  // ================================================================
  await record('resumoFila(): fila vazia -> sincronizado', async () => {
    const r = await act('resumoFila()', 4);
    assert.strictEqual(r.estado, 'sincronizado');
  });

  await record('resumoFila(): itens pendentes (nao DIVERGENT) -> pendente, com contagem certa', async () => {
    await enfileirar('registrarInicioDia', ['T-1', 'Fulano', true, '100', ''], 'INICIO_DIA', '', 'op-a');
    await flush(); await flush();
    const r = await act('resumoFila()', 4);
    assert.strictEqual(r.estado, 'pendente');
    assert.strictEqual(r.n, 1);
  });

  await record('resumoFila(): item DIVERGENT -> divergente, com contagem de pendentes separada', async () => {
    // processarFilaOffline() processa a fila INTEIRA numa chamada só --
    // pra manter cada mock deliberado (1 resposta = 1 chamada de rede
    // esperada, sem enfileirar respostas "extras" pra emergencia),
    // sincroniza o item anterior (op-a) ANTES de introduzir o proximo,
    // garantindo 1 item pendente na fila por vez.
    proximaResposta = { success: true };
    await act('processarFilaOffline()', 8);
    let filaAnterior = await lerFila();
    assert.strictEqual(filaAnterior.length, 0, 'op-a deveria ter sincronizado e saido da fila antes deste teste continuar');

    await enfileirar('registrarMovimentoFerramental', ['OS-1', 'T-1', 'FER-1', 'Carga', true, '', 'op-b'], 'FERRAMENTAL', 'OS-1', 'op-b');
    await flush(); await flush();
    proximaResposta = { success: false, retryable: false, blocking_reasons: ['Patrimonio ja alocado'] };
    await act('processarFilaOffline()', 8);

    const r = await act('resumoFila()', 4);
    assert.strictEqual(r.estado, 'divergente');
    assert.strictEqual(r.n, 1);
  });

  // ================================================================
  // 2) renderStatusSincronizacao -- texto certo por estado
  // ================================================================
  await record('renderStatusSincronizacao: estado divergente mostra motivo, pendentes restantes e botao', async () => {
    await act('renderStatusSincronizacao("sync-status-test")', 4);
    const html = ctxGet("document.getElementById('sync-status-test').innerHTML");
    assert.ok(html.includes('Não foi possível enviar 1 registro'), 'deveria mostrar a contagem de divergentes: ' + html);
    assert.ok(html.includes('permanecem salvos neste aparelho'), 'deveria ter a frase de reasseguranca');
    assert.ok(html.includes('TENTAR NOVAMENTE'), 'deveria ter o botao de retry');
  });

  // ================================================================
  // 3) O ACHADO DO DONO: retry com operationId NOVO genuinamente
  //    reexecuta fn() no backend -- nao so muda o status visualmente.
  // ================================================================
  await record('tentarNovamenteDivergentes(): usa operationId NOVO (nao o mesmo) na 2a tentativa', async () => {
    chamadasRede.length = 0;
    // Limpa a fila desta rodada de teste, começando de um estado conhecido.
    let filaAtual = await lerFila();
    for (const item of filaAtual) await act('removerItemFila(' + item.id + ')', 3);

    await enfileirar('registrarAceiteOferta', ['OF-1', 'T-900', true, '', 'op-retry-original'], 'ACEITE_OFERTA', 'OS-1', 'op-retry-original');
    await flush(); await flush();

    proximaResposta = { success: false, retryable: false, blocking_reasons: ['Oferta ja foi retirada pelo gestor'] };
    await act('processarFilaOffline()', 6);

    const chamada1 = chamadasRede.find(c => c.action === 'registrarAceiteOferta');
    assert.ok(chamada1, '1a tentativa deveria ter acontecido');
    assert.ok(chamada1.params.includes('op-retry-original'), 'operationId original deveria estar nos params da 1a tentativa');

    let fila = await lerFila();
    let item = fila.find(i => i.action === 'registrarAceiteOferta');
    assert.strictEqual(item.status, 'DIVERGENT');

    // 2a tentativa: desta vez o backend aceita (simula que o motivo da
    // recusa foi resolvido) -- a PROVA real de que fn() rodou de novo
    // e nao so devolveu o cache: item some da fila (SYNCED).
    chamadasRede.length = 0;
    proximaResposta = { success: true, operation_id: 'novo' };
    await act('tentarNovamenteDivergentes()', 8);

    const chamada2 = chamadasRede.find(c => c.action === 'registrarAceiteOferta');
    assert.ok(chamada2, '2a tentativa deveria ter acontecido (nao deveria ter sido pulada)');
    assert.ok(!chamada2.params.includes('op-retry-original'), 'a 2a tentativa NAO deveria reusar o operationId original');
    const operationIdNovoUsado = chamada2.params.find(p => typeof p === 'string' && p.startsWith('test-uuid-'));
    assert.ok(operationIdNovoUsado, 'deveria ter um operationId novo (gerado por gerarOperationId) nos params da 2a tentativa');

    fila = await lerFila();
    item = fila.find(i => i.action === 'registrarAceiteOferta');
    assert.strictEqual(item, undefined, 'PROVA: o item saiu da fila (SYNCED) -- fn() rodou de novo no backend de verdade, nao so trocou o status local visualmente');
  });

  await record('tentarNovamenteDivergentes(): se a 2a tentativa falha de novo, continua DIVERGENT (nao finge sucesso)', async () => {
    let filaAtual = await lerFila();
    for (const item of filaAtual) await act('removerItemFila(' + item.id + ')', 3);

    await enfileirar('registrarMovimentoFerramental', ['OS-2', 'T-1', 'FER-2', 'Carga', true, '', 'op-persistente'], 'FERRAMENTAL', 'OS-2', 'op-persistente');
    await flush(); await flush();
    proximaResposta = { success: false, retryable: false, blocking_reasons: ['Patrimonio baixado do catalogo'] };
    await act('processarFilaOffline()', 6);

    chamadasRede.length = 0;
    proximaResposta = { success: false, retryable: false, blocking_reasons: ['Patrimonio baixado do catalogo'] };
    await act('tentarNovamenteDivergentes()', 8);

    const chamada = chamadasRede.find(c => c.action === 'registrarMovimentoFerramental');
    assert.ok(chamada, 'deveria ter genuinamente tentado de novo');
    assert.ok(!chamada.params.includes('op-persistente'), 'operationId novo, mesmo na 2a falha');

    const fila = await lerFila();
    const item = fila.find(i => i.action === 'registrarMovimentoFerramental');
    assert.ok(item, 'item deveria continuar na fila -- ainda recusado de verdade');
    assert.strictEqual(item.status, 'DIVERGENT');
  });

  await record('tentarNovamenteDivergentes(): item sem operationId embutido em params (gsCall simples) e no-op seguro na troca', async () => {
    let filaAtual = await lerFila();
    for (const item of filaAtual) await act('removerItemFila(' + item.id + ')', 3);

    // Simula um item enfileirado via gsCall simples (nao gsCallIdempotente)
    // -- operationId existe so como campo local do item, nunca foi
    // embutido nos params originais (mesmo padrao real de pausarOS/
    // registrarInicioDia quando chamados fora do wrapper idempotente).
    await enfileirar('pausarOS', ['OS-3', 'T-1', 'Fulano', 'Motivo qualquer', ''], 'PAUSA', 'OS-3', 'op-sem-embutir');
    await flush(); await flush();
    proximaResposta = { success: false, retryable: false, blocking_reasons: ['OS ja pausada por outro dispositivo'] };
    await act('processarFilaOffline()', 6);

    chamadasRede.length = 0;
    proximaResposta = { success: true };
    await act('tentarNovamenteDivergentes()', 8);

    const chamada = chamadasRede.find(c => c.action === 'pausarOS');
    assert.ok(chamada, 'deveria ter tentado de novo mesmo sem operationId nos params originais');
    assert.deepStrictEqual(chamada.params, ['OS-3', 'T-1', 'Fulano', 'Motivo qualquer', ''], 'params deveriam continuar identicos -- nada pra trocar, no-op seguro');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
