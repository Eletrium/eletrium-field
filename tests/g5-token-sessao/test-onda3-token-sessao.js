const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const CODIGO = fs.readFileSync('C:\\EletriumERP\\pwa\\Código.js', 'utf8');
const API = fs.readFileSync('C:\\EletriumERP\\pwa\\API.js', 'utf8');
const SECRET = 'segredo-sessao-onda3-teste-nao-real';
const DOWNSTREAM = 'DOWNSTREAM_REACHED';

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
      computeDigest: (algo, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (payload, secret) => hmacBytes(payload, secret),
      formatDate() { throw new Error(DOWNSTREAM); },
      getUuid() { return 'UUID-TEST'; }
    },
    SpreadsheetApp: {
      openById() { throw new Error(DOWNSTREAM); },
      newDataValidation() { throw new Error(DOWNSTREAM); }
    },
    LockService: { getScriptLock() { throw new Error(DOWNSTREAM); } },
    DriveApp: {},
    HtmlService: {},
    ContentService: {},
    Logger: { log() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: 'Código.js' });
  vm.runInContext(API, sandbox, { filename: 'API.js' });
  return sandbox;
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

function reachesDownstream(fn) {
  try { fn(); return false; }
  catch (e) { return e && e.message === DOWNSTREAM; }
}

function isRejected(result) {
  return result && result.success === false && result.sucesso === false;
}

function runGuardMatrix(label, invoke) {
  const now = Date.now();
  const s = makeSandbox(now);
  const tokenOk = s.emitirTokenSessao('TEC-1').token;
  const tokenOutro = s.emitirTokenSessao('TEC-2').token;
  const tokenForjado = tokenOk.slice(0, -2) + (tokenOk.endsWith('00') ? '11' : '00');

  check(label + ' 1/5 sem token preserva transicao', reachesDownstream(() => invoke(s, undefined)));
  check(label + ' 2/5 token valido aceita identidade', reachesDownstream(() => invoke(s, tokenOk)));
  check(label + ' 3/5 assinatura errada recusa antes do downstream', isRejected(invoke(s, tokenForjado)));
  check(label + ' 4/5 token de X alegando Y recusa', isRejected(invoke(s, tokenOutro)));

  const old = makeSandbox(now - 25 * 60 * 60 * 1000);
  const expirado = old.emitirTokenSessao('TEC-1').token;
  check(label + ' 5/5 token expirado recusa', isRejected(invoke(s, expirado)));
}

runGuardMatrix('registrarInicioDia', (s, token) => s.registrarInicioDia('TEC-1', 'Nome', false, '', '', undefined, undefined, token));
runGuardMatrix('registrarFimDia', (s, token) => s.registrarFimDia('TEC-1', '', undefined, undefined, token));
runGuardMatrix('cadastrarOuEditarVeiculo', (s, token) => s.cadastrarOuEditarVeiculo('TEC-1', 'Nome', 'Carro', 'ABC1D23', 'Modelo', token));
runGuardMatrix('getDiariaTecnico', (s, token) => s.getDiariaTecnico('TEC-1', token));
runGuardMatrix('getVeiculoDoTecnico', (s, token) => s.getVeiculoDoTecnico('TEC-1', token));
runGuardMatrix('getOsDoTecnico', (s, token) => s.getOsDoTecnico('TEC-1', token));

// Dispatcher: trailing token em cada case migrado, sem deslocar parametros existentes.
{
  const s = makeSandbox();
  const seen = {};
  s.getOsDoTecnico = (...a) => { seen.os = a; return {}; };
  s.getVeiculoDoTecnico = (...a) => { seen.veiculo = a; return {}; };
  s.cadastrarOuEditarVeiculo = (...a) => { seen.cadastro = a; return {}; };
  s.registrarInicioDia = (...a) => { seen.inicio = a; return {}; };
  s.registrarFimDia = (...a) => { seen.fim = a; return {}; };
  s.getDiariaTecnico = (...a) => { seen.diaria = a; return {}; };

  s.executarAcao('getOsDoTecnico', ['TEC-1', 'TOK-OS']);
  s.executarAcao('getVeiculoDoTecnico', ['TEC-1', 'TOK-VEI']);
  s.executarAcao('cadastrarOuEditarVeiculo', ['TEC-1','Nome','Carro','ABC','Modelo','TOK-CAD']);
  s.executarAcao('registrarInicioDia', ['TEC-1','Nome',true,100,'VEI-1','OP-1','DEV-1','TOK-INI']);
  s.executarAcao('registrarFimDia', ['TEC-1',120,'OP-2','DEV-1','TOK-FIM']);
  s.executarAcao('getDiariaTecnico', ['TEC-1','TOK-DIA']);

  check('dispatcher getOsDoTecnico p[1]=token', seen.os && seen.os[1] === 'TOK-OS');
  check('dispatcher getVeiculoDoTecnico p[1]=token', seen.veiculo && seen.veiculo[1] === 'TOK-VEI');
  check('dispatcher cadastrarOuEditarVeiculo p[5]=token', seen.cadastro && seen.cadastro[5] === 'TOK-CAD');
  check('dispatcher registrarInicioDia p[7]=token', seen.inicio && seen.inicio[7] === 'TOK-INI');
  check('dispatcher registrarFimDia p[4]=token', seen.fim && seen.fim[4] === 'TOK-FIM');
  check('dispatcher getDiariaTecnico p[1]=token', seen.diaria && seen.diaria[1] === 'TOK-DIA');
}

// registrarUsoVeiculo: backend existe, mas sem case/call-site real hoje. Nao migrar por reflexo.
check('escopo: registrarUsoVeiculo continua fora do dispatcher nesta onda', !/case\s+["']registrarUsoVeiculo["']/.test(API));

console.log(`\nOnda 3: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
