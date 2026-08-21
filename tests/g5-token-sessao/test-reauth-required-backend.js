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

// 1. Sweep estrutural: todo guard de sessao usa _recusaSessao, nunca _recusa direta.
const runtime=CODIGO+'\n'+ONDA2;
const oldGuards=(runtime.match(/if\s*\(!identidade\.ok\)\s*return\s+_recusa\([^;]*identidade\.erro\);/g)||[]).length;
const sessionRefusals=(runtime.match(/if\s*\(!identidade\.ok\)\s*return\s+_recusaSessao\(/g)||[]).length;
ok('1a nenhum guard de sessao usa _recusa direta',oldGuards===0,'old='+oldGuards);
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

// 5. Transicao preservada: token continua opcional e contrato segue v1.
ok('5a FIELD_API_CONTRACT continua v1',/const\s+FIELD_API_CONTRACT\s*=\s*['"]v1['"]/.test(CODIGO));
ok('5b getOSsPendentes token trailing opcional',/function\s+getOSsPendentesKMFinal\(tecnicoId,\s*token\)/.test(CODIGO));
ok('5c criarOSEmergencia token aditivo no objeto',/const\s+token\s*=\s*dados\s*&&\s*dados\.token/.test(CODIGO));

console.log(`\nREAUTH backend: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
