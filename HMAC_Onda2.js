// ============================================================
// ELETRIUM ERP — G5/HMAC — Onda 2
// Protecao transicional de pausarOS / retomarOS.
//
// Regra do rollout: token ainda OPCIONAL nesta onda para manter
// compatibilidade com o Field anterior. Quando presente, deve ser valido
// e corresponder ao tecnicoId informado. A posse da OS e sempre validada
// antes de delegar para a funcao legada.
//
// O flip para token OBRIGATORIO e um gate separado e NAO pertence a
// esta onda.
// ============================================================

function _validarSessaoEPosseOnda2(osId, tecnicoId, operationId, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }

  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);

  return null;
}

function pausarOSComSessao(osId, tecnicoId, tecnicoNome, motivo, osInterrupcaoId, operationId, dispositivoId, token) {
  const recusa = _validarSessaoEPosseOnda2(osId, tecnicoId, operationId, token);
  if (recusa) return recusa;

  return pausarOS(
    osId,
    tecnicoId,
    tecnicoNome,
    motivo,
    osInterrupcaoId,
    operationId,
    dispositivoId
  );
}

function retomarOSComSessao(osId, tecnicoId, tecnicoNome, operationId, dispositivoId, token) {
  const recusa = _validarSessaoEPosseOnda2(osId, tecnicoId, operationId, token);
  if (recusa) return recusa;

  return retomarOS(
    osId,
    tecnicoId,
    tecnicoNome,
    operationId,
    dispositivoId
  );
}
