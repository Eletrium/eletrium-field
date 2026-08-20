const fs = require('fs');

function patch(path, replacements) {
  let src = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of replacements) {
    const count = src.split(from).length - 1;
    if (count !== 1) throw new Error(`${path}: esperado 1 match para ${label}, achei ${count}`);
    src = src.replace(from, to);
  }
  fs.writeFileSync(path, src, 'utf8');
}

patch('Código.js', [[
`function getDiariaHoje(tecnicoId) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
`function getDiariaHoje(tecnicoId, token) {\n  // Onda 3 / red-team PR #3: esta leitura e especifica do tecnico e\n  // acessa a mesma Diaria_Tecnico protegida por getDiariaTecnico. Sem\n  // identidade, tecnicoId era um IDOR: bastava alegar outro ID. Token\n  // continua opcional durante a transicao; quando presente, identidade\n  // e validada ANTES de qualquer leitura da diaria.\n  if (token !== undefined) {\n    const identidade = verificarTokenSessao(token, tecnicoId);\n    if (!identidade.ok) return _recusa(null, identidade.erro);\n  }\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
'getDiariaHoje: guard de identidade'
]]);

patch('API.js', [[
`    case 'getDiariaHoje':\n      return getDiariaHoje(p[0]);`,
`    case 'getDiariaHoje':\n      // p[1]=token (Onda 3, red-team PR #3) -- opcional durante a transicao.\n      return getDiariaHoje(p[0], p[1]);`,
'API getDiariaHoje token trailing'
]]);

patch('tests/g5-token-sessao/test-onda3-token-sessao.js', [
[
`function isRejected(result) {\n  return result && result.success === false && result.sucesso === false;\n}`,
`function isRejected(result) {\n  // Contrato CANONICO do backend: success:false. Nao depende do alias\n  // legado em portugues (sucesso), evitando falso negativo/positivo se\n  // esse alias for removido no futuro.\n  return result && result.success === false;\n}`,
'isRejected canonico'
],
[
`function runGuardMatrix(label, invoke) {\n  const now = Date.now();\n  const s = makeSandbox(now);\n  const tokenOk = s.emitirTokenSessao('TEC-1').token;\n  const tokenOutro = s.emitirTokenSessao('TEC-2').token;\n  const tokenForjado = tokenOk.slice(0, -2) + (tokenOk.endsWith('00') ? '11' : '00');\n\n  check(label + ' 1/5 sem token preserva transicao', reachesDownstream(() => invoke(s, undefined)));\n  check(label + ' 2/5 token valido aceita identidade', reachesDownstream(() => invoke(s, tokenOk)));\n  check(label + ' 3/5 assinatura errada recusa antes do downstream', isRejected(invoke(s, tokenForjado)));\n  check(label + ' 4/5 token de X alegando Y recusa', isRejected(invoke(s, tokenOutro)));\n\n  const old = makeSandbox(now - 25 * 60 * 60 * 1000);\n  const expirado = old.emitirTokenSessao('TEC-1').token;\n  check(label + ' 5/5 token expirado recusa', isRejected(invoke(s, expirado)));\n}`,
`function runGuardMatrix(label, invoke) {\n  const now = Date.now();\n  const s = makeSandbox(now);\n  const tokenOk = s.emitirTokenSessao('TEC-1').token;\n  const tokenOutro = s.emitirTokenSessao('TEC-2').token;\n  const tokenAssinaturaRuim = tokenOk.slice(0, -2) + (tokenOk.endsWith('00') ? '11' : '00');\n  const tokenMalformado = 'token.sem-assinatura';\n  const tokenPayloadCorrompido = tokenOk.replace(/^TEC-1\\./, 'TEC-9.');\n\n  check(label + ' 1/8 sem token preserva transicao', reachesDownstream(() => invoke(s, undefined)));\n  check(label + ' 2/8 token valido aceita identidade', reachesDownstream(() => invoke(s, tokenOk)));\n  check(label + ' 3/8 assinatura errada recusa antes do downstream', isRejected(invoke(s, tokenAssinaturaRuim)));\n  check(label + ' 4/8 token vazio recusa antes do downstream', isRejected(invoke(s, '')));\n  check(label + ' 5/8 token malformado recusa antes do downstream', isRejected(invoke(s, tokenMalformado)));\n  check(label + ' 6/8 payload corrompido recusa antes do downstream', isRejected(invoke(s, tokenPayloadCorrompido)));\n  check(label + ' 7/8 token de X alegando Y recusa', isRejected(invoke(s, tokenOutro)));\n\n  const old = makeSandbox(now - 25 * 60 * 60 * 1000);\n  const expirado = old.emitirTokenSessao('TEC-1').token;\n  check(label + ' 8/8 token expirado recusa', isRejected(invoke(s, expirado)));\n}`,
'matriz negativa ampliada'
],
[
`runGuardMatrix('getDiariaTecnico', (s, token) => s.getDiariaTecnico('TEC-1', token));`,
`runGuardMatrix('getDiariaTecnico', (s, token) => s.getDiariaTecnico('TEC-1', token));\nrunGuardMatrix('getDiariaHoje', (s, token) => s.getDiariaHoje('TEC-1', token));`,
'getDiariaHoje na matriz'
],
[
`  s.getDiariaTecnico = (...a) => { seen.diaria = a; return {}; };`,
`  s.getDiariaTecnico = (...a) => { seen.diaria = a; return {}; };\n  s.getDiariaHoje = (...a) => { seen.diariaHoje = a; return {}; };`,
'spy getDiariaHoje'
],
[
`  s.executarAcao('getDiariaTecnico', ['TEC-1','TOK-DIA']);`,
`  s.executarAcao('getDiariaTecnico', ['TEC-1','TOK-DIA']);\n  s.executarAcao('getDiariaHoje', ['TEC-1','TOK-HOJE']);`,
'dispatch getDiariaHoje'
],
[
`  check('dispatcher getDiariaTecnico p[1]=token', seen.diaria && seen.diaria[1] === 'TOK-DIA');`,
`  check('dispatcher getDiariaTecnico p[1]=token', seen.diaria && seen.diaria[1] === 'TOK-DIA');\n  check('dispatcher getDiariaHoje p[1]=token', seen.diariaHoje && seen.diariaHoje[1] === 'TOK-HOJE');`,
'assert dispatcher getDiariaHoje'
],
[
`// registrarUsoVeiculo: backend existe, mas sem case/call-site real hoje. Nao migrar por reflexo.\ncheck('escopo: registrarUsoVeiculo continua fora do dispatcher nesta onda', !/case\\s+[\"']registrarUsoVeiculo[\"']/.test(API));`,
`// registrarUsoVeiculo: confirma as DUAS metades da classificacao \"orfao\":\n// a funcao existe de verdade no backend, mas nao esta exposta no dispatcher.\ncheck('escopo: registrarUsoVeiculo existe no backend', /function\\s+registrarUsoVeiculo\\s*\\(/.test(CODIGO));\ncheck('escopo: registrarUsoVeiculo continua fora do dispatcher nesta onda', !/case\\s+[\"']registrarUsoVeiculo[\"']/.test(API));`,
'prova registrarUsoVeiculo orfao'
]
]);

console.log('Patch red-team Onda 3 aplicado com matches exatos.');
