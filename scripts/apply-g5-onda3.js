const fs = require('fs');

let codigo = fs.readFileSync('Código.js', 'utf8');
let api = fs.readFileSync('API.js', 'utf8');

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error('Trecho nao encontrado: ' + label);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error('Trecho duplicado/ambiguo: ' + label);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const guardNull = `  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante\n  // a transicao. Se presente, prova identidade antes de qualquer leitura/escrita\n  // especifica do tecnico. Nao ha conceito de posse de OS nestas funcoes.\n  if (token !== undefined) {\n    const identidade = verificarTokenSessao(token, tecnicoId);\n    if (!identidade.ok) return _recusa(null, identidade.erro);\n  }\n`;
const guardOp = `  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante\n  // a transicao. Identidade e validada antes de qualquer mutacao do tecnico.\n  if (token !== undefined) {\n    const identidade = verificarTokenSessao(token, tecnicoId);\n    if (!identidade.ok) return _recusa(operationId, identidade.erro);\n  }\n`;

codigo = replaceOnce(
  codigo,
  `function getOsDoTecnico(tecnicoId) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  `function getOsDoTecnico(tecnicoId, token) {\n${guardNull}  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  'getOsDoTecnico'
);

codigo = replaceOnce(
  codigo,
  `function getDiariaTecnico(tecnicoId) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  `function getDiariaTecnico(tecnicoId, token) {\n${guardNull}  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  'getDiariaTecnico'
);

codigo = replaceOnce(
  codigo,
  `function registrarInicioDia(tecnicoId, tecnicoNome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId) {\n  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {`,
  `function registrarInicioDia(tecnicoId, tecnicoNome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId, token) {\n${guardOp}  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {`,
  'registrarInicioDia'
);

codigo = replaceOnce(
  codigo,
  `function registrarFimDia(tecnicoId, kmFinal, operationId, dispositivoId) {\n  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {`,
  `function registrarFimDia(tecnicoId, kmFinal, operationId, dispositivoId, token) {\n${guardOp}  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {`,
  'registrarFimDia'
);

codigo = replaceOnce(
  codigo,
  `function getVeiculoDoTecnico(tecnicoId) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  `function getVeiculoDoTecnico(tecnicoId, token) {\n${guardNull}  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  'getVeiculoDoTecnico'
);

codigo = replaceOnce(
  codigo,
  `function cadastrarOuEditarVeiculo(tecnicoId, tecnicoNome, tipoVeiculo, placa, modelo) {\n  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  `function cadastrarOuEditarVeiculo(tecnicoId, tecnicoNome, tipoVeiculo, placa, modelo, token) {\n${guardNull}  const ss = SpreadsheetApp.openById(SHEET_ID);`,
  'cadastrarOuEditarVeiculo'
);

api = replaceOnce(api,
  `    case 'getOsDoTecnico':\n      return getOsDoTecnico(p[0]);`,
  `    case 'getOsDoTecnico':\n      // p[1]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return getOsDoTecnico(p[0], p[1]);`,
  'API getOsDoTecnico');

api = replaceOnce(api,
  `    case 'getVeiculoDoTecnico':\n      return getVeiculoDoTecnico(p[0]);`,
  `    case 'getVeiculoDoTecnico':\n      // p[1]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return getVeiculoDoTecnico(p[0], p[1]);`,
  'API getVeiculoDoTecnico');

api = replaceOnce(api,
  `    case 'cadastrarOuEditarVeiculo':\n      return cadastrarOuEditarVeiculo(p[0], p[1], p[2], p[3], p[4]);`,
  `    case 'cadastrarOuEditarVeiculo':\n      // p[5]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return cadastrarOuEditarVeiculo(p[0], p[1], p[2], p[3], p[4], p[5]);`,
  'API cadastrarOuEditarVeiculo');

api = replaceOnce(api,
  `    case 'registrarInicioDia':\n      return registrarInicioDia(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);`,
  `    case 'registrarInicioDia':\n      // p[7]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return registrarInicioDia(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);`,
  'API registrarInicioDia');

api = replaceOnce(api,
  `    case 'registrarFimDia':\n      return registrarFimDia(p[0], p[1], p[2], p[3]);`,
  `    case 'registrarFimDia':\n      // p[4]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return registrarFimDia(p[0], p[1], p[2], p[3], p[4]);`,
  'API registrarFimDia');

api = replaceOnce(api,
  `    case 'getDiariaTecnico':\n      return getDiariaTecnico(p[0]);`,
  `    case 'getDiariaTecnico':\n      // p[1]=token (Onda 3, Opcao A) -- opcional durante a transicao.\n      return getDiariaTecnico(p[0], p[1]);`,
  'API getDiariaTecnico');

// registrarUsoVeiculo deliberadamente NAO e migrada nesta onda: a funcao
// existe no backend, mas nao ha case no dispatcher nem call-site real nos
// frontends versionados. Reconciliar antes do enforcement obrigatorio.

fs.writeFileSync('Código.js', codigo, 'utf8');
fs.writeFileSync('API.js', api, 'utf8');
console.log('Onda 3 aplicada: 6 funcoes ativas + 6 cases do dispatcher. registrarUsoVeiculo preservada fora do escopo.');
