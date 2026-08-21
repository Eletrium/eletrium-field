// ============================================================
// HMAC_Reauth.js — contrato REAUTH_REQUIRED pre-enforcement
// ============================================================
// Adicao transicional: token continua opcional enquanto FIELD_API_CONTRACT=v1.
// Toda chamada publica do Field passa por API.js/executarAcao(); este arquivo
// centraliza a classificacao de falhas de sessao nessa fronteira sem misturar
// identidade com retry tecnico/Log_Central.
//
// Decisao owner 21/08/2026:
// - reauth_required e booleano dedicado;
// - somente token estruturalmente valido + assinatura valida + MESMO tecnico
//   + expirado gera reauth_required=true;
// - todas as demais recusas de sessao geram reauth_required=false;
// - retryable permanece false em toda recusa de sessao;
// - ausencia de token (undefined) continua permitida durante a transicao.
// ============================================================

var SESSAO_DISPATCHER_POLITICAS = {
  getDiariaHoje:                 { tecnico: 0, token: 1, operationId: null },
  getOsDoTecnico:                { tecnico: 0, token: 1, operationId: null },
  iniciarOSComGeo:               { tecnico: 1, token: 8, operationId: 6 },
  pausarOS:                      { tecnico: 1, token: 7, operationId: 5 },
  retomarOS:                     { tecnico: 1, token: 5, operationId: 3 },
  encerrarOS:                    { tecnico: 1, token: 4, operationId: null },
  salvarResposta:                { tecnico: 10, token: 11, operationId: 8 },
  getVeiculoDoTecnico:           { tecnico: 0, token: 1, operationId: null },
  cadastrarOuEditarVeiculo:      { tecnico: 0, token: 5, operationId: null },
  registrarInicioDia:            { tecnico: 0, token: 7, operationId: 5 },
  registrarFimDia:               { tecnico: 0, token: 4, operationId: 2 },
  getDiariaTecnico:              { tecnico: 0, token: 1, operationId: null },
  iniciarOSComKM:                { tecnico: 1, token: 12, operationId: 10 },
  encerrarOSComKM:               { tecnico: 1, token: 8, operationId: 6 },
  registrarKMFinalPendente:      { tecnico: 1, token: 7, operationId: 5 },
  // Gap encontrado no sweep REAUTH: leitura especifica por tecnico ainda
  // nao tinha token no contrato antigo. p[1] fica reservado ao token,
  // trailing e opcional; a funcao legada continua recebendo apenas p[0].
  getOSsPendentesKMFinal:         { tecnico: 0, token: 1, operationId: null },
  salvarArquivoOS:               { tecnico: 1, token: 8, operationId: 6 },
  confirmarSegurancaPreExecucao: { tecnico: 1, token: 6, operationId: 4 },
  salvarSelfieEPI:               { tecnico: 1, token: 8, operationId: 6 },
  fecharFaseChecklist:           { tecnico: 1, token: 5, operationId: 3 },
  registrarMovimentoFerramental: { tecnico: 1, token: 8, operationId: 6 }
};

function _verificarTokenSessaoEstruturado(token, tecnicoIdEsperado) {
  var segredo = PropertiesService.getScriptProperties().getProperty(SESSAO_SEGREDO_PROPERTY);
  if (!segredo) {
    return { ok: false, erro: 'Sessao indisponivel: segredo HMAC nao configurado', reauth_required: false };
  }
  if (!token) {
    return { ok: false, erro: 'Token de sessao ausente', reauth_required: false };
  }

  var partes = String(token).split('.');
  if (partes.length < 3) {
    return { ok: false, erro: 'Token de sessao malformado', reauth_required: false };
  }

  var sig = partes.pop();
  var expiraEm = partes.pop();
  var tecnicoIdToken = partes.join('.');
  if (!tecnicoIdToken || !/^\d+$/.test(String(expiraEm))) {
    return { ok: false, erro: 'Token de sessao malformado', reauth_required: false };
  }

  var payload = tecnicoIdToken + '.' + expiraEm;
  var sigEsperada = _bytesParaHex(Utilities.computeHmacSha256Signature(payload, segredo));
  if (!_hexIgualConstante(sigEsperada.toLowerCase(), String(sig).trim().toLowerCase())) {
    return { ok: false, erro: 'Token de sessao invalido', reauth_required: false };
  }

  // Ordem deliberada do contrato REAUTH: identidade ANTES de expiracao.
  // Um token valido de X, ainda que expirado, usado numa chamada alegando Y
  // e spoof/identidade divergente — nao rotina de reautenticacao.
  if (String(tecnicoIdToken) !== String(tecnicoIdEsperado)) {
    return { ok: false, erro: 'Token de sessao nao corresponde ao tecnico informado', reauth_required: false };
  }

  if (Math.floor(Date.now() / 1000) > Number(expiraEm)) {
    return { ok: false, erro: 'Token de sessao expirado', reauth_required: true };
  }

  return { ok: true, reauth_required: false };
}

function _recusaSessao(operationId, identidade) {
  identidade = identidade || { erro: 'Sessao invalida', reauth_required: false };
  return _recusa(operationId || null, identidade.erro || 'Sessao invalida', {
    retryable: false,
    reauth_required: identidade.reauth_required === true
  });
}

function _contextoSessaoDispatcher(action, p) {
  p = p || [];

  // criarOSEmergencia usa um objeto unico em p[0]. Como a OS ainda nao
  // existe, nao ha posse contra a qual validar: identidade e a unica
  // protecao possivel. token e aditivo dentro de dados.token.
  if (action === 'criarOSEmergencia') {
    var dados = p[0] || {};
    return {
      protegido: true,
      tecnicoId: dados.tecnicoId,
      token: dados.token,
      operationId: dados.operationId || null
    };
  }

  var politica = SESSAO_DISPATCHER_POLITICAS[action];
  if (!politica) return { protegido: false };
  return {
    protegido: true,
    tecnicoId: p[politica.tecnico],
    token: p[politica.token],
    operationId: politica.operationId === null ? null : p[politica.operationId]
  };
}

// Retorna null quando a chamada pode seguir. Retorna envelope canonico de
// recusa quando um token FOI enviado e falhou. Durante a transicao, token
// estritamente undefined preserva o comportamento antigo.
function validarSessaoDispatcherOpcional(action, p) {
  var ctx = _contextoSessaoDispatcher(action, p);
  if (!ctx.protegido) return null;
  if (ctx.token === undefined) return null;

  var identidade = _verificarTokenSessaoEstruturado(ctx.token, ctx.tecnicoId);
  if (!identidade.ok) return _recusaSessao(ctx.operationId, identidade);
  return null;
}
