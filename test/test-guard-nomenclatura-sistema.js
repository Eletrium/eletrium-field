// Guarda estatica: audita o <script> inteiro de index.html atras de
// linguagem tecnica vazando pro tecnico -- pedido do dono, seção 51 do
// documento do auditor. "Nunca mostrar LOCAL_PENDING/QUEUED/SYNC_ERROR
// crus, IDs de operação, nomenclatura de sistema". As Fases A/B/C da
// reorganização de UX já cobriram Home/Wizard (status humanizado via
// resumoFila/renderStatusSincronizacao, nunca o vocabulário bruto do
// outbox). Esta varredura (13/08) cobriu o RESTO do app -- login/PIN,
// dia, pausar/retomar, emergência, veículo, checklist (Fase 1/2),
// upload, KM, ferramental, aceite de oferta, resumo.
//
// Achado (documentado em AUDITORIA-NOMENCLATURA-SISTEMA.md): NENHUM
// caso novo -- o único uso de `.status` fora do outbox interno
// (cadastrarOuEditarVeiculo, tela de veículo) já é uma frase amigável
// própria da função ("Cadastro enviado para aprovação"), não o
// vocabulário do Log_Central. Este teste transforma a varredura manual
// num guard permanente: se algum dia um termo de vocabulário interno
// (LOCAL_PENDING/QUEUED/SYNC_ERROR/operationId/error_code/códigos de
// erro do Log_Central) aparecer na MESMA linha que uma escrita de UI
// (toast/.textContent=/.innerHTML=), este teste quebra e aponta a linha.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Nenhum <script> encontrado em index.html');
const appScript = scriptMatch[1];

// Mesmo strip de comentários já usado em test-guard-status-synced.js
// (sem "$" no fim -- o arquivo é CRLF, "." não casa "\r").
const semComentarios = appScript.split('\n').map(l => l.replace(/\/\/.*/, '')).join('\n');

const TERMOS_INTERNOS = [
  'LOCAL_PENDING', 'QUEUED', 'SENDING', 'RECEIVED', 'SYNCED', 'RECONCILED', 'SYNC_ERROR', 'DIVERGENT',
  'operationId', 'operation_id', 'error_code',
  'TIMEOUT', 'PAYLOAD_INVALIDO', 'CONFLITO_VERSAO', 'PERMISSAO_NEGADA', 'QUOTA_EXCEDIDA',
  'CONEXAO_INDISPONIVEL', 'REFERENCIA_INVALIDA', 'DUPLICADO', 'DIVERGENCIA_VALOR',
  'DIVERGENCIA_AUSENCIA', 'ERRO_DESCONHECIDO',
];

const results = [];
function record(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

record('nenhuma linha combina vocabulário interno (Log_Central/outbox) com escrita de UI (toast/textContent/innerHTML)', () => {
  const linhas = semComentarios.split('\n');
  const achados = [];
  linhas.forEach((l, i) => {
    const temTermo = TERMOS_INTERNOS.some(t => l.includes(t));
    const escreveUI = /toast\(|\.textContent\s*=|\.innerHTML\s*=/.test(l);
    if (temTermo && escreveUI) achados.push((i + 1) + ': ' + l.trim());
  });
  assert.strictEqual(achados.length, 0,
    achados.length + ' linha(s) combinando vocabulário interno com escrita de UI (nao deveria haver nenhuma):\n' + achados.join('\n'));
});

record('cadastrarOuEditarVeiculo: o unico toast(res.status) do app mostra frase amigável, não vocabulário do Log_Central', () => {
  // Achado da varredura: a função NÃO passa por _sucesso()/_recusa()
  // (não usa executarIdempotente) -- devolve seu próprio {sucesso,
  // status:'Cadastro enviado para aprovacao'/'Alteracao enviada para
  // aprovacao'} direto. Documenta a razão pela qual toast(res.status)
  // é seguro aqui (achado verificado, não suposição) -- se essa função
  // um dia migrar pro envelope canônico, este teste vira o lembrete de
  // que o toast precisa mudar junto.
  const trecho = semComentarios.slice(
    semComentarios.indexOf('function salvarVeiculo'),
    semComentarios.indexOf('function salvarVeiculo') + 900
  );
  assert.ok(/toast\(res\.status/.test(trecho), 'esperava achar o toast(res.status...) dentro de salvarVeiculo() -- a função mudou de lugar/nome?');
  // Não deveria ter nenhuma chamada a executarIdempotente/gsCallIdempotente
  // por perto -- é exatamente isso que garante que res.status nunca é
  // o vocabulário QUEUED/SYNCED/etc do envelope canônico.
  assert.ok(!/gsCallIdempotente/.test(trecho), 'se salvarVeiculo() passou a usar gsCallIdempotente, o toast(res.status) precisa ser revisado -- res.status passaria a ser QUEUED/SYNCED/etc');
});

const falhas = results.filter(r => !r.ok);
console.log('');
results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
console.log('');
console.log(results.length - falhas.length + '/' + results.length + ' passaram');
if (falhas.length) process.exitCode = 1;
