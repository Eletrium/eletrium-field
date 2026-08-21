// Guarda estatica: audita o <script> inteiro de index.html atras de
// QUALQUER comparacao "X.status === 'SYNCED'" contra uma resposta de
// OPERACAO (Log_Central) -- pedido do dono apos o achado de
// pollStatusOperacao (checava status==='SYNCED' pra decidir fim de
// operacao, quebrado quando o backend mudou o terminal de sucesso do
// Sheets de SYNCED pra QUEUED). D7-02 ja confirmou que o status LOCAL
// do outbox (`item.status`, campo proprio do IndexedDB da fila) e um
// namespace DIFERENTE do status do Log_Central -- coincide o texto
// ('SYNCED' aparece nos dois vocabularios) mas nao e o mesmo bug.
//
// Levantamento (13/08): grep completo por 'SYNCED' e por `.status ===`
// no arquivo inteiro, revisado ocorrencia por ocorrencia. Achados:
// - item.status==='SYNCED' (processarFilaOffline, skip-list do topo
//   do loop) -- outbox LOCAL, D7-02, nao e o bug.
// - oferta.status==='Aceita' -- status de NEGOCIO da oferta
//   (Pendente/Aceita/Recusada, getOfertaAlocacao, funcao só-leitura,
//   fora do envelope canonico), namespace diferente.
// - os.statusAtual==='Em andamento' / os.status==='Em andamento' --
//   status de NEGOCIO da OS (getOsDoTecnico), idem, outro namespace.
// - sw.js/API.gs/manifest.json -- zero ocorrencias.
// NENHUM caso novo encontrado alem dos 2 ja corrigidos hoje
// (pollStatusOperacao, que usava a comparacao errada; processarFilaOffline,
// que ja usava o padrao certo (success/retryable) e serviu de referencia).
//
// Este teste transforma o levantamento manual num guard permanente:
// se alguem reintroduzir "X.status === 'SYNCED'" em qualquer lugar do
// app fora do outbox local, este teste quebra e aponta a linha.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Nenhum <script> encontrado em index.html');
const appScript = scriptMatch[1];

// Remove comentarios de linha (//...) antes de varrer -- o proprio
// codigo tem comentarios citando "status==='SYNCED'" pra DOCUMENTAR o
// bug ja corrigido (ex.: em pollStatusOperacao), que nao sao codigo
// executavel e não devem contar como ocorrência real. Ingenuo o
// suficiente pro que este arquivo precisa (não lida com // dentro de
// string, mas nenhuma string do app contém "//").
// Sem "$" no fim: o arquivo é CRLF, cada linha retém um "\r" que "."
// não casa (line terminator) -- com "$" a âncora exige chegar
// exatamente no fim da string e a troca silenciosamente não batia
// nada nas linhas de comentário, deixando o texto "documentando o bug
// antigo" contando como ocorrência real (achado ao escrever este
// teste). Sem "$", ".*" simplesmente para antes do "\r" sozinho.
const appScriptSemComentarios = appScript
  .split('\n')
  .map(linha => linha.replace(/\/\/.*/, ''))
  .join('\n');

const results = [];
function record(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

record('nenhuma comparacao "X.status === SYNCED" sobra fora do outbox local (item.status)', () => {
  const regex = /([A-Za-z_$][\w.]*)\.status\s*===\s*'SYNCED'/g;
  const encontrados = [...appScriptSemComentarios.matchAll(regex)].map(m => m[1]);
  assert.strictEqual(encontrados.length, 1,
    'esperava exatamente 1 comparacao "X.status === \'SYNCED\'" no app inteiro (o skip-list do outbox local em processarFilaOffline) -- ' +
    (encontrados.length === 0 ? 'achou ZERO (o skip-list sumiu? confira se processarFilaOffline nao foi alterado por engano)' :
     'achou ' + encontrados.length + ': [' + encontrados.join(', ') + '] -- caso(s) novo(s) pra investigar, NAO assumir seguro'));
  assert.strictEqual(encontrados[0], 'item',
    'a unica comparacao restante deveria ser "item.status" (outbox LOCAL, D7-02, namespace diferente do Log_Central) -- ' +
    'veio "' + encontrados[0] + '.status" -- se nao for claramente o status local do outbox, e um caso novo real');
});

record('nenhuma comparacao "X.status === SYNC_ERROR" sobra fora do outbox local/timeout sintetico', () => {
  // SYNC_ERROR aparece em mais lugares que SYNCED porque tambem e um
  // valor SINTETICO que o proprio frontend atribui (nao só compara) --
  // aqui filtramos só comparacoes (===), nao atribuicoes.
  const regex = /([A-Za-z_$][\w.]*)\.status\s*===\s*'SYNC_ERROR'/g;
  const encontrados = [...appScriptSemComentarios.matchAll(regex)].map(m => m[1]);
  const foraDoOutboxLocal = encontrados.filter(prefixo => prefixo !== 'item');
  assert.strictEqual(foraDoOutboxLocal.length, 0,
    'comparacao "X.status === \'SYNC_ERROR\'" fora do outbox local encontrada: [' + foraDoOutboxLocal.join(', ') + '] -- ' +
    'confirmar se e status do Log_Central (bug, precisa usar success/retryable) ou outro namespace legitimo');
});

record('pollStatusOperacao nao le mais status==="SYNCED"/"SYNC_ERROR" -- usa presenca de resultado_json (ja corrigido hoje)', () => {
  const inicio = appScriptSemComentarios.indexOf('async function pollStatusOperacao');
  const trecho = appScriptSemComentarios.slice(inicio, inicio + 600);
  assert.ok(!/r\.status\s*===\s*'SYNCED'/.test(trecho), 'pollStatusOperacao nao deveria mais comparar r.status contra SYNCED (fora de comentario)');
  assert.ok(/r\.resultado/.test(trecho), 'pollStatusOperacao deveria decidir "concluido" pela presenca de r.resultado (resultado_json), nao por um valor de status especifico');
});

const falhas = results.filter(r => !r.ok);
console.log('');
results.forEach(r => console.log((r.ok ? 'PASS' : 'FAIL') + ' - ' + r.name + (r.ok ? '' : '\n  ' + r.err)));
console.log('');
console.log(results.length - falhas.length + '/' + results.length + ' passaram');
if (falhas.length) process.exitCode = 1;
