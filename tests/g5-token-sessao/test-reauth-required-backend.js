const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..','..');
const CODIGO=fs.readFileSync(path.join(ROOT,'Código.js'),'utf8');
const ONDA2=fs.readFileSync(path.join(ROOT,'HMAC_Onda2.js'),'utf8');
const API=fs.readFileSync(path.join(ROOT,'API.js'),'utf8');
const KEY='test-key-reauth';

function hmacBytes(payload){
  return Array.from(crypto.createHmac('sha256',KEY).update(String(payload)).digest()).map(b=>b>127?b-256:b);
}
function sandbox(now){
  const D=now===undefined?Date:class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};
  const s={
    console,Date:D,
    PropertiesService:{getScriptProperties(){return{getProperty:k=>k==='SESSAO_HMAC_SECRET'?KEY:null}}},
    Utilities:{
      DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
      computeDigest:(a,v)=>Array.from(crypto.createHash('sha256').update(String(v)).digest()).map(b=>b>127?b-256:b),
      computeHmacSha256Signature:p=>hmacBytes(p),
      formatDate(){return'2026-08-21'},getUuid(){return'U'},base64Decode(){return[]},newBlob(){return{}}
    },
    SpreadsheetApp:{openById(){throw Error('DOWN')}},
    LockService:{getScriptLock(){throw Error('DOWN')}},DriveApp:{},HtmlService:{},ContentService:{},Logger:{log(){}}
  };
  vm.createContext(s);vm.runInContext(CODIGO,s);vm.runInContext(ONDA2,s);vm.runInContext(API,s);return s;
}
let pass=0,fail=0;
function ok(name,cond,detail){if(cond){pass++;console.log('OK   '+name)}else{fail++;console.log('FAIL '+name+(detail?' -- '+detail:''))}}
function canonical(r){return r&&r.success===false&&r.sucesso===false&&r.retryable===false&&typeof r.reauth_required==='boolean'&&Array.isArray(r.blocking_reasons)}

// 1. E3-26 — sweep estrutural: todo guard de sessao usa _recusaSessao,
// nunca _recusa direta. Um unico guard antigo restante deve falhar o gate.
const runtime=CODIGO+'\n'+ONDA2;
const oldGuards=(runtime.match(/if\s*\(!identidade\.ok\)\s*return\s+_recusa\([^;]*identidade\.erro\);/g)||[]).length;
const sessionRefusals=(runtime.match(/if\s*\(!identidade\.ok\)\s*return\s+_recusaSessao\(/g)||[]).length;
ok('1a E3-26 nenhum guard de sessao usa _recusa direta',oldGuards===0,'old='+oldGuards);
ok('1b 19 guards de sessao usam _recusaSessao',sessionRefusals===19,'count='+sessionRefusals);
ok('1c _recusaSessao existe uma vez em Código.js',(CODIGO.match(/function\s+_recusaSessao\s*\(/g)||[]).length===1);

// 2. Metadado estruturado do verifier e regra EXCLUSIVA de expiracao.
const now=Date.now();
const mint=sandbox(now-25*60*60*1000);
const expired=mint.emitirTokenSessao('TEC-1').token;
const s=sandbox(now);
const valid=s.emitirTokenSessao('TEC-1').token;
const cases=[
  ['valido',valid,'TEC-1',true,false,null],
  ['ausente',undefined,'TEC-1',false,false,'TOKEN_AUSENTE'],
  ['vazio','', 'TEC-1',false,false,'TOKEN_AUSENTE'],
  ['malformado','abc','TEC-1',false,false,'TOKEN_MALFORMADO'],
  ['payload corrompido',valid.replace(/^TEC-1\./,'X.'),'TEC-1',false,false,'ASSINATURA_INVALIDA'],
  ['assinatura errada',valid.slice(0,-2)+'00','TEC-1',false,false,'ASSINATURA_INVALIDA'],
  ['spoof X->Y',valid,'TEC-2',false,false,'IDENTIDADE_DIVERGENTE'],
  ['expirado',expired,'TEC-1',false,true,'TOKEN_EXPIRADO'],
  ['expirado com spoof continua spoof',expired,'TEC-2',false,false,'IDENTIDADE_DIVERGENTE']
];
for(const [name,tok,tec,expectedOk,reauth,sessionError] of cases){
  let r,threw=false;try{r=s.verificarTokenSessao(tok,tec)}catch(e){threw=true;r={erro:e.message}}
  ok('2 '+name+' nao lanca',!threw,JSON.stringify(r));
  ok('2 '+name+' ok',r&&r.ok===expectedOk,JSON.stringify(r));
  ok('2 '+name+' reauth',r&&r.reauth_required===reauth,JSON.stringify(r));
  if(sessionError!==null) ok('2 '+name+' session_error',r&&r.session_error===sessionError,JSON.stringify(r));
}

// 3. Envelope central: reauth nunca vira retry tecnico.
const expId=s.verificarTokenSessao(expired,'TEC-1');
const expEnvelope=s._recusaSessao('OP-1',expId);
ok('3a envelope expirado canonico',canonical(expEnvelope),JSON.stringify(expEnvelope));
ok('3b expirado sinaliza reauth',expEnvelope.reauth_required===true,JSON.stringify(expEnvelope));
ok('3c expirado retryable false',expEnvelope.retryable===false,JSON.stringify(expEnvelope));
const spoofEnvelope=s._recusaSessao('OP-2',s.verificarTokenSessao(valid,'TEC-2'));
ok('3d spoof nao sinaliza reauth',canonical(spoofEnvelope)&&spoofEnvelope.reauth_required===false,JSON.stringify(spoofEnvelope));

// 4. Gaps do sweep: leitura de KM e OS emergencial agora recusam sessao expirada antes de tocar dados.
let rKm,rEmg;
try{rKm=s.getOSsPendentesKMFinal('TEC-1',expired)}catch(e){rKm={threw:e.message}}
try{rEmg=s.criarOSEmergencia({tecnicoId:'TEC-1',operationId:'OP-EMG',token:expired})}catch(e){rEmg={threw:e.message}}
ok('4a getOSsPendentesKMFinal protegido',rKm&&rKm.reauth_required===true&&rKm.retryable===false,JSON.stringify(rKm));
ok('4b criarOSEmergencia protegida',rEmg&&rEmg.reauth_required===true&&rEmg.retryable===false,JSON.stringify(rEmg));
ok('4c dispatcher encaminha token para KM pendente',/getOSsPendentesKMFinal\(p\[0\],\s*p\[1\]\)/.test(API));

// 4d. Achado da Cowork 2 (revisao de coerencia do PR#6): cadastrarOuEditarVeiculo
// e' a unica funcao na mesma categoria de iniciarOS/encerrarOS (escrita sem
// operationId) que nao tinha exercicio de runtime nem justificativa
// documentada para essa ausencia -- quebrava em silencio o proprio criterio
// que a secao 7 usa pra explicar as exclusoes. Formato leve (igual 4a/4b):
// so reauth_required/retryable, sem sweep de operation_id, porque a funcao
// genuinamente nao carrega esse parametro.
let rVei;
try{rVei=s.cadastrarOuEditarVeiculo('TEC-1','Nome','Carro','ABC1D23','Modelo',expired)}catch(e){rVei={threw:e.message}}
ok('4d cadastrarOuEditarVeiculo protegida',rVei&&rVei.reauth_required===true&&rVei.retryable===false,JSON.stringify(rVei));

// 5. Transicao preservada: token continua opcional e contrato segue v1.
ok('5a FIELD_API_CONTRACT continua v1',/const\s+FIELD_API_CONTRACT\s*=\s*['"]v1['"]/.test(CODIGO));
ok('5b getOSsPendentes token trailing opcional',/function\s+getOSsPendentesKMFinal\(tecnicoId,\s*token\)/.test(CODIGO));
ok('5c criarOSEmergencia token aditivo no objeto',/const\s+token\s*=\s*dados\s*&&\s*dados\.token/.test(CODIGO));

// 6. E3-34/E3-35 — sessao valida NAO substitui autorizacao de posse.
// PR #1 ja cobria explicitamente pausarOS; aqui repetimos no contrato REAUTH
// e adicionamos o simetrico de retomarOS, que nao tinha caso dedicado.
const calls=[];
s.verificarPosseOS=(osId,tecnicoId)=>({ok:false,erro:'Tecnico '+tecnicoId+' nao tem posse da OS '+osId});
s.pausarOS=(...args)=>{calls.push({fn:'pausarOS',args});return{sucesso:true}};
s.retomarOS=(...args)=>{calls.push({fn:'retomarOS',args});return{sucesso:true}};

calls.length=0;
const rPause=s.pausarOSComSessao('OS-NEGADA','TEC-1','Nome','Almoco','','OP-E3-34','DEV-1',valid);
ok('6a E3-34 pausar: token valido + posse negada bloqueia',rPause&&rPause.success===false&&/nao tem posse/i.test(rPause.erro),JSON.stringify(rPause));
ok('6b E3-34 pausar: zero delegacao',calls.length===0,JSON.stringify(calls));

calls.length=0;
const rResume=s.retomarOSComSessao('OS-NEGADA','TEC-1','Nome','OP-E3-35','DEV-1',valid);
ok('6c E3-35 retomar: token valido + posse negada bloqueia',rResume&&rResume.success===false&&/nao tem posse/i.test(rResume.erro),JSON.stringify(rResume));
ok('6d E3-35 retomar: zero delegacao',calls.length===0,JSON.stringify(calls));

// 7. E3-XX (achado do red-team independente do PR#6) — item 9 do contrato
// ("escrita expirada preserva operationId/payload, sem retry tecnico") so
// tinha exercicio de runtime pra 2 dos 19 guards (criarOSEmergencia,
// getOSsPendentesKMFinal). Aqui cobrimos, com execucao real (nao so
// sweep estrutural), TODOS os guards de sessao que carregam operationId
// -- os que gravam algo via envelope de idempotencia. iniciarOS/encerrarOS
// ficam fora de proposito: nunca tiveram parametro operationId (sempre
// usam _recusaSessao(null, identidade)), entao "preservar operationId"
// nao se aplica a eles -- documentado, nao esquecido.
function checkWriteGuardExpired(label, invoke, opId){
  let r,threw=null;
  try{r=invoke()}catch(e){threw=e.message}
  ok(label+': nao chega no downstream (SpreadsheetApp) com token expirado',threw!==('DOWN'),'threw='+threw);
  ok(label+': reauth_required=true',r&&r.reauth_required===true,JSON.stringify(r));
  ok(label+': retryable=false',r&&r.retryable===false,JSON.stringify(r));
  ok(label+': operation_id preservado ('+opId+')',r&&r.operation_id===opId,JSON.stringify(r));
}

checkWriteGuardExpired('salvarArquivoOS',
  ()=>s.salvarArquivoOS('OS-1','TEC-1','Laudo_URL','b64data','image/png','arq.png','OP-W1','DEV-1',expired),'OP-W1');

checkWriteGuardExpired('confirmarSegurancaPreExecucao',
  ()=>s.confirmarSegurancaPreExecucao('OS-1','TEC-1',{epi:true,aterramento:true,bloqueio_energia:true,sinalizacao_area:true},false,'OP-W2','DEV-1',expired),'OP-W2');

checkWriteGuardExpired('salvarSelfieEPI',
  ()=>s.salvarSelfieEPI('OS-1','TEC-1','b64data','image/png','{}','diario','OP-W3','DEV-1',expired),'OP-W3');

checkWriteGuardExpired('registrarInicioDia',
  ()=>s.registrarInicioDia('TEC-1','Nome',false,'','','OP-W4','DEV-1',expired),'OP-W4');

checkWriteGuardExpired('registrarFimDia',
  ()=>s.registrarFimDia('TEC-1','','OP-W5','DEV-1',expired),'OP-W5');

checkWriteGuardExpired('salvarResposta',
  ()=>s.salvarResposta('OS-1','SP-1','PERG-1','texto','resp','','Nome',false,'OP-W6','DEV-1','TEC-1',expired),'OP-W6');

checkWriteGuardExpired('fecharFaseChecklist',
  ()=>s.fecharFaseChecklist('OS-1','TEC-1','Execução','OP-W7','DEV-1',expired),'OP-W7');

checkWriteGuardExpired('registrarMovimentoFerramental',
  ()=>s.registrarMovimentoFerramental('OS-1','TEC-1','PAT-001','Carga',true,'','OP-W8','DEV-1',expired),'OP-W8');

checkWriteGuardExpired('registrarKMFinalPendente',
  ()=>s.registrarKMFinalPendente('OS-1','TEC-1',100,'','','OP-W9','DEV-1',expired),'OP-W9');

// criarOSEmergencia ja tinha exercicio (secao 4) mas so checava reauth/
// retryable, nao operation_id -- fechando a lacuna aqui tambem.
checkWriteGuardExpired('criarOSEmergencia (operation_id)',
  ()=>s.criarOSEmergencia({tecnicoId:'TEC-1',operationId:'OP-W10',token:expired}),'OP-W10');

// pausarOS/retomarOS (HMAC_Onda2.js) -- secao 6 ja provou posse negada
// com token VALIDO; aqui e' o caso simetrico que faltava, token EXPIRADO
// (identidade falha antes mesmo de checar posse). verificarPosseOS e
// pausarOS/retomarOS continuam sobrescritos (spies) da secao 6 -- serve
// tambem pra confirmar zero delegacao.
calls.length=0;
checkWriteGuardExpired('pausarOSComSessao',
  ()=>s.pausarOSComSessao('OS-1','TEC-1','Nome','Almoco','','OP-W11','DEV-1',expired),'OP-W11');
ok('pausarOSComSessao (expirado): zero delegacao',calls.length===0,JSON.stringify(calls));

calls.length=0;
checkWriteGuardExpired('retomarOSComSessao',
  ()=>s.retomarOSComSessao('OS-1','TEC-1','Nome','OP-W12','DEV-1',expired),'OP-W12');
ok('retomarOSComSessao (expirado): zero delegacao',calls.length===0,JSON.stringify(calls));

// 8. Achado da Cowork 2 (leitura estatica de test-frente-d-migracao-
// restante.js): os cenarios de idempotencia daquele arquivo nunca
// combinam token + posse negada + RETRY com o MESMO operationId --
// fecha a lacuna entre aquele arquivo (so idempotencia, sem sessao) e
// a secao 6 daqui (so guard, sem retry). Confirma que o guard de
// sessao+posse roda em TODA chamada, inclusive na 2a tentativa com o
// mesmo operationId -- nao ha estado/cache no guard em si que possa
// deixar passar no retry (o guard roda ANTES de qualquer envelope de
// idempotencia; quem cacheia por operationId e' pausarOS/retomarOS
// legado, nunca alcancado aqui). verificarPosseOS/pausarOS/retomarOS
// continuam sobrescritos (spies) da secao 6.
calls.length=0;
const rPause1=s.pausarOSComSessao('OS-NEGADA','TEC-1','Nome','Almoco','','OP-RETRY-1','DEV-1',valid);
const rPause2=s.pausarOSComSessao('OS-NEGADA','TEC-1','Nome','Almoco','','OP-RETRY-1','DEV-1',valid);
ok('8a pausar: sessao valida + posse negada bloqueia na 1a chamada',rPause1&&rPause1.success===false&&/nao tem posse/i.test(rPause1.erro),JSON.stringify(rPause1));
ok('8b pausar: retry com o MESMO operationId tambem bloqueia (guard nao depende de cache)',rPause2&&rPause2.success===false&&/nao tem posse/i.test(rPause2.erro),JSON.stringify(rPause2));
ok('8c pausar: zero delegacao nas 2 chamadas juntas',calls.length===0,JSON.stringify(calls));

calls.length=0;
const rResume1=s.retomarOSComSessao('OS-NEGADA','TEC-1','Nome','OP-RETRY-2','DEV-1',valid);
const rResume2=s.retomarOSComSessao('OS-NEGADA','TEC-1','Nome','OP-RETRY-2','DEV-1',valid);
ok('8d retomar: sessao valida + posse negada bloqueia na 1a chamada',rResume1&&rResume1.success===false&&/nao tem posse/i.test(rResume1.erro),JSON.stringify(rResume1));
ok('8e retomar: retry com o MESMO operationId tambem bloqueia',rResume2&&rResume2.success===false&&/nao tem posse/i.test(rResume2.erro),JSON.stringify(rResume2));
ok('8f retomar: zero delegacao nas 2 chamadas juntas',calls.length===0,JSON.stringify(calls));

console.log(`\nREAUTH backend: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
