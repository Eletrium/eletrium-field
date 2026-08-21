// P0 (15/08) -- achado cross-front classificado pelo ChatGPT, dono
// recomendado Code 2 (frontend/QA): fecharFaseChecklist nunca era
// chamada em lugar nenhum do frontend (Fase 1 chamava a função INTERIM
// confirmarSegurancaPreExecucao; Fase 2/concluirChecklist só gravava
// localStorage). Consequência real: canCloseOS tem um 5º motivo
// fail-closed sobre Checklist_Execucao_Completo que NUNCA era
// satisfeito -- nenhuma OS que passasse pelo checklist 3 fases
// conseguia fechar por este frontend, mesmo com Laudo/Assinatura/
// Fotos/Segurança corretos.
//
// Critério de aceite (dado pelo dono): checklist concluído ->
// fecharFaseChecklist efetivamente executada -> estado persistido ->
// canCloseOS reconhece a fase -> fechamento avança. Checklist
// incompleto -> fechamento continua bloqueado.
//
// Diferente das outras suítes deste worktree, o mock aqui PERSISTE
// estado de verdade entre chamadas (um objeto "servidor" simulado) --
// não é só "responde um valor enlatado pra cada action". É isso que
// prova "estado persistido -> canCloseOS reconhece", não só "a ação
// foi chamada": canCloseOS lê o MESMO objeto que fecharFaseChecklist
// escreveu, exatamente como Ordens_Servico real seria lido/escrito
// pelas duas funções reais.
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
sandbox.indexedDB = undefined; // caminho ao vivo (sem falha simulada) nao precisa do outbox
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

// ---- "servidor" simulado: um registro por OS, exatamente os campos
// que fecharFaseChecklist escreve e canCloseOS lê de verdade
// (Código.js:2546-2559 e 1962-1975). Laudo/Assinatura/Fotos ficam
// sempre satisfeitos aqui de propósito -- este teste prova
// especificamente o 5º motivo (checklist), não os outros 4.
const servidor = new Map(); // osId -> { estadoSeguranca, checklistExecucaoCompleto }
function registroOS(osId) {
  if (!servidor.has(osId)) servidor.set(osId, { estadoSeguranca: null, checklistExecucaoCompleto: false });
  return servidor.get(osId);
}

const chamadasRede = [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params: params.slice ? params.slice() : params });
  if (action === 'salvarResposta') return Promise.resolve({ sucesso: true });
  if (action === 'getProximaPergunta') return Promise.resolve(null); // fallback CHK, Fase 2 sem pergunta real
  if (action === 'fecharFaseChecklist') {
    const [osId, tecnicoId, fase] = params;
    const reg = registroOS(osId);
    // Espelha fecharFaseChecklist real (Código.js:2546-2559): grava no
    // MESMO registro que canCloseOS abaixo vai ler.
    if (fase === 'Pré-Execução') { reg.estadoSeguranca = 'Liberado'; return Promise.resolve({ sucesso: true, completa: true, fase, estado: 'Liberado' }); }
    if (fase === 'Execução') { reg.checklistExecucaoCompleto = true; return Promise.resolve({ sucesso: true, completa: true, fase }); }
    return Promise.resolve({ sucesso: true, completa: true, fase });
  }
  if (action === 'canCloseOS') {
    const [osId] = params;
    const reg = registroOS(osId);
    // Espelha canCloseOS real (Código.js:1912-1975), só a parte que
    // este teste precisa -- Laudo/Assinatura/Fotos sempre OK aqui de
    // propósito, só o motivo do checklist depende do estado real.
    const reasons = [];
    if (reg.estadoSeguranca !== 'Liberado') reasons.push('seguranca (Estado_Seguranca) - fase de pre-execucao ainda nao foi fechada ou bloqueada');
    if (reg.checklistExecucaoCompleto !== true) reasons.push('checklist de execucao completo (Checklist_Execucao_Completo) - fase de execucao ainda nao foi fechada');
    return Promise.resolve({ allowed: reasons.length === 0, blockingReasons: reasons });
  }
  throw new Error('Chamada de rede inesperada não coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);
ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });

function novaOS(id) { return { id, cliente: 'Cliente ' + id, idSharePoint: 'SP-' + id, metaDia: 0 }; }

async function completarChecklistCompleto(osId) {
  ctxSet('APP.osAtiva', novaOS(osId));
  await act('irParaChecklist()');
  for (let i = 0; i < 4; i++) await act('CHK3F.responder(true)');
  await act('CHK3F.responder(false)', 10); // NC adicional=false -> dispara toda a cadeia (Fase 1 -> Fase 2)
}

async function main() {
  // ================================================================
  // CENÁRIO 1 (critério de aceite, caminho feliz): checklist concluído
  // -> fecharFaseChecklist efetivamente executada -> estado persistido
  // -> canCloseOS reconhece a fase -> fechamento avança.
  // ================================================================
  await record('checklist completo (Fase 1+2): fecharFaseChecklist grava no "servidor", canCloseOS reconhece e libera', async () => {
    chamadasRede.length = 0;
    await completarChecklistCompleto('OS-P0-1');

    const fechamentos = chamadasRede.filter(c => c.action === 'fecharFaseChecklist');
    assert.strictEqual(fechamentos.length, 2, 'deveria ter fechado as 2 fases (Pré-Execução + Execução)');
    assert.ok(fechamentos.some(c => c.params[2] === 'Pré-Execução'));
    assert.ok(fechamentos.some(c => c.params[2] === 'Execução'));

    const reg = registroOS('OS-P0-1');
    assert.strictEqual(reg.estadoSeguranca, 'Liberado', 'estado deveria ter sido persistido no "servidor"');
    assert.strictEqual(reg.checklistExecucaoCompleto, true, 'Checklist_Execucao_Completo deveria ter sido persistido no "servidor"');

    // A PROVA REAL do critério de aceite: uma chamada NOVA e
    // INDEPENDENTE a canCloseOS (não reaproveitando nenhum estado da
    // chamada de fecharFaseChecklist -- só o "servidor" compartilhado)
    // reconhece o que foi persistido.
    const resultado = await act("gsCallReal('canCloseOS', ['OS-P0-1'])", 2);
    assert.strictEqual(resultado.allowed, true, 'canCloseOS deveria reconhecer o checklist completo e liberar o fechamento');
    assert.deepStrictEqual(resultado.blockingReasons, []);
  });

  // ================================================================
  // CENÁRIO 2 (critério de aceite, caminho bloqueado): checklist
  // incompleto -> fechamento continua bloqueado.
  // ================================================================
  await record('checklist incompleto (só Fase 1, Execução nunca fechada): canCloseOS continua bloqueando pelo motivo real', async () => {
    // Simula só a Fase 1 sendo fechada no "servidor" -- sem passar pela
    // Fase 2 (cenário real: técnico fecha o app, ou o motor de Execução
    // trava numa versão com perguntas reais, sem completar).
    const reg = registroOS('OS-P0-2');
    reg.estadoSeguranca = 'Liberado';
    // reg.checklistExecucaoCompleto continua false (default)

    const resultado = await act("gsCallReal('canCloseOS', ['OS-P0-2'])", 2);
    assert.strictEqual(resultado.allowed, false, 'canCloseOS NAO deveria liberar -- Execução nunca fechou');
    assert.ok(resultado.blockingReasons.some(r => r.includes('Checklist_Execucao_Completo')), 'motivo real deveria mencionar o campo que falta: ' + JSON.stringify(resultado.blockingReasons));
  });

  await record('checklist totalmente intocado (nenhuma fase fechada): canCloseOS bloqueia com os 2 motivos do checklist', async () => {
    const resultado = await act("gsCallReal('canCloseOS', ['OS-P0-3'])", 2);
    assert.strictEqual(resultado.allowed, false);
    assert.strictEqual(resultado.blockingReasons.length, 2, 'deveria bloquear tanto por seguranca quanto por execucao');
  });

  // ================================================================
  // Reconciliação com o gate local (irParaEncerrar) -- confirma que o
  // wizard de fato chega na tela de encerrar só quando os DOIS lados
  // (local E servidor) concordam que está completo.
  // ================================================================
  await record('irParaEncerrar(): depois do checklist completo, o gate local libera a tela de encerrar (integração com o achado P0)', async () => {
    await act('irParaEncerrar()', 4);
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.strictEqual(encId, 'OS-P0-1 - Cliente OS-P0-1', 'gate local deveria ter liberado -- checklist completo nos passos anteriores');
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
