// ============================================================
// API.gs — Ponte HTTP para a PWA hospedada no GitHub Pages
// ============================================================
// IMPORTANTE: o Apps Script não devolve o cabeçalho
// "Access-Control-Allow-Origin" nas respostas de doPost(),
// então fetch() de outro domínio (GitHub Pages) é bloqueado
// pelo navegador mesmo quando o servidor responde com sucesso.
// A solução é usar JSONP via doGet() — uma tag <script> comum
// não é bloqueada pela mesma regra de segurança.
//
// doPost() continua aqui como reserva/teste manual, mas quem
// a PWA realmente usa agora é o doGet() abaixo.
// ============================================================

function doGet(e) {
  var callback = e.parameter.callback;
  var response;

  try {
    var action = e.parameter.action;
    var paramsRaw = e.parameter.params;
    var p = paramsRaw ? JSON.parse(paramsRaw) : [];

    response = executarAcao(action, p);
  } catch (err) {
    response = { erro: 'Erro no servidor: ' + err.message };
  }

  var jsonStr = JSON.stringify(response);

  if (callback) {
    // Formato JSONP: nome_da_funcao(dados_json)
    return ContentService
      .createTextOutput(callback + '(' + jsonStr + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var response;
  try {
    var body = JSON.parse(e.postData.contents);
    response = executarAcao(body.action, body.params || []);
  } catch (err) {
    response = { erro: 'Erro no servidor: ' + err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Dispatcher central — usado por doGet e doPost ───────────
function executarAcao(action, p) {
  switch (action) {
    case 'getTecnicos':
      return getTecnicos();
    case 'getDiariaHoje':
      return getDiariaHoje(p[0]);
    case 'getOsDoTecnico':
      return getOsDoTecnico(p[0]);
    case 'iniciarOSComGeo':
      return iniciarOSComGeo(p[0], p[1], p[2], p[3], p[4], p[5]);
    // Frente D (idempotência) — últimos 2 params são operationId/
    // dispositivoId em todo case abaixo que ganhou o tratamento;
    // opcionais, chamador antigo sem eles continua funcionando.
    case 'pausarOS':
      return pausarOS(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    case 'retomarOS':
      return retomarOS(p[0], p[1], p[2], p[3], p[4]);
    case 'encerrarOS':
      return encerrarOS(p[0], p[1], p[2], p[3]);
    case 'criarOSEmergencia':
      return criarOSEmergencia(p[0]);
    case 'getProximaPergunta':
      return getProximaPergunta(p[0], p[1], p[2], p[3]);
    case 'salvarResposta':
      return salvarResposta(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9]);
    case 'getVeiculoDoTecnico':
      return getVeiculoDoTecnico(p[0]);
    case 'cadastrarOuEditarVeiculo':
      return cadastrarOuEditarVeiculo(p[0], p[1], p[2], p[3], p[4]);
    case 'registrarInicioDia':
      return registrarInicioDia(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    case 'registrarFimDia':
      return registrarFimDia(p[0], p[1], p[2], p[3]);
    case 'getDiariaTecnico':
      return getDiariaTecnico(p[0]);
    case 'validarPin':
      return validarPinTecnico(p[0], p[1]);
    // KM por-OS (Opção 2, 06/08) — aditivo, ver bloco correspondente em Código.js.
    // encerrarOSComKM tem 6 parâmetros posicionais (p[0]..p[5]) — o KM final NÃO
    // entra aqui, é preenchido depois via registrarKMFinalPendente.
    case 'iniciarOSComKM':
      return iniciarOSComKM(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11]);
    case 'encerrarOSComKM':
      // p[6]=operationId, p[7]=dispositivoId — Frente D (idempotência).
      // Ambos opcionais: chamador antigo sem eles continua funcionando.
      return encerrarOSComKM(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
    case 'registrarKMFinalPendente':
      return registrarKMFinalPendente(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    case 'getOSsPendentesKMFinal':
      return getOSsPendentesKMFinal(p[0]);
    // Leitor genérico, só leitura — usado pra verificação por releitura em
    // testes (evita ter que criar/derrubar diagnóstico descartável a cada vez).
    case 'lerCamposOS':
      return lerCamposOS(p[0], p[1]);
    // Idempotente (só adiciona coluna/aba que ainda não existe) — precisa
    // rodar uma vez depois de qualquer mudança em Código.js que adicione
    // campos novos ao array `novos`, senão getCol() devolve null pra eles
    // e todo set() correspondente vira no-op silencioso.
    case 'rodarSetupSheets':
      setupSheets();
      return { sucesso: true };
    // Leitor genérico, só leitura — dump de Perguntas_Checklist +
    // Opcoes_Resposta pra reconstruir a árvore real sem depender de
    // inferência local. Fica permanente (útil pra qualquer auditoria futura).
    case 'lerArvoreChecklist':
      return lerArvoreChecklist();
    // Leitor genérico de QUALQUER aba, só leitura — pra auditoria/teste sem
    // precisar de um leitor dedicado por aba.
    case 'lerAbaCompleta':
      return lerAbaCompleta(p[0]);
    // Frente C (Diretriz v1.1) — precheck server-side dos 4 pré-requisitos
    // de conclusão (mesmas regras do admin). Só leitura; encerrarOS() já
    // chama isto internamente antes de gravar, mas o frontend pode chamar
    // antes de tentar, pra mostrar os motivos de bloqueio sem round-trip
    // de escrita recusada.
    case 'canCloseOS':
      return canCloseOS(p[0], p[1]);
    // Frente B, fatia prioritaria (Diretriz v1.1) — os 3 campos que
    // faziam canCloseOS bloquear sempre.
    // salvarArquivoOS chega via POST (base64 estoura limite de URL de
    // GET/JSONP) — doPost já cai no mesmo executarAcao, sem caso especial.
    case 'salvarArquivoOS':
      return salvarArquivoOS(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
    case 'confirmarSegurancaPreExecucao':
      return confirmarSegurancaPreExecucao(p[0], p[1], p[2], p[3], p[4], p[5]);
    // Poll pós-upload (POST no-cors não deixa ler a resposta do POST em
    // si) — GET/JSONP normal, corpo pequeno.
    case 'consultarStatusOperacao':
      return consultarStatusOperacao(p[0]);
    // Frente B, fatia 2 (Diretriz v1.1) — selfie + checklist EPI +
    // diário do técnico. Chega via POST (mesmo motivo do salvarArquivoOS
    // — base64 da selfie estoura limite de URL de GET/JSONP).
    case 'salvarSelfieEPI':
      return salvarSelfieEPI(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
    default:
      return { erro: 'Acao desconhecida: ' + action };
  }
}

// ─── Validação de PIN — Frente E (Diretriz v1.1) ─────────────────
// Não existe fluxo de cadastro de PIN separado (o admin digita direto
// na planilha) — por isso a migração pra hash é self-migrating: no
// primeiro login certo de um técnico ainda em texto puro, esta função
// gera salt+hash, grava PIN_Hash/PIN_Salt e limpa a coluna PIN legada.
// Logins seguintes desse técnico já caem no caminho de hash direto.
function validarPinTecnico(tecnicoId, pin) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Tecnicos_MEI');
  if (!sheet) return { valido: false, erro: 'Lista de tecnicos nao encontrada' };
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const idxId = h.indexOf('ID_Tecnico');
  const idxPin = h.indexOf('PIN');
  const idxHash = h.indexOf('PIN_Hash');
  const idxSalt = h.indexOf('PIN_Salt');
  if (idxPin < 0 && idxHash < 0) return { valido: false, erro: 'Coluna PIN nao configurada na planilha' };

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxId >= 0 ? idxId : 0]) !== String(tecnicoId)) continue;

    const hashAtual = idxHash >= 0 ? String(dados[i][idxHash] || '').trim() : '';
    const saltAtual = idxSalt >= 0 ? String(dados[i][idxSalt] || '').trim() : '';

    // Já migrado: compara hash, nunca toca em texto puro.
    if (hashAtual && saltAtual) {
      return { valido: hashPin(pin, saltAtual) === hashAtual };
    }

    // Ainda em texto puro (legado): valida contra a coluna PIN e, se
    // acertou, migra a linha antes de responder.
    const pinLegado = idxPin >= 0 ? String(dados[i][idxPin] || '').trim() : '';
    if (!pinLegado) return { valido: false, erro: 'PIN nao cadastrado para este tecnico' };

    const ok = pinLegado === String(pin).trim();
    if (ok && idxHash >= 0 && idxSalt >= 0) {
      const novoSalt = gerarSalt();
      const novoHash = hashPin(pin, novoSalt);
      sheet.getRange(i + 1, idxHash + 1).setValue(novoHash);
      sheet.getRange(i + 1, idxSalt + 1).setValue(novoSalt);
      sheet.getRange(i + 1, idxPin + 1).setValue('');
      Logger.log('PIN migrado para hash: Tecnico_ID=' + tecnicoId);
    }
    return { valido: ok };
  }
  return { valido: false, erro: 'Tecnico nao encontrado' };
}

// ─── Teste manual — confirma que o roteador está funcionando ────
function testarDoPost() {
  var fakeEvent = {
    postData: { contents: JSON.stringify({ action: 'getTecnicos', params: [] }) }
  };
  var res = doPost(fakeEvent);
  Logger.log(res.getContent());
}
