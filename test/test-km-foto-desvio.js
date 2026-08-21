// Teste real da foto de desvio de KM (Frente B, fatia 4 -- Diretriz
// v1.1) -- destrava o "LIMITAÇÃO CONHECIDA" documentado no próprio
// backend (Código.js:1661-1662): captura de foto do odômetro não
// existia no app, então qualquer desvio real de KM ficava bloqueado
// pra sempre. Reaproveita a infra de upload já existente (fatia 1)
// via capturarEUpload estendido (osIdOverride + onSucesso, backward-
// compatível -- ver testes de regressão no final).
//
// Mesma técnica dos outros testes deste worktree: roda o <script> DE
// VERDADE de index.html via vm, mocka gsCallReal e fetch (nenhuma
// chamada de rede real -- action/URL não coberta pelo mock derruba o
// teste em vez de tentar sair pra rede).
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
    textContent: '', innerHTML: '', value: '', checked: false,
    files: null,
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
sandbox.navigator = { onLine: true }; // sem .geolocation -- capturarGeolocalizacao cai no fallback (null,null)
sandbox.document = makeDocument();
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };

const chamadasFetch = [];
sandbox.fetch = (url, opts) => {
  chamadasFetch.push({ url, body: JSON.parse(opts.body) });
  return Promise.resolve({}); // POST no-cors -- resposta é opaca, o app nunca lê o corpo
};

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr) { const r = ctxCall(expr); await flush(); return r; }

// ---- mock da rede (gsCallReal) -- inclui consultarStatusOperacao,
// que é o que o poll do upload usa pra saber se o Drive terminou.
// Não tenta prever o operationId exato gerado pelo app (depende de
// quantas vezes gerarOperationId() já rodou -- obterDispositivoId()
// também consome um na 1a chamada) -- só devolve a PRÓXIMA resposta
// configurada, pra qualquer operationId, o que é suficiente porque
// cada teste faz no máximo 1 upload em voo por vez.
const chamadasRede = [];
let proximaRespostaPoll = null;
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (action === 'consultarStatusOperacao') {
    if (!proximaRespostaPoll) throw new Error('proximaRespostaPoll nao configurada pra esta chamada de consultarStatusOperacao');
    const resp = proximaRespostaPoll;
    proximaRespostaPoll = null;
    return Promise.resolve(resp);
  }
  if (action === 'iniciarOSComKM') {
    // Espelha validarESalvarKMInicial (Código.js:1663-1717), só a parte
    // relevante pro teste: exige foto+texto quando ha desvio simulado.
    const [osId, , , , , , km, , justificativa, fotoDesvioUrl] = params;
    // Sentinela pra exercitar o ramo res.erro (recusa que NAO e
    // exigeJustificativa -- ex.: OS nao encontrada, regra de negocio
    // diferente) -- osId dedicado pra nao conflitar com os outros testes.
    if (osId === 'OS-ERRO-KM') {
      return Promise.resolve({ sucesso: false, success: false, retryable: false, erro: 'OS nao encontrada ou ja concluida', blocking_reasons: ['OS nao encontrada ou ja concluida'] });
    }
    if (Number(km) > 1000 && !(justificativa && fotoDesvioUrl)) {
      return Promise.resolve({ sucesso: false, exigeJustificativa: true, mensagem: 'Diferenca de KM detectada (simulado).' });
    }
    return Promise.resolve({ sucesso: true, hora: '08:00', kmFlag: null });
  }
  if (action === 'registrarKMFinalPendente') {
    const [osId, , kmFinal, justificativa, fotoDesvioUrl] = params;
    if (osId === 'OS-ERRO-KM') {
      return Promise.resolve({ sucesso: false, success: false, retryable: true, erro: 'Sistema ocupado, tente novamente em instantes', blocking_reasons: ['Sistema ocupado, tente novamente em instantes'] });
    }
    if (Number(kmFinal) > 1000 && !(justificativa && fotoDesvioUrl)) {
      return Promise.resolve({ sucesso: false, exigeJustificativa: true, mensagem: 'Trecho grande detectado (simulado).' });
    }
    return Promise.resolve({ sucesso: true });
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Técnico Teste' });

function fileFalso(nome) {
  return { name: nome || 'foto.jpg', type: 'image/jpeg' };
}

// FileReader real do Node não lê Blob fake -- o app usa
// reader.readAsDataURL(file); stubamos o construtor global FileReader
// dentro do vm context pra devolver um base64 fixo, sem precisar de
// um File/Blob real (o conteúdo em si é irrelevante pro teste).
ctxSet('FileReader', function FakeFileReader() {
  this.readAsDataURL = () => {
    this.result = 'data:image/jpeg;base64,ZmFrZS1pbWFnZS1kYXRh';
    if (this.onload) this.onload();
  };
});

async function main() {
  // ================================================================
  // 1) capturarFotoDesvioKM() -- resolve o osId certo por modo de tela
  // ================================================================
  await record('capturarFotoDesvioKM(): modo "iniciar" usa APP.osParaIniciar.id', async () => {
    chamadasFetch.length = 0;
    ctxSet('APP.telaKmModo', 'iniciar');
    ctxSet('APP.osParaIniciar', { id: 'OS-500', cliente: 'Cliente 500' });
    ctxSet('APP.osKMPendenteAtual', null);
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/foto-500.jpg', campo: 'KM_Foto_Desvio_URL' } };
    await act('capturarFotoDesvioKM()');
    assert.strictEqual(chamadasFetch.length, 1);
    assert.strictEqual(chamadasFetch[0].body.action, 'salvarArquivoOS');
    assert.strictEqual(chamadasFetch[0].body.params[0], 'OS-500', 'deveria usar o osId de osParaIniciar, nao osAtiva/osPausada (nenhum dos dois esta setado ainda)');
    assert.strictEqual(chamadasFetch[0].body.params[2], 'KM_Foto_Desvio_URL');
    const url = ctxGet('APP.kmDesvioFotoUrl');
    assert.strictEqual(url, 'https://drive.example/foto-500.jpg');
    const status = ctxGet("document.getElementById('km-desvio-foto-status').textContent");
    assert.strictEqual(status, 'Enviado ✓');
  });

  await record('capturarFotoDesvioKM(): modo "final-pendente" usa APP.osKMPendenteAtual.osId', async () => {
    chamadasFetch.length = 0;
    ctxSet('APP.telaKmModo', 'final-pendente');
    ctxSet('APP.osParaIniciar', null);
    ctxSet('APP.osKMPendenteAtual', { osId: 'OS-501', cliente: 'Cliente 501' });
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro2.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/foto-501.jpg', campo: 'KM_Foto_Desvio_URL' } };
    await act('capturarFotoDesvioKM()');
    assert.strictEqual(chamadasFetch[0].body.params[0], 'OS-501', 'deveria usar o osId de osKMPendenteAtual, nao osParaIniciar');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), 'https://drive.example/foto-501.jpg');
  });

  // ================================================================
  // 2) Estado de hoje (backend AINDA sem o campo na allow-list) --
  //    confirma que o app degrada graciosamente, sem fingir sucesso.
  // ================================================================
  await record('upload falha graciosamente se o backend recusar o campo (estado ATUAL, antes do contrato)', async () => {
    ctxSet('APP.telaKmModo', 'iniciar');
    ctxSet('APP.osParaIniciar', { id: 'OS-502', cliente: 'Cliente 502' });
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro3.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'SYNC_ERROR', resultado: { success: false, erro: 'Campo nao permitido: KM_Foto_Desvio_URL' } };
    await act('capturarFotoDesvioKM()');
    const status = ctxGet("document.getElementById('km-desvio-foto-status').textContent");
    // Achado da auditoria de mensagens (12/08): agora mostra o motivo
    // real (resultado.erro), nao mais um texto fixo de "tente novamente".
    assert.strictEqual(status, 'Não foi possível enviar: Campo nao permitido: KM_Foto_Desvio_URL');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), 'https://drive.example/foto-501.jpg', 'nao deveria ter sobrescrito o valor anterior com uma falha');
  });

  // ================================================================
  // 3) Fluxo de ponta a ponta: desvio detectado -> foto enviada ->
  //    retry com fotoDesvioUrl -> iniciarOSComKM aceita
  // ================================================================
  await record('ponta a ponta (iniciar OS): desvio bloqueia, foto+justificativa destrava', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.usaVeiculoHoje', true);
    ctxSet('APP.veiculo', { placa: 'ABC1234' });
    ctxSet('APP.osAtiva', null);
    ctxSet('APP.osPausada', null);
    await act("confirmarIniciarOS({ id: 'OS-503', cliente: 'Cliente 503' })");
    assert.strictEqual(ctxGet('APP.telaKmModo'), 'iniciar');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), '', 'deveria ter resetado ao abrir a tela de novo');

    ctxSet('document.getElementById("iniciar-km-input").value', '9999'); // > 1000 no mock -> simula desvio
    await act('confirmarKMInicial()');
    let bloqueadas = chamadasRede.filter(c => c.action === 'iniciarOSComKM');
    assert.strictEqual(bloqueadas.length, 1);
    // ainda sem foto/justificativa -> backend recusa (exigeJustificativa)

    ctxSet('document.getElementById("iniciar-km-justificativa").value', 'Desvio por transito na BR-101');
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro-desvio.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/foto-503.jpg', campo: 'KM_Foto_Desvio_URL' } };
    await act('capturarFotoDesvioKM()');
    assert.strictEqual(ctxGet('APP.kmDesvioFotoUrl'), 'https://drive.example/foto-503.jpg');

    await act('confirmarKMInicial()'); // retry
    const chamadasKM = chamadasRede.filter(c => c.action === 'iniciarOSComKM');
    assert.strictEqual(chamadasKM.length, 2, 'esperava a tentativa bloqueada + o retry');
    const ultima = chamadasKM[1].params;
    assert.strictEqual(ultima[8], 'Desvio por transito na BR-101'); // justificativa
    assert.strictEqual(ultima[9], 'https://drive.example/foto-503.jpg'); // fotoDesvioUrl
    assert.strictEqual(ctxGet('APP.osAtiva.id'), 'OS-503', 'a OS deveria ter iniciado de verdade depois do retry aceito');
  });

  await record('ponta a ponta (KM final pendente): mesma trava, mesmo destravamento', async () => {
    chamadasRede.length = 0;
    ctxCall("APP.kmPendenteFila = [{ osId: 'OS-504', cliente: 'Cliente 504', dataEncerramento: '10/08' }]");
    await act('abrirPreenchimentoKMFinal(APP.kmPendenteFila)');
    assert.strictEqual(ctxGet('APP.telaKmModo'), 'final-pendente');

    ctxSet('document.getElementById("iniciar-km-input").value', '9999');
    await act('confirmarKMFinalPendente()');
    assert.strictEqual(chamadasRede.filter(c => c.action === 'registrarKMFinalPendente').length, 1);

    ctxSet('document.getElementById("iniciar-km-justificativa").value', 'Retorno por rota alternativa');
    ctxSet('document.getElementById("km-desvio-foto-input").files', [fileFalso('odometro-final.jpg')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/foto-504.jpg', campo: 'KM_Foto_Desvio_URL' } };
    await act('capturarFotoDesvioKM()');

    await act('confirmarKMFinalPendente()');
    const chamadas = chamadasRede.filter(c => c.action === 'registrarKMFinalPendente');
    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1].params[4], 'https://drive.example/foto-504.jpg');
  });

  // ================================================================
  // 3b) Achado da auditoria de mensagens (12/08): recusa que NAO e
  //     exigeJustificativa (que ja tem seu proprio bloco dedicado,
  //     bom) agora usa mensagemRecusa, mesmo padrao do fix em
  //     capturarEUpload/enviarSelfieEPI/ferramental.
  // ================================================================
  await record('confirmarKMInicial(): recusa de regra de negocio (nao exigeJustificativa) mostra o motivo real', async () => {
    ctxSet('APP.usaVeiculoHoje', true);
    ctxSet('APP.veiculo', { placa: 'ERR0001' });
    ctxSet('APP.osAtiva', null);
    ctxSet('APP.osPausada', null);
    await act("confirmarIniciarOS({ id: 'OS-ERRO-KM', cliente: 'Cliente Erro' })");
    ctxSet('document.getElementById("iniciar-km-input").value', '50'); // <=1000, nao aciona exigeJustificativa
    await act('confirmarKMInicial()');
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Não foi possível iniciar a OS: OS nao encontrada ou ja concluida');
  });

  await record('confirmarKMFinalPendente(): recusa transitoria (retryable:true) enquadra como "tente novamente" com o motivo', async () => {
    ctxCall("APP.kmPendenteFila = [{ osId: 'OS-ERRO-KM', cliente: 'Cliente Erro', dataEncerramento: '10/08' }]");
    await act('abrirPreenchimentoKMFinal(APP.kmPendenteFila)');
    ctxSet('document.getElementById("iniciar-km-input").value', '50');
    await act('confirmarKMFinalPendente()');
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Falha ao registrar o KM final (tente novamente): Sistema ocupado, tente novamente em instantes');
  });

  // ================================================================
  // 4) Regressão: capturarEUpload chamado do jeito ANTIGO (3 args, uso
  //    de Laudo/Assinatura na tela de encerrar) continua idêntico --
  //    nao mexe na fatia 1 protegida.
  // ================================================================
  await record('regressao: capturarEUpload(3 args) continua usando osAtiva/osPausada, sem quebrar Laudo/Assinatura', async () => {
    chamadasFetch.length = 0;
    ctxSet('APP.osAtiva', { id: 'OS-505', cliente: 'Cliente 505' });
    ctxSet('APP.osPausada', null);
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo.pdf')]);
    proximaRespostaPoll = { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/laudo-505.pdf', campo: 'Laudo_URL' } };
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')");
    assert.strictEqual(chamadasFetch[0].body.params[0], 'OS-505', 'sem osIdOverride, continua usando APP.osAtiva.id como antes');
    const status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Enviado ✓');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
