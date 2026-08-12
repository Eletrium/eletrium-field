// ============================================================
// Checklist.gs — Motor de formulario dinamico NR-10
// PARTE A: initChecklistSheets() + PARTE C: motor de cascata
// ============================================================

/**
 * PARTE A — Cria as 3 abas de checklist na planilha.
 * Executar UMA VEZ manualmente no editor.
 */
function initChecklistSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const defs = [
    {
      name: 'Perguntas_Checklist',
      headers: ['ID_Pergunta','Disciplina','Nivel','Texto_Pergunta','Tipo_Resposta',
                'Pergunta_Pai','Condicao_Exibicao','Foto_Obrigatoria','Ordem','Ativo']
    },
    {
      name: 'Opcoes_Resposta',
      headers: ['Pergunta_ID','Texto_Opcao','Ordem','Aciona_NC','Cor_Indicador']
    },
    {
      name: 'Checklist_Respostas',
      headers: ['ID_OS','IDSharePoint_OS','Pergunta_ID','Texto_Pergunta',
                'Resposta_Dada','Foto_URL','Tecnico','Timestamp','Gerou_NC','Sincronizado']
    }
  ];

  defs.forEach(function(def) {
    let sh = ss.getSheetByName(def.name);
    if (!sh) {
      sh = ss.insertSheet(def.name);
      Logger.log('Criada aba: ' + def.name);
    } else {
      Logger.log('Aba ja existe: ' + def.name);
    }
    if (sh.getLastRow() === 0) {
      sh.appendRow(def.headers);
      sh.getRange(1, 1, 1, def.headers.length)
        .setFontWeight('bold')
        .setBackground('#d0e4f7');
      Logger.log('Cabecalhos escritos em: ' + def.name);
    }
  });

  SpreadsheetApp.flush();
  Logger.log('initChecklistSheets() concluido.');
}

// ============================================================
// PARTE C — Motor de formulario em cascata
// ============================================================

/**
 * Retorna a primeira pergunta (perguntaAtualId = null)
 * ou a proxima pergunta dado o ID atual e a resposta dada.
 * Chamavel via google.script.run do PWA.
 */
function getProximaPergunta(disciplinaNome, perguntaAtualId, respostaDada) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Perguntas_Checklist');
  const dados = sh.getDataRange().getValues();
  if (dados.length <= 1) return null;
  const h = dados[0];

  const iId    = h.indexOf('ID_Pergunta');
  const iDisc  = h.indexOf('Disciplina');
  const iPai   = h.indexOf('Pergunta_Pai');
  const iCond  = h.indexOf('Condicao_Exibicao');
  const iOrdem = h.indexOf('Ordem');
  const iAtivo = h.indexOf('Ativo');

  const primeiraPergunta = !perguntaAtualId || perguntaAtualId === '';

  const candidatas = dados.slice(1).filter(function(row) {
    if (row[iDisc] !== disciplinaNome) return false;
    if (row[iAtivo] !== true) return false;
    if (primeiraPergunta) {
      return !row[iPai] || row[iPai] === '';
    }
    if (row[iPai] !== perguntaAtualId) return false;
    const cond = row[iCond];
    if (cond && cond !== '' && cond !== respostaDada) return false;
    return true;
  });

  if (candidatas.length === 0) return null;

  candidatas.sort(function(a, b) { return a[iOrdem] - b[iOrdem]; });
  return montarObjetoPergunta(candidatas[0], h);
}

function montarObjetoPergunta(row, headers) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  obj.opcoes = getOpcoesDaPergunta(obj['ID_Pergunta']);
  return obj;
}

function getOpcoesDaPergunta(perguntaId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Opcoes_Resposta');
  const dados = sh.getDataRange().getValues();
  if (dados.length <= 1) return [];
  const h = dados[0];
  const iPerg  = h.indexOf('Pergunta_ID');
  const iOrdem = h.indexOf('Ordem');

  return dados.slice(1)
    .filter(function(row) { return row[iPerg] === perguntaId; })
    .sort(function(a, b) { return a[iOrdem] - b[iOrdem]; })
    .map(function(row) {
      const o = {};
      h.forEach(function(col, i) { o[col] = row[i]; });
      return o;
    });
}

/**
 * Salva resposta do tecnico na aba Checklist_Respostas.
 * Chamavel via google.script.run do PWA.
 */
function salvarResposta(osId, idSharePointOS, perguntaId, textoPergunta,
                        resposta, fotoUrl, tecnico, geraNC) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Checklist_Respostas');
  sh.appendRow([
    osId, idSharePointOS, perguntaId, textoPergunta,
    resposta, fotoUrl || '', tecnico,
    new Date(), geraNC || false, false
  ]);
  SpreadsheetApp.flush();
}
