// ============================================================
// ELETRIUM ERP — Apps Script PWA v4.0
// Planilha: 1XjMXQKjfcvdxQLj3M6InIH50OfMbzj03uJR5Jx46AvI
// Campo — Carlos e Paulo
// v4.0: + KM/Veiculo + Geolocalizacao + Inicio/Fim Dia
// ============================================================

const SHEET_ID = '1XjMXQKjfcvdxQLj3M6InIH50OfMbzj03uJR5Jx46AvI';
const TZ = 'GMT-3';

// ─── servirPWADireto: serve o PWA embarcado no Apps Script ──────────
// RENOMEADA de doGet() em 10/08/2026 — colidia com o doGet(e) real de
// API.js (o roteador JSONP que o eletrium-field no GitHub Pages usa
// para TODA chamada via gsCallReal). Apps Script deixa a última
// declaração de função com o mesmo nome vencer; esta, por vir depois
// na concatenação, estava silenciosamente sobrescrevendo o roteador —
// qualquer chamada ?action=... caía aqui e devolvia o PWA.html inteiro
// em vez de JSON, quebrando o app real (confirmado ao vivo: "Erro ao
// carregar tecnicos — Falha de rede (JSONP)" na URL pública). O
// eletrium-field PARA DE SER SERVIDO por essa função desde a migração
// para GitHub Pages — mantida só como referência/teste manual, sem
// nome reservado do Apps Script, então não é mais chamada
// automaticamente por nenhum GET.
function servirPWADireto() {
  return HtmlService.createHtmlOutputFromFile('PWA')
    .setTitle('Eletrium Field')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, user-scalable=no');
}

// ─── setupSheets ─────────────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const osSheet = ss.getSheetByName('Ordens_Servico');
  if (osSheet) {
    const existingHeaders = osSheet.getRange(1, 1, 1, osSheet.getLastColumn()).getValues()[0];
    const novos = [
      'Hora_Inicio', 'Hora_Encerramento', 'Horas_Produtivas', 'Horas_Pausadas',
      'Qtd_Interrupcoes', 'Em_Pausa_Agora', 'Motivo_Pausa_Atual', 'Hora_Ultima_Pausa',
      'Hora_Ultima_Retomada', 'Qtd_Realizada', 'Meta_Dia', 'Unidade_Meta',
      'Pct_Acumulado', 'Tipo_OS_Completo', 'Prioridade_OS', 'OS_Interrupcao_ID',
      'Status_Atual', 'Qtd_Retomadas', 'Obs_Campo', 'Materiais_Dia',
      'Ocorrencias_Dia', 'Proximo_Passo', 'Fotos_Evidencia', 'Nao_Conformidade',
      'Data_Conclusao',
      'KM_Inicial_OS', 'KM_Final_OS', 'Veiculo_ID_OS',
      'KM_Justificativa_Desvio', 'KM_Foto_Desvio_URL', 'KM_Flag_Revisao',
      // Frente B (fatia prioritaria, Diretriz v1.1) — os 3 campos que
      // faziam canCloseOS (Frente C) bloquear sempre. Ver salvarArquivoOS
      // e confirmarSegurancaPreExecucao.
      'Laudo_URL', 'Assinatura_URL', 'Estado_Seguranca',
      // Frente B (fatia 2, Diretriz v1.1) — selfie EPI individual. No
      // admin (OS_Equipe) e por membro de equipe; o PWA hoje só rastreia
      // 1 técnico por OS (sem conceito de equipe), então os campos vivem
      // direto na linha da OS — ver comentário em salvarSelfieEPI.
      'Selfie_URL', 'EPI_Checklist_OK', 'EPI_Checklist_JSON', 'Diario_Tecnico', 'Diario_Preenchido',
      // Checklist 3 fases (CONTRATO-BACKEND-CHECKLIST-3-FASES.md, sessao
      // de frontend) — sinal de que a Fase 2 (Execucao) foi fechada de
      // verdade no servidor. Escrito por fecharFaseChecklist(), lido como
      // 5o motivo de bloqueio em canCloseOS.
      'Checklist_Execucao_Completo'
    ];
    novos.forEach(campo => {
      if (!existingHeaders.includes(campo)) {
        const nextCol = osSheet.getLastColumn() + 1;
        osSheet.getRange(1, nextCol).setValue(campo);
      }
    });
  }

  if (!ss.getSheetByName('OS_Segmentos')) {
    const seg = ss.insertSheet('OS_Segmentos');
    seg.getRange(1, 1, 1, 13).setValues([[
      'ID', 'OS_ID', 'IDSharePoint_OS', 'Tecnico_ID', 'Tecnico_Nome',
      'Tipo_Evento', 'Timestamp', 'Duracao_Min', 'Horas_Acumuladas',
      'Motivo_Detalhe', 'OS_Interrupcao_ID', 'Segmento_Ativo', 'Local_Evento'
    ]]);
  }

  if (!ss.getSheetByName('Diaria_Tecnico')) {
    const diaria = ss.insertSheet('Diaria_Tecnico');
    diaria.getRange(1, 1, 1, 20).setValues([[
      'Data', 'Tecnico_ID', 'Tecnico_Nome', 'Hora_Entrada', 'Hora_Saida',
      'Horas_Produtivas', 'Horas_Pausadas', 'Total_Horas', 'Qtd_OS',
      'OS_Lista', 'Clientes_Atendidos', 'Qtd_Interrupcoes', 'Status_Dia',
      'Custo_MO_Total', 'IDSharePoint',
      'Usa_Veiculo_Hoje', 'KM_Inicial', 'KM_Final', 'KM_Rodado', 'Veiculo_ID'
    ]]);
  }

  const tecSheet = ss.getSheetByName('Tecnicos_MEI');
  if (tecSheet) {
    const tecHeaders = tecSheet.getRange(1, 1, 1, tecSheet.getLastColumn()).getValues()[0];
    ['PIN_Hash', 'PIN_Salt'].forEach(campo => {
      if (!tecHeaders.includes(campo)) {
        const nextCol = tecSheet.getLastColumn() + 1;
        tecSheet.getRange(1, nextCol).setValue(campo);
      }
    });
  }

  // Checklist 3 fases (CONTRATO-BACKEND-CHECKLIST-3-FASES.md) -- sem
  // estas 2 colunas nao ha como o servidor saber quais perguntas
  // pertencem a qual fase nem quais sao obrigatorias pra fechar a fase.
  // Schema original de Perguntas_Checklist (initChecklistSheets(),
  // Checklist.js) nao tem nenhuma das duas.
  const pergSheet = ss.getSheetByName('Perguntas_Checklist');
  if (pergSheet) {
    const pergHeaders = pergSheet.getRange(1, 1, 1, pergSheet.getLastColumn()).getValues()[0];
    ['Fase_Execucao', 'Obrigatoria'].forEach(campo => {
      if (!pergHeaders.includes(campo)) {
        const nextCol = pergSheet.getLastColumn() + 1;
        pergSheet.getRange(1, nextCol).setValue(campo);
      }
    });
  }

  // Aceite de oferta via link profundo (CONTRATO-BACKEND-ACEITE-OFERTA.md) --
  // append-only (evento, nao edicao), mesma filosofia de Checklist_Respostas/
  // Log_Central. Quem gera a linha "Pendente" inicial fica fora deste
  // contrato (provavelmente console do gestor, ver comentario em
  // registrarAceiteOferta) -- aqui so lemos/anexamos eventos de resposta.
  if (!ss.getSheetByName('Alocacoes_Ofertas')) {
    const ofertas = ss.insertSheet('Alocacoes_Ofertas');
    ofertas.getRange(1, 1, 1, ALOCACOES_OFERTAS_HEADERS.length).setValues([ALOCACOES_OFERTAS_HEADERS]);
  }

  // Ferramental -- carga/desmobilizacao (CONTRATO-BACKEND-FERRAMENTAL.md) --
  // append-only, registro minimo por codigo de patrimonio digitado (sem
  // validacao contra catalogo/calibracao/obrigatoriedade -- dependem de
  // sync SharePoint->Sheets que nao existe, fora deste contrato).
  if (!ss.getSheetByName('Ferramental_Movimentos')) {
    const ferramental = ss.insertSheet('Ferramental_Movimentos');
    ferramental.getRange(1, 1, 1, FERRAMENTAL_MOVIMENTOS_HEADERS.length).setValues([FERRAMENTAL_MOVIMENTOS_HEADERS]);
  }

  addMissingHeaders();
  garantirLogCentral(ss);
  return 'Setup concluido! Abas e colunas criadas com sucesso.';
}

const ALOCACOES_OFERTAS_HEADERS = [
  'Oferta_ID', 'OS_ID', 'Tecnico_ID', 'Escopo_Resumo', 'Valor_Proposto',
  'Criada_Em', 'Expira_Em', 'Status', 'Respondida_Em', 'Motivo_Recusa', 'operation_id'
];

const FERRAMENTAL_MOVIMENTOS_HEADERS = [
  'Movimento_ID', 'OS_ID', 'Tecnico_ID', 'Patrimonio_Codigo', 'Tipo_Movimento',
  'Estado_OK', 'Observacao', 'Registrado_Em', 'operation_id'
];

// ─── hashPin / gerarSalt — Frente E (Diretriz v1.1): PIN nunca em texto
// puro na planilha. Salt aleatorio por tecnico (Utilities.getUuid()),
// persistido em PIN_Salt; hash SHA-256 de "salt:pin" em PIN_Hash.
// Aviso honesto: salt aleatorio evita rainbow table e exposicao direta
// da planilha (compartilhamento incorreto, acesso de auditoria), mas
// NAO torna um PIN de 4-6 digitos resistente a forca bruta alvo contra
// um unico tecnico — isso e limite inerente de PIN curto, nao algo que
// hash sozinho resolve. Ganho real e contra leitura em massa da aba.
function hashPin(pin, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + String(pin).trim(),
    Utilities.Charset.UTF_8
  );
  return raw.map(b => ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join('');
}

function gerarSalt() {
  return Utilities.getUuid();
}

// ─── Log_Central / executarIdempotente — Frente D (Diretriz v1.1) ───
// Schema e formatação alinhados byte a byte com a especificação
// aprovada pelo Geovane/Cowork 2 (12/08) — 13 colunas A-M, ordem exata,
// larguras, F-I como texto ISO 8601 (NUNCA Date nativo — o Sheets
// autoconverte e aplica timezone silenciosamente), K como inteiro,
// 4 validações "Reject input" (status/tipo_operacao/erro_codigo com
// lista fechada; tentativas com fórmula custom). `resultado_json` é a
// 13ª coluna, além da spec original do Cowork — é o que a IDEMPOTÊNCIA
// (não só a observabilidade) precisa: guarda a resposta da primeira
// execução bem-sucedida, pra devolver a MESMA coisa numa repetição em
// vez de reexecutar a operação.
const LOG_CENTRAL_COLUNAS = [
  { nome: 'operation_id', largura: 220 },
  { nome: 'OS_ID', largura: 100 },
  { nome: 'tecnico_id', largura: 100 },
  { nome: 'dispositivo_id', largura: 160 },
  { nome: 'tipo_operacao', largura: 160 },
  { nome: 'criado_em', largura: 160 },
  { nome: 'enviado_em', largura: 160 },
  { nome: 'recebido_em', largura: 160 },
  { nome: 'sincronizado_em', largura: 160 },
  { nome: 'status', largura: 130 },
  { nome: 'tentativas', largura: 80 },
  { nome: 'erro_codigo', largura: 170 },
  { nome: 'erro_detalhe', largura: 300 },
];
// resultado_json fica na 14a coluna (N) -- fora da spec original do
// Cowork (que vai so ate M/13), aditiva, sem largura/validacao
// especificada por eles porque e exclusiva da idempotencia backend.
const LOG_CENTRAL_COL_RESULTADO = 'resultado_json';

// Log_Central vira Outbox operacional (ARQUITETURA-SYNC-LOG-CENTRAL.md,
// decisao do auditor, pontos 2-4) -- 3 colunas novas, APOS resultado_json
// (nao mexe na ordem A-M ja aprovada). entity_type/entity_id/
// entity_version dao pro Make.com (1A/1F) rotear por tipo de mutacao e
// detectar eventos fora de ordem/perdidos via a versao monotonica.
const LOG_CENTRAL_COLUNAS_OUTBOX = [
  { nome: 'entity_type', largura: 140 },
  { nome: 'entity_id', largura: 200 },
  { nome: 'entity_version', largura: 110 },
];

const LOG_CENTRAL_STATUS_VALIDOS = ['LOCAL_PENDING', 'QUEUED', 'SENDING', 'RECEIVED', 'SYNCED', 'RECONCILED', 'SYNC_ERROR', 'DIVERGENT'];
const LOG_CENTRAL_TIPO_OPERACAO_VALIDOS = ['CHECKLIST_RESPOSTA', 'UPLOAD_FOTO', 'ACEITE_CLIENTE', 'REGISTRO_KM', 'APONTAMENTO', 'ASSINATURA', 'REGISTRO_MEDICAO', 'CONCLUSAO_OS'];
const LOG_CENTRAL_ERRO_CODIGO_VALIDOS = ['TIMEOUT', 'PAYLOAD_INVALIDO', 'CONFLITO_VERSAO', 'PERMISSAO_NEGADA', 'QUOTA_EXCEDIDA', 'CONEXAO_INDISPONIVEL', 'REFERENCIA_INVALIDA', 'DUPLICADO', 'DIVERGENCIA_VALOR', 'DIVERGENCIA_AUSENCIA', 'ERRO_DESCONHECIDO'];
const LOG_CENTRAL_LINHAS_VALIDACAO = 100000; // teto pragmatico -- validacao aplicada a E2:E100000 etc, nao a coluna infinita

// entity_type: 6 destinos de roteamento do ponto 6 do auditor (estado da
// OS + fotos/checklist/assinatura/medicao/apontamentos). Mapeamento
// tipo_operacao -> entity_type documentado em ARQUITETURA-SYNC-LOG-
// CENTRAL.md -- ACEITE_CLIENTE mapeado pra OS_ESTADO por nao ter destino
// proprio nos 6 pontos do auditor (ambiguo, sinalizado no doc).
const LOG_CENTRAL_ENTITY_TYPE_VALIDOS = ['OS_ESTADO', 'FOTO', 'CHECKLIST', 'ASSINATURA', 'MEDICAO', 'APONTAMENTO'];
const TIPO_OPERACAO_PARA_ENTITY_TYPE = {
  CONCLUSAO_OS: 'OS_ESTADO',
  REGISTRO_KM: 'OS_ESTADO',
  ACEITE_CLIENTE: 'OS_ESTADO',
  APONTAMENTO: 'APONTAMENTO',
  CHECKLIST_RESPOSTA: 'CHECKLIST',
  UPLOAD_FOTO: 'FOTO',
  ASSINATURA: 'ASSINATURA',
  REGISTRO_MEDICAO: 'MEDICAO',
};

function garantirLogCentral(ss) {
  let sheet = ss.getSheetByName('Log_Central');
  if (sheet) {
    _garantirColunasOutboxLogCentral(sheet);
    return sheet;
  }

  sheet = ss.insertSheet('Log_Central');
  const nomes = LOG_CENTRAL_COLUNAS.map(c => c.nome)
    .concat([LOG_CENTRAL_COL_RESULTADO])
    .concat(LOG_CENTRAL_COLUNAS_OUTBOX.map(c => c.nome));
  const numCols = nomes.length;

  // 1) cabecalho: negrito + freeze na linha 1.
  const headerRange = sheet.getRange(1, 1, 1, numCols);
  headerRange.setValues([nomes]);
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);

  // 2) larguras.
  LOG_CENTRAL_COLUNAS.forEach((c, i) => sheet.setColumnWidth(i + 1, c.largura));
  const offsetOutbox = LOG_CENTRAL_COLUNAS.length + 2; // +1 pula pra depois de A-M, +1 pula resultado_json (14a coluna)
  LOG_CENTRAL_COLUNAS_OUTBOX.forEach((c, i) => sheet.setColumnWidth(offsetOutbox + i, c.largura));

  // 3) CRITICO: F,G,H,I (criado_em/enviado_em/recebido_em/sincronizado_em)
  // como texto simples ANTES de qualquer dado -- evita o Sheets
  // autoconverter ISO 8601 em Date com timezone silencioso.
  ['criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em'].forEach(nome => {
    const idx = nomes.indexOf(nome) + 1;
    sheet.getRange(1, idx, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('@');
  });

  // 4) tentativas (K) como inteiro, 0 casas decimais.
  const idxTentativasCol = nomes.indexOf('tentativas') + 1;
  sheet.getRange(1, idxTentativasCol, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');

  // 5) validacoes "Reject input", aplicadas de <col>2:<col><teto> em diante.
  const aplicarListaRejeitando = (nomeCol, valores) => {
    const idx = nomes.indexOf(nomeCol) + 1;
    const range = sheet.getRange(2, idx, LOG_CENTRAL_LINHAS_VALIDACAO - 1, 1);
    const regra = SpreadsheetApp.newDataValidation()
      .requireValueInList(valores, true)
      .setAllowInvalid(false)
      .build();
    range.setDataValidation(regra);
  };
  aplicarListaRejeitando('status', LOG_CENTRAL_STATUS_VALIDOS);
  aplicarListaRejeitando('tipo_operacao', LOG_CENTRAL_TIPO_OPERACAO_VALIDOS);
  // erro_codigo: mesma validacao de lista, mas NAO obrigatorio -- a
  // maioria das linhas fica vazia (so preenche em SYNC_ERROR/DIVERGENT).
  // requireValueInList com allowInvalid:false ainda aceita celula VAZIA
  // (reject input so barra valor preenchido fora da lista, nao a ausencia
  // de valor) -- comportamento nativo do Sheets, sem precisar de regra
  // separada pra "opcional".
  aplicarListaRejeitando('erro_codigo', LOG_CENTRAL_ERRO_CODIGO_VALIDOS);
  aplicarListaRejeitando('entity_type', LOG_CENTRAL_ENTITY_TYPE_VALIDOS);

  const idxTentativasValid = nomes.indexOf('tentativas') + 1;
  const rangeTentativas = sheet.getRange(2, idxTentativasValid, LOG_CENTRAL_LINHAS_VALIDACAO - 1, 1);
  const regraTentativas = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=AND(ISNUMBER(K2), K2>=0, K2=INT(K2))')
    .setAllowInvalid(false)
    .build();
  rangeTentativas.setDataValidation(regraTentativas);

  // 6) entity_version como inteiro, mesmo tratamento de tentativas.
  const idxVersaoCol = nomes.indexOf('entity_version') + 1;
  sheet.getRange(1, idxVersaoCol, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');

  return sheet;
}

// _garantirColunasOutboxLogCentral -- idempotente, mesmo padrao das
// outras colunas novas do projeto (setupSheets): se Log_Central ja foi
// criado ANTES desta rodada (schema sem entity_type/entity_id/
// entity_version), adiciona as 3 colunas no final sem mexer no resto.
function _garantirColunasOutboxLogCentral(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  LOG_CENTRAL_COLUNAS_OUTBOX.forEach(c => {
    if (!headers.includes(c.nome)) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(c.nome);
      sheet.setColumnWidth(nextCol, c.largura);
      if (c.nome === 'entity_version') sheet.getRange(1, nextCol, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');
    }
  });
}

// classificarErroLogCentral: heurística best-effort pra encaixar uma
// mensagem de erro real (variada, texto livre) num dos 11 códigos
// fechados aprovados pra erro_codigo. Não é perfeito -- é um
// classificador por palavra-chave, documentado como tal. Cai em
// ERRO_DESCONHECIDO quando nada bate, nunca deixa a coluna com valor
// fora da lista (isso quebraria a validação Reject input).
function classificarErroLogCentral(mensagem) {
  const m = String(mensagem || '').toLowerCase();
  if (/timeout|tempo esgotado/.test(m)) return 'TIMEOUT';
  if (/quota/.test(m)) return 'QUOTA_EXCEDIDA';
  if (/permiss|access denied|not authorized|nao autorizad/.test(m)) return 'PERMISSAO_NEGADA';
  if (/not found|nao encontrad/.test(m)) return 'REFERENCIA_INVALIDA';
  if (/duplicat|duplicad/.test(m)) return 'DUPLICADO';
  if (/invalid|invalido|payload/.test(m)) return 'PAYLOAD_INVALIDO';
  if (/conflict|conflito|version/.test(m)) return 'CONFLITO_VERSAO';
  if (/network|conexao|connection|unavailable|indispon/.test(m)) return 'CONEXAO_INDISPONIVEL';
  return 'ERRO_DESCONHECIDO';
}

// _comLockDeOS -- LockService.getScriptLock() (ARQUITETURA-SYNC-LOG-
// CENTRAL.md, ponto 3). Apps Script nao tem lock nativo por chave
// arbitraria (nao da pra travar "so a OS-123") -- a unica API real e
// script-inteiro/documento-inteiro. Serializa TODAS as operacoes
// criticas entre si, nao so as da mesma OS -- limitacao real, aceitavel
// no volume de uso do PWA, documentada no arquivo acima. Se o lock nao
// e obtido dentro do timeout, fn() NAO roda e nada e gravado em
// Log_Central (evita poluir o log com uma tentativa que nunca
// aconteceu) -- retry do MESMO operationId tenta de novo do zero, sem
// violar idempotencia.
const LOCK_TIMEOUT_MS = 10000;

function _comLockDeOS(fn) {
  const lock = LockService.getScriptLock();
  const obtido = lock.tryLock(LOCK_TIMEOUT_MS);
  if (!obtido) {
    return _recusa('Sistema ocupado, tente novamente em instantes');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// _proximaVersaoEntidadeOS -- maior entity_version ja gravado em
// Log_Central pra este OS_ID, +1 (ou 1 se nenhum ainda). SO deve ser
// chamada de dentro de _comLockDeOS -- ler-incrementar fora do lock e
// exatamente a corrida que o ponto 3 do auditor pede pra fechar.
function _proximaVersaoEntidadeOS(osId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const log = garantirLogCentral(ss);
  const dados = log.getDataRange().getValues();
  const h = dados[0];
  const idxOS = h.indexOf('OS_ID');
  const idxVersao = h.indexOf('entity_version');
  let maior = 0;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxOS]) !== String(osId)) continue;
    const v = parseInt(dados[i][idxVersao]) || 0;
    if (v > maior) maior = v;
  }
  return maior + 1;
}

// executarIdempotente: todo ponto de escrita crítico (checklist, fotos,
// aceite, KM, apontamentos, assinatura, medição, conclusão) deveria
// passar por aqui. Sem operationId, comportamento antigo preservado
// (roda fn() direto, sem dedup) — compatibilidade retroativa com
// chamadores ainda não migrados.
//
// `entidade` (opcional, {tipo, id}) -- ARQUITETURA-SYNC-LOG-CENTRAL.md,
// ponto 2/6. Sem ele, entity_type e derivado de tipoOperacao (mapeamento
// TIPO_OPERACAO_PARA_ENTITY_TYPE) e entity_id vira o proprio osId --
// suficiente pras mutacoes de estado da OS. Chamadores que escrevem
// mais de uma "coisa" na mesma OS (fotos: Laudo_URL vs Selfie_URL;
// checklist: fase ou pergunta) passam `entidade.id` explicito
// (osId + ':' + algo) pra nao colidir entity_id entre eventos
// genuinamente diferentes da mesma OS.
function executarIdempotente(operationId, tipoOperacao, osId, tecnicoId, dispositivoId, fn, entidade) {
  if (!operationId) return fn();

  const entityType = (entidade && entidade.tipo) || TIPO_OPERACAO_PARA_ENTITY_TYPE[tipoOperacao] || '';
  const entityId = (entidade && entidade.id) || osId || '';

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const log = garantirLogCentral(ss);
  const dados = log.getDataRange().getValues();
  const h = dados[0];
  const idxOpId = h.indexOf('operation_id');
  const idxStatus = h.indexOf('status');
  const idxResultado = h.indexOf('resultado_json');
  const idxTentativas = h.indexOf('tentativas');

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxOpId]) !== String(operationId)) continue;

    if (dados[i][idxStatus] === 'SYNCED') {
      // Já processado com sucesso — devolve o MESMO resultado gravado,
      // NÃO roda fn() de novo. Isso é o que torna isto idempotência de
      // verdade, não só "melhor esforço".
      try {
        return JSON.parse(dados[i][idxResultado]);
      } catch (eParse) {
        // resultado salvo corrompido (não deveria acontecer) — cai pro
        // reprocessamento abaixo em vez de travar o técnico pra sempre.
      }
    }
    // Existe mas não SYNCED (tentativa anterior deu erro) — reprocessa.
    // MESMA entity_version da tentativa original (retry nao e evento
    // novo) -- so a gravacao de fn()+Log_Central roda sob lock.
    return _comLockDeOS(() => {
      const tentativaAtual = (parseInt(dados[i][idxTentativas]) || 0) + 1;
      log.getRange(i + 1, idxTentativas + 1).setValue(tentativaAtual);
      log.getRange(i + 1, idxStatus + 1).setValue('SENDING');
      return processarEGravarLog(log, i + 1, h, fn);
    });
  }

  // Primeira vez que este operation_id aparece -- sob lock: ler versao
  // atual -> incrementar -> gravar entidade (fn(), dentro de
  // processarEGravarLog) -> gravar Log_Central -> liberar lock. Isto
  // fecha o cenario real "entidade alterada + Log_Central falhou": se a
  // gravacao do Log_Central falhasse DEPOIS de fn() ja ter rodado, um
  // retry da MESMA operationId reexecutaria fn() de novo (idempotencia
  // quebrada, sem registro de que ja tinha rodado); com as duas escritas
  // na MESMA tentativa sob o mesmo lock, um erro no meio propaga pro
  // chamador (nao fica um operation_id "orfao" sem rastro nenhum).
  return _comLockDeOS(() => {
    const versao = _proximaVersaoEntidadeOS(osId);
    const linha = new Array(h.length).fill('');
    linha[idxOpId] = operationId;
    linha[h.indexOf('OS_ID')] = osId || '';
    linha[h.indexOf('tecnico_id')] = tecnicoId || '';
    linha[h.indexOf('dispositivo_id')] = dispositivoId || '';
    linha[h.indexOf('tipo_operacao')] = tipoOperacao || '';
    // F/G/H/I sao TEXTO ISO 8601, nunca Date nativo (spec critica —
    // Date nativo ignora a formatacao '@' da coluna e o Sheets ainda
    // aplica timezone/serial silenciosamente).
    linha[h.indexOf('criado_em')] = new Date().toISOString();
    linha[h.indexOf('recebido_em')] = new Date().toISOString();
    linha[idxStatus] = 'SENDING';
    linha[idxTentativas] = 1;
    const idxEntityType = h.indexOf('entity_type');
    const idxEntityId = h.indexOf('entity_id');
    const idxEntityVersion = h.indexOf('entity_version');
    if (idxEntityType >= 0) linha[idxEntityType] = entityType;
    if (idxEntityId >= 0) linha[idxEntityId] = entityId;
    if (idxEntityVersion >= 0) linha[idxEntityVersion] = versao;
    log.appendRow(linha);
    return processarEGravarLog(log, log.getLastRow(), h, fn);
  });
}

function processarEGravarLog(log, linhaNum, headers, fn) {
  const idxStatus = headers.indexOf('status');
  const idxResultado = headers.indexOf('resultado_json');
  const idxSinc = headers.indexOf('sincronizado_em');
  const idxErro = headers.indexOf('erro_detalhe');
  const idxErroCodigo = headers.indexOf('erro_codigo');
  try {
    const resultado = fn();
    log.getRange(linhaNum, idxStatus + 1).setValue('SYNCED');
    log.getRange(linhaNum, idxResultado + 1).setValue(JSON.stringify(resultado));
    // sincronizado_em (coluna I) e TEXTO ISO 8601, nunca Date nativo —
    // mesma regra critica de criado_em/recebido_em (ver executarIdempotente).
    log.getRange(linhaNum, idxSinc + 1).setValue(new Date().toISOString());
    return resultado;
  } catch (e) {
    const mensagem = String((e && e.message) || e);
    log.getRange(linhaNum, idxStatus + 1).setValue('SYNC_ERROR');
    log.getRange(linhaNum, idxErro + 1).setValue(mensagem);
    if (idxErroCodigo >= 0) log.getRange(linhaNum, idxErroCodigo + 1).setValue(classificarErroLogCentral(mensagem));
    throw e;
  }
}

// consultarStatusOperacao — pro frontend confirmar se um upload via
// POST no-cors (salvarArquivoOS) foi processado. no-cors nao deixa ler
// a resposta do POST em si (a request chega e roda no servidor, só a
// LEITURA do corpo da resposta é bloqueada pelo browser) — por isso o
// frontend manda o operationId, faz o POST sem esperar resposta legível,
// e confirma via este GET/JSONP normal (corpo pequeno, sem essa restrição).
function consultarStatusOperacao(operationId) {
  if (!operationId) return { encontrado: false, erro: 'operationId obrigatorio' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const log = ss.getSheetByName('Log_Central');
  if (!log) return { encontrado: false };
  const dados = log.getDataRange().getValues();
  const h = dados[0];
  const idxOpId = h.indexOf('operation_id');
  const idxStatus = h.indexOf('status');
  const idxResultado = h.indexOf('resultado_json');
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxOpId]) !== String(operationId)) continue;
    let resultado = null;
    try { resultado = JSON.parse(dados[i][idxResultado]); } catch (eParse) { /* ainda sem resultado (SENDING) */ }
    return { encontrado: true, status: dados[i][idxStatus], resultado: resultado };
  }
  return { encontrado: false };
}

// ─── salvarArquivoOS — Frente B (fatia prioritaria, Diretriz v1.1) ───
// Grava Laudo_URL/Assinatura_URL: recebe o arquivo em base64 (chega via
// POST, nao GET/JSONP — imagem em base64 estoura limite de tamanho de
// URL), salva no Drive numa pasta dedicada, e grava a URL pública na OS.
function _pastaEvidenciasOS() {
  const NOME_PASTA = 'Eletrium_Evidencias_OS';
  const arquivoSheet = DriveApp.getFileById(SHEET_ID);
  const pais = arquivoSheet.getParents();
  const raiz = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  const existentes = raiz.getFoldersByName(NOME_PASTA);
  return existentes.hasNext() ? existentes.next() : raiz.createFolder(NOME_PASTA);
}

// KM_Foto_Desvio_URL liberado 12/08 -- contrato da sessao de frontend
// (CONTRATO-BACKEND-FOTO-DESVIO-KM.md): a coluna ja era escrita por
// validarESalvarKMInicial/registrarKMFinalPendente, so faltava essa
// allow-list pra salvarArquivoOS aceitar o upload real da foto de
// desvio (antes disso, o desvio ficava permanentemente travado sem
// app-side nenhum jeito de cumprir a exigencia de foto).
const CAMPOS_ARQUIVO_PERMITIDOS = ['Laudo_URL', 'Assinatura_URL', 'KM_Foto_Desvio_URL'];

function salvarArquivoOS(osId, tecnicoId, campo, base64Data, mimeType, nomeArquivo, operationId, dispositivoId) {
  if (CAMPOS_ARQUIVO_PERMITIDOS.indexOf(campo) < 0) {
    return _recusa('Campo nao permitido: ' + campo);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);
  // tipo_operacao pro Log_Central (lista fechada aprovada Geovane/Cowork
  // 2, 12/08): Assinatura_URL bate exato com ASSINATURA. Laudo_URL nao
  // tem categoria propria na lista aprovada -- aproximado pra UPLOAD_FOTO
  // (o mais proximo semanticamente: evidencia fotografica/documental
  // anexada). Sinalizado aqui de proposito, nao escolhido silenciosamente.
  const tipoOp = campo === 'Assinatura_URL' ? 'ASSINATURA' : 'UPLOAD_FOTO';
  // entity_id inclui o campo (nao so osId) -- uma OS pode ter mais de um
  // UPLOAD_FOTO (Laudo_URL, e via salvarSelfieEPI a selfie tambem cai
  // aqui) na mesma OS; sem o campo no entity_id os dois colidiriam no
  // mesmo par (entity_type=FOTO, entity_id=OS_ID), indistinguivel pro
  // consumidor do Outbox (ARQUITETURA-SYNC-LOG-CENTRAL.md).
  return executarIdempotente(operationId, tipoOp, osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa('OS nao encontrada: ' + osId);

    const col = getCol(campo);
    if (!col) return _recusa('Coluna ' + campo + ' nao existe na planilha (rode rodarSetupSheets)');

    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', nomeArquivo || (campo + '_' + osId + '.jpg'));
    const pasta = _pastaEvidenciasOS();
    const arquivo = pasta.createFile(blob);
    arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = arquivo.getUrl();

    osSheet.getRange(osRow, col).setValue(url);
    return { sucesso: true, url: url, campo: campo };
  }, { tipo: tipoOp === 'ASSINATURA' ? 'ASSINATURA' : 'FOTO', id: osId + ':' + campo });
}

// ─── confirmarSegurancaPreExecucao — Frente B (fatia prioritaria) ────
// VERSAO INTERIM/SIMPLIFICADA, documentada como tal de proposito: o
// admin deriva Estado_Seguranca do motor COMPLETO de checklist
// versionado (Perguntas_Checklist com fases/versoes congeladas/NC por
// pergunta — ver checklist.html, comentario B4). Portar esse motor
// inteiro pro PWA e o item MAIOR da Frente B ("checklist em 3 fases"),
// ainda pendente. Esta funcao e um degrau intermediario deliberado:
// um conjunto pequeno e explicito de confirmacoes de seguranca que o
// tecnico atesta antes de iniciar a execucao — suficiente pra
// Estado_Seguranca parar de ser uma coluna inexistente (o que fazia
// canCloseOS bloquear SEMPRE, Frente C) sem esperar o motor completo.
// Quando o checklist 3 fases for portado, ele deve virar o escritor
// real desta coluna — isto aqui nao e a versao final.
const CONFIRMACOES_SEGURANCA_MIN = ['epi', 'aterramento', 'bloqueio_energia', 'sinalizacao_area'];

function confirmarSegurancaPreExecucao(osId, tecnicoId, confirmacoes, temNaoConformidade, operationId, dispositivoId) {
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);
  // tipo_operacao pro Log_Central: a lista fechada aprovada (Geovane/
  // Cowork 2, 12/08) nao tem categoria propria pra "confirmacao de
  // seguranca" -- aproximado pra CHECKLIST_RESPOSTA (o mais proximo
  // semanticamente: e literalmente o degrau interim que antecede o
  // motor de checklist de verdade). Sinalizado aqui, nao escolhido
  // silenciosamente -- vale confirmar com o dono se cabe.
  return executarIdempotente(operationId, 'CHECKLIST_RESPOSTA', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa('OS nao encontrada: ' + osId);

    const colEstado = getCol('Estado_Seguranca');
    if (!colEstado) return _recusa('Coluna Estado_Seguranca nao existe na planilha (rode rodarSetupSheets)');

    const c = confirmacoes || {};
    const faltando = CONFIRMACOES_SEGURANCA_MIN.filter(item => !c[item]);
    if (faltando.length) {
      return _recusa('Confirmacoes de seguranca incompletas', { faltando: faltando, motivos: faltando });
    }

    const novoEstado = temNaoConformidade ? 'Bloqueado' : 'Liberado';
    osSheet.getRange(osRow, colEstado).setValue(novoEstado);
    return { sucesso: true, estado: novoEstado };
  });
}

// ─── salvarSelfieEPI — Frente B, fatia 2 (Diretriz v1.1) ─────────────
// No admin, selfie+EPI vivem em OS_Equipe (1 linha por MEMBRO da
// equipe por OS — Funcao: Líder/Eletricista/Ajudante/Apoio,
// Elegivel_Financeiro = Selfie_URL preenchida E Diario_Preenchido,
// EPI_Checklist_OK=false BLOQUEIA pagamento em medicao.html). O PWA
// hoje só rastreia 1 técnico por OS (Tecnico_ID/Tecnico_Nome direto em
// Ordens_Servico — não existe conceito de equipe/múltiplos técnicos
// aqui ainda). Por isso esta fatia grava os campos direto na linha da
// OS, cobrindo o caso comum (1 técnico), não o roster completo de
// equipe — isso é uma limitação real, registrada de propósito, não
// escondida. Portar OS_Equipe pro PWA (multi-técnico) fica de fora
// desta fatia.
//
// Lista de itens do EPI é uma composição razoável pro trabalho elétrico
// descrito no módulo (capacete, luvas isolantes, óculos, calçado de
// segurança, cinto) — não confirmada contra um EPI_Checklist_JSON
// canônico do admin (a pesquisa não achou um schema fixo documentado
// pra isso). Vale o dono conferir/ajustar a lista antes do deploy.
const EPI_ITENS_MIN = ['capacete', 'luvas_isolantes', 'oculos_protecao', 'calcado_seguranca', 'cinto_seguranca'];

function salvarSelfieEPI(osId, tecnicoId, base64Selfie, mimeType, epiChecklist, diarioTexto, operationId, dispositivoId) {
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);
  // tipo_operacao pro Log_Central: sem categoria propria "selfie" na
  // lista aprovada -- aproximado pra UPLOAD_FOTO (a selfie e uma foto;
  // EPI/diario sao dados secundarios na mesma chamada). Sinalizado, nao
  // escolhido silenciosamente.
  return executarIdempotente(operationId, 'UPLOAD_FOTO', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa('OS nao encontrada: ' + osId);

    const colSelfie = getCol('Selfie_URL');
    const colEpiOk = getCol('EPI_Checklist_OK');
    const colEpiJson = getCol('EPI_Checklist_JSON');
    const colDiario = getCol('Diario_Tecnico');
    const colDiarioOk = getCol('Diario_Preenchido');
    if (!colSelfie || !colEpiOk || !colEpiJson || !colDiario || !colDiarioOk) {
      return _recusa('Colunas de Selfie/EPI/Diario nao existem na planilha (rode rodarSetupSheets)');
    }

    let urlNova = '';
    if (base64Selfie) {
      const bytes = Utilities.base64Decode(base64Selfie);
      const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', 'selfie_' + osId + '.jpg');
      const pasta = _pastaEvidenciasOS();
      const arquivo = pasta.createFile(blob);
      arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urlNova = arquivo.getUrl();
      osSheet.getRange(osRow, colSelfie).setValue(urlNova);
    }

    const epi = epiChecklist || {};
    const epiOk = EPI_ITENS_MIN.every(item => !!epi[item]);
    osSheet.getRange(osRow, colEpiJson).setValue(JSON.stringify(epi));
    osSheet.getRange(osRow, colEpiOk).setValue(epiOk);

    const diarioPreenchido = !!(diarioTexto && String(diarioTexto).trim());
    if (diarioTexto !== undefined && diarioTexto !== null) osSheet.getRange(osRow, colDiario).setValue(diarioTexto);
    osSheet.getRange(osRow, colDiarioOk).setValue(diarioPreenchido);

    const selfieAtual = String(osSheet.getRange(osRow, colSelfie).getValue() || '').trim();
    return {
      sucesso: true,
      url: urlNova || selfieAtual,
      epiOk: epiOk,
      diarioPreenchido: diarioPreenchido,
      // espelha a mesma formula do admin (os.html) — so leitura aqui,
      // nao gate de nada; informativo pro tecnico ver se ja esta elegivel.
      elegivelFinanceiro: !!selfieAtual && diarioPreenchido
    };
  // entity_id distingue a selfie do Laudo_URL (tambem UPLOAD_FOTO na
  // mesma OS via salvarArquivoOS) -- mesmo motivo do campo no entity_id
  // de salvarArquivoOS.
  }, { tipo: 'FOTO', id: osId + ':Selfie_URL' });
}

// ─── getCol ───────────────────────────────────────────────────────
function getCol(campo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ordens_Servico');
  if (!sheet) return null;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(campo);
  return idx >= 0 ? idx + 1 : null;
}

// ─── getColDiaria ─────────────────────────────────────────────────
function getColDiaria(campo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return null;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(campo);
  return idx >= 0 ? idx + 1 : null;
}

// ─── addMissingHeaders ────────────────────────────────────────────
// Adiciona colunas KM/Veiculo em Diaria_Tecnico se nao existirem.
// Chamada automaticamente por registrarInicioDia e setupSheets.
function addMissingHeaders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return 'Aba Diaria_Tecnico nao encontrada';
  const novosCampos = ['Usa_Veiculo_Hoje', 'KM_Inicial', 'KM_Final', 'KM_Rodado', 'Veiculo_ID'];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  novosCampos.forEach(campo => {
    if (!headers.includes(campo)) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(campo);
      Logger.log('Diaria_Tecnico: adicionado ' + campo + ' na coluna ' + nextCol);
    }
  });
  return 'OK';
}

// ─── encontrarLinha ───────────────────────────────────────────────
function encontrarLinha(sheet, valor, colIndex) {
  if (!sheet) return null;
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][colIndex]) === String(valor)) return i + 1;
  }
  return null;
}

// ─── verificarPosseOS — Frente E, Opcao C (Diretriz v1.1) ────────
// Checagem de posse: confere que o tecnicoId que esta chamando e o
// mesmo atribuido a OS (Ordens_Servico.ID_Tecnico) antes de aceitar
// uma escrita critica. Camada barata (ver docs/DESENHO-FRENTE-E-
// AUTH-DISPATCHER.md, Opcao C) -- fecha o pior caso concreto
// (adulterar a OS de OUTRO tecnico), mas nao exige ter passado pelo
// PIN nem impede alguem que ja SABE o Tecnico_ID de outro tecnico de
// agir como ele. A correcao real (token de sessao assinado, Opcao A)
// fica pra depois, com decisao separada. Fail-open SO quando a coluna
// ID_Tecnico nao existe (planilha ainda sem o schema, mesmo padrao
// usado em canCloseOS) -- nunca quando ela existe mas esta vazia ou
// diferente do tecnicoId recebido.
function verificarPosseOS(osId, tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  if (!osSheet) return { ok: false, erro: 'OS nao encontrada: ' + osId };
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { ok: false, erro: 'OS nao encontrada: ' + osId };

  const colTec = getCol('ID_Tecnico');
  if (!colTec) return { ok: true };

  const tecnicoDaOS = String(osSheet.getRange(osRow, colTec).getValue() || '').trim();
  if (tecnicoDaOS !== String(tecnicoId || '').trim()) {
    return { ok: false, erro: 'Tecnico ' + tecnicoId + ' nao tem posse da OS ' + osId };
  }
  return { ok: true };
}

// ─── _recusa — envelope canonico de rejeicao ─────────────────────
// Achado do Code 2 (revisao das 5 fatias em conjunto, citacao direta de
// codigo): processarFilaOffline so reconhecia uma recusa do backend
// como DIVERGENT quando a resposta tinha `blockingReasons` -- formato
// exclusivo de canCloseOS/encerrarOS. Toda outra forma de recusa
// (exigeJustificativa do KM, erro+faltando do checklist, e os
// contratos novos de ferramental/aceite-oferta) passava batido: sem
// blockingReasons, o item era marcado SYNCED e removido da fila em
// silencio, mesmo tendo sido recusado -- o tecnico nunca ficava
// sabendo que a escrita nao aconteceu.
//
// Fix estrutural, nao so mais um campo novo no processarFilaOffline:
// TODA funcao de escrita que recusa passa a devolver o MESMO envelope
// -- sucesso:false + erro (string) SEMPRE presentes, motivos (array de
// strings) generalizando blockingReasons/faltando/exigeJustificativa
// num campo unico. Ver CONTRATO-FRONTEND-ENVELOPE-RECUSA.md pro que o
// frontend deve checar (response.sucesso===false), nao mais um campo
// especifico por funcao. Campos legados (blockingReasons/faltando/
// exigeJustificativa/mensagem) continuam presentes via `extras` --
// nao removidos, nada que ja leia eles quebra.
function _recusa(erro, extras) {
  return Object.assign({ sucesso: false, erro: erro, motivos: [erro] }, extras || {});
}

// ─── encontrarOuCriarLinhaDiaria ──────────────────────────────────
function encontrarOuCriarLinhaDiaria(sheet, tecnicoId, hoje) {
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    const dataLinha = dados[i][0] instanceof Date
      ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
      : String(dados[i][0]).substring(0, 10);
    if (dataLinha === hoje && String(dados[i][1]) === String(tecnicoId)) return i + 1;
  }
  // Criar nova linha
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tecSheet = ss.getSheetByName('Tecnicos_MEI');
  let tecNome = '';
  if (tecSheet) {
    const td = tecSheet.getDataRange().getValues();
    const h = td[0];
    const idxId = h.indexOf('ID_Tecnico');
    const idxNome = h.indexOf('Nome');
    for (let i = 1; i < td.length; i++) {
      if (String(td[i][idxId >= 0 ? idxId : 0]) === String(tecnicoId)) {
        tecNome = String(td[i][idxNome >= 0 ? idxNome : 1]); break;
      }
    }
  }
  sheet.appendRow([hoje, tecnicoId, tecNome, '', '', 0, 0, 0, 0, '', '', 0, 'Em campo', 0, '']);
  return sheet.getLastRow();
}

// ─── calcularHoras ────────────────────────────────────────────────
function calcularHoras(inicio, fim) {
  if (!inicio || !fim) return 0;
  const i = inicio instanceof Date ? inicio : new Date(inicio);
  const f = fim instanceof Date ? fim : new Date(fim);
  return Math.max(0, (f - i) / 3600000);
}

// ─── formatarHora ─────────────────────────────────────────────────
function formatarHora(date) {
  if (!date) return '';
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), TZ, 'HH:mm');
}

// ─── formatarDuracao ─────────────────────────────────────────────
function formatarDuracao(horas) {
  const h = Math.floor(horas || 0);
  const m = Math.round(((horas || 0) - h) * 60);
  return h + 'h' + (m < 10 ? '0' : '') + m;
}

// ─── registrarSegmento ───────────────────────────────────────────
function registrarSegmento(ss, osId, tecId, tecNome, tipo, timestamp, durMin, horasAcum, local) {
  const seg = ss.getSheetByName('OS_Segmentos');
  if (!seg) return;
  const id = 'SEG-' + new Date().getTime();
  seg.appendRow([
    id, String(osId), '', String(tecId), String(tecNome),
    tipo, timestamp, durMin || 0, horasAcum || 0,
    '', '', true, local || ''
  ]);
}

// ─── atualizarDiaria ─────────────────────────────────────────────
function atualizarDiaria(ss, tecId, tecNome, now, tipo, horas, osId) {
  const diariaSheet = ss.getSheetByName('Diaria_Tecnico');
  if (!diariaSheet) return;
  const hoje = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');

  const dados = diariaSheet.getDataRange().getValues();
  let linha = null;
  for (let i = 1; i < dados.length; i++) {
    const dataLinha = dados[i][0] instanceof Date
      ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
      : String(dados[i][0]).substring(0, 10);
    if (dataLinha === hoje && String(dados[i][1]) === String(tecId)) {
      linha = i + 1; break;
    }
  }

  if (!linha) {
    diariaSheet.appendRow([hoje, tecId, tecNome, tipo === 'entrada' ? now : '',
      '', 0, 0, 0, 0, '', '', 0, 'Em campo', 0, '']);
    linha = diariaSheet.getLastRow();
  }

  if (tipo === 'entrada') {
    diariaSheet.getRange(linha, 4).setValue(now);
  } else if (tipo === 'saida') {
    const horasProd = (parseFloat(diariaSheet.getRange(linha, 6).getValue()) || 0) + (horas || 0);
    const qtdOS = (parseInt(diariaSheet.getRange(linha, 9).getValue()) || 0) + 1;
    const osLista = String(diariaSheet.getRange(linha, 10).getValue() || '');
    diariaSheet.getRange(linha, 5).setValue(now);
    diariaSheet.getRange(linha, 6).setValue(horasProd);
    diariaSheet.getRange(linha, 8).setValue(horasProd);
    diariaSheet.getRange(linha, 9).setValue(qtdOS);
    diariaSheet.getRange(linha, 10).setValue(osLista ? osLista + ', ' + osId : String(osId));
    diariaSheet.getRange(linha, 13).setValue('Encerrado');
  }
}

// ─── getTecnicos ─────────────────────────────────────────────────
function getTecnicos() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Tecnicos_MEI');
  if (!sheet) return [];
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const idxId = h.indexOf('ID_Tecnico');
  const idxNome = h.indexOf('Nome');
  const result = [];
  for (let i = 1; i < dados.length; i++) {
    const id = dados[i][idxId >= 0 ? idxId : 0];
    const nome = dados[i][idxNome >= 0 ? idxNome : 1];
    if (id) result.push({ id: String(id), nome: String(nome) });
  }
  return result;
}

// ─── getClientes ─────────────────────────────────────────────────
function getClientes() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Clientes');
  if (!sheet) return [];
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const idxId = h.indexOf('ID_Cliente');
  const idxNome = h.indexOf('Nome');
  const result = [];
  for (let i = 1; i < dados.length; i++) {
    const id = dados[i][idxId >= 0 ? idxId : 0];
    const nome = dados[i][idxNome >= 0 ? idxNome : 1];
    if (id) result.push({ id: String(id), nome: String(nome) });
  }
  return result;
}

// ─── getOsDoTecnico ──────────────────────────────────────────────
function getOsDoTecnico(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ordens_Servico');
  if (!sheet) return [];

  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  const col = name => h.indexOf(name);
  const iId = col('ID_OS');
  const iCliente = col('Nome_Cliente');
  const iDesc = col('Descricao');
  const iStatus = col('Status');
  const iStatusAtual = col('Status_Atual');
  const iTecnico = (col('ID_Tecnico') >= 0 ? col('ID_Tecnico') : col('Nome_Tecnico'));
  const iData = Math.max(col('DataPrevista'), col('Data_Abertura'), col('Data_OS'));
  const iHoraInicio = col('Hora_Inicio');
  const iHoraEnc = col('Hora_Encerramento');
  const iHorasProd = col('Horas_Produtivas');
  const iEmPausa = col('Em_Pausa_Agora');
  const iMotivoPausa = col('Motivo_Pausa_Atual');
  const iQtdReal = col('Qtd_Realizada');
  const iMeta = col('Meta_Dia');
  const iUnidade = col('Unidade_Meta');
  const iPct = col('Pct_Acumulado');
  const iPrioridade = col('Prioridade_OS');

  const result = [];
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (!row[iId]) continue;

    const status = iStatus >= 0 ? String(row[iStatus]) : '';
    const statusAtual = iStatusAtual >= 0 ? String(row[iStatusAtual]) : '';

    const dataRow = iData >= 0 && row[iData] instanceof Date
      ? Utilities.formatDate(row[iData], TZ, 'yyyy-MM-dd') : '';
    const isHoje = dataRow === hoje;
    // 'status' (coluna Status) usa 'Em Andamento' com acento/maiuscula desde o
    // fix de validacao de dados (10/08) -- clausula corrigida junto pra nao
    // ficar morta (nunca mais batia sozinha, so sobrevivia pelo || com statusAtual).
    const isAtiva = status === 'Em Andamento' || statusAtual === 'Em andamento'
      || (statusAtual && statusAtual.startsWith('Pausada'));

    if (!isHoje && !isAtiva) continue;

    const tecNaOS = iTecnico >= 0 ? String(row[iTecnico]) : '';
    const isMeu = tecNaOS === String(tecnicoId)
      || tecNaOS.toLowerCase().includes(String(tecnicoId).toLowerCase());
    if (!isMeu && tecNaOS) continue;

    const horasProd = iHorasProd >= 0 ? (parseFloat(row[iHorasProd]) || 0) : 0;
    result.push({
      id: String(row[iId]),
      cliente: iCliente >= 0 ? String(row[iCliente] || '') : '',
      descricao: iDesc >= 0 ? String(row[iDesc] || '').substring(0, 80) : '',
      status: status,
      statusAtual: statusAtual,
      horaInicio: iHoraInicio >= 0 && row[iHoraInicio] instanceof Date ? formatarHora(row[iHoraInicio]) : '',
      horaEnc: iHoraEnc >= 0 && row[iHoraEnc] instanceof Date ? formatarHora(row[iHoraEnc]) : '',
      horasProdutivas: horasProd,
      horasProdFormatadas: formatarDuracao(horasProd),
      emPausa: iEmPausa >= 0 ? (row[iEmPausa] === true || row[iEmPausa] === 'TRUE') : false,
      motivoPausa: iMotivoPausa >= 0 ? String(row[iMotivoPausa] || '') : '',
      qtdRealizada: iQtdReal >= 0 ? (parseInt(row[iQtdReal]) || 0) : 0,
      metaDia: iMeta >= 0 ? (parseInt(row[iMeta]) || 0) : 0,
      unidadeMeta: iUnidade >= 0 ? String(row[iUnidade] || '') : '',
      pctAcumulado: iPct >= 0 ? (parseFloat(row[iPct]) || 0) : 0,
      prioridade: iPrioridade >= 0 ? String(row[iPrioridade] || 'Normal') : 'Normal'
    });
  }
  return result;
}

// ─── getDiariaTecnico ────────────────────────────────────────────
// Retorna resumo do dia incluindo campos KM/Veiculo (para Resumo)
function getDiariaTecnico(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return null;
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const gv = (campo, row) => { const i = h.indexOf(campo); return i >= 0 ? row[i] : null; };
  for (let i = 1; i < dados.length; i++) {
    const dataLinha = dados[i][0] instanceof Date
      ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
      : String(dados[i][0]).substring(0, 10);
    if (dataLinha === hoje && String(dados[i][1]) === String(tecnicoId)) {
      const horasProd = parseFloat(dados[i][5]) || 0;
      return {
        data: hoje,
        tecnicoId: String(dados[i][1]),
        tecnicoNome: String(dados[i][2]),
        horaEntrada: dados[i][3] instanceof Date ? formatarHora(dados[i][3]) : '',
        horaSaida: dados[i][4] instanceof Date ? formatarHora(dados[i][4]) : '',
        horasProdutivas: horasProd,
        horasProdFormatadas: formatarDuracao(horasProd),
        totalHoras: parseFloat(dados[i][7]) || horasProd,
        qtdOS: parseInt(dados[i][8]) || 0,
        osLista: String(dados[i][9] || ''),
        clientes: String(dados[i][10] || ''),
        qtdInterrupcoes: parseInt(dados[i][11]) || 0,
        statusDia: String(dados[i][12] || 'Em campo'),
        custoMO: parseFloat(dados[i][13]) || 0,
        usaVeiculo: gv('Usa_Veiculo_Hoje', dados[i]),
        kmInicial: gv('KM_Inicial', dados[i]),
        kmFinal: gv('KM_Final', dados[i]),
        kmRodado: gv('KM_Rodado', dados[i]),
        veiculoId: gv('Veiculo_ID', dados[i])
      };
    }
  }
  return null;
}

// ─── getDiariaHoje ────────────────────────────────────────────────
// Verifica se o tecnico ja iniciou o dia.
// { existe: false } -> mostrar Scr_Inicio_Dia
// { existe: true, ... } -> ir direto p/ Home
function getDiariaHoje(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return { existe: false };
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const gv = (campo, row) => { const i = h.indexOf(campo); return i >= 0 ? row[i] : null; };
  for (let i = 1; i < dados.length; i++) {
    const dl = dados[i][0] instanceof Date
      ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
      : String(dados[i][0]).substring(0, 10);
    if (dl === hoje && String(dados[i][1]) === String(tecnicoId)) {
      return {
        existe: true,
        horaEntrada: dados[i][3] instanceof Date ? formatarHora(dados[i][3]) : '',
        usaVeiculo: gv('Usa_Veiculo_Hoje', dados[i]),
        kmInicial: gv('KM_Inicial', dados[i]),
        kmFinal: gv('KM_Final', dados[i]),
        kmRodado: gv('KM_Rodado', dados[i]),
        veiculoId: gv('Veiculo_ID', dados[i])
      };
    }
  }
  return { existe: false };
}

// ─── registrarInicioDia ──────────────────────────────────────────
// Chamado pela Scr_Inicio_Dia apos responder "Usou veiculo hoje?"
// operationId/dispositivoId no final (Frente D) — backward-compat
// posicional, chamador antigo sem eles continua funcionando sem
// idempotencia.
function registrarInicioDia(tecnicoId, tecnicoNome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return _recusa('Aba Diaria_Tecnico nao encontrada');
  addMissingHeaders();
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const now = new Date();
  const linha = encontrarOuCriarLinhaDiaria(sheet, tecnicoId, hoje);
  sheet.getRange(linha, 4).setValue(now); // Hora_Entrada
  const usaBool = usaVeiculo === true || usaVeiculo === 'true';
  const colUsa = getColDiaria('Usa_Veiculo_Hoje');
  if (colUsa) sheet.getRange(linha, colUsa).setValue(usaBool);
  if (usaBool) {
    const colKMI = getColDiaria('KM_Inicial');
    const colVei = getColDiaria('Veiculo_ID');
    if (colKMI && kmInicial !== null && kmInicial !== '') {
      sheet.getRange(linha, colKMI).setValue(parseFloat(kmInicial) || 0);
    }
    if (colVei && veiculoId) sheet.getRange(linha, colVei).setValue(String(veiculoId));
  }
  return { sucesso: true, hora: formatarHora(now) };
  });
}

// ─── registrarFimDia ─────────────────────────────────────────────
// Chamado no Resumo quando o tecnico informa o KM final
function registrarFimDia(tecnicoId, kmFinal, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return _recusa('Aba Diaria_Tecnico nao encontrada');
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const now = new Date();
  const dados = sheet.getDataRange().getValues();
  let linha = null;
  for (let i = 1; i < dados.length; i++) {
    const dl = dados[i][0] instanceof Date
      ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
      : String(dados[i][0]).substring(0, 10);
    if (dl === hoje && String(dados[i][1]) === String(tecnicoId)) { linha = i + 1; break; }
  }
  if (!linha) return _recusa('Registro do dia nao encontrado');
  sheet.getRange(linha, 5).setValue(now);  // Hora_Saida
  sheet.getRange(linha, 13).setValue('Encerrado'); // Status_Dia
  let kmRodado = 0;
  if (kmFinal !== undefined && kmFinal !== null && kmFinal !== '') {
    const colKMF = getColDiaria('KM_Final');
    const colKMI = getColDiaria('KM_Inicial');
    const colKMR = getColDiaria('KM_Rodado');
    const kmFinalNum = parseFloat(kmFinal) || 0;
    if (colKMF) sheet.getRange(linha, colKMF).setValue(kmFinalNum);
    if (colKMI && colKMR) {
      const kmInicialVal = parseFloat(sheet.getRange(linha, colKMI).getValue()) || 0;
      kmRodado = Math.max(0, kmFinalNum - kmInicialVal);
      sheet.getRange(linha, colKMR).setValue(kmRodado);
    }
  }
  return { sucesso: true, hora: formatarHora(now), kmRodado: kmRodado };
  });
}

// ─── registrarUsoVeiculo ─────────────────────────────────────────
// (Parte A Pagamento) Atualiza flag de veiculo numa diaria existente
function registrarUsoVeiculo(tecnicoId, usaVeiculo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return _recusa('Aba Diaria_Tecnico nao encontrada');
  addMissingHeaders();
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const linha = encontrarOuCriarLinhaDiaria(sheet, tecnicoId, hoje);
  const colUsa = getColDiaria('Usa_Veiculo_Hoje');
  if (colUsa) sheet.getRange(linha, colUsa).setValue(usaVeiculo === true || usaVeiculo === 'true');
  return { sucesso: true };
}

// ─── iniciarOS ───────────────────────────────────────────────────
function iniciarOS(osId, tecnicoId, tecnicoNome, local) {
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const updates = {
    'Status': 'Em Andamento',
    'Status_Atual': 'Em andamento',
    'Hora_Inicio': now,
    'Em_Pausa_Agora': false
  };
  Object.keys(updates).forEach(campo => {
    const col = getCol(campo);
    if (col) osSheet.getRange(osRow, col).setValue(updates[campo]);
  });

  registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'Inicio', now, 0, 0, local || '');
  atualizarDiaria(ss, tecnicoId, tecnicoNome, now, 'entrada');

  return { sucesso: true, hora: formatarHora(now), osId: osId };
}

// ─── iniciarOSComGeo ─────────────────────────────────────────────
// Versao de iniciarOS com coordenadas GPS do navegador.
// Local_Evento em OS_Segmentos recebe "descricao [lat,lng]".
function iniciarOSComGeo(osId, tecnicoId, tecnicoNome, local, lat, lng, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
    const localComGeo = (lat && lng)
      ? ((local ? local + ' ' : '') + '[' + lat + ',' + lng + ']')
      : (local || '');
    return iniciarOS(osId, tecnicoId, tecnicoNome, localComGeo);
  });
}

// ─── encerrarOSComGeo ────────────────────────────────────────────
// Versao de encerrarOS com GPS de saida
function encerrarOSComGeo(osId, tecnicoId, tecnicoNome, dadosEnc, lat, lng) {
  if (lat && lng) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    registrarSegmento(ss, osId, tecnicoId, tecnicoNome,
      'GPS_Saida', new Date(), 0, 0, '[' + lat + ',' + lng + ']');
  }
  return encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc);
}

// ─── pausarOS ────────────────────────────────────────────────────
function pausarOS(osId, tecnicoId, tecnicoNome, motivo, osInterrupcaoId, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const colRet = getCol('Hora_Ultima_Retomada');
  const colIni = getCol('Hora_Inicio');
  const colProd = getCol('Horas_Produtivas');
  const colQtd = getCol('Qtd_Interrupcoes');

  const ultimaRetomada = colRet ? osSheet.getRange(osRow, colRet).getValue() : null;
  const horaInicio = colIni ? osSheet.getRange(osRow, colIni).getValue() : null;
  const ref = (ultimaRetomada instanceof Date ? ultimaRetomada : null) ||
              (horaInicio instanceof Date ? horaInicio : null);
  const horasSeg = ref ? calcularHoras(ref, now) : 0;

  const horasAcum = (parseFloat(colProd ? osSheet.getRange(osRow, colProd).getValue() : 0) || 0) + horasSeg;
  const qtdPausas = (parseInt(colQtd ? osSheet.getRange(osRow, colQtd).getValue() : 0) || 0) + 1;

  const updates = {
    'Em_Pausa_Agora': true,
    'Motivo_Pausa_Atual': motivo,
    'Hora_Ultima_Pausa': now,
    'Horas_Produtivas': horasAcum,
    'Qtd_Interrupcoes': qtdPausas,
    'Status_Atual': 'Pausada - ' + motivo
  };
  if (osInterrupcaoId) updates['OS_Interrupcao_ID'] = osInterrupcaoId;

  Object.keys(updates).forEach(campo => {
    const col = getCol(campo);
    if (col) osSheet.getRange(osRow, col).setValue(updates[campo]);
  });

  registrarSegmento(ss, osId, tecnicoId, tecnicoNome,
    'Pausa - ' + motivo, now, horasSeg * 60, horasAcum, '');

  return {
    sucesso: true,
    hora: formatarHora(now),
    horasAcumuladas: formatarDuracao(horasAcum)
  };
  });
}

// ─── retomarOS ───────────────────────────────────────────────────
function retomarOS(osId, tecnicoId, tecnicoNome, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const colProd = getCol('Horas_Produtivas');
  const colQtdRet = getCol('Qtd_Retomadas');
  const horasAcum = parseFloat(colProd ? osSheet.getRange(osRow, colProd).getValue() : 0) || 0;
  const qtdRet = (parseInt(colQtdRet ? osSheet.getRange(osRow, colQtdRet).getValue() : 0) || 0) + 1;

  const updates = {
    'Em_Pausa_Agora': false,
    'Motivo_Pausa_Atual': '',
    'Hora_Ultima_Retomada': now,
    'Status_Atual': 'Em andamento',
    'Qtd_Retomadas': qtdRet
  };
  Object.keys(updates).forEach(campo => {
    const col = getCol(campo);
    if (col) osSheet.getRange(osRow, col).setValue(updates[campo]);
  });

  registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'Retomada', now, 0, horasAcum, '');

  return {
    sucesso: true,
    hora: formatarHora(now),
    horasAcumuladas: formatarDuracao(horasAcum)
  };
  });
}

// ─── canCloseOS — Frente C (Diretriz v1.1) ───────────────────────
// Réplica server-side dos 4 pré-requisitos de conclusão já provados no
// lado admin (web/os.html: reqFechamento/faltasFechamento). O backend
// é quem decide — encerrarOS() chama esta função e recusa a escrita se
// allowed=false; o frontend só REFLETE a decisão, não reimplementa a
// regra sozinho.
//
// Fail-closed deliberado: Laudo_URL/Assinatura_URL/Estado_Seguranca
// ainda não existem no schema deste Sheet (captura desses dados é
// escopo da Frente B — checklist 3 fases, assinatura, laudo). Enquanto
// essas colunas não existirem, canCloseOS SEMPRE bloqueia com um motivo
// que deixa claro que é lacuna de funcionalidade, não erro do técnico.
//
// ATENÇÃO OPERACIONAL: com esta função ligada a encerrarOS, NENHUMA OS
// pode ser concluída pelo PWA até a Frente B entregar essas 3 colunas
// (laudo, assinatura, segurança). Isso é intencional (é exatamente o
// que "regras críticas no servidor, não só na interface" pede), mas é
// uma pausa operacional real — o dono precisa estar ciente antes de
// fazer o deploy desta mudança.
const PISO_FOTOS_FECHAMENTO_PWA = 2; // mesmo piso fail-closed (MIN_FOTOS_HARDCODED) do admin; aqui não há matriz de exigências acessível (ela vive no SharePoint), então o piso É o critério, não um fallback eventual.

function contarFotosEvidencia(nota) {
  if (!nota) return 0;
  return String(nota).split(/[\n,;]+/).map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s)).length;
}

// dadosPendentes (opcional): valores AINDA NAO GRAVADOS que vao ser
// escritos nesta mesma chamada de fechamento (ex.: fotosURL que o
// tecnico esta enviando agora, junto do encerramento — Fotos_Evidencia
// só é escrita por encerrarOS, não existe upload incremental antes
// disso). Sem este parametro, o precheck avalia só o que já esta
// gravado na planilha (util pro frontend perguntar ANTES de o tecnico
// preencher o formulario de encerramento). encerrarOS() passa os dados
// reais que vai gravar, pra nao recusar com base em estado desatualizado
// nem aceitar com base em dado que nunca vai ser escrito de verdade.
function canCloseOS(osId, dadosPendentes) {
  const pend = dadosPendentes || {};
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { allowed: false, blockingReasons: ['OS nao encontrada: ' + osId] };

  const colExiste = (campo) => getCol(campo) !== null;
  const ler = (campo) => {
    const col = getCol(campo);
    return col ? osSheet.getRange(osRow, col).getValue() : undefined;
  };
  const temTexto = (v) => (typeof v === 'string' ? v.trim().length > 0 : !!v);

  const reasons = [];

  if (!colExiste('Laudo_URL')) {
    reasons.push('laudo (Laudo_URL) - coluna ainda nao existe na planilha do PWA; captura de laudo e escopo da Frente B');
  } else if (!temTexto(pend.laudoURL !== undefined ? pend.laudoURL : ler('Laudo_URL'))) {
    reasons.push('laudo (Laudo_URL) ausente');
  }

  // Fotos_Evidencia só é gravada por encerrarOS (não há upload
  // incremental hoje) — se vier fotosURL pendente, é ISSO que vale,
  // não o que já esta (quase sempre vazio) na planilha.
  const fotosFonte = pend.fotosURL !== undefined ? pend.fotosURL : ler('Fotos_Evidencia');
  const fotos = contarFotosEvidencia(fotosFonte);
  if (fotos < PISO_FOTOS_FECHAMENTO_PWA) {
    reasons.push('fotos de evidencia (' + fotos + ' de ' + PISO_FOTOS_FECHAMENTO_PWA +
      ' minimas em Fotos_Evidencia - faltam ' + (PISO_FOTOS_FECHAMENTO_PWA - fotos) + ')');
  }

  if (!colExiste('Assinatura_URL')) {
    reasons.push('assinatura do cliente (Assinatura_URL) - coluna ainda nao existe na planilha do PWA; captura de assinatura e escopo da Frente B');
  } else if (!temTexto(pend.assinaturaURL !== undefined ? pend.assinaturaURL : ler('Assinatura_URL'))) {
    reasons.push('assinatura do cliente (Assinatura_URL) ausente');
  }

  if (!colExiste('Estado_Seguranca')) {
    reasons.push('seguranca liberada pelo checklist (Estado_Seguranca) - coluna ainda nao existe na planilha do PWA; checklist em 3 fases e escopo da Frente B');
  } else {
    const seg = ler('Estado_Seguranca');
    if (seg !== 'Liberado') {
      reasons.push('seguranca liberada pelo checklist (Estado_Seguranca: ' + (temTexto(seg) ? seg : '-') + ' - exige "Liberado")');
    }
  }

  // 5o motivo (CONTRATO-BACKEND-CHECKLIST-3-FASES.md, item 3) -- exige
  // que a Fase 2 (Execucao) do checklist tenha sido fechada de verdade
  // via fecharFaseChecklist(), nao so a Fase 1 (Estado_Seguranca acima).
  // Fail-closed no mesmo padrao dos outros 4: sem a coluna, bloqueia
  // com motivo de lacuna de funcionalidade, nao erro do tecnico.
  if (!colExiste('Checklist_Execucao_Completo')) {
    reasons.push('checklist de execucao completo (Checklist_Execucao_Completo) - coluna ainda nao existe na planilha do PWA; checklist em 3 fases e escopo da Frente B');
  } else if (ler('Checklist_Execucao_Completo') !== true) {
    reasons.push('checklist de execucao completo (Checklist_Execucao_Completo) - fase de execucao ainda nao foi fechada');
  }

  const statusAtual = ler('Status');
  if (statusAtual === 'Concluída' || statusAtual === 'Cancelada') {
    reasons.push('OS ja esta "' + statusAtual + '" - conclusao ja ocorreu ou foi cancelada');
  }

  return { allowed: reasons.length === 0, blockingReasons: reasons };
}

// ─── encerrarOS ──────────────────────────────────────────────────
function encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc) {
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);

  const check = canCloseOS(osId, { fotosURL: dadosEnc.fotosURL || '' });
  if (!check.allowed) {
    return _recusa('OS nao pode ser concluida ainda', { blockingReasons: check.blockingReasons, motivos: check.blockingReasons });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const colEmPausa = getCol('Em_Pausa_Agora');
  const colProd = getCol('Horas_Produtivas');
  const colRet = getCol('Hora_Ultima_Retomada');
  const colIni = getCol('Hora_Inicio');
  const colMeta = getCol('Meta_Dia');

  const emPausa = colEmPausa ? (osSheet.getRange(osRow, colEmPausa).getValue() === true) : false;
  let horasAcum = parseFloat(colProd ? osSheet.getRange(osRow, colProd).getValue() : 0) || 0;

  if (!emPausa) {
    const ultimaRetomada = colRet ? osSheet.getRange(osRow, colRet).getValue() : null;
    const horaInicio = colIni ? osSheet.getRange(osRow, colIni).getValue() : null;
    const ref = (ultimaRetomada instanceof Date ? ultimaRetomada : null) ||
                (horaInicio instanceof Date ? horaInicio : null);
    if (ref) horasAcum += calcularHoras(ref, now);
  }

  const metaDia = parseFloat(colMeta ? osSheet.getRange(osRow, colMeta).getValue() : 0) || 0;
  const qtdReal = parseInt(dadosEnc.qtdRealizada) || 0;
  const statusDia = (metaDia > 0 && qtdReal >= metaDia)
    ? 'Concluida - meta atingida' : 'Concluida - meta parcial';

  const updates = {
    'Hora_Encerramento': now,
    'Horas_Produtivas': horasAcum,
    'Status': 'Concluída',
    'Status_Atual': statusDia,
    'Em_Pausa_Agora': false,
    'Qtd_Realizada': qtdReal,
    'Pct_Acumulado': parseInt(dadosEnc.pctAcumulado) || 0,
    'Obs_Campo': dadosEnc.observacoes || '',
    'Materiais_Dia': dadosEnc.materiais || '',
    'Ocorrencias_Dia': dadosEnc.ocorrencias || '',
    'Proximo_Passo': dadosEnc.proximoPasso || '',
    'Fotos_Evidencia': dadosEnc.fotosURL || '',
    'Nao_Conformidade': dadosEnc.naoConformidade === true || dadosEnc.naoConformidade === 'true'
  };
  if ((parseInt(dadosEnc.pctAcumulado) || 0) >= 100) updates['Data_Conclusao'] = now;

  Object.keys(updates).forEach(campo => {
    const col = getCol(campo);
    if (col) osSheet.getRange(osRow, col).setValue(updates[campo]);
  });

  registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'Encerramento', now, 0, horasAcum, '');
  atualizarDiaria(ss, tecnicoId, tecnicoNome, now, 'saida', horasAcum, osId);

  return {
    sucesso: true,
    horasFinais: formatarDuracao(horasAcum),
    statusDia: statusDia,
    pctAcumulado: dadosEnc.pctAcumulado
  };
}

// ─── criarOSEmergencia ──────────────────────────────────────────
function criarOSEmergencia(dados) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  // Granularidade de minuto colidia em chamadas rapidas (achado real em teste,
  // 10/08) -- segundos + sufixo aleatorio de 3 digitos torna a colisao
  // desprezivel sem mudar o prefixo 'EMG-' que o resto do sistema reconhece.
  const novoId = 'EMG-' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  if (!osSheet) return _recusa('Aba Ordens_Servico nao encontrada');

  const headers = osSheet.getRange(1, 1, 1, osSheet.getLastColumn()).getValues()[0];
  const novaOS = new Array(headers.length).fill('');
  const set = (campo, val) => {
    const idx = headers.indexOf(campo);
    if (idx >= 0) novaOS[idx] = val;
  };

  set('ID_OS', novoId);
  set('Nome_Cliente', dados.clienteNome || '');
  set('ID_Cliente', dados.clienteId || '');
  set('Nome_Tecnico', dados.tecnicoNome || '');
  set('ID_Tecnico', dados.tecnicoId || '');
  set('Descricao', dados.descricao || '');
  set('Status', 'Em Andamento');
  set('Status_Atual', 'Em andamento');
  set('Prioridade_OS', 'Emergencia');
  set('Tipo_OS_Completo', 'Emergencia - mesmo cliente');
  set('Data_Abertura', now);
  set('Hora_Inicio', now);
  set('Em_Pausa_Agora', false);
  set('OS_Interrupcao_ID', dados.osOrigemId || '');
  set('Local', dados.local || '');

  osSheet.appendRow(novaOS);
  registrarSegmento(ss, novoId, dados.tecnicoId, dados.tecnicoNome,
    'Inicio', now, 0, 0, dados.local || '');

  return { sucesso: true, osId: novoId, hora: formatarHora(now) };
}

// ================================================================
// CHECKLIST NR-10 — Motor de formulario dinamico
// ================================================================

// ─── getPerguntasRespondidas ──────────────────────────────────────
// Mapa Pergunta_ID -> Resposta_Dada de tudo que já foi gravado em
// Checklist_Respostas para esta OS. É o estado real de "já visitada" que
// getProximaPergunta usa pra saber quais irmãs ainda faltam percorrer.
function getPerguntasRespondidas(osId) {
  const mapa = {};
  if (!osId) return mapa;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Checklist_Respostas');
  if (!sheet) return mapa;
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return mapa;
  const h = dados[0];
  const idxOS = h.indexOf('ID_OS');
  const idxPerg = h.indexOf('Pergunta_ID');
  const idxResp = h.indexOf('Resposta_Dada');
  if (idxOS < 0 || idxPerg < 0 || idxResp < 0) return mapa;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxOS]) !== String(osId)) continue;
    mapa[dados[i][idxPerg]] = dados[i][idxResp];
  }
  return mapa;
}

// Retorna a primeira pergunta da arvore para uma disciplina, ou a proxima
// pergunta dado o ID da pergunta atual e a resposta dada. Retorna null ao
// chegar no fim da arvore de verdade (nenhuma pergunta aplicavel restante,
// nem descendo nem subindo pra irmas nao visitadas).
//
// MOTOR CORRIGIDO em 10/08/2026: a versao anterior so olhava filhos da
// pergunta que ACABOU de ser respondida — perguntas irmas sob o MESMO pai
// (ex.: N4_REAP_ANOM/TORQ/ACAO, todas com Pergunta_Pai=N4_REAP_EST) nunca
// eram alcancadas depois que a primeira (por Ordem) terminava seu proprio
// ramo, mesmo sem terem filhos proprios (achado real, confirmado ao vivo
// contra a planilha real, ver TESTE-CHECKLIST-PONTA-A-PONTA-1008.md).
// Fix: usa Checklist_Respostas (por osId) como estado de "ja respondida" e,
// ao nao achar filho aplicavel, sobe a cadeia de Pergunta_Pai procurando a
// proxima irma nao respondida do ancestral mais proximo, usando a resposta
// que de fato levou a esse ancestral (ja gravada quando ele foi respondido).
function getProximaPergunta(disciplinaNome, perguntaAtualId, respostaDada, osId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const pergSheet = ss.getSheetByName('Perguntas_Checklist');
  if (!pergSheet) return null;
  const dados = pergSheet.getDataRange().getValues();
  if (dados.length < 2) return null;
  const headers = dados[0];

  const idxId   = headers.indexOf('ID_Pergunta');
  const idxDisc = headers.indexOf('Disciplina');
  const idxPai  = headers.indexOf('Pergunta_Pai');
  const idxCond = headers.indexOf('Condicao_Exibicao');
  const idxOrdem= headers.indexOf('Ordem');
  const idxAtivo= headers.indexOf('Ativo');

  const linhas = dados.slice(1);
  const porId = {};
  linhas.forEach(row => { porId[row[idxId]] = row; });

  const ehAtiva = row => row[idxAtivo] === true || row[idxAtivo] === 'TRUE' || row[idxAtivo] === 'true';

  const candidatasDe = (paiId, resposta) => linhas.filter(row => {
    if (row[idxDisc] !== disciplinaNome || !ehAtiva(row)) return false;
    if (paiId === null) return !row[idxPai] || row[idxPai] === '';
    if (row[idxPai] !== paiId) return false;
    if (row[idxCond] && row[idxCond] !== '' && row[idxCond] !== resposta) return false;
    return true;
  }).sort((a, b) => (a[idxOrdem] || 0) - (b[idxOrdem] || 0));

  const respondidas = getPerguntasRespondidas(osId);

  if (!perguntaAtualId) {
    const raizes = candidatasDe(null, null).filter(row => !respondidas.hasOwnProperty(row[idxId]));
    return raizes.length ? montarObjetoPergunta(raizes[0], headers) : null;
  }

  // a resposta desta chamada pode ainda não estar em Checklist_Respostas
  // (depende de o cliente já ter chamado salvarResposta antes desta) —
  // conta ela mesmo assim pra não reoferecer a própria pergunta atual.
  respondidas[perguntaAtualId] = respostaDada;

  // 1) desce: filhos aplicáveis de perguntaAtualId, ainda não respondidos
  let candidatos = candidatasDe(perguntaAtualId, respostaDada).filter(row => !respondidas.hasOwnProperty(row[idxId]));
  if (candidatos.length) return montarObjetoPergunta(candidatos[0], headers);

  // 2) sobe: primeira irmã não respondida do ancestral mais próximo, usando
  // a resposta real que levou a cada ancestral
  let atualId = perguntaAtualId;
  while (atualId) {
    const linhaAtual = porId[atualId];
    const paiId = linhaAtual ? linhaAtual[idxPai] : null;
    if (!paiId) break; // atualId já é raiz — não há mais pra onde subir
    const respostaQueChegouNoPai = respondidas[paiId];
    candidatos = candidatasDe(paiId, respostaQueChegouNoPai).filter(row => !respondidas.hasOwnProperty(row[idxId]));
    if (candidatos.length) return montarObjetoPergunta(candidatos[0], headers);
    atualId = paiId;
  }
  return null;
}

function montarObjetoPergunta(row, headers) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  obj.opcoes = getOpcoesDaPergunta(obj['ID_Pergunta']);
  return obj;
}

function getOpcoesDaPergunta(perguntaId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const opSheet = ss.getSheetByName('Opcoes_Resposta');
  if (!opSheet) return [];
  const dados = opSheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  const headers = dados[0];
  const idxPerg  = headers.indexOf('Pergunta_ID');
  const idxOrdem = headers.indexOf('Ordem');

  return dados.slice(1)
    .filter(row => String(row[idxPerg]) === String(perguntaId))
    .sort((a, b) => (a[idxOrdem] || 0) - (b[idxOrdem] || 0))
    .map(row => {
      const o = {};
      headers.forEach((h, i) => { o[h] = row[i]; });
      return o;
    });
}

// ─── lerArvoreChecklist ──────────────────────────────────────────
// Dump completo, só leitura, de Perguntas_Checklist + Opcoes_Resposta —
// pra reconstruir a árvore real sem depender de inferência local.
function lerArvoreChecklist() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const pergSheet = ss.getSheetByName('Perguntas_Checklist');
  const opSheet = ss.getSheetByName('Opcoes_Resposta');
  if (!pergSheet) return { erro: 'Aba Perguntas_Checklist nao encontrada' };

  const pDados = pergSheet.getDataRange().getValues();
  const pHead = pDados[0];
  const perguntas = pDados.slice(1).map(row => {
    const o = {};
    pHead.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });

  let opcoes = [];
  if (opSheet) {
    const oDados = opSheet.getDataRange().getValues();
    const oHead = oDados[0];
    opcoes = oDados.slice(1).map(row => {
      const o = {};
      oHead.forEach((h, i) => { o[h] = row[i]; });
      return o;
    });
  }

  return { perguntas: perguntas, opcoes: opcoes };
}

// ─── lerAbaCompleta ──────────────────────────────────────────────
// Leitor genérico, só leitura, de qualquer aba da planilha — pra
// auditoria/teste sem precisar de um leitor dedicado por aba.
function lerAbaCompleta(nomeAba) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return { erro: 'Aba nao encontrada: ' + nomeAba };
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 1) return { headers: [], linhas: [] };
  const headers = dados[0];
  const linhas = dados.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
  return { headers: headers, linhas: linhas };
}

// Salva a resposta do tecnico na aba Checklist_Respostas.
// geraNC = true se a opcao escolhida tem Aciona_NC = true.
function salvarResposta(osId, idSharePointOS, perguntaId, textoPergunta,
                        resposta, fotoUrl, tecnico, geraNC, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'CHECKLIST_RESPOSTA', osId, tecnico, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const respSheet = ss.getSheetByName('Checklist_Respostas');
  if (!respSheet) return _recusa('Aba Checklist_Respostas nao encontrada');
  respSheet.appendRow([
    osId,
    idSharePointOS || '',
    perguntaId,
    textoPergunta,
    resposta,
    fotoUrl || '',
    tecnico,
    new Date(),
    geraNC === true || geraNC === 'true',
    false  // Sincronizado — Make.com 1F vai setar true
  ]);
  return { sucesso: true };
  // entity_id inclui a pergunta -- cada resposta e um evento distinto na
  // mesma OS, colidiriam em (CHECKLIST, OS_ID) sem isso.
  }, { tipo: 'CHECKLIST', id: osId + ':' + perguntaId });
}

// ─── fecharFaseChecklist — Checklist 3 fases (Diretriz v1.1) ────────
// Contrato da sessao de frontend (CONTRATO-BACKEND-CHECKLIST-3-FASES.md):
// hoje a sequencia Pre-Execucao -> Execucao -> Pos-Execucao e 100%
// aplicada no cliente (localStorage) -- nada no servidor impede concluir
// uma OS sem nunca ter aberto a Fase 2. Esta funcao fecha essa lacuna:
// confere que toda pergunta ATIVA+OBRIGATORIA da fase tem resposta
// gravada em Checklist_Respostas para esta OS e, se completa, grava o
// efeito colateral real da fase.
//
// Fase "Pre-Execucao": grava Estado_Seguranca (Bloqueado se alguma
// resposta das perguntas desta fase tiver Gerou_NC=true, senao
// Liberado) -- isto SUBSTITUI confirmarSegurancaPreExecucao como
// escritor real da coluna, exatamente como o comentario da versao
// interim ja anunciava.
// Fase "Execucao": grava Checklist_Execucao_Completo=true, que
// canCloseOS passa a exigir (5o motivo de bloqueio).
// Fase "Pos-Execucao": sem efeito colateral proprio na planilha do PWA
// -- o fechamento real da OS continua passando pelos 4 requisitos ja
// existentes de canCloseOS (Laudo/Assinatura/Fotos/Estado_Seguranca).
// Esta chamada so confirma que a fase foi percorrida por completo.
//
// Mesma checagem de posse (Frente E, Opcao C) aplicada as outras
// escritas criticas -- esta e uma escrita nova, nao ficaria de fora.
const FASES_CHECKLIST_VALIDAS = ['Pré-Execução', 'Execução', 'Pós-Execução'];

function fecharFaseChecklist(osId, tecnicoId, fase, operationId, dispositivoId) {
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);

  if (FASES_CHECKLIST_VALIDAS.indexOf(fase) < 0) {
    return _recusa('Fase invalida: ' + fase);
  }

  return executarIdempotente(operationId, 'CHECKLIST_RESPOSTA', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa('OS nao encontrada: ' + osId);

    const pergSheet = ss.getSheetByName('Perguntas_Checklist');
    if (!pergSheet) return _recusa('Aba Perguntas_Checklist nao encontrada');
    const pDados = pergSheet.getDataRange().getValues();
    const pH = pDados[0];
    const idxFase = pH.indexOf('Fase_Execucao');
    const idxObrig = pH.indexOf('Obrigatoria');
    const idxAtivo = pH.indexOf('Ativo');
    const idxIdPerg = pH.indexOf('ID_Pergunta');
    if (idxFase < 0 || idxObrig < 0) {
      return _recusa('Colunas Fase_Execucao/Obrigatoria nao existem na planilha (rode rodarSetupSheets)');
    }

    const ehVerdadeiro = (v) => v === true || v === 'TRUE' || v === 'true';
    const perguntasDaFase = pDados.slice(1)
      .filter(row => row[idxFase] === fase && ehVerdadeiro(row[idxAtivo]))
      .map(row => row[idxIdPerg]);
    const obrigatoriasDaFase = pDados.slice(1)
      .filter(row => row[idxFase] === fase && ehVerdadeiro(row[idxAtivo]) && ehVerdadeiro(row[idxObrig]))
      .map(row => row[idxIdPerg]);

    const respSheet = ss.getSheetByName('Checklist_Respostas');
    if (!respSheet) return _recusa('Aba Checklist_Respostas nao encontrada');
    const rDados = respSheet.getDataRange().getValues();
    const rH = rDados[0];
    const idxROS = rH.indexOf('ID_OS');
    const idxRPerg = rH.indexOf('Pergunta_ID');
    const idxRNC = rH.indexOf('Gerou_NC');
    const respostasDaOS = rDados.slice(1).filter(row => String(row[idxROS]) === String(osId));
    const idsRespondidos = respostasDaOS.map(row => row[idxRPerg]);

    const faltando = obrigatoriasDaFase.filter(id => idsRespondidos.indexOf(id) < 0);
    if (faltando.length) {
      return _recusa('Fase incompleta: faltam perguntas obrigatorias (' + faltando.join(', ') + ')',
        { completa: false, fase: fase, faltando: faltando, motivos: faltando });
    }

    const temNC = respostasDaOS.some(row =>
      perguntasDaFase.indexOf(row[idxRPerg]) >= 0 && ehVerdadeiro(row[idxRNC]));

    if (fase === 'Pré-Execução') {
      const colEstado = getCol('Estado_Seguranca');
      if (!colEstado) return _recusa('Coluna Estado_Seguranca nao existe na planilha (rode rodarSetupSheets)');
      const novoEstado = temNC ? 'Bloqueado' : 'Liberado';
      osSheet.getRange(osRow, colEstado).setValue(novoEstado);
      return { sucesso: true, completa: true, fase: fase, estado: novoEstado };
    }

    if (fase === 'Execução') {
      const colExec = getCol('Checklist_Execucao_Completo');
      if (!colExec) return _recusa('Coluna Checklist_Execucao_Completo nao existe na planilha (rode rodarSetupSheets)');
      osSheet.getRange(osRow, colExec).setValue(true);
      return { sucesso: true, completa: true, fase: fase };
    }

    return { sucesso: true, completa: true, fase: fase };
  // entity_id inclui a fase -- Pre-Execucao/Execucao/Pos-Execucao sao
  // eventos distintos na mesma OS, colidiriam em (CHECKLIST, OS_ID) sem
  // isso.
  }, { tipo: 'CHECKLIST', id: osId + ':' + fase });
}

// ─── consultarFaseChecklist — leitura pontual (Diretriz v1.1) ───────
// Contrato item 4: o frontend pergunta ao servidor "essa OS ja tem
// Fase 1/2 completas?" antes de decidir qual fase mostrar -- hoje o
// CHK3F decide isso so pelo localStorage, que nao sobrevive a troca de
// aparelho nem a limpeza de dados do navegador. So leitura, sem
// checagem de posse (mesmo padrao de canCloseOS/lerCamposOS).
function consultarFaseChecklist(osId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { erro: 'OS nao encontrada: ' + osId };

  const colEstado = getCol('Estado_Seguranca');
  const colExec = getCol('Checklist_Execucao_Completo');
  const estadoSeguranca = colEstado ? osSheet.getRange(osRow, colEstado).getValue() : '';
  const execucaoCompleta = colExec ? (osSheet.getRange(osRow, colExec).getValue() === true) : false;

  return {
    osId: osId,
    preExecucaoCompleta: estadoSeguranca === 'Liberado' || estadoSeguranca === 'Bloqueado',
    estadoSeguranca: estadoSeguranca || null,
    execucaoCompleta: execucaoCompleta
  };
}

// ================================================================
// ACEITE DE OFERTA — link profundo + PIN (CONTRATO-BACKEND-ACEITE-OFERTA.md)
// ================================================================
// Migra o registro de aceite do portal-alocacao.html (MSAL, morto por
// construcao pro tecnico MEI sem conta Microsoft) pro PWA via PIN + link
// profundo (SPEC-PWA-TECNICO.md §1). Identidade do tecnico: Tecnico_ID +
// PIN, nunca e-mail. Quem GERA o link (mint da assinatura) fica fora
// deste contrato -- provavelmente console do gestor, decisao separada.

// Mesmo primitivo ja desenhado em DESENHO-FRENTE-E-AUTH-DISPATCHER.md
// (Opcao A, token HMAC pos-PIN), aqui aplicado só a esta acao pontual
// (assinatura por oferta) -- as duas coisas sao independentes, Opcao A
// da sessao geral do dispatcher continua so desenhada, nao implementada.
const OFERTA_SEGREDO_PROPERTY = 'OFERTA_HMAC_SECRET';

function _bytesParaHex(bytes) {
  return bytes.map(b => ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2)).join('');
}

// Comparacao constant-effort (nao usa === com short-circuit, nem
// .indexOf) -- defesa contra timing attack no oraculo de assinatura,
// pedido explicito do contrato ("constant-time se possivel").
function _hexIgualConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Fail-closed: sem segredo configurado em Script Properties, NUNCA
// valida (nao existe "assinatura correta" possivel sem segredo real).
function verificarAssinaturaOferta(ofertaId, tecnicoId, exp, sig) {
  const segredo = PropertiesService.getScriptProperties().getProperty(OFERTA_SEGREDO_PROPERTY);
  if (!segredo || !sig) return false;
  const payload = String(ofertaId) + '|' + String(tecnicoId) + '|' + String(exp);
  const bytes = Utilities.computeHmacSha256Signature(payload, segredo);
  const sigEsperada = _bytesParaHex(bytes);
  return _hexIgualConstante(sigEsperada.toLowerCase(), String(sig).trim().toLowerCase());
}

// Ultima linha (a mais recente, append-only) para este Oferta_ID -- o
// evento de resposta (registrarAceiteOferta) ANEXA uma linha nova em vez
// de editar a original, entao "o estado atual da oferta" e sempre a
// ULTIMA linha com este Oferta_ID, nao a primeira.
function _ultimaLinhaOferta(sheet, ofertaId) {
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const idxId = h.indexOf('Oferta_ID');
  let ultima = null;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxId]) === String(ofertaId)) ultima = { linha: i + 1, headers: h, valores: dados[i] };
  }
  return ultima;
}

// getOfertaAlocacao — so leitura. Assinatura errada (ou qualquer campo do
// link adulterado -- id/tecnico/exp entram todos no payload assinado, IN
// alterar qualquer um invalida sig) -> erro generico "Link invalido", sem
// revelar se a oferta existe. So depois da assinatura bater e que
// checamos expiracao/status -- nessa ordem, autenticacao antes de
// qualquer dado de negocio.
function getOfertaAlocacao(ofertaId, tecnicoId, exp, sig) {
  if (!verificarAssinaturaOferta(ofertaId, tecnicoId, exp, sig)) {
    return { encontrada: false, erro: 'Link invalido' };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Alocacoes_Ofertas');
  if (!sheet) return { encontrada: false, erro: 'Oferta nao encontrada' };
  const ultima = _ultimaLinhaOferta(sheet, ofertaId);
  if (!ultima) return { encontrada: false, erro: 'Oferta nao encontrada' };

  const g = (campo) => ultima.valores[ultima.headers.indexOf(campo)];

  if (Number(exp) * 1000 < Date.now()) {
    return { encontrada: true, expirada: true, expiraEm: g('Expira_Em') };
  }

  const status = g('Status');
  if (status !== 'Pendente') {
    return { encontrada: true, status: status };
  }

  return {
    encontrada: true,
    status: 'Pendente',
    osId: g('OS_ID'),
    escopoResumo: g('Escopo_Resumo'),
    valorProposto: g('Valor_Proposto'),
    expiraEm: g('Expira_Em')
  };
}

// registrarAceiteOferta — evento NOVO (anexa linha, nao edita a
// proposta original), passa por executarIdempotente (Frente D). Sem
// parametro de assinatura aqui (o frontend so chega nesta tela depois
// de getOfertaAlocacao+PIN ja terem validado) -- por isso, mesma
// disciplina da Frente E (Opcao C), confere que tecnicoId bate com o
// Tecnico_ID gravado na oferta antes de aceitar a escrita. Extensao do
// padrao estabelecido pras outras escritas criticas -- escrita nova,
// nao ficaria de fora.
//
// tipo_operacao pro Log_Central: ACEITE_CLIENTE e o unico valor da
// lista fechada aprovada (Geovane/Cowork 2) com formato de "aceite" --
// usado aqui pro tecnico aceitando/recusando a oferta (nao literalmente
// um cliente aceitando algo, mas e a categoria mais proxima da lista
// aprovada; sinalizado, nao escolhido silenciosamente).
function registrarAceiteOferta(ofertaId, tecnicoId, aceito, motivoRecusa, operationId, dispositivoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Alocacoes_Ofertas');
  if (!sheet) return _recusa('Aba Alocacoes_Ofertas nao encontrada');

  const ultimaPre = _ultimaLinhaOferta(sheet, ofertaId);
  if (!ultimaPre) return _recusa('Oferta nao encontrada: ' + ofertaId);
  const gPre = (campo) => ultimaPre.valores[ultimaPre.headers.indexOf(campo)];

  if (String(gPre('Tecnico_ID')) !== String(tecnicoId)) {
    return _recusa('Tecnico ' + tecnicoId + ' nao tem posse desta oferta');
  }

  // OS_ID real da oferta -- lido ANTES de executarIdempotente pra
  // entity_version (monotonico POR OS, ARQUITETURA-SYNC-LOG-CENTRAL.md,
  // ponto 3) usar a chave certa. Corrige compromisso documentado na
  // entrega anterior desta fatia, que usava ofertaId no lugar do OS_ID
  // real por nao ter esta leitura prévia ainda.
  const osIdReal = gPre('OS_ID');

  return executarIdempotente(operationId, 'ACEITE_CLIENTE', osIdReal, tecnicoId, dispositivoId, () => {
    // Releitura fresca -- protege contra corrida com outra resposta ja
    // registrada por uma operation_id DIFERENTE entre o precheck acima e
    // esta gravacao (retry da MESMA operation_id nunca chega aqui,
    // executarIdempotente ja devolveu o resultado cacheado antes de
    // rodar este fn() de novo).
    const ultima = _ultimaLinhaOferta(sheet, ofertaId);
    if (!ultima) return _recusa('Oferta nao encontrada: ' + ofertaId);
    const g = (campo) => ultima.valores[ultima.headers.indexOf(campo)];

    if (g('Status') !== 'Pendente') {
      return _recusa('Oferta ja foi respondida', { status: g('Status') });
    }

    if (aceito !== true && !(motivoRecusa && String(motivoRecusa).trim())) {
      return _recusa('Motivo de recusa obrigatorio');
    }

    const novoStatus = aceito === true ? 'Aceita' : 'Recusada';
    sheet.appendRow([
      ofertaId,
      g('OS_ID'),
      tecnicoId,
      g('Escopo_Resumo'),
      g('Valor_Proposto'),
      g('Criada_Em'),
      g('Expira_Em'),
      novoStatus,
      new Date(),
      aceito === true ? '' : String(motivoRecusa).trim(),
      operationId || ''
    ]);

    return { sucesso: true, status: novoStatus };
  });
}

// ================================================================
// FERRAMENTAL — carga/desmobilizacao (CONTRATO-BACKEND-FERRAMENTAL.md)
// ================================================================
// Registro append-only minimo: o tecnico digita o codigo do patrimonio
// (etiqueta fisica) em vez de escolher de uma lista. SEM validacao de
// catalogo/calibracao/obrigatoriedade por tipo de OS -- essas 3 travas
// de seguranca reais do fluxo do gestor (web/ferramental.html) dependem
// de dado que so existe no SharePoint hoje; portar exige um sync novo
// (decisao de dono + Cowork), fora deste contrato. Documentada a
// lacuna, nao escondida.
const FERRAMENTAL_TIPOS_VALIDOS = ['Carga', 'Desmobilizacao'];

// registrarMovimentoFerramental — fail-closed nos 3 pontos que o
// contrato pede: tipo fora da lista, patrimonio vazio, e
// Estado_OK=false sem observacao (só relevante em Desmobilizacao) --
// tudo validado ANTES de executarIdempotente (entrada mal formada nao
// deveria consumir Log_Central), mesmo padrao ja usado em
// fecharFaseChecklist pra "fase invalida". Mesma checagem de posse
// (Frente E, Opcao C) das outras escritas criticas.
//
// tipo_operacao pro Log_Central: o contrato propos 'FERRAMENTAL', que
// NAO esta na lista fechada aprovada (Geovane/Cowork 2) --
// CHECKLIST_RESPOSTA/UPLOAD_FOTO/ACEITE_CLIENTE/REGISTRO_KM/
// APONTAMENTO/ASSINATURA/REGISTRO_MEDICAO/CONCLUSAO_OS. Usei
// APONTAMENTO (categoria mais proxima: evento de dado de campo, mesma
// familia de iniciarOSComGeo/pausarOS/retomarOS) em vez do valor
// literal do contrato -- sinalizado aqui e no relatorio pro Geovane,
// nao escolhido silenciosamente. Se 'FERRAMENTAL' for aprovado como
// valor novo depois, e so adicionar na lista e trocar esta linha.
function registrarMovimentoFerramental(osId, tecnicoId, patrimonioCodigo, tipoMovimento, estadoOk, observacao, operationId, dispositivoId) {
  if (FERRAMENTAL_TIPOS_VALIDOS.indexOf(tipoMovimento) < 0) {
    return _recusa('Tipo de movimento invalido: ' + tipoMovimento);
  }
  if (!patrimonioCodigo || !String(patrimonioCodigo).trim()) {
    return _recusa('Codigo de patrimonio obrigatorio');
  }
  if (tipoMovimento === 'Desmobilizacao' && estadoOk === false && !(observacao && String(observacao).trim())) {
    return _recusa('Observacao obrigatoria quando o estado nao esta OK');
  }

  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(posse.erro);

  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('Ferramental_Movimentos');
    if (!sheet) return _recusa('Aba Ferramental_Movimentos nao encontrada');

    const movimentoId = Utilities.getUuid();
    sheet.appendRow([
      movimentoId,
      osId,
      tecnicoId,
      String(patrimonioCodigo).trim(),
      tipoMovimento,
      estadoOk === true,
      observacao || '',
      new Date(),
      operationId || ''
    ]);

    return { sucesso: true, movimentoId: movimentoId };
  });
}

// getFerramentalDaOS — so leitura, todos os movimentos ja registrados
// nesta OS (nao so o ultimo -- carga e desmobilizacao sao eventos
// distintos, ambos relevantes). So pra MOSTRAR o que ja foi registrado;
// nao deriva nenhum estado "atual" (isso e exatamente o que a trava
// real do SharePoint resolve, fora deste contrato).
function getFerramentalDaOS(osId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ferramental_Movimentos');
  if (!sheet) return [];
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  const h = dados[0];
  const idxOS = h.indexOf('OS_ID');
  return dados.slice(1)
    .filter(row => String(row[idxOS]) === String(osId))
    .map(row => ({
      patrimonioCodigo: row[h.indexOf('Patrimonio_Codigo')],
      tipoMovimento: row[h.indexOf('Tipo_Movimento')],
      estadoOk: row[h.indexOf('Estado_OK')],
      observacao: row[h.indexOf('Observacao')],
      registradoEm: row[h.indexOf('Registrado_Em')]
    }));
}

// ================================================================
// VEICULO DO TECNICO — Autocadastro com aprovacao pendente
// ================================================================

// ─── getColVeiculo ────────────────────────────────────────────────
function getColVeiculo(campo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Veiculos_Tecnicos');
  if (!sheet) return null;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return null;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(campo);
  return idx >= 0 ? idx + 1 : null;
}

// ─── getVeiculoDoTecnico ─────────────────────────────────────────
// Retorna o veiculo cadastrado pelo tecnico, ou null se nao houver.
function getVeiculoDoTecnico(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Veiculos_Tecnicos');
  if (!sheet) return null;
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return null;
  const h = dados[0];
  const idxId = h.indexOf('Tecnico_ID');
  if (idxId < 0) return null;
  const gv = (campo, row) => { const i = h.indexOf(campo); return i >= 0 ? row[i] : null; };
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxId]) === String(tecnicoId)) {
      const alt = gv('Alteracao_Pendente', dados[i]);
      return {
        tipoVeiculo: String(gv('Tipo_Veiculo', dados[i]) || ''),
        placa:       String(gv('Placa', dados[i]) || ''),
        modelo:      String(gv('Modelo', dados[i]) || ''),
        statusAprovacao: String(gv('Status_Aprovacao', dados[i]) || 'Pendente'),
        alteracaoPendente: alt === true || alt === 'TRUE' || alt === 'true',
        motivoRejeicao: String(gv('Motivo_Rejeicao', dados[i]) || '')
      };
    }
  }
  return null;
}

// ─── cadastrarOuEditarVeiculo ─────────────────────────────────────
// Novo cadastro: Status_Aprovacao = 'Pendente'.
// Edicao: atualiza dados e marca Alteracao_Pendente = true,
//   mas NAO desativa o cadastro aprovado anterior.
function cadastrarOuEditarVeiculo(tecnicoId, tecnicoNome, tipoVeiculo, placa, modelo) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let veiculosSheet = ss.getSheetByName('Veiculos_Tecnicos');

  // Cria a aba com cabecalhos se ainda nao existir
  if (!veiculosSheet) {
    veiculosSheet = ss.insertSheet('Veiculos_Tecnicos');
    veiculosSheet.getRange(1, 1, 1, 16).setValues([[
      'Tecnico_Nome', 'Tecnico_ID', 'Tipo_Veiculo', 'Placa', 'Modelo',
      'Elegivel_Reembolso', 'Valor_Por_KM', 'Ativo', 'Observacoes',
      'Cadastrado_Por', 'Status_Aprovacao', 'Aprovado_Por', 'Data_Aprovacao',
      'Motivo_Rejeicao', 'Data_Ultima_Alteracao', 'Alteracao_Pendente'
    ]]);
  }

  const dados = veiculosSheet.getDataRange().getValues();
  const h = dados[0];
  const idxId = h.indexOf('Tecnico_ID');
  let linhaExistente = null;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][idxId >= 0 ? idxId : 1]) === String(tecnicoId)) {
      linhaExistente = i + 1;
      break;
    }
  }

  const agora = new Date();
  if (linhaExistente) {
    // Edicao — fica pendente, mas o cadastro aprovado anterior ainda vale
    const set = (campo, val) => {
      const col = getColVeiculo(campo);
      if (col) veiculosSheet.getRange(linhaExistente, col).setValue(val);
    };
    set('Tipo_Veiculo', tipoVeiculo);
    set('Placa', placa);
    set('Modelo', modelo);
    set('Status_Aprovacao', 'Pendente');
    set('Alteracao_Pendente', true);
    set('Data_Ultima_Alteracao', agora);
  } else {
    // Novo cadastro — entra como Pendente
    veiculosSheet.appendRow([
      tecnicoNome, tecnicoId, tipoVeiculo, placa, modelo,
      false, 0, true, '',
      'Tecnico (PWA)', 'Pendente',
      '', '', '',
      agora, false
    ]);
  }

  return {
    sucesso: true,
    status: linhaExistente
      ? 'Alteracao enviada para aprovacao'
      : 'Cadastro enviado para aprovacao'
  };
}

// ─── lerCamposOS ───────────────────────────────────────────────────
// Utilitário genérico, só leitura: devolve os campos pedidos de uma OS,
// pelo nome real da coluna. Existe pra permitir verificação por releitura
// em testes sem precisar publicar diagnóstico descartável a cada rodada.
function lerCamposOS(osId, campos) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { erro: 'OS nao encontrada: ' + osId };
  const resultado = {};
  (campos || []).forEach(campo => {
    const col = getCol(campo);
    resultado[campo] = col ? osSheet.getRange(osRow, col).getValue() : null;
  });
  return resultado;
}

// ================================================================
// KM POR-OS (Opção 2, decidido em 06/08) — aditivo ao modelo por-dia
// ================================================================
// Espelha os valores de Politicas_Operacionais_Versoes (SharePoint,
// confirmado real via PnP em 05/08: KM_DESVIO_INTRA_KM=5 km,
// KM_DESVIO_PCT=20%, ambos Ativa=True). Apps Script não fala com o
// SharePoint direto — se esses números mudarem lá, precisam ser
// atualizados aqui manualmente também.
const KM_LIMIAR_INTRA_DIA_KM = 5;      // chave KM_DESVIO_INTRA_KM
const KM_LIMIAR_INTER_DIA_PCT = 0.20;  // chave KM_DESVIO_PCT

// ─── getUltimaOSDoTecnicoHoje ─────────────────────────────────────
// Última OS ENCERRADA do técnico, hoje, com KM_Final_OS preenchido.
function getUltimaOSDoTecnicoHoje(tecnicoId, osIdAtual) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ordens_Servico');
  if (!sheet) return null;
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const col = name => h.indexOf(name);
  const iId = col('ID_OS');
  const iTec = (col('ID_Tecnico') >= 0 ? col('ID_Tecnico') : col('Nome_Tecnico'));
  const iEnc = col('Hora_Encerramento');
  const iKmFinal = col('KM_Final_OS');
  const iVeiculo = col('Veiculo_ID_OS');
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  let melhor = null;
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (String(row[iId]) === String(osIdAtual)) continue;
    if (String(row[iTec]) !== String(tecnicoId)) continue;
    const enc = row[iEnc];
    if (!(enc instanceof Date)) continue;
    if (Utilities.formatDate(enc, TZ, 'yyyy-MM-dd') !== hoje) continue;
    if (iKmFinal < 0 || row[iKmFinal] === '' || row[iKmFinal] === null) continue;
    if (!melhor || enc > melhor.hora) {
      melhor = { hora: enc, kmFinal: parseFloat(row[iKmFinal]) || 0,
                 veiculoId: iVeiculo >= 0 ? String(row[iVeiculo] || '') : '' };
    }
  }
  return melhor;
}

// ─── getUltimaOSDoTecnicoDiaAnterior ──────────────────────────────
// Cobre fim de semana/feriado: pega o dia anterior mais recente,
// não necessariamente "ontem".
function getUltimaOSDoTecnicoDiaAnterior(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ordens_Servico');
  if (!sheet) return null;
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const col = name => h.indexOf(name);
  const iTec = (col('ID_Tecnico') >= 0 ? col('ID_Tecnico') : col('Nome_Tecnico'));
  const iEnc = col('Hora_Encerramento');
  const iKmFinal = col('KM_Final_OS');
  const iVeiculo = col('Veiculo_ID_OS');
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  let melhor = null;
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (String(row[iTec]) !== String(tecnicoId)) continue;
    const enc = row[iEnc];
    if (!(enc instanceof Date)) continue;
    if (Utilities.formatDate(enc, TZ, 'yyyy-MM-dd') >= hoje) continue;
    if (iKmFinal < 0 || row[iKmFinal] === '' || row[iKmFinal] === null) continue;
    if (!melhor || enc > melhor.hora) {
      melhor = { hora: enc, kmFinal: parseFloat(row[iKmFinal]) || 0,
                 veiculoId: iVeiculo >= 0 ? String(row[iVeiculo] || '') : '' };
    }
  }
  return melhor;
}

// ─── validarESalvarKMInicial ──────────────────────────────────────
// Núcleo da regra: decide se há salto a justificar, exige foto+texto
// juntos quando exige, e só grava se passou (ou se não havia salto).
// LIMITAÇÃO CONHECIDA: captura de foto não existe no app ainda —
// enquanto isso, qualquer salto real fica bloqueado até existir.
function validarESalvarKMInicial(osId, tecnicoId, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const kmInicialNum = parseFloat(kmInicial) || 0;
  let flag = '', exigeJustificativa = false, referencia = null, limiar = null, tipoComparacao = '';

  const anteriorHoje = getUltimaOSDoTecnicoHoje(tecnicoId, osId);
  if (anteriorHoje) {
    referencia = anteriorHoje.kmFinal;
    limiar = KM_LIMIAR_INTRA_DIA_KM;
    tipoComparacao = 'intra-dia';
  } else {
    const anteriorDia = getUltimaOSDoTecnicoDiaAnterior(tecnicoId);
    if (anteriorDia && anteriorDia.veiculoId === String(veiculoId || '')) {
      referencia = anteriorDia.kmFinal;
      limiar = referencia * KM_LIMIAR_INTER_DIA_PCT;
      tipoComparacao = 'inter-dia';
    }
    // Veiculo diferente do dia anterior, ou sem OS anterior: 1a viagem, sem comparacao
  }

  if (referencia !== null) {
    if (kmInicialNum < referencia) {
      flag = 'Revisao Manual - Hodometro Invertido';
    } else if ((kmInicialNum - referencia) > limiar) {
      const temFoto = !!fotoDesvioUrl;
      const temTexto = !!(justificativaDesvio && justificativaDesvio.trim());
      if (!temFoto || !temTexto) {
        exigeJustificativa = true;
      }
      // Se tem os dois: aprovado com evidencia, sem flag
    }
  }

  if (exigeJustificativa) {
    const mensagem = 'Diferenca de ' + Math.round(kmInicialNum - referencia) + 'km detectada (' + tipoComparacao + '). '
      + 'Informe justificativa por texto E foto do odometro para continuar.';
    return _recusa(mensagem, { exigeJustificativa: true, mensagem: mensagem });
  }

  const set = (campo, val) => { const col = getCol(campo); if (col) osSheet.getRange(osRow, col).setValue(val); };
  set('KM_Inicial_OS', kmInicialNum);
  set('Veiculo_ID_OS', String(veiculoId || ''));
  if (justificativaDesvio) set('KM_Justificativa_Desvio', justificativaDesvio);
  if (fotoDesvioUrl) set('KM_Foto_Desvio_URL', fotoDesvioUrl);
  if (flag) set('KM_Flag_Revisao', flag);

  return { sucesso: true, flag: flag || null };
}

// ─── iniciarOSComKM ────────────────────────────────────────────────
// Aditivo: convive com iniciarOSComGeo, não a substitui ainda.
function iniciarOSComKM(osId, tecnicoId, tecnicoNome, local, lat, lng, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'REGISTRO_KM', osId, tecnicoId, dispositivoId, () => {
    const kmResult = validarESalvarKMInicial(osId, tecnicoId, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl);
    if (kmResult.erro || kmResult.exigeJustificativa) return kmResult;

    const localComGeo = (lat && lng) ? ((local ? local + ' ' : '') + '[' + lat + ',' + lng + ']') : (local || '');
    const res = iniciarOS(osId, tecnicoId, tecnicoNome, localComGeo);
    if (!res.erro) res.kmFlag = kmResult.flag || null;
    return res;
  });
}

// ─── encerrarOSComKM ────────────────────────────────────────────────
// KM sai daqui — o fechamento da OS (checklist/assinatura/hora) não
// espera mais o técnico chegar na base. KM_Final_OS fica pendente,
// preenchido depois via registrarKMFinalPendente.
// operationId/dispositivoId no final (backward-compat posicional —
// chamador antigo sem esses 2 args continua funcionando, só sem
// idempotencia). Ver bloco executarIdempotente/Log_Central (Frente D).
function encerrarOSComKM(osId, tecnicoId, tecnicoNome, dadosEnc, lat, lng, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'CONCLUSAO_OS', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    if (lat && lng) {
      registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'GPS_Saida', new Date(), 0, 0, '[' + lat + ',' + lng + ']');
    }
    return encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc);
  });
}

// ─── registrarKMFinalPendente ────────────────────────────────────────
// Preenche o KM final de uma OS já concluída, sem reabrir nada.
// Roda a mesma validacao de desvio (foto+texto) que o KM inicial usa.
function registrarKMFinalPendente(osId, tecnicoId, kmFinal, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'REGISTRO_KM', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa('OS nao encontrada: ' + osId);

  const colStatus = getCol('Status');
  const status = colStatus ? String(osSheet.getRange(osRow, colStatus).getValue()) : '';
  if (status !== 'Concluída') return _recusa('OS nao esta concluida, KM final nao se aplica ainda');

  const colKmInicial = getCol('KM_Inicial_OS');
  const kmInicial = colKmInicial ? (parseFloat(osSheet.getRange(osRow, colKmInicial).getValue()) || 0) : 0;
  const kmFinalNum = parseFloat(kmFinal) || 0;

  if (kmFinalNum < kmInicial) {
    return _recusa('KM final nao pode ser menor que o KM inicial desta OS (' + kmInicial + ')');
  }

  const diferenca = kmFinalNum - kmInicial;
  if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
    const temFoto = !!fotoDesvioUrl;
    const temTexto = !!(justificativaDesvio && justificativaDesvio.trim());
    if (!temFoto || !temTexto) {
      const mensagem = 'Trecho de ' + Math.round(diferenca) + 'km dentro desta OS. '
        + 'Informe justificativa por texto E foto do odometro para continuar.';
      return _recusa(mensagem, { exigeJustificativa: true, mensagem: mensagem });
    }
  }

  const set = (campo, val) => { const col = getCol(campo); if (col) osSheet.getRange(osRow, col).setValue(val); };
  set('KM_Final_OS', kmFinalNum);
  if (justificativaDesvio) set('KM_Justificativa_Desvio', justificativaDesvio);
  if (fotoDesvioUrl) set('KM_Foto_Desvio_URL', fotoDesvioUrl);

  return { sucesso: true };
  });
}

// ─── getOSsPendentesKMFinal ───────────────────────────────────────────
// Alimenta o banner de lembrete: OS Concluida do tecnico, dos ultimos
// 3 dias, com KM_Inicial_OS preenchido mas KM_Final_OS vazio.
function getOSsPendentesKMFinal(tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Ordens_Servico');
  if (!sheet) return [];
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const col = name => h.indexOf(name);
  const iId = col('ID_OS');
  const iCliente = col('Nome_Cliente');
  const iTec = (col('ID_Tecnico') >= 0 ? col('ID_Tecnico') : col('Nome_Tecnico'));
  const iStatus = col('Status');
  const iEnc = col('Hora_Encerramento');
  const iKmIni = col('KM_Inicial_OS');
  const iKmFinal = col('KM_Final_OS');
  if (iKmIni < 0 || iKmFinal < 0) return [];

  const limite = new Date();
  limite.setDate(limite.getDate() - 3);

  const pendentes = [];
  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (String(row[iTec]) !== String(tecnicoId)) continue;
    if (String(row[iStatus]) !== 'Concluída') continue;
    const enc = row[iEnc];
    if (!(enc instanceof Date) || enc < limite) continue;
    const kmIni = row[iKmIni];
    const kmFinal = row[iKmFinal];
    if ((kmIni === '' || kmIni === null)) continue; // OS sem KM por-OS (nao usou veiculo)
    if (kmFinal !== '' && kmFinal !== null) continue; // ja preenchido

    pendentes.push({
      osId: String(row[iId]),
      cliente: iCliente >= 0 ? String(row[iCliente] || '') : '',
      dataEncerramento: Utilities.formatDate(enc, TZ, 'dd/MM HH:mm'),
      kmInicial: parseFloat(kmIni) || 0
    });
  }
  return pendentes;
}

