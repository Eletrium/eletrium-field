const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..','..');
const CODIGO=fs.readFileSync(path.join(ROOT,'Código.js'),'utf8');
const ONDA2=fs.readFileSync(path.join(ROOT,'HMAC_Onda2.js'),'utf8');
const KEY='x';
function bytes(s){return Array.from(crypto.createHmac('sha256',KEY).update(s).digest()).map(b=>b>127?b-256:b)}
function sandbox(now){const D=now===undefined?Date:class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};const s={console,Date:D,PropertiesService:{getScriptProperties(){return{getProperty:k=>k==='SESSAO_HMAC_SECRET'?KEY:null}}},Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(a,v)=>Array.from(crypto.createHash('sha256').update(String(v)).digest()).map(b=>b>127?b-256:b),computeHmacSha256Signature:p=>bytes(p),formatDate(){return'2026-08-21'},getUuid(){return'U'}},SpreadsheetApp:{openById(){throw Error('DOWN')},newDataValidation(){throw Error('DOWN')}},LockService:{getScriptLock(){throw Error('DOWN')}},DriveApp:{},HtmlService:{},ContentService:{},Logger:{log(){}}};vm.createContext(s);vm.runInContext(CODIGO,s);vm.runInContext(ONDA2,s);return s}
let pass=0,fail=0;function ok(n,c,d){if(c){pass++;console.log('OK   '+n)}else{fail++;console.log('FAIL '+n+(d?' -- '+d:''))}}
function shape(r){return['success','status','operation_id','error_code','retryable','blocking_reasons','erro','sucesso','motivos'].every(k=>Object.prototype.hasOwnProperty.call(r,k))}
ok('1a Onda2 sem _recusa propria',!/function\s+_recusa\s*\(/.test(ONDA2));
ok('1b Código com _recusa canonica',/function\s+_recusa\s*\(/.test(CODIGO));
{
 const s=sandbox();s.verificarPosseOS=()=>({ok:true});s.pausarOS=()=>({sucesso:true});s.retomarOS=()=>({sucesso:true});
 const a=s.pausarOSComSessao('OS','TEC','N','M','','OP','D','TOKEN-FORJADO');
 const b=s.getDiariaHoje('TEC','TOKEN-FORJADO');
 ok('2a Onda2 envelope canonico',a.success===false&&a.sucesso===false&&shape(a),JSON.stringify(a));
 ok('2b Onda3 envelope canonico',b.success===false&&b.sucesso===false&&shape(b),JSON.stringify(b));
 ok('2c mesma classificacao para mesma entrada',a.error_code===b.error_code&&!!a.error_code,JSON.stringify({a,b}));
}
{
 const now=Date.now(),old=sandbox(now-25*60*60*1000),t=old.emitirTokenSessao('TEC').token,s=sandbox(now),r=s.getDiariaHoje('TEC',t);
 ok('3a expirado recusado',r.success===false&&/expirado/i.test(r.erro),JSON.stringify(r));
 ok('3b expirado retryable false',r.retryable===false,JSON.stringify(r));
}
{
 const s=sandbox();for(const x of[undefined,null,'','x','a.b','a.b.c',{},[],123]){let r,e=false;try{r=s.verificarTokenSessao(x,'TEC')}catch(_){e=true}ok('4 verifier fail-closed '+JSON.stringify(x),!e&&r&&r.ok===false,JSON.stringify(r))}
 const t=s.emitirTokenSessao('TEC').token;
 ok('4j spoof tecnico recusa',s.verificarTokenSessao(t,'OUTRO').ok===false);
 ok('4k payload corrompido recusa',s.verificarTokenSessao(t.replace(/^TEC\./,'X.'),'TEC').ok===false);
}
console.log(`\nPre-enforcement contrato sessao: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
