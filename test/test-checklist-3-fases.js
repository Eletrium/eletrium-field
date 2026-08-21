// Teste real do motor CHK3F (Checklist da OS em 3 fases) -- Frente B,
// fatia 3 (Diretriz v1.1).
//
// Roda o <script> DE VERDADE de index.html (não uma reimplementação
// paralela da lógica) dentro de uma sandbox de DOM/localStorage mínima,
// escrita à mão (sem jsdom/fake-indexeddb -- não estão instalados neste
// worktree e este teste não precisa deles: CHK3F não toca IndexedDB,
// só as funções da Fase 2/Frente D que ele DELEGA, que não são
// exercitadas de propósito aqui -- essa mecânica já tem suíte própria,
// Frente D, 24/24).
//
// gsCallReal é substituído por um mock LOCAL depois do script real
// carregar (mesma técnica da suíte de outbox: "última atribuição
// vence" -- função declarada no topo pode ser reatribuída depois, no
// mesmo escopo). NENHUMA chamada de rede acontece -- confirmado pelo
// próprio mock: qualquer action não coberta explicitamente abaixo
// lança erro, então uma chamada inesperada FALHA o teste em vez de
// silenciosamente tentar sair pra rede.
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

// ---- sandbox mínima -----------------------------------------------
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
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeElement());
      return els.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeElement(); },
    body: makeElement(),
    addEventListener() {},
  };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.scrollTo = () => {};
sandbox.document = makeDocument();
sandbox.localStorage = makeLocalStorage();
sandbox.navigator = { onLine: true };
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.fetch = () => { throw new Error('fetch() não deveria ser chamado neste teste (upload de arquivo não faz parte do fluxo testado)'); };
sandbox.indexedDB = undefined; // proposital -- CHK3F não deve tocar IndexedDB nos caminhos testados

const context = vm.createContext(sandbox);
vm.runInContext(appScript, context);

// ---- mock da rede (gsCallReal) -- reatribuição pós-carga -----------
// Log de toda chamada "de rede" pra provar, ao final, que nada além
// das actions esperadas foi tentado.
const chamadasRede = [];
// P0 (15/08): simula Checklist_Respostas -- fecharFaseChecklist real lê
// as respostas já gravadas pra decidir Estado_Seguranca/
// Checklist_Execucao_Completo, não recebe os booleans direto como
// confirmarSegurancaPreExecucao (interim) fazia.
const respostasSalvas = [];
function mockGsCallReal(action, params) {
  chamadasRede.push({ action, params });
  if (action === 'salvarResposta') {
    respostasSalvas.push({ osId: params[0], perguntaId: params[2], geraNC: params[7] });
    return Promise.resolve({ sucesso: true });
  }
  if (action === 'getProximaPergunta') return Promise.resolve(null); // fecha a Fase 2 (fallback CHK) na 1a chamada
  if (action === 'fecharFaseChecklist') {
    // Espelha a regra REAL do backend (Código.js:2463-2565), só a parte
    // que estes testes precisam -- não reimplementação paralela de
    // negócio, é o mock da rede.
    const [osId, , fase] = params;
    const respostasDaOS = respostasSalvas.filter(r => r.osId === osId);
    if (fase === 'Pré-Execução') {
      const temNC = respostasDaOS.some(r => r.geraNC === true);
      return Promise.resolve({ sucesso: true, completa: true, fase, estado: temNC ? 'Bloqueado' : 'Liberado' });
    }
    return Promise.resolve({ sucesso: true, completa: true, fase });
  }
  throw new Error('Chamada de rede inesperada nao coberta pelo mock: ' + action);
}

function ctxGet(name) { return vm.runInContext(name, context); }
function ctxSet(name, value) { context['__inject'] = value; vm.runInContext(name + ' = __inject;', context); }
function ctxCall(expr) { return vm.runInContext(expr, context); }

// Drena a fila de microtasks (promises encadeadas dentro do vm context
// -- realm separado, mas o loop de microtasks do isolate é o mesmo).
// gsCallIdempotente tem 2-3 saltos de microtask (await + .then); um
// setImmediate (macrotask) garante que TODOS já rodaram antes de
// continuar, mesmo cascatas (Fase 1 fechando -> Fase 2 abrindo ->
// getProximaPergunta resolvendo) criadas durante o próprio drain.
function flush() { return new Promise(resolve => setImmediate(resolve)); }
async function act(expr) { const r = ctxCall(expr); await flush(); return r; }

// Reatribuição pós-carga: gsCallReal foi declarado como function no
// topo do script real; reatribuir aqui (mesmo escopo) troca o binding
// pra todo mundo que já fechou sobre ele (gsCall/gsCallIdempotente).
ctxSet('gsCallReal', mockGsCallReal);

// ---- fixtures --------------------------------------------------------
ctxSet('APP.tecnico', { id: 'T1', nome: 'Técnico Teste' });

function novaOS(id) {
  return { id, cliente: 'Cliente ' + id, idSharePoint: '', checklist_version: undefined };
}

function estadoLocal(osId) {
  return JSON.parse(sandbox.localStorage.getItem('eletrium_chk3f_' + osId) || 'null');
}

// Compara objetos que atravessam a fronteira do vm context (realm
// diferente -- deepStrictEqual falha por prototype mismatch mesmo com
// conteúdo idêntico) via round-trip JSON, que é o suficiente pra estes
// payloads (booleans/strings simples).
function assertEqualCrossRealm(actual, expected, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
}

// Responde as 4 perguntas de segurança (todas "Sim") + a de NC
// adicional, com o valor passado. A última resposta dispara o fluxo
// assíncrono (_finalizarFase1 -> Promise.all(respostas) ->
// fecharFaseChecklist -> Fase 2), por isso é async e usa act().
async function completarFase1(temNCAdicional) {
  for (let i = 0; i < 4; i++) await act('CHK3F.responder(true)');
  await act('CHK3F.responder(' + (temNCAdicional ? 'true' : 'false') + ')');
}

async function main() {
  // ================================================================
  // 1) Fase 1 mostra as perguntas uma de cada vez, na ordem certa
  // ================================================================
  await record('Fase 1: entrar no checklist mostra a 1a pergunta de seguranca', async () => {
    ctxSet('APP.osAtiva', novaOS('OS-100'));
    await act('irParaChecklist()');
    const texto = ctxGet("document.getElementById('chk-f1-texto').textContent");
    assert.strictEqual(texto, 'EPI utilizado corretamente?');
    const block = ctxGet("document.getElementById('chk-f1-block').style.display");
    assert.strictEqual(block, 'block');
  });

  await record('Fase 1: responder "Nao" bloqueia avanco e nao chama o backend', async () => {
    chamadasRede.length = 0;
    await act('CHK3F.responder(false)');
    const alerta = ctxGet("document.getElementById('chk-f1-alerta').style.display");
    assert.strictEqual(alerta, 'block');
    const texto = ctxGet("document.getElementById('chk-f1-texto').textContent");
    assert.strictEqual(texto, 'EPI utilizado corretamente?', 'nao deve avancar de pergunta');
    assert.strictEqual(chamadasRede.length, 0, 'nao deveria ter chamado a rede so por um "Nao"');
  });

  await record('Fase 1: as 4 perguntas aparecem na ordem certa antes da pergunta de NC adicional', async () => {
    const ordemEsperada = [
      'EPI utilizado corretamente?',
      'Aterramento verificado?',
      'Bloqueio de energia realizado?',
      'Área sinalizada?',
    ];
    const vistas = [];
    for (let i = 0; i < 4; i++) {
      vistas.push(ctxGet("document.getElementById('chk-f1-texto').textContent"));
      await act('CHK3F.responder(true)');
    }
    assert.deepStrictEqual(vistas, ordemEsperada);
    const textoFinal = ctxGet("document.getElementById('chk-f1-texto').textContent");
    assert.ok(/conformidade adicional/i.test(textoFinal), 'ultima pergunta deveria ser a de NC adicional, veio: ' + textoFinal);
  });

  // ================================================================
  // 2) Completar a Fase 1 grava auditoria por pergunta, fecha a fase
  //    no backend (fecharFaseChecklist, achado P0 de 15/08) e avanca
  //    sozinho pra Fase 2
  // ================================================================
  await record('Fase 1 completa (sem NC): grava 5 respostas de auditoria + 1 fecharFaseChecklist, estado Liberado', async () => {
    chamadasRede.length = 0;
    ctxSet('APP.osAtiva', novaOS('OS-200'));
    await act('irParaChecklist()');
    await completarFase1(false);

    const salvas = chamadasRede.filter(c => c.action === 'salvarResposta');
    assert.strictEqual(salvas.length, 5, 'esperava 4 perguntas de seguranca + 1 de NC adicional');
    const idsGravados = salvas.map(c => c.params[2]);
    assertEqualCrossRealm(idsGravados, ['PRE_EPI', 'PRE_ATERRAMENTO', 'PRE_BLOQUEIO', 'PRE_SINALIZACAO', 'PRE_NC_ADICIONAL']);

    // P0 (15/08): fecharFaseChecklist substitui confirmarSegurancaPreExecucao
    // como escritor real -- chamada SÓ DEPOIS que as 5 respostas acima
    // já resolveram (Promise.all em _finalizarFase1). O mock deste
    // arquivo fecha a Fase 2 (Execução) sozinho na sequência (fallback
    // CHK sem perguntas reais) -- por isso filtra por fase pra isolar
    // só o fechamento da Fase 1 que este teste quer provar.
    const fechamentosF1 = chamadasRede.filter(c => c.action === 'fecharFaseChecklist' && c.params[2] === 'Pré-Execução');
    assert.strictEqual(fechamentosF1.length, 1);
    const [osId, tecnicoId, fase] = fechamentosF1[0].params;
    assert.strictEqual(osId, 'OS-200');
    assert.strictEqual(tecnicoId, 'T1');
    assert.strictEqual(fase, 'Pré-Execução');
    // Ordem importa: fecharFaseChecklist(Pré-Execução) tem que vir
    // DEPOIS das 5 respostas na fila de chamadas (prova que o
    // Promise.all esperou).
    const idxUltimaResposta = chamadasRede.map(c => c.action).lastIndexOf('salvarResposta');
    const idxFechamento = chamadasRede.map(c => c.action).indexOf('fecharFaseChecklist');
    assert.ok(idxFechamento > idxUltimaResposta, 'fecharFaseChecklist deveria ter sido chamado depois de todas as respostas');

    const estado = estadoLocal('OS-200');
    assert.ok(estado.fase1 && estado.fase1.completo, 'fase1.completo deveria ser true');
    assert.strictEqual(estado.fase1.estadoSeguranca, 'Liberado');
  });

  await record('Fase 1 completa (com NC adicional): estado vira Bloqueado, mas fase1 ainda conta como completa', async () => {
    ctxSet('APP.osAtiva', novaOS('OS-201'));
    await act('irParaChecklist()');
    await completarFase1(true);
    const estado = estadoLocal('OS-201');
    assert.strictEqual(estado.fase1.completo, true);
    assert.strictEqual(estado.fase1.estadoSeguranca, 'Bloqueado');
  });

  await record('Fase 1 completa: avanca sozinho pra Fase 2 (motor de Execucao existente)', async () => {
    // fallback CHK (sem checklist_version) chamou getProximaPergunta, que
    // o mock devolve null de cara -> fecha direto no resumo (progresso
    // passa por 'Fase 2 de 3 — Execução' e cai em 'Concluido' na mesma
    // leva de microtasks, porque o mock nao tem nenhuma pergunta real).
    const progresso = ctxGet("document.getElementById('chk-progresso').textContent");
    assert.strictEqual(progresso, 'Concluido');
    const resumo = ctxGet("document.getElementById('chk-resumo-block').style.display");
    assert.strictEqual(resumo, 'block');
  });

  // ================================================================
  // 3) concluirChecklist() marca a Fase 2 como completa localmente
  // ================================================================
  await record('concluirChecklist() marca fase2.completo=true pra OS ativa', async () => {
    ctxSet('APP.osAtiva', novaOS('OS-201')); // reaproveita OS-201 (fase1 ja completa la em cima)
    await act('concluirChecklist()');
    const estado = estadoLocal('OS-201');
    assert.strictEqual(estado.fase2.completo, true);
  });

  // ================================================================
  // 4) Fase 3 (irParaEncerrar) -- trava client-side por fase incompleta
  // ================================================================
  await record('irParaEncerrar(): OS sem nenhuma fase feita -- bloqueia e redireciona pro checklist (Fase 1)', async () => {
    ctxSet('APP.osAtiva', novaOS('OS-300'));
    await act('irParaEncerrar()');
    const telaChecklist = ctxGet("document.getElementById('chk-f1-block').style.display");
    assert.strictEqual(telaChecklist, 'block', 'deveria ter caido de volta na Fase 1 do checklist');
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.strictEqual(encId, '', 'tela de encerrar nao deveria ter sido preenchida/mostrada');
  });

  await record('irParaEncerrar(): Fase 1 completa mas Fase 2 nao -- bloqueia e redireciona pro checklist (Fase 2)', async () => {
    // P0 (15/08) mudou QUANDO fase2 fica completa localmente: antes só
    // acontecia quando o técnico apertava "VOLTAR PARA OS"
    // (concluirChecklist()); agora _fecharFase2Execucao() já persiste
    // fase2.completo assim que fecharFaseChecklist('Execução', ...)
    // resolve -- ou seja, no mock deste arquivo (getProximaPergunta
    // sempre null, fecha a Execução na hora) o estado "Fase 1 sim,
    // Fase 2 ainda não" não sobrevive a um irParaChecklist() completo.
    // Pra isolar esse estado intermediário sem depender do motor real
    // (que nesta suíte não tem pergunta nenhuma pra "ficar no meio
    // de"), grava o estado local direto -- mesma técnica do 1o teste
    // desta seção ("OS sem nenhuma fase feita").
    ctxSet('APP.osAtiva', novaOS('OS-301'));
    ctxCall("CHK3F.salvarEstado('OS-301', { fase1: { completo: true, estadoSeguranca: 'Liberado' }, fase2: null })");
    const antes = estadoLocal('OS-301');
    assert.strictEqual(antes.fase2, null, 'fase2 ainda nao deveria existir -- Execucao nunca foi aberta');

    await act('irParaEncerrar()');
    // Redirecionado de volta pro checklist (nao pra tela de encerrar).
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.strictEqual(encId, '', 'tela de encerrar nao deveria ter sido preenchida -- OS-301 ainda nao tinha fase2.completo=true');
  });

  await record('irParaEncerrar(): Fase 1 e 2 completas -- libera a tela de encerrar e mostra o estado de seguranca real', async () => {
    ctxSet('APP.osAtiva', novaOS('OS-302'));
    await act('irParaChecklist()');
    await completarFase1(true); // temNC=true -> estadoSeguranca = 'Bloqueado'
    await act('concluirChecklist()');

    await act('irParaEncerrar()');
    const encId = ctxGet("document.getElementById('enc-id').textContent");
    assert.strictEqual(encId, 'OS-302 - Cliente OS-302', 'tela de encerrar deveria ter sido preenchida normalmente');
    const status = ctxGet("document.getElementById('enc-seguranca-status').textContent");
    assert.strictEqual(status, 'Segurança: Bloqueado');
  });

  // ================================================================
  // 5) Fase 1 com resposta "backend recusou" -- nao trava o app, so avisa
  //    (defensivo; na pratica nao deveria acontecer, ja que so chegamos
  //    aqui com os 4 booleans true, mas prova que o codigo nao assume
  //    sucesso sem checar r.sucesso)
  // ================================================================
  await record('_finalizarFase1 lida com sucesso:false do backend sem travar o fluxo', async () => {
    const realGsCallReal = ctxGet('gsCallReal');
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params });
      if (action === 'fecharFaseChecklist') return Promise.resolve({ sucesso: false, completa: false, erro: 'falha simulada' });
      if (action === 'salvarResposta') return Promise.resolve({ sucesso: true });
      if (action === 'getProximaPergunta') return Promise.resolve(null);
      throw new Error('acao inesperada: ' + action);
    });
    ctxSet('APP.osAtiva', novaOS('OS-400'));
    await act('irParaChecklist()');
    await completarFase1(false);
    const estado = estadoLocal('OS-400');
    assert.strictEqual(estado.fase1.completo, true, 'fase1 fica marcada como completa mesmo com erro do backend (documentado no codigo -- gap conhecido)');
    assert.strictEqual(estado.fase1.estadoSeguranca, 'Erro');
    ctxSet('gsCallReal', realGsCallReal);
  });

  // ================================================================
  // 6) Achado da auditoria de mensagens (12/08): a frase antiga
  //    ("Segurança confirmada localmente, mas o backend recusou...")
  //    era contraditória -- "confirmada" e "recusou" na mesma frase.
  //    Agora usa mensagemRecusa (blocking_reasons + retryable), mesmo
  //    padrão do fix em capturarEUpload/enviarSelfieEPI/ferramental.
  // ================================================================
  await record('_finalizarFase1: recusa com blocking_reasons mostra o motivo real, sem a frase contraditoria antiga', async () => {
    const realGsCallReal = ctxGet('gsCallReal');
    ctxSet('gsCallReal', (action, params) => {
      chamadasRede.push({ action, params });
      // Recusa só na Fase 1 (Pré-Execução) -- Fase 2 (Execução) sucede
      // normalmente, senão o toast dela (que dispara na sequência,
      // fallback CHK sem pergunta real) sobrescreveria o desta prova.
      if (action === 'fecharFaseChecklist') {
        if (params[2] === 'Pré-Execução') return Promise.resolve({ sucesso: false, success: false, completa: false, retryable: false, blocking_reasons: ['Tecnico nao encontrado'] });
        return Promise.resolve({ sucesso: true, completa: true, fase: params[2] });
      }
      if (action === 'salvarResposta') return Promise.resolve({ sucesso: true });
      if (action === 'getProximaPergunta') return Promise.resolve(null);
      throw new Error('acao inesperada: ' + action);
    });
    ctxSet('APP.osAtiva', novaOS('OS-401'));
    await act('irParaChecklist()');
    await completarFase1(false);
    const toastEl = ctxGet("document.getElementById('toast').textContent");
    assert.strictEqual(toastEl, 'Não foi possível fechar a fase de segurança: Tecnico nao encontrado');
    assert.ok(!toastEl.includes('confirmada localmente'), 'nao deveria mais ter a frase contraditoria antiga');
    ctxSet('gsCallReal', realGsCallReal);
  });

  // ================================================================
  // Relatorio
  // ================================================================
  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
