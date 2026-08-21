const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const CODIGO = fs.readFileSync(path.join(ROOT, 'Código.js'), 'utf8');
const ONDA2 = fs.readFileSync(path.join(ROOT, 'HMAC_Onda2.js'), 'utf8');
const SECRET = 'segredo-preenforcement-teste-nao-real';

function hmacBytes(payload, secret) {
  const h = crypto.createHmac('sha256', secret).update(payload).digest();
  return Array.from(h).map(b => (b > 127 ? b - 256 : b));
}

function makeSandbox(nowMs) {
  const FakeDate = nowMs === undefined ? Date : class extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  };
  const sandbox = {
    console,
    Date: FakeDate,
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: key => key === 'SESSAO_HMAC_SECRET' ? SECRET : null };
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algo, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
      formatDate() { return '2026-08-21'; },
      getUuid() { return 'UUID-TEST'; }
    },
    SpreadsheetApp: { openById() { throw new Error('SPREADSHEET_DOWNSTREAM'); }, newDataValidation() { throw new Error('SPREADSHEET_DOWNSTREAM'); } },
    LockService: { getScriptLock() { throw new Error('LOCK_DOWNSTREAM'); } },
    DriveApp: {}, HtmlService: {}, ContentService: {}, Logger: { log() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: 'Código.js' });
  vm.runInContext(ONDA2, sandbox, { filename: 'HMAC_Onda2.js' });
  return sandbox;
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

function sameCanonicalShape(a, b) {
  const keys = ['success','status','operation_id','error_code','retryable','blocking_reasons','erro','sucesso','motivos'];
  return keys.every(k => Object.prototype.hasOwnProperty.call(a, k) && Object.prototype.hasOwnProperty.call(b, k));
}

check('1a: HMAC_Onda2.js nao define _recusa propria', !/function\s+_recusa\s*\(/.test(ONDA2));
check('1b: Código.js define _recusa canonica', /function\s+_recusa\s*\(/.test(CODIGO));

{
  const s = makeSandbox();
  s.verificarPosseOS = () => ({ ok: true });
  s.pausarOS = () => ({ sucesso: true });
  s.retomarOS = () => ({ sucesso: true });

  const r2 = s.pausarOSComSessao('OS-1','TEC-1','Nome','Motivo','', 'OP-2','DEV-1','TOKEN-FORJADO');
  const r3 = s.getDiariaHoje('TEC-1','TOKEN-FORJADO');

  check('2a: Onda 2 recusa no contrato canonico', r2 && r2.success === false && r2.sucesso === false, JSON.stringify(r2));
  check('2b: Onda 3 recusa no contrato canonico', r3 && r3.success === false && r3.sucesso === false, JSON.stringify(r3));
  check('2c: Onda 2/3 expõem os mesmos 9 campos canonicos/compat', sameCanonicalShape(r2, r3), JSON.stringify({r2, r3}));
  check('2d: ambas recusas de token invalido classificam PAYLOAD_INVALIDO', r2.error_code === 'PAYLOAD_INVALIDO' && r3.error_code === 'PAYLOAD_INVALIDO', JSON.stringify({r2, r3}));
}

{
  const now = Date.now();
  const old = makeSandbox(now - 25 * 60 * 60 * 1000);
  const expired = old.emitirTokenSessao('TEC-1').token;
  const s = makeSandbox(now);
  const r = s.getDiariaHoje('TEC-1', expired);
  check('3a: expirado e recusado', r && r.success === false && /expirado/i.test(r.erro), JSON.stringify(r));
  check('3b: expirado permanece retryable=false (sem auto-loop)', r.retryable === false, JSON.stringify(r));
}

{
  const s = makeSandbox();
  const samples = [undefined, null, '', 'x', 'a.b', 'a.b.c', {}, [], ['a','b','c'], 12345];
  for (const sample of samples) {
    let threw = false;
    let result;
    try { result = s.verificarTokenSessao(sample, 'TEC-1'); }
    catch (e) { threw = true; }
    check('4: verifier nao lanca para ' + JSON.stringify(sample), !threw && result && result.ok === false, JSON.stringify(result));
  }

  const token = s.emitirTokenSessao('TEC-1').token;
  const corruptPayload = token.replace(/^TEC-1\./, 'TEC-9.');
  const wrongTech = s.verificarTokenSessao(token, 'TEC-2');
  const corrupt = s.verificarTokenSessao(corruptPayload, 'TEC-1');
  check('4k: token valido usado como outro tecnico recusa', wrongTech && wrongTech.ok === false, JSON.stringify(wrongTech));
  check('4l: payload corrompido recusa', corrupt && corrupt.ok === false, JSON.stringify(corrupt));
}

console.log(`\nPre-enforcement contrato sessao: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
