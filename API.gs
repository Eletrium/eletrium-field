// ============================================================
// API.gs — Ponte HTTP para a PWA hospedada no GitHub Pages
// Como a PWA deixou de ser servida DIRETO pelo Apps Script,
// ela não pode mais usar google.script.run (isso só funciona
// quando o HTML é renderizado pelo próprio HtmlService).
// Este doPost() recebe chamadas via fetch() normal e repassa
// para as funções que já existem em Código.gs, Checklist.gs etc.
// ============================================================

function doPost(e) {
  var response;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var p = body.params || [];

    switch (action) {
      case 'getTecnicos':
        response = getTecnicos();
        break;
      case 'getDiariaHoje':
        response = getDiariaHoje(p[0]);
        break;
      case 'getOsDoTecnico':
        response = getOsDoTecnico(p[0]);
        break;
      case 'iniciarOSComGeo':
        response = iniciarOSComGeo(p[0], p[1], p[2], p[3], p[4], p[5]);
        break;
      case 'pausarOS':
        response = pausarOS(p[0], p[1], p[2], p[3], p[4]);
        break;
      case 'retomarOS':
        response = retomarOS(p[0], p[1], p[2]);
        break;
      case 'encerrarOS':
        response = encerrarOS(p[0], p[1], p[2], p[3]);
        break;
      case 'criarOSEmergencia':
        response = criarOSEmergencia(p[0]);
        break;
      case 'getProximaPergunta':
        response = getProximaPergunta(p[0], p[1], p[2]);
        break;
      case 'salvarResposta':
        response = salvarResposta(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
        break;
      case 'getVeiculoDoTecnico':
        response = getVeiculoDoTecnico(p[0]);
        break;
      case 'cadastrarOuEditarVeiculo':
        response = cadastrarOuEditarVeiculo(p[0], p[1], p[2], p[3], p[4]);
        break;
      case 'registrarInicioDia':
        response = registrarInicioDia(p[0], p[1], p[2], p[3], p[4]);
        break;
      case 'registrarFimDia':
        response = registrarFimDia(p[0], p[1]);
        break;
      case 'getDiariaTecnico':
        response = getDiariaTecnico(p[0]);
        break;
      default:
        response = { erro: 'Acao desconhecida: ' + action };
    }
  } catch (err) {
    response = { erro: 'Erro no servidor: ' + err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Teste manual — confirma que o roteador está funcionando ────
// Execute no editor do Apps Script para validar antes de implantar.
function testarDoPost() {
  var fakeEvent = {
    postData: {
      contents: JSON.stringify({ action: 'getTecnicos', params: [] })
    }
  };
  var res = doPost(fakeEvent);
  Logger.log(res.getContent());
}
