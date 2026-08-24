const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const WRAPPER = fs.readFileSync(path.join(ROOT, 'HMAC_Onda2.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'API.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

const calls = [];
const sandbox = {
  console,
  verificarTokenSessao(token, tecnicoId) {
    if (token === 'VALID:' + tecnicoId) {
      return { ok: true, session_error: null, reauth_required: false, tecnico_id: tecnicoId };
    }
    if (token === 'EXPIRED') {
      return { ok: false, erro: 'Token de sessao expirado', session_error: 'TOKEN_EXPIRADO', reauth_required: true };
    }
    return { ok: false, erro: 'Token de sessao invalido', session_error: 'TOKEN_INVALIDO', reauth_required: false };
  },
  verificarPosseOS(osId, tecnicoId) {
    const dono = tecnicoId === 'TEC-1' && osId !== 'OS-SEM-POSSE';
    return dono
      ? { ok: true }
      : { ok: false, erro: 'Tecnico ' + tecnicoId + ' nao tem posse da OS ' + osId };
  },
  _recusa(operationId, erro) {
    return { success: false, operation_id: operationId || null, erro };
  },
  // No runtime Apps Script, HMAC_Onda2.js compartilha o namespace global
  // com Código.js. O contrato REAUTH introduz _recusaSessao em Código.js;
  // este harness isolado precisa materializar o mesmo global em vez de
  // fingir que HMAC_Onda2.js roda sozinho.
  _recusaSessao(operationId, identidade) {
    const erro = identidade && identidade.erro ? identidade.erro : 'Sessao invalida';
    return {
      success: false,
      operation_id: operationId || null,
      erro,
      retryable: false,
      reauth_required: !!(identidade && identidade.reauth_required),
      session_error: identidade && identidade.session_error ? identidade.session_error : null,
    };
  },
  pausarOS(...args) {
    calls.push({ fn: 'pausarOS', args });
    return { sucesso: true, delegated: 'pausarOS' };
  },
  retomarOS(...args) {
    calls.push({ fn: 'retomarOS', args });
    return { sucesso: true, delegated: 'retomarOS' };
  },
};
vm.createContext(sandbox);
vm.runInContext(WRAPPER, sandbox, { filename: 'HMAC_Onda2.js' });

// 1) Compatibilidade transicional: token ausente ainda passa, mas posse e validada.
calls.length = 0;
let r = sandbox.pausarOSComSessao('OS-1', 'TEC-1', 'Nome', 'Almoco', '', 'OP-1', 'DEV-1');
check('1a: pausar sem token delega durante transicao', r.sucesso === true && r.delegated === 'pausarOS');
check('1b: pausar sem token ainda validou/delegou com argumentos legados intactos', calls.length === 1 && calls[0].args[5] === 'OP-1' && calls[0].args[6] === 'DEV-1');

// 2) Token valido do mesmo tecnico passa quando a posse tambem e valida.
calls.length = 0;
r = sandbox.pausarOSComSessao('OS-1', 'TEC-1', 'Nome', 'Almoco', '', 'OP-2', 'DEV-1', 'VALID:TEC-1');
check('2: pausar com token valido e posse valida delega', r.sucesso === true && calls.length === 1);

// 2b) Red-team: token valido NAO substitui posse. Esta combinacao precisa
// bloquear tecnico autenticado tentando operar uma OS que nao possui.
// O teste deve falhar se surgir qualquer early-return apos validar o token
// que pule verificarPosseOS.
calls.length = 0;
r = sandbox.pausarOSComSessao('OS-SEM-POSSE', 'TEC-1', 'Nome', 'Almoco', '', 'OP-2B', 'DEV-1', 'VALID:TEC-1');
check('2b: token valido do proprio tecnico + posse negada bloqueia sem delegar', r.success === false && /nao tem posse/i.test(r.erro) && calls.length === 0, JSON.stringify(r));

// 3) Token invalido bloqueia ANTES da mutacao e NAO pede reauth.
calls.length = 0;
r = sandbox.pausarOSComSessao('OS-1', 'TEC-1', 'Nome', 'Almoco', '', 'OP-3', 'DEV-1', 'FORGED');
check('3a: pausar com token invalido bloqueia sem delegar', r.success === false && /invalido/i.test(r.erro) && calls.length === 0, JSON.stringify(r));
check('3b: token invalido nao sinaliza reauth', r.reauth_required === false && r.retryable === false, JSON.stringify(r));

// 4) Token expirado validamente identificado bloqueia e pede reauth.
calls.length = 0;
r = sandbox.retomarOSComSessao('OS-1', 'TEC-1', 'Nome', 'OP-4', 'DEV-1', 'EXPIRED');
check('4a: retomar com token expirado bloqueia', r.success === false && /expirado/i.test(r.erro) && calls.length === 0, JSON.stringify(r));
check('4b: expirado sinaliza reauth sem retry tecnico', r.reauth_required === true && r.retryable === false && r.session_error === 'TOKEN_EXPIRADO', JSON.stringify(r));

// 5) Token de outro tecnico nao casa com tecnicoId informado.
calls.length = 0;
r = sandbox.retomarOSComSessao('OS-1', 'TEC-1', 'Nome', 'OP-5', 'DEV-1', 'VALID:TEC-2');
check('5: retomar com token de outro tecnico bloqueia', r.success === false && r.reauth_required === false && calls.length === 0, JSON.stringify(r));

// 6) Posse sempre obrigatoria, mesmo durante transicao sem token.
calls.length = 0;
r = sandbox.pausarOSComSessao('OS-1', 'TEC-2', 'Nome 2', 'Almoco', '', 'OP-6', 'DEV-2');
check('6: pausar sem posse bloqueia mesmo sem token', r.success === false && /nao tem posse/i.test(r.erro) && calls.length === 0, JSON.stringify(r));

// 7) Retomada valida preserva argumentos legados.
calls.length = 0;
r = sandbox.retomarOSComSessao('OS-1', 'TEC-1', 'Nome', 'OP-7', 'DEV-1', 'VALID:TEC-1');
check('7a: retomar com token valido delega', r.sucesso === true && r.delegated === 'retomarOS');
check('7b: retomar preserva operationId/dispositivoId', calls.length === 1 && calls[0].args[3] === 'OP-7' && calls[0].args[4] === 'DEV-1');

// 8) Dispatcher deve encaminhar token nos indices trailing aprovados.
// Carregar API.js nao executa Apps Script; os globals so sao usados quando
// as respectivas funcoes sao chamadas. Substituimos os wrappers por spies.
vm.runInContext(API, sandbox, { filename: 'API.js' });
let pauseDispatchArgs = null;
let resumeDispatchArgs = null;
sandbox.pausarOSComSessao = (...args) => { pauseDispatchArgs = args; return { ok: true }; };
sandbox.retomarOSComSessao = (...args) => { resumeDispatchArgs = args; return { ok: true }; };

sandbox.executarAcao('pausarOS', ['OS-1','TEC-1','Nome','Motivo','OS-I','OP-D','DEV-D','TOKEN-P']);
check('8: dispatcher pausarOS encaminha p[7] como token', pauseDispatchArgs && pauseDispatchArgs[7] === 'TOKEN-P' && pauseDispatchArgs[5] === 'OP-D' && pauseDispatchArgs[6] === 'DEV-D');

sandbox.executarAcao('retomarOS', ['OS-1','TEC-1','Nome','OP-R','DEV-R','TOKEN-R']);
check('9: dispatcher retomarOS encaminha p[5] como token', resumeDispatchArgs && resumeDispatchArgs[5] === 'TOKEN-R' && resumeDispatchArgs[3] === 'OP-R' && resumeDispatchArgs[4] === 'DEV-R');

console.log(`\nOnda 2: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
