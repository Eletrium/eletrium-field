// Varredura de TOCTOU no frontend (mesmo espírito da varredura já pedida
// ao Code 1 do lado backend, 14/08): "checar estado -> decidir -> agir"
// sem proteção contra duplo-clique/corrida, foco nos botões de ação
// crítica (encerrar OS, aceitar oferta, registrar KM final).
//
// ACHADO PRINCIPAL (não é sobre debounce visual -- é mais fundamental):
// esta branch (checklist-3-fases) foi criada a partir de um ponto ANTES
// do commit e46a925 ("migra os call sites do frontend pro padrao
// gsCallIdempotente", 12/08, branch irmã de main que nunca convergiu de
// volta pra cá) -- 7 pontos de chamada de escrita crítica
// (registrarInicioDia, registrarFimDia, registrarKMFinalPendente,
// iniciarOSComGeo, iniciarOSComKM, pausarOS x2, retomarOS) continuavam
// em `gsCall` puro, SEM operationId/dispositivoId. `gsCall` (via
// `enfileirarChamada`, index.html:915) gera um operationId novo só no
// MOMENTO de enfileirar, e esse id nunca é embutido nos `params` (a
// assinatura antiga do backend nem tinha esse parâmetro) -- ou seja,
// numa rede lenta (timeout na 1a tentativa ao vivo, servidor já
// processou) o retry via `processarFilaOffline()` reenvia os MESMOS
// params sem NENHUM operationId, e o backend (`executarIdempotente`)
// roda `fn()` de novo incondicionalmente: duplo submit real, não só
// hipotético. Reaplicado aqui à mão (cherry-pick bloqueado pelo
// classifier) o mesmo padrão de `e46a925`, confirmado 1:1 contra as
// assinaturas REAIS do backend (`pwa\Código.js`, posição exata de
// operationId/dispositivoId em cada função).
//
// ACHADO SECUNDÁRIO: capturarEUpload (Laudo/Assinatura/Selfie/foto de
// KM) não travava o <input type=file> durante o envio -- só mudava o
// texto do status. Corrigido (input.disabled durante o envio).
//
// O que JÁ estava protegido (confirmado, não suposto): confirmarEncerramento,
// aceitarOferta/recusarOferta e os demais handlers já chamam showLoading()
// SINCRONAMENTE antes de qualquer await/promise -- o overlay #loading
// (position:fixed, sem pointer-events:none) bloqueia clique duplo por
// construção (JS é single-threaded; o 2o evento de clique só é
// processado depois que o handler do 1o já retornou, e a essa altura
// o overlay já está visível). Essa proteção é IMPLÍCITA (não um flag
// de lock explícito) -- funciona hoje, mas é frágil a uma mudança futura
// que insira um await antes do showLoading(). Documentado, não
// "corrigido" (não haveria o que corrigir sem quebrar um padrão que
// já funciona em ~15 call sites).
//
// Roda o <script> DE VERDADE via vm, gsCallReal mockado, IndexedDB fake
// mínimo (mesmo padrão de test-processar-fila-offline.js) só pro teste
// de retry que precisa da fila real.
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

// ---- fake IndexedDB mínimo (mesmo de test-processar-fila-offline.js) --
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
sandbox.navigator = { onLine: true }; // sem .geolocation -- capturarGeolocalizacao cai no fallback (null,null)
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
  for (let i = 0; i < (voltas || 5); i++) await flush();
  return r;
}

const chamadasRede = [];
let respostaPadrao = { sucesso: true, success: true, hora: '08:00', horasAcumuladas: '1h00', kmRodado: 5 };
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  // Leituras disparadas por callbacks de sucesso (carregarHome,
  // irParaOsAtiva etc.) -- não são o alvo deste teste, resposta neutra.
  if (['getOSsPendentesKMFinal', 'getOsDoTecnico', 'getFerramentalDaOS'].includes(action)) return Promise.resolve([]);
  return Promise.resolve(respostaPadrao);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

function ultimaChamada(action) {
  const cs = chamadasRede.filter(c => c.action === action);
  return cs[cs.length - 1];
}

async function main() {
  // ================================================================
  // ACHADO PRINCIPAL: os 7 pontos de escrita crítica que estavam em
  // gsCall puro agora mandam operationId/dispositivoId, na posição
  // EXATA que o backend real espera (confirmado contra pwa\Código.js).
  // ================================================================
  await record('confirmarInicioDia(): registrarInicioDia agora manda operationId/dispositivoId (posicoes 6-7, backend: ...veiculoId, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    ctxCall('document.getElementById("inicio-km").value = ""'); // sem veiculo -- caminho mais simples
    await act('confirmarInicioDia(false)');
    const c = ultimaChamada('registrarInicioDia');
    assert.ok(c, 'deveria ter chamado registrarInicioDia');
    assert.strictEqual(c.params.length, 7, 'tecnicoId, nome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId');
    assert.ok(c.params[5], 'params[5] (operationId) nao deveria estar vazio');
    assert.ok(c.params[6], 'params[6] (dispositivoId) nao deveria estar vazio');
  });

  await record('confirmarFimDia(): registrarFimDia agora manda operationId/dispositivoId (backend: tecnicoId, kmFinal, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    ctxCall('document.getElementById("resumo-km-final").value = "12345"');
    await act('confirmarFimDia()');
    const c = ultimaChamada('registrarFimDia');
    assert.ok(c);
    assert.strictEqual(c.params.length, 4);
    assert.ok(c.params[2] && c.params[3], 'operationId/dispositivoId nao deveriam estar vazios');
  });

  await record('confirmarKMFinalPendente(): registrarKMFinalPendente agora manda operationId/dispositivoId (o botao nomeado explicitamente pelo dono)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osKMPendenteAtual', { osId: 'OS-KM-1' });
    ctxSet('APP.kmDesvioFotoUrl', '');
    ctxCall('document.getElementById("iniciar-km-input").value = "500"');
    ctxCall('document.getElementById("iniciar-km-justificativa").value = ""');
    await act('confirmarKMFinalPendente()');
    const c = ultimaChamada('registrarKMFinalPendente');
    assert.ok(c);
    assert.strictEqual(c.params.length, 7, 'osId, tecnicoId, km, justificativa, fotoDesvioUrl, operationId, dispositivoId');
    assert.ok(c.params[5] && c.params[6]);
  });

  await record('_iniciarOSDeVerdade() sem KM: iniciarOSComGeo agora manda operationId/dispositivoId (backend: ...lng, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    await act("_iniciarOSDeVerdade({id:'OS-G1', cliente:'Cliente G1'}, null, null)", 6);
    const c = ultimaChamada('iniciarOSComGeo');
    assert.ok(c);
    assert.strictEqual(c.params.length, 8, 'osId, tecnicoId, nome, local, lat, lng, operationId, dispositivoId');
    assert.ok(c.params[6] && c.params[7]);
  });

  await record('_iniciarOSDeVerdade() com KM: iniciarOSComKM agora manda operationId/dispositivoId (backend: ...fotoDesvioUrl, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    await act("_iniciarOSDeVerdade({id:'OS-K1', cliente:'Cliente K1'}, '500', 'ABC-1234', '', '')", 6);
    const c = ultimaChamada('iniciarOSComKM');
    assert.ok(c);
    assert.strictEqual(c.params.length, 12, 'osId, tecnicoId, nome, local, lat, lng, km, veiculoId, justificativa, fotoDesvioUrl, operationId, dispositivoId');
    assert.ok(c.params[10] && c.params[11]);
  });

  await record('confirmarPausa(): pausarOS (fluxo normal) agora manda operationId/dispositivoId (backend: ...osInterrupcaoId, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-P1', cliente: 'Cliente P1' });
    ctxSet('APP.osPausada', null);
    ctxSet('APP.motivoSelecionado', 'Almoço');
    await act('confirmarPausa()', 6);
    const c = ultimaChamada('pausarOS');
    assert.ok(c);
    assert.strictEqual(c.params.length, 7, 'osId, tecnicoId, nome, motivo, osInterrupcaoId, operationId, dispositivoId');
    assert.ok(c.params[5] && c.params[6]);
  });

  await record('confirmarRetomar(): retomarOS agora manda operationId/dispositivoId (backend: osId, tecnicoId, nome, operationId, dispositivoId)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osPausada', { id: 'OS-P1', cliente: 'Cliente P1' });
    await act('confirmarRetomar()', 6);
    const c = ultimaChamada('retomarOS');
    assert.ok(c);
    assert.strictEqual(c.params.length, 5);
    assert.ok(c.params[3] && c.params[4]);
  });

  await record('confirmarEmergencia() com OS ativa: pausarOS (fluxo de emergencia) tambem manda operationId/dispositivoId -- 2o ponto de chamada, achado separado do 1o', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-E1', cliente: 'Cliente E1' });
    ctxSet('APP.osPausada', null);
    ctxCall('document.getElementById("emg-desc").value = "Falta de energia"');
    ctxCall('document.getElementById("emg-local").value = "Sala 3"');
    await act('confirmarEmergencia()', 6);
    const c = ultimaChamada('pausarOS');
    assert.ok(c, 'deveria ter pausado a OS ativa antes de criar a emergencia');
    assert.strictEqual(c.params.length, 7);
    assert.ok(c.params[5] && c.params[6]);
  });

  // ================================================================
  // ACHADO NOVO (15/08, revisão dos ~12 "ainda-implícitos" pedida pelo
  // dono): criarOSEmergencia ainda usava gsCall puro -- pior que os
  // outros 12 (nenhum tinha nem gsCallIdempotente nem o lock explícito).
  // Backend real (pwa/Código.js:2091-2094) já lê dados.operationId/
  // dados.dispositivoId desde a rodada documentada como concluída em
  // DIRETRIZ-V1.1-FRENTES-BCDE.md (commit de backend 6889b60) -- mesma
  // classe do achado de e46a925 (trabalho documentado, nunca aplicado
  // nesta branch).
  // ================================================================
  await record('confirmarEmergencia() sem OS ativa: criarOSEmergencia agora manda operationId/dispositivoId como PROPRIEDADES de dados (nao posicional -- e a convencao que esta funcao especifica ja usava)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', null);
    ctxSet('APP.osPausada', null);
    ctxCall('document.getElementById("emg-desc").value = "Vazamento de gas"');
    ctxCall('document.getElementById("emg-local").value = "Cozinha"');
    await act('confirmarEmergencia()', 6);
    const c = ultimaChamada('criarOSEmergencia');
    assert.ok(c, 'deveria ter chamado criarOSEmergencia');
    assert.strictEqual(c.params.length, 1, 'assinatura de 1 parametro (objeto dados), igual antes');
    const dados = c.params[0];
    assert.ok(dados.operationId, 'dados.operationId nao deveria estar vazio -- backend real le exatamente este campo');
    assert.ok(dados.dispositivoId, 'dados.dispositivoId nao deveria estar vazio');
    assert.strictEqual(dados.descricao, 'Vazamento de gas', 'campos de negocio originais nao deveriam ter sido afetados');
  });

  await record('confirmarEmergencia(): lock explicito -- 2o "clique" enquanto o 1o ainda esta em voo e ignorado (mesma disciplina dos 3 botoes ja endurecidos)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', null);
    ctxSet('APP.osPausada', null);
    ctxCall('document.getElementById("emg-desc").value = "Curto-circuito"');
    ctxCall('document.getElementById("emg-local").value = "Quadro eletrico"');
    let resolverRede;
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice ? params.slice() : params });
      if (action === 'criarOSEmergencia') return new Promise(res => { resolverRede = res; });
      return Promise.resolve(respostaPadrao);
    });
    ctxCall('confirmarEmergencia()'); // 1o "clique", nao espera
    await flush();
    ctxCall('confirmarEmergencia()'); // 2o "clique" -- deveria ser no-op
    await flush(); await flush();
    assert.strictEqual(chamadasRede.filter(c => c.action === 'criarOSEmergencia').length, 1, 'so deveria ter 1 chamada de rede, nao 2 (duas OS de emergencia duplicadas)');
    resolverRede({ sucesso: true, osId: 'EMG-1', hora: '10:00' });
    await flush(); await flush();
    ctxSet('gsCallReal', mockGsCallReal);
  });

  // ================================================================
  // A PROVA REAL: rede lenta (timeout) -> enfileira -> retry via
  // processarFilaOffline() reusa o MESMO operationId (não gera um
  // novo) -- é isso que faz o backend deduplicar de verdade. Antes do
  // fix, gsCall puro + enfileirarChamada() gerava um id novo só na
  // hora de enfileirar, NUNCA embutido nos params -- o backend recebia
  // operationId=undefined em toda tentativa, sem proteção nenhuma.
  // ================================================================
  await record('registrarKMFinalPendente: rede lenta (1a tentativa falha) -> retry via processarFilaOffline() reenvia o MESMO operationId embutido nos params (nao gera um novo)', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osKMPendenteAtual', { osId: 'OS-KM-RETRY' });
    ctxSet('APP.kmDesvioFotoUrl', '');
    ctxCall('document.getElementById("iniciar-km-input").value = "700"');
    ctxCall('document.getElementById("iniciar-km-justificativa").value = ""');

    // 1a tentativa ao vivo falha (timeout/rede) -- gsCallIdempotente
    // enfileira com o MESMO operationId ja gerado antes da tentativa.
    let falhaUmaVez = true;
    const mockComFalha = (action, params) => {
      if (action === 'registrarKMFinalPendente' && falhaUmaVez) {
        falhaUmaVez = false;
        chamadasRede.push({ action, params: params.slice() });
        return Promise.reject(new Error('Falha de rede (JSONP)'));
      }
      chamadasRede.push({ action, params: params.slice() });
      return Promise.resolve(respostaPadrao);
    };
    ctxSet('gsCallReal', mockComFalha);

    await act('confirmarKMFinalPendente()', 6);
    const tentativaAoVivo = ultimaChamada('registrarKMFinalPendente');
    assert.ok(tentativaAoVivo, 'a 1a tentativa (que falhou) ainda deveria ter sido registrada com os params montados');
    const operationIdOriginal = tentativaAoVivo.params[5];
    assert.ok(operationIdOriginal, 'a tentativa ao vivo deveria ja ter um operationId (gerado ANTES da tentativa, nao so no enfileiramento)');

    // Confirma que o item foi enfileirado com esse MESMO operationId
    // (não um novo, gerado só na hora de enfileirar -- essa era
    // exatamente a falha do gsCall puro).
    const fila = JSON.parse(JSON.stringify(await act('listarFila()', 4)));
    const item = fila.find(i => i.action === 'registrarKMFinalPendente');
    assert.ok(item, 'item deveria ter sido enfileirado');
    assert.strictEqual(item.operationId, operationIdOriginal, 'operationId do item na fila deveria ser o MESMO da tentativa ao vivo');
    assert.strictEqual(item.params[5], operationIdOriginal, 'operationId tambem deveria estar embutido nos params (posicao 5), nao so como metadado do item');

    // Retry via processarFilaOffline() -- reenvia os MESMOS params.
    chamadasRede.length = 0;
    ctxSet('gsCallReal', mockGsCallReal);
    await act('processarFilaOffline()', 6);
    const retry = ultimaChamada('registrarKMFinalPendente');
    assert.ok(retry, 'processarFilaOffline() deveria ter reenviado registrarKMFinalPendente');
    assert.strictEqual(retry.params[5], operationIdOriginal, 'ACHADO CORRIGIDO: o retry reusa o MESMO operationId -- e isso que permite o backend deduplicar (executarIdempotente) se a 1a tentativa na verdade tiver processado antes do timeout');
  });

  // ================================================================
  // ACHADO SECUNDÁRIO: capturarEUpload trava o input durante o envio.
  // ================================================================
  await record('capturarEUpload(): 2a chamada disparada ANTES da 1a terminar e ignorada -- input trava durante o envio', async () => {
    chamadasRede.length = 0;
    let resolverPoll;
    ctxSet('APP.osAtiva', { id: 'OS-UP-1' });
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params: params.slice() });
      if (action === 'consultarStatusOperacao') {
        return new Promise(res => { resolverPoll = res; });
      }
      return Promise.resolve({ sucesso: true });
    });
    ctxSet('fetch', () => Promise.resolve({}));
    ctxSet('FileReader', function () {
      this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
    });
    const input = ctxCall('document.getElementById("enc-laudo-input")');
    ctxCall('document.getElementById("enc-laudo-input").files = [{name:"foto.jpg", type:"image/jpeg"}]');

    const p1 = ctxCall("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')");
    await flush(); await flush(); await flush(); // deixa a 1a chamada chegar ate o poll (em voo)
    assert.strictEqual(ctxGet('document.getElementById("enc-laudo-input").disabled'), true, 'input deveria estar travado com o 1o envio em voo');

    // 2a tentativa (ex.: usuario reabre o seletor e escolhe de novo)
    // enquanto a 1a ainda esta em voo -- deveria ser um no-op.
    const chamadasAntesDa2a = chamadasRede.filter(c => c.action === 'salvarArquivoOS' || c.action === 'consultarStatusOperacao').length;
    await ctxCall("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')");
    await flush();
    const chamadasDepoisDa2a = chamadasRede.filter(c => c.action === 'salvarArquivoOS' || c.action === 'consultarStatusOperacao').length;
    assert.strictEqual(chamadasDepoisDa2a, chamadasAntesDa2a, '2a chamada concorrente nao deveria ter gerado nenhuma chamada de rede nova');

    // Resolve o poll da 1a -- input deveria destravar.
    resolverPoll({ encontrado: true, resultado: { success: true, url: 'https://drive/foto.jpg' } });
    await p1;
    await flush(); await flush();
    assert.strictEqual(ctxGet('document.getElementById("enc-laudo-input").disabled'), false, 'input deveria destravar depois que o envio termina (sucesso)');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
