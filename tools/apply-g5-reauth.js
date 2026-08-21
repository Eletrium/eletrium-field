const fs=require('fs');

const CODIGO='Código.js';
const ONDA2='HMAC_Onda2.js';
const API='API.js';
let codigo=fs.readFileSync(CODIGO,'utf8');
let onda2=fs.readFileSync(ONDA2,'utf8');
let api=fs.readFileSync(API,'utf8');

function count(text,re){return (text.match(re)||[]).length}
function assert(cond,msg){if(!cond)throw new Error(msg)}
function replaceOnce(text,needle,replacement,label){
  const n=text.split(needle).length-1;
  assert(n===1,label+': esperado 1 match, encontrado '+n);
  return text.replace(needle,replacement);
}

// Evidencia de grep REAL no checkout completo do runner (run 32525512192):
// o levantamento por snippets subestimava a quantidade. O grep executavel
// encontrou 83 call-sites `return _recusa(...)` em Código.js+HMAC_Onda2.js.
const recusaCodigoAntes=count(codigo,/return\s+_recusa\s*\(/g);
const recusaOnda2Antes=count(onda2,/return\s+_recusa\s*\(/g);
const recusaCallsAntes=recusaCodigoAntes+recusaOnda2Antes;
console.log('SWEEP _recusa runtime:',JSON.stringify({codigo:recusaCodigoAntes,onda2:recusaOnda2Antes,total:recusaCallsAntes}));
assert(recusaCallsAntes===83,'sweep _recusa mudou: esperado 83 call-sites, encontrado '+recusaCallsAntes);

// 16 guards em Código.js + 1 no helper Onda2 — segunda premissa a ser
// confirmada pelo runner antes de qualquer escrita prospectiva.
const guardOld=/if\s*\(!identidade\.ok\)\s*return\s+_recusa\(([^,\n]+),\s*identidade\.erro\);/g;
const guardsCodigo=count(codigo,guardOld);
const guardsOnda2=count(onda2,guardOld);
console.log('SWEEP guards sessao:',JSON.stringify({codigo:guardsCodigo,onda2:guardsOnda2,total:guardsCodigo+guardsOnda2}));
assert(guardsCodigo===16,'guards Código.js: esperado 16, encontrado '+guardsCodigo);
assert(guardsOnda2===1,'guards HMAC_Onda2.js: esperado 1, encontrado '+guardsOnda2);

codigo=codigo.replace(guardOld,(m,op)=>`if (!identidade.ok) return _recusaSessao(${op.trim()}, identidade);`);
onda2=onda2.replace(guardOld,(m,op)=>`if (!identidade.ok) return _recusaSessao(${op.trim()}, identidade);`);

// _recusaSessao central, adjacente ao envelope canonico.
assert(!/function\s+_recusaSessao\s*\(/.test(codigo),'_recusaSessao ja existe em Código.js');
const recusaTail='  return Object.assign(base, extras);\n}\n';
assert(codigo.split(recusaTail).length-1===1,'nao encontrou final unico de _recusa');
const recusaSessao=`${recusaTail}\n// _recusaSessao — adaptador unico entre identidade HMAC e envelope canonico.\n// `+'`retryable`'+` continua reservado a retry tecnico; reautenticacao e sinal\n// separado. O Field so deve abrir login automaticamente quando\n// reauth_required===true.\nfunction _recusaSessao(operationId, identidade) {\n  identidade = identidade || {\n    ok: false,\n    session_error: 'SESSAO_INVALIDA',\n    erro: 'Sessao invalida',\n    reauth_required: false\n  };\n  return _recusa(operationId, identidade.erro || 'Sessao invalida', {\n    retryable: false,\n    reauth_required: identidade.reauth_required === true,\n    session_error: identidade.session_error || 'SESSAO_INVALIDA'\n  });\n}\n`;
codigo=codigo.replace(recusaTail,recusaSessao);

// Verifier estruturado: estrutura -> assinatura -> identidade -> tempo.
const verifierStart=codigo.indexOf('function verificarTokenSessao(token, tecnicoIdEsperado) {');
assert(verifierStart>=0,'inicio verificarTokenSessao nao encontrado');
const verifierEndMarker='\n}\n\n// Ultima linha (a mais recente, append-only) para este Oferta_ID';
const verifierEnd=codigo.indexOf(verifierEndMarker,verifierStart);
assert(verifierEnd>verifierStart,'fim verificarTokenSessao nao encontrado');
const newVerifier=`function verificarTokenSessao(token, tecnicoIdEsperado) {\n  const segredo = PropertiesService.getScriptProperties().getProperty(SESSAO_SEGREDO_PROPERTY);\n  const falha = (sessionError, erro, reauthRequired) => ({\n    ok: false,\n    session_error: sessionError,\n    erro: erro,\n    reauth_required: reauthRequired === true\n  });\n\n  if (!segredo) return falha('CONFIGURACAO_AUSENTE', 'Sessao indisponivel: segredo HMAC nao configurado', false);\n  if (!token) return falha('TOKEN_AUSENTE', 'Token de sessao ausente', false);\n\n  const partes = String(token).split('.');\n  if (partes.length < 3) return falha('TOKEN_MALFORMADO', 'Token de sessao malformado', false);\n  const sig = partes.pop();\n  const expiraEm = partes.pop();\n  const tecnicoIdToken = partes.join('.');\n  if (!tecnicoIdToken || !/^\\d+$/.test(String(expiraEm))) {\n    return falha('TOKEN_MALFORMADO', 'Token de sessao malformado', false);\n  }\n\n  // 1) assinatura valida prova que payload/expiracao vieram de quem possui\n  // o segredo. Token forjado nunca pode induzir UX de re-login normal.\n  const payload = tecnicoIdToken + '.' + expiraEm;\n  const sigEsperada = _bytesParaHex(Utilities.computeHmacSha256Signature(payload, segredo));\n  if (!_hexIgualConstante(sigEsperada.toLowerCase(), String(sig).trim().toLowerCase())) {\n    return falha('ASSINATURA_INVALIDA', 'Token de sessao invalido', false);\n  }\n\n  // 2) identidade ANTES do relogio: token autentico de X usado como Y e\n  // spoof, mesmo se esse token tambem estiver expirado.\n  if (String(tecnicoIdToken) !== String(tecnicoIdEsperado)) {\n    return falha('IDENTIDADE_DIVERGENTE', 'Token de sessao nao corresponde ao tecnico informado', false);\n  }\n\n  // 3) so depois de estrutura+assinatura+identidade confirmadas, expiracao\n  // vira rotina recuperavel por reautenticacao.\n  if (Math.floor(Date.now() / 1000) > Number(expiraEm)) {\n    return falha('TOKEN_EXPIRADO', 'Token de sessao expirado', true);\n  }\n\n  return {\n    ok: true,\n    session_error: null,\n    reauth_required: false,\n    tecnico_id: String(tecnicoIdToken),\n    expira_em: Number(expiraEm)\n  };\n}`;
codigo=codigo.slice(0,verifierStart)+newVerifier+codigo.slice(verifierEnd+2);

// Gap 1 do sweep: leitura publica especifica por tecnico sem token.
const kmOld=`function getOSsPendentesKMFinal(tecnicoId) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`;
const kmNew=`function getOSsPendentesKMFinal(tecnicoId, token) {\n  if (token !== undefined) {\n    const identidade = verificarTokenSessao(token, tecnicoId);\n    if (!identidade.ok) return _recusaSessao(null, identidade);\n  }\n  const ss = SpreadsheetApp.openById(SHEET_ID);`;
codigo=replaceOnce(codigo,kmOld,kmNew,'getOSsPendentesKMFinal');
api=replaceOnce(api,"return getOSsPendentesKMFinal(p[0]);","return getOSsPendentesKMFinal(p[0], p[1]);",'dispatcher getOSsPendentesKMFinal');

// Gap 2 do sweep: escrita em nome do tecnico antes de existir OS/posse.
const emgOld=`function criarOSEmergencia(dados) {\n  const operationId = dados && dados.operationId;\n  const dispositivoId = dados && dados.dispositivoId;\n  return executarIdempotente(operationId, 'APONTAMENTO', '', dados && dados.tecnicoId, dispositivoId, () => {`;
const emgNew=`function criarOSEmergencia(dados) {\n  const operationId = dados && dados.operationId;\n  const dispositivoId = dados && dados.dispositivoId;\n  const tecnicoId = dados && dados.tecnicoId;\n  const token = dados && dados.token;\n  if (token !== undefined) {\n    const identidade = verificarTokenSessao(token, tecnicoId);\n    if (!identidade.ok) return _recusaSessao(operationId, identidade);\n  }\n  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {`;
codigo=replaceOnce(codigo,emgOld,emgNew,'criarOSEmergencia');

// Pos-condicoes: 19 guards (17 existentes + 2 gaps), zero guard antigo.
const runtimeDepois=codigo+'\n'+onda2;
const oldDepois=count(runtimeDepois,/if\s*\(!identidade\.ok\)\s*return\s+_recusa\([^;]*identidade\.erro\);/g);
const novosDepois=count(runtimeDepois,/if\s*\(!identidade\.ok\)\s*return\s+_recusaSessao\(/g);
assert(oldDepois===0,'restaram guards antigos: '+oldDepois);
assert(novosDepois===19,'esperado 19 guards _recusaSessao, encontrado '+novosDepois);
assert(count(codigo,/function\s+_recusaSessao\s*\(/g)===1,'_recusaSessao deve existir uma vez');
assert(/const\s+FIELD_API_CONTRACT\s*=\s*'v1'/.test(codigo),'FIELD_API_CONTRACT nao pode mudar nesta etapa');

fs.writeFileSync(CODIGO,codigo);
fs.writeFileSync(ONDA2,onda2);
fs.writeFileSync(API,api);
if(fs.existsSync('HMAC_Reauth.js'))fs.unlinkSync('HMAC_Reauth.js');

console.log(JSON.stringify({
  sweep_recusa_codigo:recusaCodigoAntes,
  sweep_recusa_onda2:recusaOnda2Antes,
  sweep_recusa_total:recusaCallsAntes,
  session_guards_before:guardsCodigo+guardsOnda2,
  session_guards_after:novosDepois,
  old_session_guards_after:oldDepois,
  field_api_contract:'v1'
},null,2));
