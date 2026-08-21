// Teste real do achado da Cowork 2: o backend mudou o terminal de
// sucesso do Log_Central de SYNCED pra QUEUED (SYNCED/RECONCILED agora
// exclusivos de confirmação real pelo 1A). pollStatusOperacao (e seus
// 2 chamadores, capturarEUpload/enviarSelfieEPI) checavam
// `resultado.status === 'SYNCED'` especificamente -- com a mudança,
// isso NUNCA mais bateria num upload bem-sucedido, e o poll estouraria
// tentativasMax devolvendo TIMEOUT mesmo no caso feliz. Mesma classe
// do gap já corrigido em processarFilaOffline (achado da revisão de
// integração da Frente B): fix generaliza pro mesmo princípio --
// confiar no envelope (`resultado.resultado.success`), não num valor
// de status específico.
//
// Roda o <script> DE VERDADE de index.html via vm, gsCallReal e fetch
// mockados (nenhuma chamada de rede real).
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
sandbox.navigator = { onLine: true };
sandbox.document = makeDocument();
sandbox.localStorage = makeLocalStorage();
sandbox.console = console;
// pollStatusOperacao espera 2000ms reais entre tentativas -- acelera
// pra manter o teste rapido sem mudar a logica de retry sendo testada.
sandbox.setTimeout = (fn) => setImmediate(fn);
sandbox.clearTimeout = clearTimeout;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.indexedDB = undefined;
sandbox.FileReader = function FakeFileReader() {
  this.readAsDataURL = () => { this.result = 'data:image/jpeg;base64,ZmFrZQ=='; if (this.onload) this.onload(); };
};

const chamadasFetch = [];
sandbox.fetch = (url, opts) => {
  chamadasFetch.push({ url, body: JSON.parse(opts.body) });
  return Promise.resolve({});
};

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr, voltas) {
  const r = ctxCall(expr);
  for (let i = 0; i < (voltas || 3); i++) await flush();
  return r;
}

// ---- mock de consultarStatusOperacao: fila de respostas sucessivas,
// uma por chamada -- simula o poll acontecendo ao longo do tempo.
const chamadasConsulta = [];
let filaRespostasConsulta = [];
function mockGsCallReal(action, params) {
  if (action === 'consultarStatusOperacao') {
    chamadasConsulta.push(params[0]);
    if (!filaRespostasConsulta.length) throw new Error('fila de respostas de consultarStatusOperacao vazia');
    return Promise.resolve(filaRespostasConsulta.shift());
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Técnico Teste' });

function fileFalso(nome) { return { name: nome || 'foto.jpg', type: 'image/jpeg' }; }

async function main() {
  // ================================================================
  // 1) pollStatusOperacao: status='QUEUED' (o terminal REAL de sucesso
  //    hoje) com resultado presente -- retorna na hora, nao espera
  //    esgotar tentativasMax achando que nunca terminou.
  // ================================================================
  await record('pollStatusOperacao: QUEUED com resultado presente conta como concluido (nao mais so SYNCED)', async () => {
    filaRespostasConsulta = [
      { encontrado: true, status: 'QUEUED', resultado: { success: true, status: 'QUEUED', url: 'https://drive.example/x.jpg' } },
    ];
    chamadasConsulta.length = 0;
    const r = await act("pollStatusOperacao('op-1', 5)", 4);
    assert.strictEqual(chamadasConsulta.length, 1, 'deveria ter retornado na 1a consulta, sem ficar tentando de novo achando que nao terminou');
    assert.strictEqual(r.resultado.success, true);
  });

  await record('pollStatusOperacao: SYNC_ERROR com resultado presente tambem conta como concluido', async () => {
    filaRespostasConsulta = [
      { encontrado: true, status: 'SYNC_ERROR', resultado: { success: false, status: 'SYNC_ERROR', error_code: 'ERRO_DESCONHECIDO' } },
    ];
    chamadasConsulta.length = 0;
    const r = await act("pollStatusOperacao('op-2', 5)", 4);
    assert.strictEqual(chamadasConsulta.length, 1);
    assert.strictEqual(r.resultado.success, false);
  });

  await record('pollStatusOperacao: ainda sem resultado_json (SENDING) continua tentando, para assim que resultado aparece', async () => {
    filaRespostasConsulta = [
      { encontrado: true, status: 'SENDING', resultado: null },
      { encontrado: true, status: 'SENDING', resultado: null },
      { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/y.jpg' } },
    ];
    chamadasConsulta.length = 0;
    const r = await act("pollStatusOperacao('op-3', 5)", 10);
    assert.strictEqual(chamadasConsulta.length, 3, 'deveria ter tentado 3 vezes ate o resultado aparecer');
    assert.strictEqual(r.resultado.success, true);
  });

  await record('pollStatusOperacao: nunca aparece resultado -> esgota tentativasMax e devolve TIMEOUT (nao trava pra sempre)', async () => {
    filaRespostasConsulta = [
      { encontrado: true, status: 'SENDING', resultado: null },
      { encontrado: true, status: 'SENDING', resultado: null },
      { encontrado: true, status: 'SENDING', resultado: null },
    ];
    chamadasConsulta.length = 0;
    const r = await act("pollStatusOperacao('op-4', 3)", 10);
    assert.strictEqual(r.encontrado, false);
    assert.strictEqual(r.status, 'TIMEOUT');
  });

  // ================================================================
  // 2) capturarEUpload (Laudo/Assinatura/KM-foto) -- ponta a ponta com
  //    o status QUEUED real, nao mais SYNCED
  // ================================================================
  await record('capturarEUpload: sucesso real (status QUEUED) mostra "Enviado" e chama onSucesso com a URL', async () => {
    ctxSet('APP.osAtiva', { id: 'OS-1', cliente: 'Cliente 1' });
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo.pdf')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/laudo.pdf' } },
    ];
    let urlRecebida = null;
    ctxSet('__testCallback', (url) => { urlRecebida = url; });
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL', null, __testCallback)", 8);
    const status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Enviado ✓');
    assert.strictEqual(urlRecebida, 'https://drive.example/laudo.pdf');
  });

  // ================================================================
  // Achado da auditoria de mensagens (12/08): upload era a UNICA area
  // que descartava blocking_reasons/erro por completo, sempre mostrando
  // "tente novamente" mesmo quando a recusa nao era transitoria. Fix
  // copia o padrao que ja funcionava bem em confirmarEncerramento (le
  // blockingReasons de verdade).
  // ================================================================
  await record('capturarEUpload: recusa de regra de negocio (retryable:false) mostra o MOTIVO REAL via blocking_reasons, nao "tente novamente"', async () => {
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo2.pdf')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'DIVERGENT', resultado: { success: false, retryable: false, error_code: 'PERMISSAO_NEGADA', blocking_reasons: ['Campo nao permitido: Laudo_URL_Invalido'] } },
    ];
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 8);
    const status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Não foi possível enviar: Campo nao permitido: Laudo_URL_Invalido', 'deveria mostrar o motivo real, nao mais um texto fixo de "tente novamente" pra uma recusa que nao e transitoria');
  });

  await record('capturarEUpload: falha transitoria (retryable:true) enquadra como "tente novamente" COM o motivo', async () => {
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo2b.pdf')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'SYNC_ERROR', resultado: { success: false, retryable: true, error_code: 'CONEXAO_INDISPONIVEL', blocking_reasons: ['Sistema ocupado, tente novamente em instantes'] } },
    ];
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 8);
    const status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Falha ao enviar (tente novamente): Sistema ocupado, tente novamente em instantes');
  });

  await record('capturarEUpload: sem blocking_reasons (array vazio), cai no fallback erro/"motivo nao informado"', async () => {
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo2c.pdf')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'SYNC_ERROR', resultado: { success: false, retryable: false, blocking_reasons: [], erro: 'Falha ao acessar o Drive' } },
    ];
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 8);
    let status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Não foi possível enviar: Falha ao acessar o Drive');

    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo2d.pdf')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'SYNC_ERROR', resultado: { success: false, retryable: false, blocking_reasons: [] } },
    ];
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 8);
    status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Não foi possível enviar: motivo não informado', 'sem blocking_reasons nem erro, cai no fallback generico -- ainda assim melhor que nao dizer nada');
  });

  await record('capturarEUpload: timeout do poll (nunca resolve) mostra "em processamento", nao erro nem sucesso falso', async () => {
    ctxSet('document.getElementById("enc-laudo-input").files', [fileFalso('laudo3.pdf')]);
    filaRespostasConsulta = new Array(20).fill({ encontrado: true, status: 'SENDING', resultado: null });
    await act("capturarEUpload('enc-laudo-input','enc-laudo-status','Laudo_URL')", 40);
    const status = ctxGet("document.getElementById('enc-laudo-status').textContent");
    assert.strictEqual(status, 'Envio em processamento — confira antes de concluir');
  });

  // ================================================================
  // 3) enviarSelfieEPI -- mesmo padrao, chamador separado
  // ================================================================
  await record('enviarSelfieEPI: sucesso real (status QUEUED) mostra elegibilidade, nao fica preso', async () => {
    ctxSet('APP.osAtiva', { id: 'OS-2', cliente: 'Cliente 2' });
    ctxSet('document.getElementById("selfie-input").files', [fileFalso('selfie.jpg')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'QUEUED', resultado: { success: true, url: 'https://drive.example/selfie.jpg', epiOk: true, elegivelFinanceiro: true } },
    ];
    await act('enviarSelfieEPI()', 8);
    const status = ctxGet("document.getElementById('selfie-epi-status').textContent");
    assert.ok(status.includes('elegibilidade financeira: sim'), 'esperava status de elegibilidade, veio: ' + status);
  });

  await record('enviarSelfieEPI: recusa de regra de negocio mostra o motivo real (mesmo padrao de capturarEUpload)', async () => {
    ctxSet('document.getElementById("selfie-input").files', [fileFalso('selfie2.jpg')]);
    filaRespostasConsulta = [
      { encontrado: true, status: 'DIVERGENT', resultado: { success: false, retryable: false, blocking_reasons: ['Diario do tecnico obrigatorio, nao foi preenchido'] } },
    ];
    await act('enviarSelfieEPI()', 8);
    const status = ctxGet("document.getElementById('selfie-epi-status').textContent");
    assert.strictEqual(status, 'Não foi possível salvar: Diario do tecnico obrigatorio, nao foi preenchido');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
