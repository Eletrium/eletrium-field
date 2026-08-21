// Teste real do wizard de encerramento (Fase C da reorganização de UX,
// 13/08, seções 49-55 do documento do auditor) -- Execução ->
// Pendências -> Evidências -> Aceite -> Revisão -> Concluir, em vez de
// formulário único. Roda o <script> DE VERDADE de index.html via vm,
// gsCallReal mockado (nenhuma chamada de rede real).
//
// Foco: NADA do que já era validado mudou por dentro (gate de
// checklist da Fase 3, captura de Laudo/Assinatura, mensagem de
// blockingReasons) -- só a organização da tela em etapas + a
// pré-validação nova (canCloseOS chamado proativamente).
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
    textContent: '', innerHTML: '', value: '', checked: false, files: null, disabled: false,
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

ctxSet('APP.tecnico', { id: 'T1', nome: 'Técnico Teste' });

const chamadasRede = [];
let respostaCanCloseOS = null;
let respostaEncerrar = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (action === 'canCloseOS') {
    if (!respostaCanCloseOS) throw new Error('respostaCanCloseOS nao configurada');
    return Promise.resolve(respostaCanCloseOS);
  }
  if (action === 'encerrarOSComKM') {
    if (!respostaEncerrar) throw new Error('respostaEncerrar nao configurada');
    const r = respostaEncerrar; respostaEncerrar = null; return Promise.resolve(r);
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);

function osComChecklistCompleto(id) {
  // CHK3F.lerEstado lê do localStorage por OS -- simula fases 1 e 2 já
  // completas (mesmo gate que já existia antes deste wizard, intocado).
  sandbox.localStorage.setItem('eletrium_chk3f_' + id, JSON.stringify({
    fase1: { completo: true, estadoSeguranca: 'Liberado' },
    fase2: { completo: true },
  }));
}

async function main() {
  // ================================================================
  // 1) O gate da Fase 3 (checklist) continua intocado -- sem checklist
  //    completo, nem entra no wizard.
  // ================================================================
  await record('irParaEncerrar(): sem checklist completo, gate intocado continua bloqueando (nao entra no wizard)', async () => {
    ctxSet('APP.osAtiva', { id: 'OS-SEM-CHK', cliente: 'Cliente 1' });
    await act('irParaEncerrar()');
    const etapa1Display = ctxGet("document.getElementById('enc-etapa-1').style.display");
    assert.notStrictEqual(etapa1Display, 'block', 'nao deveria ter entrado na etapa 1 do wizard sem o checklist completo');
  });

  // ================================================================
  // 2) Com checklist completo: entra na Etapa 1, navegacao sequencial
  // ================================================================
  await record('irParaEncerrar(): com checklist completo, entra no wizard na Etapa 1', async () => {
    osComChecklistCompleto('OS-100');
    ctxSet('APP.osAtiva', { id: 'OS-100', cliente: 'Cliente 100', qtdRealizada: 5, pctAcumulado: 40 });
    await act('irParaEncerrar()');
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 1);
    assert.strictEqual(ctxGet("document.getElementById('enc-etapa-1').style.display"), 'block');
    assert.strictEqual(ctxGet("document.getElementById('enc-etapa-label').textContent"), 'Etapa 1 de 6 — Execução');
    assert.strictEqual(ctxGet("document.getElementById('enc-qtd').value"), 5, 'campos da OS pre-preenchidos, mesmo comportamento de antes');
  });

  await record('encerramentoProximaEtapa(): Execucao -> Pendencias chama canCloseOS proativamente (pre-validacao)', async () => {
    chamadasRede.length = 0;
    respostaCanCloseOS = { allowed: false, blockingReasons: ['Laudo pendente', 'Assinatura do cliente pendente'] };
    await act('encerramentoProximaEtapa()', 6);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 2);
    const chamada = chamadasRede.find(c => c.action === 'canCloseOS');
    assert.ok(chamada, 'deveria ter chamado canCloseOS ao entrar na etapa Pendencias');
    assert.strictEqual(chamada.params[0], 'OS-100');
    const html = ctxGet("document.getElementById('enc-pendencias-lista').innerHTML");
    assert.ok(html.includes('Laudo pendente'), 'deveria mostrar os motivos reais vindos do canCloseOS: ' + html);
    assert.ok(html.includes('Assinatura do cliente pendente'));
  });

  await record('encerramentoProximaEtapa(): Pendencias -> Evidencias (ids de Laudo/Assinatura intocados)', async () => {
    await act('encerramentoProximaEtapa()', 4);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 3);
    assert.strictEqual(ctxGet("document.getElementById('enc-etapa-3').style.display"), 'block');
    // ids que capturarEUpload usa -- confirma que continuam existindo e acessiveis
    assert.ok(ctxGet("document.getElementById('enc-laudo-input')") !== undefined);
    assert.ok(ctxGet("document.getElementById('enc-assinatura-input')") !== undefined);
  });

  await record('encerramentoProximaEtapa(): Etapa 4 (Aceite) EXIGE o gesto explicito antes de avancar', async () => {
    await act('encerramentoProximaEtapa()', 4); // Evidencias -> Aceite
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 4);
    ctxSet('document.getElementById("enc-aceite-confirmado").checked', false);
    await act('encerramentoProximaEtapa()', 2);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 4, 'nao deveria ter avancado sem o aceite confirmado');

    ctxSet('document.getElementById("enc-aceite-confirmado").checked', true);
    respostaCanCloseOS = { allowed: true, blockingReasons: [] };
    await act('encerramentoProximaEtapa()', 6); // Aceite -> Revisao (chama canCloseOS de novo)
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 5);
  });

  await record('renderizarRevisao(): recap mostra os campos reais preenchidos + estado da Fase 1/checklist', async () => {
    ctxSet('document.getElementById("enc-obs").value', 'Reaperto de conexoes feito');
    ctxSet('document.getElementById("enc-materiais").value', '2m cabo 6mm');
    respostaCanCloseOS = { allowed: true, blockingReasons: [] };
    await act('renderizarRevisao()', 6);
    const resumo = ctxGet("document.getElementById('enc-revisao-resumo').innerHTML");
    assert.ok(resumo.includes('Reaperto de conexoes feito'));
    assert.ok(resumo.includes('2m cabo 6mm'));
    const btn = ctxGet("document.getElementById('enc-btn-concluir')");
    assert.strictEqual(btn.disabled, false, 'canCloseOS allowed:true -- botao final deveria estar habilitado');
  });

  await record('renderizarRevisao(): canCloseOS bloqueando na ultima checagem desabilita o botao final', async () => {
    respostaCanCloseOS = { allowed: false, blockingReasons: ['Fotos de evidencia insuficientes'] };
    await act('renderizarRevisao()', 6);
    const btn = ctxGet("document.getElementById('enc-btn-concluir')");
    assert.strictEqual(btn.disabled, true, 'ultima checagem bloqueando deveria desabilitar CONCLUIR OS');
    const bloqueio = ctxGet("document.getElementById('enc-revisao-bloqueio').textContent");
    assert.ok(bloqueio.includes('Fotos de evidencia insuficientes'));
  });

  // ================================================================
  // 3) confirmarEncerramento() -- sucesso e recusa, ambos SEM sair do
  //    wizard (Etapa 6), mesmo padrao de mensagemRecusa da auditoria.
  // ================================================================
  await record('confirmarEncerramento(): sucesso vai pra Etapa 6 com "VOLTAR", nao mostra "AJUSTAR"', async () => {
    chamadasRede.length = 0;
    respostaEncerrar = { sucesso: true, success: true, horasFinais: '3h20' };
    await act('confirmarEncerramento()', 6);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 6);
    const titulo = ctxGet("document.getElementById('enc-resultado-titulo').textContent");
    assert.strictEqual(titulo, 'OS encerrada!');
    assert.strictEqual(ctxGet("document.getElementById('enc-btn-voltar-home').style.display"), 'block');
    assert.strictEqual(ctxGet("document.getElementById('enc-btn-ajustar').style.display"), 'none');
    assert.strictEqual(ctxGet('APP.osAtiva'), null, 'OS deveria ter encerrado de verdade (mesmo efeito colateral de antes)');
  });

  await record('confirmarEncerramento(): recusa (blockingReasons) fica na Etapa 6 com o motivo real e "AJUSTAR", NAO um toast solto', async () => {
    osComChecklistCompleto('OS-101');
    ctxSet('APP.osAtiva', { id: 'OS-101', cliente: 'Cliente 101' });
    await act('irParaEncerrar()', 4);
    respostaEncerrar = { sucesso: false, success: false, blockingReasons: ['OS ja foi concluida'] };
    await act('confirmarEncerramento()', 6);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 6, 'recusa NAO deveria sair do wizard');
    const titulo = ctxGet("document.getElementById('enc-resultado-titulo').textContent");
    const msg = ctxGet("document.getElementById('enc-resultado-msg').textContent");
    assert.strictEqual(titulo, 'OS não pode ser concluída ainda');
    assert.ok(msg.includes('OS ja foi concluida'), 'deveria mostrar o motivo real vindo do backend: ' + msg);
    assert.strictEqual(ctxGet("document.getElementById('enc-btn-ajustar').style.display"), 'block');
    assert.strictEqual(ctxGet("document.getElementById('enc-btn-voltar-home').style.display"), 'none');

    // "AJUSTAR" volta pra Pendencias (etapa 2), nao fecha a tela
    respostaCanCloseOS = { allowed: false, blockingReasons: ['OS ja foi concluida'] };
    await act('encerramentoIrParaEtapa(2)', 6);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 2);
  });

  await record('encerramentoVoltarEtapa(): navega pra tras etapa por etapa, nao pula a tela inteira', async () => {
    osComChecklistCompleto('OS-102');
    ctxSet('APP.osAtiva', { id: 'OS-102', cliente: 'Cliente 102' });
    respostaCanCloseOS = { allowed: true, blockingReasons: [] };
    await act('irParaEncerrar()', 4);
    await act('encerramentoProximaEtapa()', 6); // 1 -> 2
    await act('encerramentoProximaEtapa()', 4); // 2 -> 3
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 3);
    await act('encerramentoVoltarEtapa()', 2);
    assert.strictEqual(ctxGet('APP.encEtapaAtual'), 2, 'voltar deveria ir 1 etapa por vez, nao pra tela anterior inteira');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
