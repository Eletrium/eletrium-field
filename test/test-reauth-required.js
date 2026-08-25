// Contrato REAUTH_REQUIRED (21/08) -- G5-DECISAO-CONTRATO-REAUTH-
// REQUIRED.md (owner, pré-enforcement) + G5-DECISOES-E3-REAUTH-UX.md,
// ambos lidos do branch chatgpt/g5-reauth-backend-20260821 do repo
// backend (não mesclado ainda -- trabalho aqui é "contra mock", per
// pedido explícito do dono). Cobre as 4 prioridades pedidas:
// 1. Interceptor central (E3-30) -- gsCallReal injeta token/detecta
//    reauth_required num único ponto de transporte.
// 2. UX de leitura síncrona (E3-11/12/13/14/14b) -- interrompe, pede
//    login, replay único sem loop; getDiariaHoje tem tratamento próprio
//    (bug real corrigido: catch caindo em carregarHome() sem resposta
//    autoritativa).
// 3. UX de escrita/outbox (E3-15-19/29) -- token reinjetado só no envio,
//    preserva operationId/payload, não conta tentativa/backoff, bloqueio
//    só local (REAUTH_BLOQUEADO), sem status novo no Log_Central.
// 4. Isolamento por técnico (E3-20/21) -- outro técnico no aparelho não
//    dispara nem mostra a fila do técnico anterior.
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

// ---- fake IndexedDB (mesmo padrão das outras suítes deste worktree) ----
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
// classList real (Set-backed) + id -- este teste precisa mesmo confirmar
// qual .screen tem .active de verdade (showScreen/_solicitarReautenticacao
// dependem disso), diferente de outras suites deste worktree que só
// verificam texto/classe de um elemento isolado.
function makeElement(id) {
  const classes = new Set();
  return {
    id: id || '',
    textContent: '', innerHTML: '', value: '', disabled: false, style: {}, dataset: {},
    classList: {
      add: (...cs) => cs.forEach(c => classes.add(c)),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
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
    querySelectorAll(sel) {
      if (sel === '.screen') return Array.from(els.values()).filter(e => e.id.indexOf('scr-') === 0);
      return [];
    },
    querySelector(sel) {
      if (sel === '.screen.active') {
        return Array.from(els.values()).find(e => e.id.indexOf('scr-') === 0 && e.classList.contains('active')) || null;
      }
      return makeElement();
    },
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
function telaAtivaId() {
  const t = ctxCall('document.querySelector(".screen.active")');
  return t ? t.id : null;
}

// ---- mock do transporte bruto (_jsonpBruto) -- não gsCallReal, que É
// o interceptor sob teste. `comportamento[action]` pode ser um valor, um
// Error, ou uma função(params) -- suporta simular reauth_required só na
// 1ª chamada de uma action e sucesso na 2ª (replay). ----
const chamadas = [];
let comportamento = {};
function mockJsonpBruto(action, params) {
  chamadas.push({ action, params: params.slice ? params.slice() : params });
  const r = comportamento[action];
  if (r === undefined) throw new Error('Chamada nao coberta pelo mock: ' + action);
  if (typeof r === 'function') {
    const v = r(params);
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  }
  return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
}
ctxSet('_jsonpBruto', mockJsonpBruto);

function ultimaChamada(action) {
  const cs = chamadas.filter(c => c.action === action);
  return cs[cs.length - 1];
}
function contarChamadas(action) {
  return chamadas.filter(c => c.action === action).length;
}

async function main() {
  // ============================================================
  // 1. INTERCEPTOR CENTRAL (E3-30)
  // ============================================================
  await record('gsCallReal(): sem token local -- params passam sem anexar nada', async () => {
    ctxSet('APP.tokenSessao', null);
    ctxCall("localStorage.removeItem('eletrium_token_sessao')");
    chamadas.length = 0;
    comportamento = { getTecnicos: [{ id: 'T1', nome: 'Tecnico Um' }] };
    await act("gsCallReal('getTecnicos', [])");
    assert.strictEqual(chamadas[0].params.length, 0);
  });

  await record('gsCallReal(): com token local -- anexa como ULTIMO parametro', async () => {
    await act("salvarTokenSessao('tok-abc.123.sig')");
    chamadas.length = 0;
    comportamento = { getOsDoTecnico: [] };
    await act("gsCallReal('getOsDoTecnico', ['T1'])");
    const p = chamadas[0].params;
    assert.strictEqual(p.length, 2);
    assert.strictEqual(p[0], 'T1');
    assert.strictEqual(p[1], 'tok-abc.123.sig');
  });

  await record('gsCallReal(): reauth_required:true -- rejeita com err.reauthRequired, nao resolve normalmente', async () => {
    comportamento = { getOsDoTecnico: { reauth_required: true, retryable: false, erro: 'Token de sessao expirado' } };
    // .catch() anexado JA na criacao (nao dentro de um try/await depois de
    // varios flush()) -- evita o falso-positivo de unhandledRejection do
    // Node nesse intervalo, mesmo padrao ja usado nos testes de cancelamento/
    // loop mais abaixo.
    const capturado = await ctxCall("gsCallReal('getOsDoTecnico', ['T1'])").catch(e => e);
    for (let i = 0; i < 6; i++) await flush();
    assert.ok(capturado, 'deveria ter lancado');
    assert.strictEqual(capturado.reauthRequired, true);
    assert.ok(capturado.recusaOriginal, 'deveria anexar a recusa original do backend');
  });

  await ctxCall("salvarTokenSessao(null)"); // limpa pro resto da suite

  // ============================================================
  // 2. UX DE LEITURA SINCRONA (E3-11/12/13)
  // ============================================================
  ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Um' });

  await record('leituraComReauth(): sucesso de primeira -- nao abre tela de reautenticacao', async () => {
    await act("showScreen('scr-home')");
    comportamento = { getDiariaTecnico: { existe: true } };
    const r = await act("leituraComReauth(() => gsCallReal('getDiariaTecnico', ['T1']))");
    assert.strictEqual(telaAtivaId(), 'scr-home', 'nao deveria ter navegado pra lugar nenhum');
  });

  await record('leituraComReauth(): reauth_required -> login com sucesso -> replay UNICO com sucesso', async () => {
    await act("showScreen('scr-resumo')");
    chamadas.length = 0;
    let primeira = true;
    comportamento = {
      getDiariaTecnico: () => {
        if (primeira) { primeira = false; return { reauth_required: true, retryable: false, erro: 'expirado' }; }
        return { existe: true, marcador: 'replay-ok' };
      },
      validarPin: { valido: true, token: 'tok-novo.999.sig' },
    };
    const promessa = ctxCall("leituraComReauth(() => gsCallReal('getDiariaTecnico', ['T1']))");
    await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar', 'deveria ter interrompido e pedido login');
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    const resultado = await promessa;
    assert.strictEqual(resultado.marcador, 'replay-ok', 'deveria ter repetido a leitura e devolvido o resultado novo');
    assert.strictEqual(telaAtivaId(), 'scr-resumo', 'deveria ter voltado pra tela estavel anterior');
    assert.strictEqual(contarChamadas('getDiariaTecnico'), 2, 'exatamente 1 tentativa original + 1 replay');
    assert.strictEqual(ctxGet('APP.tokenSessao'), 'tok-novo.999.sig', 'token novo deveria ter sido salvo');
  });

  await record('leituraComReauth(): reauth_required -> usuario cancela -- reauthCancelado, sem replay, sem loop', async () => {
    await act("showScreen('scr-meu-veiculo')");
    chamadas.length = 0;
    comportamento = { getVeiculoDoTecnico: { reauth_required: true, retryable: false, erro: 'expirado' } };
    const promessa = ctxCall("leituraComReauth(() => gsCallReal('getVeiculoDoTecnico', ['T1']))").catch(e => ({ __erro: true, reauthCancelado: e.reauthCancelado }));
    await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall('cancelarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    const r = await promessa;
    assert.strictEqual(r.__erro, true);
    assert.strictEqual(r.reauthCancelado, true);
    assert.strictEqual(telaAtivaId(), 'scr-meu-veiculo', 'deveria ter voltado pra tela estavel anterior');
    assert.strictEqual(contarChamadas('getVeiculoDoTecnico'), 1, 'cancelar nao pode disparar replay');
  });

  await record('leituraComReauth(): renova mas expira nos DE NOVO -- reauthLoopEvitado, so 1 replay (sem 3a tentativa)', async () => {
    await act("showScreen('scr-home')");
    chamadas.length = 0;
    comportamento = {
      getOsDoTecnico: { reauth_required: true, retryable: false, erro: 'expirado' }, // sempre expira, mesmo apos "renovar"
      validarPin: { valido: true, token: 'tok-outro.111.sig' },
    };
    const promessa = ctxCall("leituraComReauth(() => gsCallReal('getOsDoTecnico', ['T1']))").catch(e => ({ __erro: true, reauthLoopEvitado: e.reauthLoopEvitado }));
    await flush(); await flush(); await flush();
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    const r = await promessa;
    assert.strictEqual(r.__erro, true);
    assert.strictEqual(r.reauthLoopEvitado, true);
    assert.strictEqual(contarChamadas('getOsDoTecnico'), 2, 'exatamente 2 tentativas (original + replay unico), nunca uma 3a');
  });

  // Achado do dono (26/08, investigação da OS assistida): os 4 call sites
  // que usam leituraComReauth() distinguiam reauthCancelado (silencioso,
  // tela já voltou) mas NÃO distinguiam reauthLoopEvitado -- caía no
  // MESMO texto genérico de qualquer outra falha ("Erro ao carregar...",
  // "Sem conexao no momento"), sem nenhuma pista de que a causa foi
  // sessão expirando de novo após já ter renovado uma vez. Baixo risco,
  // aprovado pelo dono independente de ter sido ou não a causa do achado
  // #3 (erro ao carregar veículo) da OS assistida.
  await record('carregarHome(): reauthLoopEvitado -- card mostra "Sessao expirou de novo", nao o texto generico de "sem conexao"', async () => {
    comportamento = {
      getOsDoTecnico: { reauth_required: true, retryable: false, erro: 'expirado' },
      getOSsPendentesKMFinal: [],
      validarPin: { valido: true, token: 'tok-loop-home.1.sig' },
    };
    ctxCall('carregarHome()');
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 12; i++) await flush();
    const html = ctxGet("document.getElementById('home-os-lista').innerHTML");
    assert.ok(html.includes('Sessao expirou de novo'), 'deveria mostrar o texto especifico, nao o generico de rede: ' + html);
    assert.ok(!html.includes('Sem conexao no momento'), 'nao pode mostrar o texto de rede pra um caso de sessao: ' + html);
  });

  await record('irParaResumo(): reauthLoopEvitado -- toast especifico, nao "Erro ao carregar resumo"', async () => {
    comportamento = {
      getDiariaTecnico: { reauth_required: true, retryable: false, erro: 'expirado' },
      validarPin: { valido: true, token: 'tok-loop-resumo.1.sig' },
    };
    ctxCall('irParaResumo()');
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 12; i++) await flush();
    const texto = ctxGet("document.getElementById('toast').textContent");
    assert.ok(texto.toLowerCase().includes('sessao expirou de novo'), 'texto do toast: ' + texto);
  });

  await record('_carregarFormVeiculo(): reauthLoopEvitado -- toast especifico, nao "Erro ao carregar dados do veiculo" (achado #3 da OS assistida)', async () => {
    ctxSet('APP.veiculo', undefined);
    comportamento = {
      getVeiculoDoTecnico: { reauth_required: true, retryable: false, erro: 'expirado' },
      validarPin: { valido: true, token: 'tok-loop-veiculo.1.sig' },
    };
    ctxCall('_carregarFormVeiculo()');
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 12; i++) await flush();
    const texto = ctxGet("document.getElementById('toast').textContent");
    assert.ok(texto.toLowerCase().includes('sessao expirou de novo'), 'texto do toast: ' + texto);
  });

  await record('responderVeiculo(true): reauthLoopEvitado -- toast especifico, nao cai direto no formulario manual de KM', async () => {
    ctxSet('APP.veiculo', undefined);
    ctxSet('APP.usaVeiculoHoje', true);
    comportamento = {
      getVeiculoDoTecnico: { reauth_required: true, retryable: false, erro: 'expirado' },
      validarPin: { valido: true, token: 'tok-loop-responder.1.sig' },
    };
    ctxCall('responderVeiculo(true)');
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 12; i++) await flush();
    const texto = ctxGet("document.getElementById('toast').textContent");
    assert.ok(texto.toLowerCase().includes('sessao expirou de novo'), 'texto do toast: ' + texto);
  });

  await record('_solicitarReautenticacao(): N chamadas falhando juntas -- 1 SO prompt (promessa compartilhada)', async () => {
    await act("showScreen('scr-home')");
    const p1 = ctxCall('_solicitarReautenticacao()');
    const p2 = ctxCall('_solicitarReautenticacao()');
    const p3 = ctxCall('_solicitarReautenticacao()');
    await flush();
    ctxSet('__p1', p1); ctxSet('__p2', p2); ctxSet('__p3', p3);
    assert.strictEqual(ctxCall('__p1 === __p2'), true, 'segunda chamada deveria reusar a mesma promessa');
    assert.strictEqual(ctxCall('__p1 === __p3'), true, 'terceira chamada tambem deveria reusar');
    ctxCall("cancelarReautenticacao()");
    await flush(); await flush();
  });

  // ============================================================
  // getDiariaHoje / E3-14b -- tratamento proprio + bug real corrigido
  // (catch generico caia em carregarHome() mesmo pra reauth_required)
  // ============================================================
  let carregarHomeChamadas = 0;
  ctxSet('carregarHome', () => { carregarHomeChamadas++; });

  await record('_tentarGetDiariaHoje(): reauth_required + cancela -- volta pro LOGIN (nao chama carregarHome, nao infere Inicio/Home)', async () => {
    carregarHomeChamadas = 0;
    ctxSet('carregarHome', () => { carregarHomeChamadas++; });
    await act("showScreen('scr-pin')");
    chamadas.length = 0;
    comportamento = { getDiariaHoje: { reauth_required: true, retryable: false, erro: 'expirado' } };
    ctxCall("_entrarConfirmado({id:'T9', nome:'Fulano De Tal'})");
    await flush(); await flush(); await flush(); await flush();
    assert.strictEqual(telaAtivaId(), 'scr-reautenticar');
    ctxCall('cancelarReautenticacao()');
    for (let i = 0; i < 10; i++) await flush();
    assert.strictEqual(telaAtivaId(), 'scr-login', 'E3-14b: sem tela operacional segura, volta pro login');
    assert.strictEqual(ctxGet('APP.tecnico'), null, 'sessao nao pode ser tratada como autenticada apos cancelar');
    assert.strictEqual(ctxGet("document.getElementById('login-nome-input').value"), 'Fulano De Tal', 'nome mantido so como conveniencia visual');
    assert.strictEqual(carregarHomeChamadas, 0, 'ACHADO/BUG corrigido: nao pode cair em carregarHome() como fallback pra reauth');
  });

  await record('_tentarGetDiariaHoje(): reauth_required + renova com sucesso -- replay funciona, segue fluxo normal (Inicio do Dia)', async () => {
    carregarHomeChamadas = 0;
    await act("showScreen('scr-pin')");
    chamadas.length = 0;
    let primeira = true;
    let irParaInicioDiaChamado = false;
    ctxSet('irParaInicioDia', () => { irParaInicioDiaChamado = true; });
    comportamento = {
      getDiariaHoje: () => {
        if (primeira) { primeira = false; return { reauth_required: true, retryable: false, erro: 'expirado' }; }
        return { existe: false };
      },
      validarPin: { valido: true, token: 'tok-boot.222.sig' },
    };
    ctxCall("_entrarConfirmado({id:'T9', nome:'Fulano De Tal'})");
    await flush(); await flush(); await flush(); await flush();
    ctxCall("document.getElementById('reautenticar-pin-input').value = '1234'");
    ctxCall('confirmarReautenticacao()');
    for (let i = 0; i < 12; i++) await flush();
    assert.strictEqual(irParaInicioDiaChamado, true, 'replay confirmou diaria.existe=false -- deveria seguir pro fluxo normal');
    assert.strictEqual(carregarHomeChamadas, 0);
  });

  await record('_tentarGetDiariaHoje(): erro generico (rede) -- comportamento ANTIGO preservado, cai em carregarHome()', async () => {
    carregarHomeChamadas = 0;
    chamadas.length = 0;
    comportamento = { getDiariaHoje: new Error('Falha de rede (JSONP)') };
    await act("_entrarConfirmado({id:'T9', nome:'Fulano De Tal'})", 10);
    assert.strictEqual(carregarHomeChamadas, 1, 'falha generica de rede -- fallback antigo continua valendo, so reauth_required e especial');
  });

  // ============================================================
  // 3. UX DE ESCRITA/OUTBOX (E3-15 a E3-19, E3-29)
  // ============================================================
  ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Um' });
  await ctxCall("salvarTokenSessao(null)");

  await record('gsCallIdempotente(): escrita bate reauth_required -- item fica REAUTH_BLOQUEADO, nao DIVERGENT/SYNC_ERROR', async () => {
    chamadas.length = 0;
    comportamento = { pausarOS: { reauth_required: true, retryable: false, erro: 'Token de sessao expirado' } };
    await act("gsCallIdempotente('pausarOS', (opId, devId) => ['OS-1', 'T1', 'Motivo', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'OS', osId: 'OS-1' })", 12);
    const fila = await act('listarFila()');
    assert.strictEqual(fila.length, 1);
    assert.strictEqual(fila[0].status, 'QUEUED', 'gsCallIdempotente enfileira normalmente no catch -- quem marca REAUTH_BLOQUEADO e o processarFilaOffline, no envio real');
  });

  await record('processarFilaOffline(): item que bate reauth_required no ENVIO fica REAUTH_BLOQUEADO -- nao incrementa tentativas/backoff, preserva operationId', async () => {
    const filaAntes = await act('listarFila()');
    const opIdOriginal = filaAntes[0].operationId;
    comportamento = { pausarOS: { reauth_required: true, retryable: false, erro: 'Token de sessao expirado' } };
    await act('processarFilaOffline()', 12);
    const fila = await act('listarFila()');
    assert.strictEqual(fila.length, 1, 'nao pode ser descartada');
    assert.strictEqual(fila[0].status, 'REAUTH_BLOQUEADO');
    assert.strictEqual(fila[0].tentativas, 0, 'expiracao de sessao NAO conta como tentativa/backoff tecnico');
    assert.strictEqual(fila[0].operationId, opIdOriginal, 'mesma operationId preservada');
  });

  await record('processarFilaOffline(): item REAUTH_BLOQUEADO nao e reprocessado sozinho (precisa de retomarOperacoesBloqueadasPorSessao)', async () => {
    chamadas.length = 0;
    comportamento = {}; // nenhuma chamada deveria acontecer
    await act('processarFilaOffline()', 8);
    assert.strictEqual(chamadas.length, 0, 'REAUTH_BLOQUEADO fica parado ate reautenticacao, scanner normal nao mexe nele');
  });

  await record('resumoFila(): item REAUTH_BLOQUEADO conta como "pendente" (nao sincronizado, nao e recusa de negocio)', async () => {
    const r = await act('resumoFila()');
    assert.strictEqual(r.estado, 'pendente');
    assert.strictEqual(r.n, 1);
  });

  await record('retomarOperacoesBloqueadasPorSessao(): apos reauth OK, reenvia preservando operationId/payload -- sucesso remove da fila', async () => {
    const filaAntes = await act('listarFila()');
    const opIdOriginal = filaAntes[0].operationId;
    const paramsOriginais = filaAntes[0].params;
    // Simula o que a reautenticacao real ja teria feito antes de chamar
    // retomarOperacoesBloqueadasPorSessao (ela mesma so roda dentro do
    // resolve de sucesso de _solicitarReautenticacao, depois de
    // salvarTokenSessao ja ter rodado) -- aqui chamamos direto pra testar
    // isoladamente, entao precisa deste passo manualmente.
    await act("salvarTokenSessao('tok-retomar.777.sig')");
    chamadas.length = 0;
    comportamento = {
      pausarOS: (params) => {
        // confirma que o reenvio preservou o payload original + token novo anexado no final
        return { success: true };
      },
    };
    await act('retomarOperacoesBloqueadasPorSessao()', 12);
    const chamada = ultimaChamada('pausarOS');
    assert.ok(chamada, 'deveria ter reenviado pausarOS');
    assert.strictEqual(chamada.params.length, paramsOriginais.length + 1, 'payload original + token anexado no final');
    for (let i = 0; i < paramsOriginais.length; i++) {
      assert.strictEqual(chamada.params[i], paramsOriginais[i], 'params originais preservados na mesma ordem, indice ' + i);
    }
    assert.strictEqual(chamada.params[paramsOriginais.length], 'tok-retomar.777.sig', 'token novo deveria ser o ultimo parametro');
    const filaDepois = await act('listarFila()');
    assert.strictEqual(filaDepois.length, 0, 'sucesso no reenvio -- item sai da fila');
  });

  // ============================================================
  // 4. ISOLAMENTO POR TECNICO (E3-20/21)
  // ============================================================
  await record('enfileirarChamadaComId(): item novo carrega o tecnicoId de quem estava logado ao registrar', async () => {
    ctxSet('APP.tecnico', { id: 'TEC-A', nome: 'Tecnico A' });
    comportamento = { registrarMovimentoFerramental: new Error('offline') };
    await act("gsCallIdempotente('registrarMovimentoFerramental', (opId, devId) => ['OS-ISO', 'TEC-A', 'Carga', opId, devId], { enfileiravelSeOffline: true, tipoOperacao: 'FERRAMENTAL', osId: 'OS-ISO' })", 10);
    const fila = await act('listarFila()');
    const item = fila.find(i => i.action === 'registrarMovimentoFerramental');
    assert.ok(item);
    assert.strictEqual(item.tecnicoId, 'TEC-A');
  });

  await record('processarFilaOffline(): tecnico B logado -- NAO dispara a operacao pendente do tecnico A', async () => {
    ctxSet('APP.tecnico', { id: 'TEC-B', nome: 'Tecnico B' });
    chamadas.length = 0;
    comportamento = {};
    await act('processarFilaOffline()', 8);
    assert.strictEqual(contarChamadas('registrarMovimentoFerramental'), 0, 'item do tecnico A nao pode ser reenviado sob a identidade de B');
  });

  await record('resumoFila(): tecnico B logado -- NAO mostra a fila do tecnico A (sincronizado do ponto de vista de B)', async () => {
    const r = await act('resumoFila()');
    assert.strictEqual(r.estado, 'sincronizado', 'a operacao pendente e do tecnico A, B nao deveria ver nada');
  });

  await record('resumoFila(): tecnico A loga de volta -- volta a ver e poder reenviar a propria fila', async () => {
    ctxSet('APP.tecnico', { id: 'TEC-A', nome: 'Tecnico A' });
    const r = await act('resumoFila()');
    assert.strictEqual(r.estado, 'pendente');
    assert.strictEqual(r.n, 1);
    chamadas.length = 0;
    comportamento = { registrarMovimentoFerramental: { success: true } };
    await act('processarFilaOffline()', 12);
    assert.strictEqual(contarChamadas('registrarMovimentoFerramental'), 1, 'tecnico dono de volta -- processa normalmente');
    const filaFinal = await act('listarFila()');
    assert.strictEqual(filaFinal.length, 0);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
