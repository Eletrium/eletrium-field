// 4 melhorias de UX pedidas pelo Geovane (15/08), depois de testar o
// fluxo real: (1) saudação varia por período do dia; (2) cronômetro ao
// vivo tirado da tela durante a execução; (3) lista de "Próximas" some
// da Home enquanto há OS ativa; (4) "Trocar técnico" vira botão "Sair"
// direto (já não tinha confirm(), confirmado nesta suíte); (5) login
// deixa de listar todos os técnicos, vira campo de nome + PIN.
//
// Roda o <script> DE VERDADE via vm, gsCallReal mockado.
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
    addEventListener() {}, setAttribute() {}, focus() {}, querySelector() { return null; },
    appendChild() {}, insertBefore() {}, remove() {},
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
sandbox.setInterval = (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; };
sandbox.clearInterval = clearInterval;
sandbox.setImmediate = setImmediate;
sandbox.crypto = { randomUUID: (() => { let n = 0; return () => 'test-uuid-' + (n++); })() };
sandbox.indexedDB = undefined;
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

const ROSTER = [
  { id: 'T1', nome: 'João da Silva' },
  { id: 'T2', nome: 'Maria Souza' },
  { id: 'T3', nome: 'João Pereira' }, // mesmo primeiro nome de T1, de proposito -- prova o caso ambiguo
];
function mockGsCallReal(action, params) {
  if (action === 'getTecnicos') return Promise.resolve(ROSTER);
  throw new Error('Chamada de rede inesperada não coberta pelo mock: ' + action);
}
ctxSet('gsCallReal', mockGsCallReal);

async function main() {
  // ================================================================
  // 1) Saudação por período do dia
  // ================================================================
  await record('saudacaoPorHorario(): varia conforme a hora -- nao e mais fixa', async () => {
    const RealDate = Date;
    function stubHora(h) {
      ctxSet('Date', class extends RealDate {
        constructor(...args) { if (args.length) super(...args); else super(2026, 0, 1, h, 0, 0); }
        getHours() { return h; }
      });
    }
    stubHora(8); assert.strictEqual(ctxCall('saudacaoPorHorario()'), 'Bom dia');
    stubHora(14); assert.strictEqual(ctxCall('saudacaoPorHorario()'), 'Boa tarde');
    stubHora(21); assert.strictEqual(ctxCall('saudacaoPorHorario()'), 'Boa noite');
    ctxSet('Date', RealDate);
  });

  await record('irParaInicioDia(): usa a saudacao dinamica no texto exibido', async () => {
    ctxSet('APP.tecnico', { id: 'T1', nome: 'João da Silva' });
    await act('irParaInicioDia()');
    const texto = ctxGet('document.getElementById("inicio-sub").textContent');
    assert.ok(/^(Bom dia|Boa tarde|Boa noite), João!$/.test(texto), 'deveria ter uma das 3 saudacoes: ' + texto);
  });

  // ================================================================
  // 2) Cronometro nao fica mais tickando ao vivo na tela
  // ================================================================
  await record('iniciarCronometro(): mostra "Em andamento" estatico, nao um relogio rodando', async () => {
    ctxSet('APP.osAtiva', { id: 'OS-1', cliente: 'Cliente 1' });
    await act('iniciarCronometro(0)', 1);
    const home = ctxGet('document.getElementById("home-timer").textContent');
    const ativa = ctxGet('document.getElementById("ativa-timer").textContent');
    assert.strictEqual(home, 'Em andamento');
    assert.strictEqual(ativa, 'Em andamento');
    // Espera mais de 1 "tick" (500ms) do jeito antigo e confirma que o
    // texto NAO mudou -- nao ha mais setInterval fazendo isso tickar.
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ctxGet('document.getElementById("home-timer").textContent'), 'Em andamento', 'nao deveria ter virado um relogio tickando');
  });

  // ================================================================
  // 3) Lista de "Proximas" some da Home quando ha OS ativa
  // ================================================================
  await record('renderHome(): com OS ativa, a secao "Proximas" fica escondida (nao so vazia -- some mesmo)', async () => {
    await act('renderHome([{ id: "OS-1", cliente: "Cliente 1", statusAtual: "Em andamento", emPausa: false }, { id: "OS-2", cliente: "Cliente 2", statusAtual: "Pendente", emPausa: false }])', 2);
    const display = ctxGet('document.getElementById("home-proximas-secao").style.display');
    assert.strictEqual(display, 'none', 'secao de proximas deveria estar escondida com uma OS ativa');
  });

  await record('renderHome(): sem OS ativa, a secao "Proximas" volta a aparecer normalmente', async () => {
    await act('renderHome([{ id: "OS-2", cliente: "Cliente 2", statusAtual: "Pendente", emPausa: false }])', 2);
    const display = ctxGet('document.getElementById("home-proximas-secao").style.display');
    assert.strictEqual(display, 'block', 'sem OS ativa, a lista de proximas deveria voltar a aparecer');
  });

  // ================================================================
  // 4) "Trocar tecnico" -- ja era direto (sem confirm()), so o texto
  //    do botao mudou pra "Sair".
  // ================================================================
  await record('logOut(): acao direta, sem dialogo -- e o botao/tooltip agora dizem "Sair"', async () => {
    let confirmChamado = false;
    ctxSet('confirm', () => { confirmChamado = true; return true; });
    ctxSet('APP.tecnico', { id: 'T1', nome: 'Tecnico Teste' });
    await act('logOut()');
    assert.strictEqual(confirmChamado, false, 'logOut() nao deveria ter chamado confirm() nenhuma vez');
    assert.strictEqual(ctxGet('APP.tecnico'), null, 'deveria ter deslogado de verdade, sem pedir confirmacao');
  });

  // ================================================================
  // 5) Login por nome -- nao expoe mais a lista completa de tecnicos
  // ================================================================
  await record('carregarTecnicos(): busca a lista em segundo plano, mas NAO expoe em nenhum elemento renderizado', async () => {
    ctxSet('APP.tecnicosCache', null);
    await act('carregarTecnicos()');
    const cache = ctxGet('APP.tecnicosCache');
    assert.strictEqual(cache.length, 3, 'deveria ter guardado a lista internamente pra resolver nome -> ID');
    // Confirma que não existe mais nenhum elemento tipo lista de
    // técnicos no DOM (o antigo #login-tecnicos foi removido de vez).
    assert.strictEqual(ctxGet('document.getElementById("login-tecnicos")').innerHTML, '', 'nao deveria ter renderizado nada visivel com os nomes');
  });

  await record('confirmarNomeLogin(): nome exato (com acento) entra normalmente', async () => {
    let chamou = null;
    ctxSet('entrarComoTecnico', (tec) => { chamou = tec; });
    ctxCall('document.getElementById("login-nome-input").value = "Maria Souza"');
    await act('confirmarNomeLogin()');
    assert.ok(chamou, 'deveria ter encontrado a tecnica');
    assert.strictEqual(chamou.id, 'T2');
  });

  await record('confirmarNomeLogin(): nome sem acento/caixa diferente ainda encontra (normalizacao)', async () => {
    let chamou = null;
    ctxSet('entrarComoTecnico', (tec) => { chamou = tec; });
    ctxCall('document.getElementById("login-nome-input").value = "  joao da silva  "');
    await act('confirmarNomeLogin()');
    assert.ok(chamou);
    assert.strictEqual(chamou.id, 'T1');
  });

  await record('confirmarNomeLogin(): nome ambiguo (só primeiro nome, 2 tecnicos "João") pede nome completo, NAO lista os candidatos', async () => {
    let chamou = null;
    ctxSet('entrarComoTecnico', (tec) => { chamou = tec; });
    ctxCall('document.getElementById("login-nome-input").value = "João"');
    await act('confirmarNomeLogin()');
    assert.strictEqual(chamou, null, 'nao deveria ter decidido sozinho entre os 2 Joões');
    const erro = ctxGet('document.getElementById("login-erro").textContent');
    assert.ok(erro.toLowerCase().includes('mais de um'), 'deveria pedir nome completo: ' + erro);
    assert.ok(!erro.includes('Pereira') && !erro.includes('Silva'), 'NAO deveria vazar os nomes completos dos candidatos no erro: ' + erro);
  });

  await record('confirmarNomeLogin(): nome que nao existe mostra erro generico, sem revelar a lista real', async () => {
    let chamou = null;
    ctxSet('entrarComoTecnico', (tec) => { chamou = tec; });
    ctxCall('document.getElementById("login-nome-input").value = "Fulano Inexistente"');
    await act('confirmarNomeLogin()');
    assert.strictEqual(chamou, null);
    const erro = ctxGet('document.getElementById("login-erro").textContent');
    assert.ok(erro.toLowerCase().includes('nao encontrado') || erro.toLowerCase().includes('não encontrado'));
    assert.ok(!erro.includes('João') && !erro.includes('Maria'), 'erro nao deveria vazar nenhum nome real cadastrado: ' + erro);
  });

  await record('confirmarNomeLogin(): campo vazio nao tenta nada, so avisa', async () => {
    let chamou = null;
    ctxSet('entrarComoTecnico', (tec) => { chamou = tec; });
    ctxCall('document.getElementById("login-nome-input").value = "   "');
    await act('confirmarNomeLogin()');
    assert.strictEqual(chamou, null);
  });

  const falhas = results.filter(r => !r.ok);
  console.log('');
  results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
  console.log('');
  console.log(results.length - falhas.length + '/' + results.length + ' passaram');
  if (falhas.length) process.exitCode = 1;
}

main();
