// Teste de INTEGRAÇÃO entre as 5 fatias da Frente B (Diretriz v1.1),
// pedido explícito do dono após a entrega da fatia 6 (ferramental):
// cada fatia foi testada isolada (test-checklist-3-fases.js,
// test-km-foto-desvio.js, test-aceite-oferta.js, test-ferramental.js),
// mas nenhum teste ainda encadeava todas na MESMA sessão de um único
// técnico, na ordem que aconteceria de verdade -- é aqui que bugs de
// estado compartilhado (APP global) apareceriam, e que não apareceriam
// em nenhuma suíte isolada (cada uma começa com sandbox/APP zerados).
//
// Mesma técnica das outras suítes: roda o <script> DE VERDADE de
// index.html via vm, rede 100% mockada.
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

// ---- fake IndexedDB mínimo (mesmo das outras suítes que tocam o
// outbox) -- achado ao rodar este teste após a Fase B (home
// contextual) da reorganização de UX: renderHome() agora chama
// renderStatusSincronizacao() -> resumoFila() -> listarFila(), que
// precisa de IndexedDB de verdade. Antes deste teste não precisava.
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
    textContent: '', innerHTML: '', value: '', checked: false, files: null,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
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
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.location = { hash: '', pathname: '/index.html', search: '' };
sandbox.history = { replaceState() {} };
sandbox.indexedDB = makeFakeIndexedDB();

const chamadasFetch = [];
sandbox.fetch = (url, opts) => {
  chamadasFetch.push({ url, body: JSON.parse(opts.body) });
  return Promise.resolve({});
};
sandbox.FileReader = function FakeFileReader() {
  this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
};

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
// D7-08: gsCallIdempotente agora faz 2 idas a mais no IndexedDB por
// chamada (registra a intenção ANTES da tentativa ao vivo, remove no
// sucesso) -- cada uma com sua própria cadeia microtask+macrotask no
// fake IndexedDB. Um único flush() não é mais suficiente pra deixar
// tudo assentar antes da asserção seguinte; várias voltas cobre isso
// sem precisar tocar cada um dos 19 call sites de act() individualmente.
async function act(expr) { const r = ctxCall(expr); for (let i = 0; i < 6; i++) await flush(); return r; }

function fileFalso(nome) { return { name: nome || 'foto.jpg', type: 'image/jpeg' }; }
function estadoLocalChecklist(osId) {
  return JSON.parse(sandbox.localStorage.getItem('eletrium_chk3f_' + osId) || 'null');
}

// ---- mock único, cobrindo TODAS as actions das 5 fatias ao mesmo tempo
const chamadasRede = [];
let respostas = {}; // action -> valor fixo OU array (consumido em ordem) OU função(params)
function proxima(action, valorOuArray) { respostas[action] = valorOuArray; }
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  const cfg = respostas[action];
  if (typeof cfg === 'function') return Promise.resolve(cfg(params));
  if (Array.isArray(cfg)) {
    if (!cfg.length) throw new Error('fila de respostas vazia pra ' + action);
    return Promise.resolve(cfg.shift());
  }
  if (cfg !== undefined) return Promise.resolve(cfg);
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action + ' ' + JSON.stringify(params));
}
ctxSet('gsCallReal', mockGsCallReal);

async function main() {
  // ================================================================
  // Dia de trabalho completo de um único técnico, na ordem real:
  // login -> iniciar OS com desvio de KM (foto) -> ferramental (carga)
  // -> checklist (fase 1 + fase 2) -> ferramental (desmobilização) ->
  // encerrar OS (gate da fatia 3 tem que já estar liberado).
  // ================================================================

  await record('1) login: getTecnicos -> validarPin -> getDiariaHoje, sem sobra de estado de nenhuma fatia anterior', async () => {
    proxima('getTecnicos', () => [{ id: 'T-INT', nome: 'Integração Teste' }]);
    await act('carregarTecnicos()');
    await act("entrarComoTecnico({ id: 'T-INT', nome: 'Integração Teste' })");
    ctxSet('document.getElementById("pin-input").value', '1234');
    proxima('validarPin', { valido: true });
    proxima('getDiariaHoje', { existe: true, usaVeiculo: true, kmInicial: 1000 });
    proxima('getOSsPendentesKMFinal', () => []);
    proxima('getOsDoTecnico', () => []);
    await act('confirmarPin()');
    assert.strictEqual(ctxGet('APP.tecnico.id'), 'T-INT');
    assert.strictEqual(ctxGet('APP.usaVeiculoHoje'), true);
  });

  await record('2) iniciar OS com desvio de KM: bloqueia, foto+justificativa destrava, OS fica ativa', async () => {
    ctxSet('APP.veiculo', { placa: 'INT1234' });
    await act("confirmarIniciarOS({ id: 'OS-INT', cliente: 'Cliente Integracao' })");
    assert.strictEqual(ctxGet('APP.telaKmModo'), 'iniciar');

    ctxSet('document.getElementById("iniciar-km-input").value', '9999');
    proxima('iniciarOSComKM', [{ sucesso: false, exigeJustificativa: true, mensagem: 'Diferenca de KM detectada' }]);
    await act('confirmarKMInicial()');

    ctxSet('document.getElementById("iniciar-km-justificativa").value', 'Desvio por obra na via');
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odo.jpg')]);
    proxima('consultarStatusOperacao', { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/odo-int.jpg' } });
    await act('capturarFotoDesvioKM()');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), 'https://drive.example/odo-int.jpg');

    proxima('iniciarOSComKM', [{ sucesso: true, hora: '08:00' }]);
    // iniciarOSComKM bem-sucedido chama carregarHome() de novo internamente
    // (achado ao escrever este teste) -- que RE-DERIVA APP.osAtiva a partir
    // da resposta de getOsDoTecnico (renderHome, index.html:1691-1699), não
    // confia só no que acabou de setar em memória. O mock precisa refletir
    // que o backend real já veria esta OS como "Em andamento" nesse ponto.
    proxima('getOSsPendentesKMFinal', () => []);
    proxima('getOsDoTecnico', () => [{ id: 'OS-INT', cliente: 'Cliente Integracao', statusAtual: 'Em andamento', horasProdutivas: 0 }]);
    await act('confirmarKMInicial()');
    assert.strictEqual(ctxGet('APP.osAtiva.id'), 'OS-INT', 'OS deveria estar ativa apos o desvio ser resolvido');
  });

  await record('3) ferramental (carga): usa APP.osAtiva.id corretamente, sem interferencia do telaKmModo da etapa anterior', async () => {
    proxima('getFerramentalDaOS', () => []);
    await act('irParaFerramental()');
    const chamadaLista = chamadasRede.filter(c => c.action === 'getFerramentalDaOS').pop();
    assert.strictEqual(chamadaLista.params[0], 'OS-INT');
    assert.strictEqual(ctxGet('APP.ferramentalTipo'), 'Carga');

    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-INT-1');
    proxima('registrarMovimentoFerramental', { sucesso: true });
    proxima('getFerramentalDaOS', () => [{ patrimonioCodigo: 'FER-INT-1', tipoMovimento: 'Carga', estadoOk: true, observacao: '' }]);
    await act('registrarMovimentoFerramental()');
    const chamadaRegistro = chamadasRede.filter(c => c.action === 'registrarMovimentoFerramental').pop();
    assert.strictEqual(chamadaRegistro.params[0], 'OS-INT');
    assert.strictEqual(chamadaRegistro.params[1], 'T-INT');
  });

  await record('4) checklist Fase 1 (seguranca): 5 perguntas + fecharFaseChecklist, isolado de ferramental/KM', async () => {
    chamadasRede.length = 0;
    proxima('salvarResposta', () => ({ sucesso: true }));
    await act('irParaChecklist()');
    assert.strictEqual(ctxGet("document.getElementById('chk-f1-texto').textContent"), 'EPI utilizado corretamente?');
    for (let i = 0; i < 4; i++) await act('CHK3F.responder(true)');
    // P0 (15/08): fecharFaseChecklist substitui confirmarSegurancaPreExecucao
    // como escritor real de Estado_Seguranca. A ultima resposta da Fase 1
    // dispara _finalizarFase1() -> fecharFaseChecklist('Pré-Execução') ->
    // auto-entra na Fase 2 (_iniciarFaseExecucao -> carregarPergunta ->
    // getProximaPergunta) -> como este mock devolve null na hora,
    // _fecharFase2Execucao TAMBÉM chama fecharFaseChecklist('Execução')
    // NA MESMA cadeia -- por isso a resposta cobre as duas fases (não
    // depende do fase param aqui, ambas devem suceder). Mock precisa
    // estar pronto ANTES desta chamada, não depois (achado ao escrever
    // este teste originalmente: a etapa 5 configurava tarde demais).
    proxima('fecharFaseChecklist', () => ({ sucesso: true, completa: true, estado: 'Liberado' }));
    proxima('getProximaPergunta', null);
    await act('CHK3F.responder(false)'); // sem NC adicional
    // P0 (15/08): esta última resposta dispara a cadeia MAIS funda da
    // suíte -- fecharFaseChecklist(Pré-Execução) [registrarIntencaoLocal
    // + gsCallReal + removerItemPorOperationId] -> auto-entra na Fase 2
    // -> getProximaPergunta -> fecharFaseChecklist(Execução) [mesma
    // cadeia de novo]. As 6 voltas padrão de act() não são suficientes
    // pra deixar tudo assentar antes da próxima asserção (achado ao
    // rodar este teste após o fix) -- flushes extras só aqui, não vale
    // bumpar o act() inteiro por causa de 1 call site excepcionalmente
    // fundo.
    for (let i = 0; i < 10; i++) await flush();
    const estado = estadoLocalChecklist('OS-INT');
    assert.strictEqual(estado.fase1.completo, true);
    assert.strictEqual(estado.fase1.estadoSeguranca, 'Liberado');
  });

  await record('5) checklist Fase 2 (execucao): fallback CHK, fecha e concluirChecklist() marca fase2', async () => {
    const resumo = ctxGet("document.getElementById('chk-resumo-block').style.display");
    assert.strictEqual(resumo, 'block');
    await act('concluirChecklist()');
    const estado = estadoLocalChecklist('OS-INT');
    assert.strictEqual(estado.fase2.completo, true);
  });

  await record('6) ferramental (desmobilizacao) apos o checklist: ainda funciona, nao foi afetado pelo estado do CHK3F', async () => {
    chamadasRede.length = 0;
    proxima('getFerramentalDaOS', () => [{ patrimonioCodigo: 'FER-INT-1', tipoMovimento: 'Carga', estadoOk: true, observacao: '' }]);
    await act('irParaFerramental()');
    ctxCall("selecionarTipoFerramental('Desmobilizacao')");
    ctxSet('document.getElementById("ferramental-patrimonio").value', 'FER-INT-1');
    ctxSet('document.getElementById("ferramental-estado-ok").checked', true);
    proxima('registrarMovimentoFerramental', { sucesso: true });
    proxima('getFerramentalDaOS', () => []);
    await act('registrarMovimentoFerramental()');
    const chamada = chamadasRede.filter(c => c.action === 'registrarMovimentoFerramental').pop();
    assert.strictEqual(chamada.params[3], 'Desmobilizacao');
    assert.strictEqual(chamada.params[0], 'OS-INT', 'ainda a OS certa, checklist nao mudou APP.osAtiva');
  });

  await record('7) encerrar OS: o gate da fatia 3 (fase 1+2 completas) libera a tela de verdade, e a conclusao passa', async () => {
    await act('irParaEncerrar()');
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.strictEqual(encId, 'OS-INT - Cliente Integracao', 'gate deveria ter liberado -- fases 1 e 2 completas nos passos 4 e 5');
    const segStatus = ctxGet("document.getElementById('enc-seguranca-status').textContent");
    assert.strictEqual(segStatus, 'Segurança: Liberado');

    proxima('encerrarOSComKM', { sucesso: true, horasFinais: '4h30' });
    // confirmarEncerramento(), ao suceder, chama carregarHome() de novo
    // internamente -- precisa das mesmas 2 respostas que carregarHome()
    // sempre consome (achado ao escrever este teste: cada chamada a
    // carregarHome() consome 1x getOSsPendentesKMFinal + 1x getOsDoTecnico).
    proxima('getOSsPendentesKMFinal', () => []);
    proxima('getOsDoTecnico', () => []);
    await act('confirmarEncerramento()');
    assert.strictEqual(ctxGet('APP.osAtiva'), null, 'OS deveria ter encerrado de verdade');
  });

  await record('8) 2a OS do mesmo técnico no mesmo dia: estado da Fase 1/2 (CHK3F) é POR OS, não vaza da OS anterior', async () => {
    proxima('getOSsPendentesKMFinal', () => []);
    proxima('getOsDoTecnico', () => []);
    await act('carregarHome()');
    ctxSet('APP.osAtiva', { id: 'OS-INT-2', cliente: 'Segundo cliente do dia' });
    const estado = estadoLocalChecklist('OS-INT-2');
    assert.strictEqual(estado, null, 'OS nova nao deveria herdar fase1/fase2 completas da OS anterior');
    await act('irParaEncerrar()');
    // sem checklist feito pra esta OS -> gate deveria mandar pro checklist, nao liberar encerrar
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.notStrictEqual(encId, 'OS-INT-2 - Segundo cliente do dia', 'gate nao deveria ter liberado uma OS diferente sem checklist proprio');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
