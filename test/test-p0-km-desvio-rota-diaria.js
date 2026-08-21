// P0 (15/08) -- achado reportado pelo Geovane, dado real: "ao registrar
// KM final de uma OS, se o trecho excede um limiar (disparou com 6412km
// e com apenas 12km), o app exige justificativa por TEXTO E FOTO do
// odômetro -- mas a captura de foto 'não está implementada nesta
// versão', então nenhuma combinação de valores passa. Qualquer técnico
// com desvio de rota fica permanentemente incapaz de fechar o dia."
//
// INVESTIGAÇÃO (não suposição -- lida direto no backend real,
// pwa\Código.js):
// 1. O requisito É "texto E foto" de verdade -- confirmado,
//    registrarKMFinalPendente (Código.js:3350-3358):
//      diferenca = kmFinalNum - kmInicial;
//      if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
//        if (!temFoto || !temTexto) return _recusa(..., {exigeJustificativa:true});
//      }
//    KM_LIMIAR_INTRA_DIA_KM = 5 (Código.js:3160) -- achado ADJACENTE,
//    sinalizado mas não decidido aqui (é constante do backend, fora do
//    meu território): 5km é um limiar muito baixo pro "trecho
//    percorrido DENTRO da OS" -- qualquer job com mais de 5km de
//    deslocamento (a maioria dos jobs reais) cai nesse gate, não só
//    "desvio suspeito" de verdade. Isso explica tanto 12km quanto
//    6412km disparando igual: `diferenca > 5` é a MESMA condição
//    booleana pros dois números, não uma diferença de causa.
// 2. A captura de foto do odômetro JÁ ESTÁ implementada neste worktree
//    desde o commit 734bbd9 ("Frente B, fatia 4 -- destrava foto de
//    desvio de KM"), incluindo o fluxo "KM final pendente" específico
//    (capturarFotoDesvioKM() já trata APP.telaKmModo==='final-pendente'
//    -- ver index.html:1494-1505). Já havia teste ponta a ponta
//    cobrindo isso (test-km-foto-desvio.js) -- este arquivo é uma
//    camada A MAIS, espelhando a fórmula REAL do backend (diferenca >
//    5, não uma aproximação) e os números EXATOS que o Geovane
//    reportou, pra confirmar sem ambiguidade que o código ATUAL (não
//    necessariamente o que está em produção -- nenhum commit deste
//    worktree foi deployado) já resolve o cenário relatado.
//
// CONCLUSÃO: não há bug de lógica neste worktree (o requisito "E" é
// intencional, e o caminho pra satisfazê-lo já existe e funciona) --
// o relato bate com a versão ANTERIOR ao commit 734bbd9, que
// realmente não tinha captura de foto nenhuma (era travamento
// permanente de verdade, documentado no próprio código da época). O
// "fix" real é garantir que ISTO chegue a produção, não alterar a
// regra de negócio. Este teste existe pra provar isso com números
// concretos, não só reafirmar em texto.
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
    classList: { add() {}, remove() {}, contains() { return false; } },
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
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.indexedDB = undefined; // caminho ao vivo, sem falha simulada -- outbox nao entra em jogo

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
async function act(expr, voltas) {
  const r = ctxCall(expr);
  for (let i = 0; i < (voltas || 4); i++) await flush();
  return r;
}

// ---- mock fiel à REGRA REAL do backend (Código.js:3320-3368), não uma
// aproximação -- KM_INICIAL_POR_OS por osId (o "servidor" simulado),
// KM_LIMIAR_INTRA_DIA_KM = 5 (valor real, copiado, não reinventado).
const KM_LIMIAR_INTRA_DIA_KM = 5;
const kmInicialPorOS = { 'OS-DESVIO-PEQUENO': 1000, 'OS-DESVIO-GRANDE': 50000 };
const osFechadas = new Set();
const chamadasRede = [];
let proximaRespostaPoll = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  if (action === 'consultarStatusOperacao') {
    const resp = proximaRespostaPoll;
    proximaRespostaPoll = null;
    if (!resp) throw new Error('proximaRespostaPoll nao configurada');
    return Promise.resolve(resp);
  }
  if (action === 'registrarKMFinalPendente') {
    const [osId, , kmFinal, justificativa, fotoDesvioUrl] = params;
    const kmInicial = kmInicialPorOS[osId];
    const kmFinalNum = parseFloat(kmFinal) || 0;
    const diferenca = kmFinalNum - kmInicial;
    if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
      const temFoto = !!fotoDesvioUrl;
      const temTexto = !!(justificativa && justificativa.trim());
      if (!temFoto || !temTexto) {
        const mensagem = 'Trecho de ' + Math.round(diferenca) + 'km dentro desta OS. Informe justificativa por texto E foto do odometro para continuar.';
        return Promise.resolve({ sucesso: false, exigeJustificativa: true, mensagem });
      }
    }
    osFechadas.add(osId);
    return Promise.resolve({ sucesso: true });
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

function fileFalso(nome) { return { name: nome || 'foto.jpg', type: 'image/jpeg' }; }

async function prepararTelaKMFinal(osId, cliente) {
  ctxCall(`APP.kmPendenteFila = [{ osId: '${osId}', cliente: '${cliente}', dataEncerramento: '14/08' }]`);
  await act('_proximoKMPendente()');
  assert.strictEqual(ctxGet('APP.telaKmModo'), 'final-pendente');
}

async function main() {
  // ================================================================
  // CENÁRIO EXATO DO RELATO: trecho pequeno (12km, > limiar de 5km).
  // ================================================================
  await record('desvio de 12km (o numero exato do relato): sem foto/texto bloqueia; com os dois, fecha de verdade', async () => {
    chamadasRede.length = 0;
    await prepararTelaKMFinal('OS-DESVIO-PEQUENO', 'Cliente Pequeno');
    ctxSet('document.getElementById("iniciar-km-input").value', String(1000 + 12)); // kmInicial=1000, diferenca=12km

    // 1a tentativa: SEM justificativa nem foto -- tem que bloquear.
    await act('confirmarKMFinalPendente()');
    let bloco = ctxGet('document.getElementById("iniciar-km-desvio-bloco").style.display');
    assert.strictEqual(bloco, 'block', 'deveria ter exigido justificativa (12km > limiar de 5km)');
    assert.ok(!osFechadas.has('OS-DESVIO-PEQUENO'), 'OS NAO deveria ter fechado ainda');

    // 2a tentativa: SÓ texto, SEM foto -- ainda tem que bloquear (prova
    // que "E" e nao "OU" de verdade, ponta a ponta).
    ctxSet('document.getElementById("iniciar-km-justificativa").value', 'Cliente pediu pra passar em outro endereco antes');
    chamadasRede.length = 0;
    await act('confirmarKMFinalPendente()');
    const tentativaSoTexto = chamadasRede.find(c => c.action === 'registrarKMFinalPendente');
    assert.ok(tentativaSoTexto, 'deveria ter tentado (o app nao decide sozinho, manda pro servidor)');
    assert.strictEqual(tentativaSoTexto.params[4], '', 'foto ainda vazia nesta tentativa');
    assert.ok(!osFechadas.has('OS-DESVIO-PEQUENO'), 'OS ainda NAO deveria ter fechado -- so texto nao basta');

    // Captura a foto -- ESTE é o passo que o relato original dizia ser
    // impossível ("captura ainda não disponível"). Prova que, no código
    // ATUAL deste worktree, é possível.
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/odo-pequeno.jpg' } };
    await act('capturarFotoDesvioKM()');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), 'https://drive.example/odo-pequeno.jpg', 'foto deveria ter sido capturada e a URL guardada');

    // 3a tentativa: texto E foto -- agora tem que fechar de verdade.
    await act('confirmarKMFinalPendente()');
    assert.ok(osFechadas.has('OS-DESVIO-PEQUENO'), 'OS deveria ter fechado com justificativa + foto');
    const chamadaFinal = chamadasRede.filter(c => c.action === 'registrarKMFinalPendente').pop();
    assert.strictEqual(chamadaFinal.params[4], 'https://drive.example/odo-pequeno.jpg');
  });

  // ================================================================
  // CENÁRIO EXATO DO RELATO: trecho grande (>6000km) -- mesma condição
  // booleana (diferenca > 5), só prova que o tamanho do desvio não
  // muda o comportamento (não é um bug ligado à magnitude do número).
  // ================================================================
  await record('desvio de 6412km (o outro numero exato do relato): mesma trava, mesmo destravamento com foto+texto', async () => {
    chamadasRede.length = 0;
    await prepararTelaKMFinal('OS-DESVIO-GRANDE', 'Cliente Grande');
    ctxSet('document.getElementById("iniciar-km-input").value', String(50000 + 6412)); // kmInicial=50000, diferenca=6412km

    await act('confirmarKMFinalPendente()');
    const bloco = ctxGet('document.getElementById("iniciar-km-desvio-bloco").style.display');
    assert.strictEqual(bloco, 'block');
    assert.ok(!osFechadas.has('OS-DESVIO-GRANDE'));

    ctxSet('document.getElementById("iniciar-km-justificativa").value', 'OS de outra regional, deslocamento programado');
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro-grande.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/odo-grande.jpg' } };
    await act('capturarFotoDesvioKM()');

    await act('confirmarKMFinalPendente()');
    assert.ok(osFechadas.has('OS-DESVIO-GRANDE'), 'OS deveria ter fechado -- magnitude do desvio nao muda a regra (E continua sendo E)');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
