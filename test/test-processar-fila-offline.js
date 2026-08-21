// Teste real de processarFilaOffline consumindo o contrato canônico
// do backend (docs/CONTRATO-FRONTEND-ENVELOPE-RECUSA.md) -- tarefa do
// dono após o achado da revisão de integração: a versão antiga só
// reconhecia recusa quando a resposta tinha `blockingReasons`
// (exclusivo de canCloseOS/encerrarOS); qualquer outra função de
// escrita (KM, checklist, ferramental, oferta) que recusasse passava
// batido e o item era marcado SYNCED e removido em silêncio.
//
// Roda o <script> DE VERDADE de index.html via vm. gsCallReal mockado
// (nenhuma chamada de rede real). Diferente das outras suítes deste
// worktree, este teste PRECISA de IndexedDB de verdade (é o que
// processarFilaOffline lê/escreve) -- como fake-indexeddb não está
// instalado neste worktree, implementamos aqui um fake mínimo, só com
// a fatia da API que abrirDB()/enfileirarChamadaComId()/listarFila()/
// atualizarItemFila()/removerItemFila() realmente usam (open com
// onupgradeneeded/onsuccess, 1 object store keyPath+autoIncrement, 1
// transação por vez, get/put/add/delete/getAll). Callbacks de request
// disparam via microtask (Promise.resolve().then), oncomplete da
// transação via macrotask (setImmediate) -- garante que operações
// encadeadas (get().onsuccess chamando put()) terminem ANTES do
// oncomplete resolver a promise que o app está esperando (mesma
// técnica de ordenação microtask-antes-de-macrotask já usada no
// flush() das outras suítes deste worktree).
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

// ---- fake IndexedDB mínimo -----------------------------------------
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
// Fila do outbox tem várias camadas de microtask+macrotask por
// operação (abrirDB -> get -> put, cada uma com seu próprio salto) --
// alguns caminhos (enfileirar, depois processar, depois reler)
// precisam de mais de um flush() encadeado. act() aceita quantos
// flushes forem necessários.
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr, voltas) {
  const r = ctxCall(expr);
  for (let i = 0; i < (voltas || 3); i++) await flush();
  return r;
}

const chamadasRede = [];
let proximaResposta = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (!proximaResposta) throw new Error('proximaResposta nao configurada pra ' + action);
  const r = proximaResposta; proximaResposta = null;
  if (r instanceof Error) return Promise.reject(r);
  return Promise.resolve(r);
}
ctxSet('gsCallReal', mockGsCallReal);

async function enfileirar(action, params, tipoOperacao, osId) {
  return ctxCall(
    `enfileirarChamadaComId('op-' + Math.random(), ${JSON.stringify(action)}, ${JSON.stringify(params)}, ${JSON.stringify(tipoOperacao)}, ${JSON.stringify(osId)})`
  );
}
async function lerFila() {
  const r = await act('listarFila()', 4);
  return JSON.parse(JSON.stringify(r));
}

async function main() {
  // ================================================================
  // 1) Sucesso canônico (success:true) -- item sai da fila (SYNCED)
  // ================================================================
  await record('item com success:true sincroniza e sai da fila', async () => {
    await enfileirar('salvarResposta', ['OS-1'], 'CHECKLIST', 'OS-1');
    await flush(); await flush();
    proximaResposta = { success: true, status: 'SYNCED', operation_id: 'op-1', error_code: null, retryable: false, blocking_reasons: [] };
    await act('processarFilaOffline()', 5);
    const fila = await lerFila();
    assert.strictEqual(fila.filter(i => i.action === 'salvarResposta').length, 0, 'item deveria ter saido da fila');
  });

  // ================================================================
  // 2) O ACHADO CORRIGIDO: recusa de regra de negocio SEM
  //    blockingReasons (formato canonico -- ex.: KM, checklist,
  //    ferramental, oferta) agora vira DIVERGENT, nao mais SYNCED.
  // ================================================================
  await record('recusa de regra de negocio (success:false, retryable:false, SEM blockingReasons) vira DIVERGENT, nao SYNCED', async () => {
    await enfileirar('iniciarOSComKM', ['OS-2'], 'REGISTRO_KM', 'OS-2');
    await flush(); await flush();
    proximaResposta = {
      success: false, status: 'DIVERGENT', operation_id: 'op-2', error_code: 'DIVERGENCIA_VALOR',
      retryable: false, blocking_reasons: ['Diferenca de KM detectada'],
      // campos legados continuam presentes, mas SEM blockingReasons (o
      // formato antigo que a checagem velha exigia)
      exigeJustificativa: true, mensagem: 'Diferenca de KM detectada', sucesso: false,
    };
    await act('processarFilaOffline()', 5);
    const fila = await lerFila();
    const item = fila.find(i => i.action === 'iniciarOSComKM');
    assert.ok(item, 'item deveria continuar na fila (DIVERGENT nao remove)');
    assert.strictEqual(item.status, 'DIVERGENT');
    assert.deepStrictEqual(JSON.parse(item.erroDetalhe), ['Diferenca de KM detectada']);
  });

  await record('item DIVERGENT nao e reprocessado numa chamada seguinte de processarFilaOffline()', async () => {
    chamadasRede.length = 0;
    await act('processarFilaOffline()', 3);
    assert.strictEqual(chamadasRede.filter(c => c.action === 'iniciarOSComKM').length, 0, 'DIVERGENT fica parado ate acao humana, nao reprocessa sozinho');
  });

  // ================================================================
  // 3) Falha TRANSITORIA (retryable:true) -- SYNC_ERROR com backoff,
  //    mesmo tratamento que falha de rede, mas SEM lancar excecao.
  // ================================================================
  await record('recusa transitoria (success:false, retryable:true) vira SYNC_ERROR com backoff, continua na fila', async () => {
    await enfileirar('registrarMovimentoFerramental', ['OS-3'], 'FERRAMENTAL', 'OS-3');
    await flush(); await flush();
    proximaResposta = { success: false, status: 'SYNC_ERROR', operation_id: 'op-3', error_code: 'CONEXAO_INDISPONIVEL', retryable: true, blocking_reasons: ['Sistema ocupado, tente novamente em instantes'] };
    await act('processarFilaOffline()', 5);
    const fila = await lerFila();
    const item = fila.find(i => i.action === 'registrarMovimentoFerramental');
    assert.ok(item);
    assert.strictEqual(item.status, 'SYNC_ERROR');
    assert.strictEqual(item.tentativas, 1);
    assert.ok(item.proximaTentativaEm > Date.now() - 1000, 'deveria ter agendado proxima tentativa com backoff');
  });

  // ================================================================
  // 4) Regressao: falha de REDE (excecao) continua tratada igual --
  //    esta suite so mudou a deteccao de recusa NA RESPOSTA, nao o
  //    catch de erro de transporte.
  // ================================================================
  await record('regressao: excecao de rede (gsCallReal rejeita) continua virando SYNC_ERROR', async () => {
    await enfileirar('registrarAceiteOferta', ['OF-1'], 'ACEITE_OFERTA', 'OS-4');
    await flush(); await flush();
    proximaResposta = new Error('Falha de rede (JSONP)');
    await act('processarFilaOffline()', 5);
    const fila = await lerFila();
    const item = fila.find(i => i.action === 'registrarAceiteOferta');
    assert.ok(item);
    assert.strictEqual(item.status, 'SYNC_ERROR');
    assert.strictEqual(item.erroDetalhe, 'Falha de rede (JSONP)');
  });

  // ================================================================
  // 5) Regressao: canCloseOS/encerrarOS -- o caso ORIGINAL que a
  //    checagem antiga (so blockingReasons) tratava certo -- continua
  //    virando DIVERGENT com a checagem NOVA. `_recusa()` (Código.js)
  //    hoje devolve o envelope canonico completo (success:false) E os
  //    campos legados (blockingReasons) juntos -- não um ou outro.
  // ================================================================
  await record('regressao: canCloseOS bloqueando encerramento (envelope canonico completo) continua virando DIVERGENT', async () => {
    await enfileirar('encerrarOSComKM', ['OS-5'], 'CONCLUSAO', 'OS-5');
    await flush(); await flush();
    proximaResposta = {
      success: false, status: 'DIVERGENT', operation_id: 'op-5', error_code: 'DIVERGENCIA_AUSENCIA',
      retryable: false, blocking_reasons: ['Laudo pendente'],
      // campos legados, presentes JUNTO (nao no lugar) do envelope canonico
      sucesso: false, erro: 'OS nao pode ser concluida ainda', motivos: ['Laudo pendente'], blockingReasons: ['Laudo pendente'],
    };
    await act('processarFilaOffline()', 5);
    const fila = await lerFila();
    const item = fila.find(i => i.action === 'encerrarOSComKM');
    assert.ok(item, 'item deveria continuar na fila');
    assert.strictEqual(item.status, 'DIVERGENT');
  });

  // ================================================================
  // 6) ACHADO DO DONO (pedido explícito, "antes de qualquer outra
  //    coisa"): retry de um SYNC_ERROR GENUÍNO (fn() lançou exceção de
  //    verdade no backend, não erro de rede) reusa o MESMO operationId
  //    -- confirmado por leitura de enfileirarChamadaComId/
  //    processarFilaOffline (item.params é gravado uma vez e reenviado
  //    verbatim a cada tentativa, nunca regenerado). Cruzado com
  //    Código.js:411-473 (executarIdempotente) + Código.js:530-540
  //    (processarEGravarLog, catch de fn()): quando fn() lança exceção,
  //    SYNC_ERROR é gravado mas resultado_json fica VAZIO -- o retry
  //    com o mesmo operationId cai no fallback de Código.js:467-472,
  //    que devolve retryable:false HARDCODED, sem rodar fn() de novo.
  //    Com a checagem success/retryable da suíte anterior (correta em
  //    si), esse retryable:false vira DIVERGENT já na 2ª tentativa --
  //    a mutação real só correu (e falhou) UMA vez, nunca teve uma
  //    segunda chance de verdade, mesmo a falha original sendo
  //    potencialmente transitória.
  //
  //    Este teste PROVA o comportamento atual (não afirma que está
  //    certo) -- é a confirmação pedida antes de decidir o fix (outbox
  //    gerar operationId novo por tentativa de SYNC_ERROR, vs. backend
  //    distinguir "visto mas ainda tentável" de "definitivamente
  //    resolvido"). Ver relatório da sessão pra recomendação.
  // ================================================================
  await record('ACHADO CONFIRMADO: retry de SYNC_ERROR genuino reusa o mesmo operationId, e o dedup do backend (sem resultado_json cacheado) devolve retryable:false -- fn() nunca roda de novo', async () => {
    const OPERATION_ID_FIXO = 'op-retry-genuino-001';
    await ctxCall(`enfileirarChamadaComId(${JSON.stringify(OPERATION_ID_FIXO)}, 'registrarInicioDia', ['T-6', true, '', ${JSON.stringify(OPERATION_ID_FIXO)}], 'INICIO_DIA', '')`);
    await flush(); await flush();

    // 1a tentativa (dentro de processarFilaOffline): fn() lancou excecao
    // de VERDADE no backend (nao falha de rede) -- SYNC_ERROR,
    // retryable:true (Codigo.js:540), mas SEM resultado_json (o catch
    // de processarEGravarLog so grava status/erro/erro_codigo).
    chamadasRede.length = 0;
    proximaResposta = { success: false, status: 'SYNC_ERROR', operation_id: OPERATION_ID_FIXO, error_code: 'ERRO_DESCONHECIDO', retryable: true, blocking_reasons: ['Erro transitorio simulado no backend'] };
    await act('processarFilaOffline()', 5);

    let fila = await lerFila();
    let item = fila.find(i => i.action === 'registrarInicioDia');
    assert.ok(item, '1a tentativa deveria ter deixado o item na fila (retryable)');
    assert.strictEqual(item.status, 'SYNC_ERROR');
    assert.strictEqual(item.tentativas, 1);
    const paramsPrimeiraTentativa = chamadasRede[0].params;
    assert.strictEqual(paramsPrimeiraTentativa[3], OPERATION_ID_FIXO);

    // Pula o backoff sem esperar de verdade (mesmo campo que o app usa).
    await ctxCall('atualizarItemFila(' + item.id + ', { proximaTentativaEm: 0 })');
    await flush(); await flush();

    // 2a tentativa: o outbox reenvia item.params tal como gravado --
    // simula a resposta REAL do backend pra esse retry (executarIdempotente
    // acha a linha da 1a tentativa, resultado_json vazio -> cai no
    // fallback _recusa(..., retryable:false) -- NAO roda fn() de novo).
    chamadasRede.length = 0;
    proximaResposta = {
      success: false, status: 'SYNC_ERROR', operation_id: OPERATION_ID_FIXO, error_code: 'DUPLICADO',
      retryable: false, blocking_reasons: ['Operacao ja registrada (operation_id existente) -- verifique o status antes de tentar de novo'],
      ja_registrada: true,
    };
    await act('processarFilaOffline()', 5);

    assert.strictEqual(chamadasRede.length, 1, 'deveria ter tentado reenviar');
    const paramsSegundaTentativa = chamadasRede[0].params;
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(paramsSegundaTentativa)),
      JSON.parse(JSON.stringify(paramsPrimeiraTentativa)),
      'CONFIRMADO: o outbox reenvia os MESMOS params (mesmo operationId) na 2a tentativa -- nunca gera um id novo por retry'
    );

    fila = await lerFila();
    item = fila.find(i => i.action === 'registrarInicioDia');
    assert.ok(item, 'item continua na fila (nao foi removido como se fosse SYNCED)');
    assert.strictEqual(item.status, 'DIVERGENT', 'ACHADO: retryable:false na 2a resposta do backend faz o outbox desistir -- vira DIVERGENT depois de 1 SO tentativa real');

    // Prova final: uma 3a chamada nem tenta mais -- DIVERGENT esta na
    // lista de skip do topo do loop. A mutacao real rodou (e falhou)
    // UMA UNICA vez; nunca teve segunda chance de verdade.
    chamadasRede.length = 0;
    await act('processarFilaOffline()', 3);
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarInicioDia').length, 0, 'DIVERGENT nao reprocessa -- retry automatico efetivamente morto apos a 1a falha real');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
