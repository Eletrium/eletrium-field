// D7-08 (achado Cowork 2, INVESTIGACAO-D6-08-D7-08-OUTBOX-COWORK2.md,
// commit ce65dec): gsCallIdempotente gerava o operationId em memória e
// só persistia em IndexedDB DENTRO do catch -- se o app morresse
// durante a tentativa ao vivo (antes do catch rodar), o id sumia sem
// rastro, mesmo que o servidor já tivesse processado. Reenvio
// subsequente gerava um id NOVO, sem relação com o perdido, duplicando
// de verdade em funções sem guarda própria (salvarResposta,
// registrarMovimentoFerramental). Achado adjacente: capturarEUpload
// tinha o mesmo buraco (operationId só em variável local).
//
// Fix: persistir o operationId ANTES da tentativa ao vivo, e
// reconciliar órfãos no boot usando consultarStatusOperacao (que o
// backend já expõe, leitura pública sem posse).
//
// Roda o <script> DE VERDADE via vm, gsCallReal mockado, IndexedDB fake
// (a prova central deste teste -- "persistiu ANTES do catch" -- exige
// IndexedDB de verdade, não sandbox.indexedDB=undefined).
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

// ---- fake IndexedDB mínimo (mesmo padrão já usado em várias suítes
// deste worktree) -- microtask pros callbacks de request, macrotask
// pro oncomplete da transação.
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
    textContent: '', innerHTML: '', value: '', checked: false, disabled: false, className: '',
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
async function lerFila() { return JSON.parse(JSON.stringify(await act('listarFila()', 5))); }

const chamadasRede = [];
let comportamento = {}; // controlado por cada teste
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  if (action === 'consultarStatusOperacao') {
    const opId = params[0];
    const resp = comportamento.consultarStatusOperacao ? comportamento.consultarStatusOperacao(opId) : { encontrado: false };
    if (resp instanceof Error) return Promise.reject(resp);
    return Promise.resolve(resp);
  }
  if (comportamento.acoesNormais && comportamento.acoesNormais[action] !== undefined) {
    const r = comportamento.acoesNormais[action];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  }
  throw new Error('Chamada de rede inesperada não coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

async function main() {
  // ================================================================
  // 1) A PROVA CENTRAL: persiste ANTES da tentativa ao vivo, não só
  //    no catch -- confirma com IndexedDB de verdade, não inferência.
  // ================================================================
  await record('gsCallIdempotente(): registra LOCAL_PENDING em IndexedDB ANTES da tentativa ao vivo resolver (rede em voo)', async () => {
    let resolverRede;
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice() });
      return new Promise(res => { resolverRede = res; }); // nunca resolve sozinha
    });
    const p = ctxCall("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-1', opId, devId], { tipoOperacao: 'CHECKLIST', osId: 'OS-1' })");
    await flush(); await flush(); await flush(); // deixa so o registro ANTES da tentativa assentar
    const fila = await lerFila();
    const item = fila.find(i => i.action === 'salvarResposta');
    assert.ok(item, 'deveria ter um registro em IndexedDB MESMO com a tentativa ao vivo ainda em voo (nunca resolveu)');
    assert.strictEqual(item.status, 'LOCAL_PENDING', 'status deveria ser LOCAL_PENDING enquanto a tentativa esta em voo');
    resolverRede({ sucesso: true, success: true });
    await p;
    await flush(); await flush();
    ctxSet('gsCallReal', mockGsCallReal);
  });

  await record('gsCallIdempotente(): sucesso ao vivo remove o registro (nada sobra pra reconciliar depois)', async () => {
    chamadasRede.length = 0;
    comportamento = { acoesNormais: { salvarResposta: { sucesso: true, success: true } } };
    await act("gsCallIdempotente('salvarResposta', (opId, devId) => ['OS-2', opId, devId], { tipoOperacao: 'CHECKLIST', osId: 'OS-2' })");
    const fila = await lerFila();
    assert.strictEqual(fila.filter(i => i.osId === 'OS-2').length, 0, 'nao deveria sobrar nenhum registro apos sucesso ao vivo');
  });

  await record('gsCallIdempotente(): falha + enfileiravelSeOffline transiciona LOCAL_PENDING -> QUEUED (mesmo operationId, 1 registro so)', async () => {
    chamadasRede.length = 0;
    comportamento = { acoesNormais: { registrarMovimentoFerramental: new Error('Falha de rede (JSONP)') } };
    await act("gsCallIdempotente('registrarMovimentoFerramental', (opId, devId) => ['OS-3', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'FERRAMENTAL', osId: 'OS-3' })");
    const fila = await lerFila();
    const itens = fila.filter(i => i.osId === 'OS-3');
    assert.strictEqual(itens.length, 1, 'deveria ter exatamente 1 registro (upsert, nao duplicado)');
    assert.strictEqual(itens[0].status, 'QUEUED');
    const opIdDaTentativa = chamadasRede.find(c => c.action === 'registrarMovimentoFerramental').params.find(p => typeof p === 'string' && p.startsWith('test-uuid'));
    assert.strictEqual(itens[0].operationId, opIdDaTentativa, 'operationId do item enfileirado deveria ser o MESMO da tentativa ao vivo que falhou');
  });

  await record('gsCallIdempotente(): falha SEM enfileiravelSeOffline remove o registro e relança o erro (sem contrato de retry, nao deixa registro pendurado)', async () => {
    chamadasRede.length = 0;
    comportamento = { acoesNormais: { getProximaPergunta: new Error('Falha de rede (JSONP)') } };
    let erroCapturado = null;
    // Anexa o .catch() JÁ NA MESMA TICK que obtém a promise -- diferente
    // de act() (que só faz `return r` depois de várias voltas de
    // flush()), evitando a janela de "unhandled rejection" que o Node
    // trata como fatal por padrão mesmo quando o erro É tratado depois.
    const p = ctxCall("gsCallIdempotente('getProximaPergunta', (opId, devId) => ['OS-4', opId, devId], { tipoOperacao: 'CHECKLIST', osId: 'OS-4' })");
    await p.catch(e => { erroCapturado = e; });
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(erroCapturado, 'deveria ter relancado o erro (sem enfileiravelSeOffline)');
    const fila = await lerFila();
    assert.strictEqual(fila.filter(i => i.osId === 'OS-4').length, 0, 'nao deveria sobrar registro -- sem fila pra reenviar depois mesmo');
  });

  // ================================================================
  // 2) processarFilaOffline() NUNCA toca LOCAL_PENDING -- só a
  //    reconciliação de boot decide o que fazer com ele.
  // ================================================================
  await record('processarFilaOffline() pula itens LOCAL_PENDING -- nao reenvia uma tentativa que pode estar em voo agora mesmo', async () => {
    chamadasRede.length = 0;
    await ctxCall("registrarIntencaoLocal('op-fixo-1', 'salvarResposta', ['OS-5'], 'CHECKLIST', 'OS-5')");
    await flush(); await flush(); await flush();
    comportamento = { acoesNormais: {} };
    await act('processarFilaOffline()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'salvarResposta').length, 0, 'processarFilaOffline() nao deveria ter tentado reenviar um item LOCAL_PENDING');
    const fila = await lerFila();
    assert.strictEqual(fila.find(i => i.operationId === 'op-fixo-1').status, 'LOCAL_PENDING', 'status deveria continuar LOCAL_PENDING (so reconciliarIntencoesOrfas muda isso)');
  });

  // ================================================================
  // 3) reconciliarIntencoesOrfas() -- o coracao do fix.
  // ================================================================
  await record('reconciliarIntencoesOrfas(): servidor confirma que ja processou -- remove sem reenviar (nao duplica)', async () => {
    chamadasRede.length = 0;
    await ctxCall("registrarIntencaoLocal('op-orfa-resolvida', 'salvarResposta', ['OS-6'], 'CHECKLIST', 'OS-6')");
    await flush(); await flush(); await flush();
    comportamento = { consultarStatusOperacao: (opId) => opId === 'op-orfa-resolvida' ? { encontrado: true, resultado: { success: true } } : { encontrado: false } };
    await act('reconciliarIntencoesOrfas()');
    assert.ok(chamadasRede.some(c => c.action === 'consultarStatusOperacao' && c.params[0] === 'op-orfa-resolvida'), 'deveria ter perguntado ao servidor');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'salvarResposta').length, 0, 'NAO deveria ter reenviado -- servidor ja confirmou que processou');
    const fila = await lerFila();
    assert.strictEqual(fila.find(i => i.operationId === 'op-orfa-resolvida'), undefined, 'registro deveria ter sido removido');
  });

  await record('reconciliarIntencoesOrfas(): servidor nunca viu esse operationId -- promove pra QUEUED com o MESMO id, processarFilaOffline() completa sem duplicar', async () => {
    chamadasRede.length = 0;
    await ctxCall("registrarIntencaoLocal('op-orfa-nunca-chegou', 'salvarResposta', ['OS-7', 'op-orfa-nunca-chegou'], 'CHECKLIST', 'OS-7')");
    await flush(); await flush(); await flush();
    comportamento = {
      consultarStatusOperacao: () => ({ encontrado: false }),
      acoesNormais: { salvarResposta: { sucesso: true, success: true } },
    };
    await act('reconciliarIntencoesOrfas()');
    const filaAposReconciliar = await lerFila();
    const item = filaAposReconciliar.find(i => i.operationId === 'op-orfa-nunca-chegou');
    assert.ok(item, 'registro deveria continuar existindo (promovido, nao removido)');
    assert.strictEqual(item.status, 'QUEUED', 'deveria ter sido promovido pra QUEUED');

    chamadasRede.length = 0;
    await act('processarFilaOffline()');
    // Filtra pelo operationId ESPECÍFICO deste teste -- outro item
    // órfão de um teste anterior (op-fixo-1, mesmo IndexedDB fake
    // compartilhado por todo o arquivo) também é reconciliado e
    // reenviado nesta mesma passada, o que é o comportamento CORRETO
    // (prova reconciliação com múltiplos órfãos), só não pode ser
    // confundido com o item que esta asserção quer conferir.
    const chamada = chamadasRede.find(c => c.action === 'salvarResposta' && c.params.includes('op-orfa-nunca-chegou'));
    assert.ok(chamada, 'processarFilaOffline() deveria ter completado a operacao orfa');
    assert.strictEqual(chamada.params[1], 'op-orfa-nunca-chegou', 'deveria ter reenviado com o MESMO operationId original -- e isso que evita duplicar');
    const filaFinal = await lerFila();
    assert.strictEqual(filaFinal.find(i => i.operationId === 'op-orfa-nunca-chegou'), undefined, 'item deveria ter saido da fila apos sincronizar');
  });

  await record('reconciliarIntencoesOrfas(): sem sinal pra confirmar agora -- promove pra QUEUED (default seguro, tenta de novo quando a rede voltar)', async () => {
    chamadasRede.length = 0;
    await ctxCall("registrarIntencaoLocal('op-orfa-sem-sinal', 'pausarOS', ['OS-8'], 'APONTAMENTO', 'OS-8')");
    await flush(); await flush(); await flush();
    comportamento = { consultarStatusOperacao: () => { throw new Error('Falha de rede (JSONP)'); } };
    await act('reconciliarIntencoesOrfas()');
    const fila = await lerFila();
    const item = fila.find(i => i.operationId === 'op-orfa-sem-sinal');
    assert.ok(item);
    assert.strictEqual(item.status, 'QUEUED', 'sem sinal deveria cair no mesmo default seguro (QUEUED), nao ficar preso em LOCAL_PENDING pra sempre');
  });

  // ================================================================
  // 4) Achado ADJACENTE: capturarEUpload persiste um marcador leve
  //    (sem base64) e reconciliarUploadsOrfaos() confirma o desfecho.
  // ================================================================
  await record('capturarEUpload(): persiste marcador LOCAL_PENDING_UPLOAD ANTES do POST, remove no sucesso', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-UP-D7' });
    ctxSet('fetch', () => Promise.resolve({}));
    ctxSet('FileReader', function () {
      this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
    });
    comportamento = { consultarStatusOperacao: () => ({ encontrado: true, resultado: { success: true, url: 'https://drive/foto.jpg' } }) };
    ctxCall('document.getElementById("enc-laudo-input").files = [{name:"foto.jpg", type:"image/jpeg"}]');
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 8);
    const fila = await lerFila();
    assert.strictEqual(fila.filter(i => i.status === 'LOCAL_PENDING_UPLOAD').length, 0, 'marcador deveria ter sido removido apos sucesso confirmado pelo poll');
  });

  await record('capturarEUpload(): app "morre" antes do poll confirmar -- marcador sobrevive em IndexedDB (nao so em variavel local)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-UP-MORTE' });
    ctxSet('fetch', () => Promise.resolve({}));
    ctxSet('FileReader', function () {
      this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
    });
    // consultarStatusOperacao nunca resolve -- simula o app "morrendo"
    // no meio do poll (a promise fica pendurada pra sempre, igual uma
    // aba fechada nunca chamaria o callback de novo).
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice ? params.slice() : params });
      if (action === 'consultarStatusOperacao') return new Promise(() => {});
      return Promise.resolve({});
    });
    ctxCall('document.getElementById("enc-laudo-input").files = [{name:"foto2.jpg", type:"image/jpeg"}]');
    ctxCall("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')"); // nao espera -- like a real crash, ninguem espera o resultado
    await flush(); await flush(); await flush(); await flush(); await flush();
    const fila = await lerFila();
    const marcador = fila.find(i => i.status === 'LOCAL_PENDING_UPLOAD' && i.osId === 'OS-UP-MORTE');
    assert.ok(marcador, 'marcador deveria ter sobrevivido em IndexedDB mesmo com o poll nunca resolvendo -- e exatamente isso que faltava antes do fix');
    ctxSet('gsCallReal', mockGsCallReal);
  });

  await record('reconciliarUploadsOrfaos(): confirma sucesso -- remove o marcador e avisa o tecnico', async () => {
    chamadasRede.length = 0;
    comportamento = { consultarStatusOperacao: () => ({ encontrado: true, resultado: { success: true, url: 'https://drive/x.jpg' } }) };
    await act('reconciliarUploadsOrfaos()');
    const fila = await lerFila();
    assert.strictEqual(fila.filter(i => i.status === 'LOCAL_PENDING_UPLOAD').length, 0, 'todos os marcadores deveriam ter sido limpos');
    const msg = ctxGet('document.getElementById("toast").textContent');
    assert.ok(msg.includes('Confirmado') || msg.includes('concluido'), 'deveria informar que o envio anterior foi confirmado: ' + msg);
  });

  await record('reconciliarUploadsOrfaos(): nao encontra confirmacao -- limpa o marcador (sem base64 pra reenviar) e avisa o tecnico pra verificar', async () => {
    chamadasRede.length = 0;
    await ctxCall("enfileirarChamadaComId('op-upload-nunca-confirmado', 'salvarArquivoOS', ['OS-9', 'T1', 'Assinatura_URL'], 'UPLOAD', 'OS-9', 'LOCAL_PENDING_UPLOAD')");
    await flush(); await flush(); await flush();
    comportamento = { consultarStatusOperacao: () => ({ encontrado: false }) };
    await act('reconciliarUploadsOrfaos()');
    const fila = await lerFila();
    assert.strictEqual(fila.find(i => i.operationId === 'op-upload-nunca-confirmado'), undefined, 'marcador deveria ter sido limpo mesmo sem confirmacao -- nao ha base64 pra reenviar automaticamente');
    const msg = ctxGet('document.getElementById("toast").textContent');
    assert.ok(msg.toLowerCase().includes('nao foi possivel confirmar') || msg.toLowerCase().includes('não foi possível confirmar'), 'deveria avisar que nao foi possivel confirmar: ' + msg);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
