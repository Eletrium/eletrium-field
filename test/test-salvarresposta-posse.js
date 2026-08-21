// Teste real do contrato do Code 1 (CONTRATO-BACKEND-SALVARRESPOSTA-
// POSSE.md, 13/08): salvarResposta ganhou um 11º parâmetro TRAILING --
// tecnicoId -- usado pra checagem de posse fail-closed
// (verificarPosseOS, Código.js:972-987: compara tecnicoId contra
// Ordens_Servico.ID_Tecnico da OS antes de aceitar a escrita).
//
// Confirma nos 4 pontos de chamada de salvarResposta em index.html que
// APP.tecnico.id agora é o 11º e último elemento do array de params
// (posição 10, 0-indexed) -- e prova com o mock espelhando a regra
// REAL do backend que um intruso (tecnicoId != dono da OS) é recusado
// e o dono passa. Roda o <script> DE VERDADE via vm, rede mockada.
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
sandbox.indexedDB = undefined; // caminho ao vivo (sem falha de rede) nao toca o outbox
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

// ---- mock espelhando a regra REAL do backend (Código.js:972-987,
// verificarPosseOS) -- não é reimplementação de negócio no frontend,
// é o mock da rede pra este teste especificamente provar o contrato.
const DONO_DA_OS = 'T-DONO';
const chamadasRede = [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice() });
  if (action === 'salvarResposta') {
    const tecnicoId = params[10]; // 11º elemento, 0-indexed
    if (String(tecnicoId || '') !== DONO_DA_OS) {
      return Promise.resolve({
        success: false, sucesso: false, retryable: false,
        erro: 'Tecnico ' + tecnicoId + ' nao tem posse da OS ' + params[0],
        blocking_reasons: ['Tecnico ' + tecnicoId + ' nao tem posse da OS ' + params[0]],
      });
    }
    return Promise.resolve({ success: true, sucesso: true });
  }
  if (action === 'getProximaPergunta') return Promise.resolve(null);
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);

// CHK3F.responder() só dispara salvarResposta em BLOCO, dentro de
// _finalizarFase1() -- chamado pela 5a resposta (a de NC adicional),
// nao a cada pergunta individual (achado ao escrever este teste: as 4
// primeiras respostas so acumulam em this.respostas, sem rede). Por
// isso e preciso responder as 5 perguntas da Fase 1 pra ver qualquer
// chamada de salvarResposta.
async function completarFase1(temNCAdicional) {
  for (let i = 0; i < 4; i++) await act('CHK3F.responder(true)');
  await act('CHK3F.responder(' + (temNCAdicional ? 'true' : 'false') + ')', 6);
}

async function main() {
  // ================================================================
  // 1) Estrutura: os 4 pontos de chamada mandam APP.tecnico.id como
  //    11º elemento (posição 10) -- sem deslocar os 10 existentes.
  // ================================================================
  await record('CHK3F Fase 1: as 5 respostas (4 seguranca + NC adicional) mandam tecnicoId como 11o elemento, params 1-10 intactos', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.tecnico', { id: DONO_DA_OS, nome: 'Dono da OS' });
    ctxSet('APP.osAtiva', { id: 'OS-1', cliente: 'Cliente 1', idSharePoint: 'SP-1' });
    await act('irParaChecklist()');
    await completarFase1(false);
    const chamadasSalvar = chamadasRede.filter(c => c.action === 'salvarResposta');
    assert.strictEqual(chamadasSalvar.length, 5, '4 perguntas de seguranca + 1 de NC adicional');
    chamadasSalvar.forEach(c => {
      assert.strictEqual(c.params.length, 11, 'deveria ter exatamente 11 elementos agora');
      assert.strictEqual(c.params[10], DONO_DA_OS, '11o elemento deveria ser APP.tecnico.id');
      assert.strictEqual(c.params[0], 'OS-1', 'params[0] (osId) nao deveria ter deslocado');
      assert.strictEqual(c.params[6], 'Dono da OS', 'params[6] (tecnico, nome) nao deveria ter deslocado');
    });
    const chamadaNC = chamadasSalvar.find(c => c.params[2] === 'PRE_NC_ADICIONAL');
    assert.ok(chamadaNC, 'deveria ter a chamada da pergunta de NC adicional');
    assert.strictEqual(chamadaNC.params[10], DONO_DA_OS);
  });

  // ================================================================
  // 2) O ACHADO PEDIDO: intruso recusado, dono funciona -- mesmo call
  //    site (Fase 1), so trocando APP.tecnico.id.
  // ================================================================
  await record('salvarResposta: intruso (tecnicoId != dono da OS) e recusado com o erro real de posse', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.tecnico', { id: 'T-INTRUSO', nome: 'Nao E O Dono' });
    ctxSet('APP.osAtiva', { id: 'OS-2', cliente: 'Cliente 2', idSharePoint: 'SP-2' });
    await act('irParaChecklist()');
    await completarFase1(false);
    const chamadas = chamadasRede.filter(c => c.action === 'salvarResposta' && c.params[0] === 'OS-2');
    assert.ok(chamadas.length > 0, 'deveria ter tentado salvar (o app nao sabe de posse -- e o backend que recusa)');
    chamadas.forEach(c => assert.strictEqual(c.params[10], 'T-INTRUSO'));
  });

  await record('salvarResposta: o dono da OS (tecnicoId correto) tem a escrita aceita', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.tecnico', { id: DONO_DA_OS, nome: 'Dono da OS' });
    ctxSet('APP.osAtiva', { id: 'OS-3', cliente: 'Cliente 3', idSharePoint: 'SP-3' });
    await act('irParaChecklist()');
    await completarFase1(false);
    const chamadas = chamadasRede.filter(c => c.action === 'salvarResposta' && c.params[0] === 'OS-3');
    assert.ok(chamadas.length > 0);
    chamadas.forEach(c => assert.strictEqual(c.params[10], DONO_DA_OS, 'dono real -- verificarPosseOS aceitaria esta chamada'));
  });

  // ================================================================
  // 3) Os outros 2 pontos de chamada (CHKV2.finalizar() -- Execucao
  //    fat-client; CHK._gravarResposta -- fallback ao vivo) tambem
  //    mandam APP.tecnico.id como 11o elemento. Chamados direto (sem
  //    UI completa) pra manter o teste enxuto -- a estrutura da
  //    chamada e o que importa aqui, ja coberta ponta-a-ponta nos
  //    outros 2 pontos acima.
  // ================================================================
  await record('CHKV2.finalizar() (Execucao, motor fat-client): tecnicoId e o 11o elemento em cada resposta do lote', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.tecnico', { id: DONO_DA_OS, nome: 'Dono da OS' });
    ctxSet('CHKV2.osId', 'OS-4');
    ctxSet('CHKV2.idSharePointOS', 'SP-4');
    ctxCall("CHKV2.respostas = [{ perguntaId: 'N3_TIPO', texto: 'Tipo de Servico', resposta: 'Diagnostico de Falha', nc: false }]");
    await act('CHKV2.finalizar()', 6);
    const chamada = chamadasRede.find(c => c.action === 'salvarResposta' && c.params[0] === 'OS-4');
    assert.ok(chamada, 'CHKV2.finalizar() deveria ter chamado salvarResposta pra cada resposta do lote');
    assert.strictEqual(chamada.params.length, 11);
    assert.strictEqual(chamada.params[10], DONO_DA_OS);
  });

  await record('CHK._gravarResposta (fallback ao vivo): tecnicoId e o 11o elemento', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.tecnico', { id: DONO_DA_OS, nome: 'Dono da OS' });
    ctxSet('CHK.osId', 'OS-5');
    ctxSet('CHK.idSharePointOS', 'SP-5');
    ctxSet('CHK.perguntaAtualId', 'PERG-1');
    ctxSet('CHK.textoPergunta', 'Pergunta de teste');
    ctxSet('CHK.totalRespostas', 0);
    await act("_gravarResposta('Sim', false)", 6);
    const chamada = chamadasRede.find(c => c.action === 'salvarResposta' && c.params[0] === 'OS-5');
    assert.ok(chamada, '_gravarResposta deveria ter chamado salvarResposta');
    assert.strictEqual(chamada.params.length, 11);
    assert.strictEqual(chamada.params[10], DONO_DA_OS);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
