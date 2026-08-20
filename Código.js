// ============================================================
// ELETRIUM ERP — Apps Script PWA v4.0
// Planilha: 1XjMXQKjfcvdxQLj3M6InIH50OfMbzj03uJR5Jx46AvI
// Campo — Carlos e Paulo
// v4.0: + KM/Veiculo + Geolocalizacao + Inicio/Fim Dia
// ============================================================

const SHEET_ID = '1XjMXQKjfcvdxQLj3M6InIH50OfMbzj03uJR5Jx46AvI';
const TZ = 'GMT-3';
// FIELD_API_CONTRACT (Seção 19, CONTRATO-BACKEND-FIELD-API-CONTRACT.md,
// sessão de frontend) -- so incrementa ('v2', 'v3'...) numa mudança
// QUEBRADORA de verdade no dispatcher/envelope (ex.: parametro posicional
// novo obrigatorio, remocao de campo que o frontend le), nunca em toda
// alteracao/deploy. O frontend (eletrium-field-checklist3) compara isso
// contra FIELD_API_CONTRACT_ESPERADO no boot e bloqueia com tela cheia se
// divergir -- ver getFieldApiContract() mais abaixo.
const FIELD_API_CONTRACT = 'v1';
const OS_LINHAS_FORMATACAO = 20000; // teto pragmatico pra pre-formatar colunas de texto critico em Ordens_Servico (ex.: SP_Sincronizado_Em), mesmo padrao do LOG_CENTRAL_LINHAS_VALIDACAO

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
      'Checklist_Execucao_Completo',
      // Protecao anti-sobrescrita do 1B (DESENHO-1B-ANTI-SOBRESCRITA.md,
      // aprovado 13/08) -- watermark do lado SharePoint: guarda o valor
      // de `Modified` do item do SharePoint no momento em que o 1B
      // aplicou a ultima edicao administrativa (Title/Cliente/Tecnico/
      // Descricao/Criticidade/datas), nao a hora em que o Make rodou.
      // "Mais novo vence": 1B so aplica um updateRow se Modified (SP) for
      // mais recente que este valor. Escrito pelo 1B (Make), nao por
      // este codigo -- Apps Script so garante a coluna existir e com o
      // formato de texto critico (ver bloco de formatacao abaixo).
      'SP_Sincronizado_Em'
    ];
    novos.forEach(campo => {
      if (!existingHeaders.includes(campo)) {
        const nextCol = osSheet.getLastColumn() + 1;
        osSheet.getRange(1, nextCol).setValue(campo);
      }
    });

    // SP_Sincronizado_Em como texto simples ('@'), nunca Date nativo --
    // mesma regra critica das colunas de tempo do Log_Central (o Sheets
    // autoconverte ISO 8601 em Date com timezone silencioso senao). O
    // valor e um timestamp de ORIGEM (Modified do SharePoint) escrito
    // pelo 1B via Make, comparado como string ISO -- uma conversao
    // silenciosa quebraria a comparacao "mais novo vence".
    const headersAposNovos = osSheet.getRange(1, 1, 1, osSheet.getLastColumn()).getValues()[0];
    const idxSpSync = headersAposNovos.indexOf('SP_Sincronizado_Em');
    if (idxSpSync >= 0) {
      osSheet.getRange(1, idxSpSync + 1, OS_LINHAS_FORMATACAO, 1).setNumberFormat('@');
    }
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
  let ferramentalSheet = ss.getSheetByName('Ferramental_Movimentos');
  if (!ferramentalSheet) {
    ferramentalSheet = ss.insertSheet('Ferramental_Movimentos');
    ferramentalSheet.getRange(1, 1, 1, FERRAMENTAL_MOVIMENTOS_HEADERS.length).setValues([FERRAMENTAL_MOVIMENTOS_HEADERS]);
  }
  _garantirFormatoFerramentalMovimentos(ferramentalSheet);

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

// _garantirFormatoFerramentalMovimentos -- achado adjacente da varredura
// de TOCTOU (15/08, finalizado agora): Registrado_Em gravava Date nativo
// ate o commit 5b7f83c (corrigido pra .toISOString()) -- mesma classe de
// bug ja tratada em Log_Central/Ordens_Servico/Alocacoes_Ofertas, mesmo
// padrao de correcao aplicado aqui: (1) coluna pre-formatada como texto
// '@' ANTES de qualquer escrita nova (evita o Sheets autoconverter ISO
// 8601 em Date com timezone silencioso -- protege dai em diante); (2)
// normalizacao de celulas Date ja gravadas ANTES do fix de 5b7f83c, se
// a aba ja existia (mesmo mecanismo de _normalizarTimestampsLogCentral,
// idempotente, no-op se ja for tudo texto). Roda sempre (aba nova ou ja
// existente), mesmo padrao "sempre reaplica" de garantirLogCentral.
function _garantirFormatoFerramentalMovimentos(sheet) {
  const idxRegistradoEm = FERRAMENTAL_MOVIMENTOS_HEADERS.indexOf('Registrado_Em');
  sheet.getRange(1, idxRegistradoEm + 1, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('@');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, idxRegistradoEm + 1, lastRow - 1, 1);
  const valores = range.getValues();
  let mudou = false;
  for (let i = 0; i < valores.length; i++) {
    if (valores[i][0] instanceof Date) {
      valores[i][0] = valores[i][0].toISOString();
      mudou = true;
    }
  }
  if (mudou) range.setValues(valores);
}

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

// Teto de retry -- decisao fechada pela Cowork 2 (PROPOSTA-TETO-RETRY.md,
// 3 eixos: 5 tentativas uniforme pra SYNC_ERROR, backoff crescente,
// alerta via campo novo em vez de mexer no catalogo aprovado de
// erro_codigo). So o schema aqui -- a logica do scanner (contagem,
// backoff, QUANDO marcar) e escopo do cenario Make que a Cowork 1 vai
// construir, nao deste codigo. Boolean simples, sem validacao de lista
// (mesmo padrao de outros booleanos do projeto -- Checklist_Execucao_
// Completo, EPI_Checklist_OK -- nenhum tem formatacao especial).
// Retry_Manual_Por/Retry_Manual_Em -- especificacao fechada (Geovane,
// 14/08): quando o retry manual reseta uma linha Teto_Excedido=true de
// volta pra QUEUED, precisa registrar quem pediu e quando -- nao existia
// nenhum campo pra isso ate agora (reprocessarOperacaoManual, abaixo, e
// a unica escrita nessas 2 colunas).
const LOG_CENTRAL_COLUNAS_RETRY = [
  { nome: 'Teto_Excedido', largura: 110 },
  { nome: 'Retry_Manual_Por', largura: 140 },
  { nome: 'Retry_Manual_Em', largura: 160 },
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
    .concat(LOG_CENTRAL_COLUNAS_OUTBOX.map(c => c.nome))
    .concat(LOG_CENTRAL_COLUNAS_RETRY.map(c => c.nome));
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
  const offsetRetry = offsetOutbox + LOG_CENTRAL_COLUNAS_OUTBOX.length; // logo apos entity_type/entity_id/entity_version
  LOG_CENTRAL_COLUNAS_RETRY.forEach((c, i) => sheet.setColumnWidth(offsetRetry + i, c.largura));

  // 3) CRITICO: F,G,H,I (criado_em/enviado_em/recebido_em/sincronizado_em)
  // + Retry_Manual_Em (mesma classe de coluna, mesmo risco) como texto
  // simples ANTES de qualquer dado -- evita o Sheets autoconverter ISO
  // 8601 em Date com timezone silencioso.
  ['criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em', 'Retry_Manual_Em'].forEach(nome => {
    const idx = nomes.indexOf(nome) + 1;
    sheet.getRange(1, idx, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('@');
  });

  // 4) validacoes (4 listas Reject-input + formula de tentativas) +
  // formato numerico de tentativas/entity_version -- extraido pra
  // _aplicarValidacoesLogCentral (ver abaixo), reusada tambem no reparo
  // de uma aba ja existente (_garantirColunasOutboxLogCentral).
  _aplicarValidacoesLogCentral(sheet, nomes);

  return sheet;
}

// _aplicarValidacoesLogCentral -- aplica (SEMPRE reaplica, nunca so
// verifica) as 5 regras de validacao do Log_Central: 4 listas fechadas
// (Reject input: status/tipo_operacao/erro_codigo/entity_type) + a
// formula de tentativas, mais os formatos numericos de tentativas/
// entity_version. Extraida em funcao propria e chamada tanto na criacao
// da aba (garantirLogCentral) quanto no reparo de uma aba ja existente
// (_garantirColunasOutboxLogCentral) -- achado real (12/08): uma
// execucao de setupSheets() pode travar NO MEIO da aplicacao das
// validacoes (foi exatamente o caso -- crash no bug de locale pt-BR na
// formula de tentativas deixou a aba criada, mas sem essa validacao
// especifica; a rodada seguinte, que teve sucesso, so verificava as 3
// colunas outbox via _garantirColunasOutboxLogCentral, nunca revisitava
// o resto). Reaplicar tudo incondicionalmente sempre que a aba ja
// existe e mais simples e mais seguro do que tentar detectar qual
// validacao especifica ficou faltando -- cobre qualquer ponto de
// travamento no meio do setup original, nao so este caso.
function _aplicarValidacoesLogCentral(sheet, headers) {
  const idx = nomeCol => headers.indexOf(nomeCol) + 1;

  const aplicarListaRejeitando = (nomeCol, valores) => {
    const col = idx(nomeCol);
    if (col <= 0) return;
    const range = sheet.getRange(2, col, LOG_CENTRAL_LINHAS_VALIDACAO - 1, 1);
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

  const colTentativas = idx('tentativas');
  if (colTentativas > 0) {
    sheet.getRange(1, colTentativas, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');
    const rangeTentativas = sheet.getRange(2, colTentativas, LOG_CENTRAL_LINHAS_VALIDACAO - 1, 1);
    // Planilha em locale pt-BR -- formulas customizadas de data validation
    // exigem ';' como separador de argumento, nao ',' (mesma armadilha de
    // localizacao ja documentada do lado SharePoint com ValidationFormula/
    // OR->OU). Vírgula aqui falha com "argumento da regra de validacao de
    // dados e invalido" -- confirmado ao vivo, so essa formula no projeto
    // usa requireFormulaSatisfied (as outras 4 sao requireValueInList).
    const regraTentativas = SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=AND(ISNUMBER(K2); K2>=0; K2=INT(K2))')
      .setAllowInvalid(false)
      .build();
    rangeTentativas.setDataValidation(regraTentativas);
  }

  const colVersao = idx('entity_version');
  if (colVersao > 0) sheet.getRange(1, colVersao, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');
}

// _garantirColunasOutboxLogCentral -- idempotente, mesmo padrao das
// outras colunas novas do projeto (setupSheets): se Log_Central ja foi
// criado ANTES desta rodada (schema sem entity_type/entity_id/
// entity_version/Teto_Excedido), adiciona as colunas que faltarem no
// final sem mexer no resto. Cobre Outbox (entity_*) e retry
// (Teto_Excedido) com o mesmo loop -- ambas sao so "adiciona se faltar".
function _garantirColunasOutboxLogCentral(sheet) {
  let lastCol = sheet.getLastColumn();
  let headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  LOG_CENTRAL_COLUNAS_OUTBOX.concat(LOG_CENTRAL_COLUNAS_RETRY).forEach(c => {
    if (!headers.includes(c.nome)) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(c.nome);
      sheet.setColumnWidth(nextCol, c.largura);
      if (c.nome === 'entity_version') sheet.getRange(1, nextCol, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('0');
      // mesma cautela critica de criado_em/sincronizado_em (texto ANTES
      // de qualquer dado, senao o Sheets autoconverte ISO 8601 em Date).
      if (c.nome === 'Retry_Manual_Em') sheet.getRange(1, nextCol, LOG_CENTRAL_LINHAS_VALIDACAO, 1).setNumberFormat('@');
      headers.push(c.nome);
    }
  });

  // Reparo (achado real, 12/08): uma execucao anterior de setupSheets()
  // pode ter criado a aba e travado antes de terminar de aplicar as
  // validacoes -- nao so a falta de coluna outbox. Reaplica as 5
  // validacoes incondicionalmente toda vez que a aba ja existe (nao so
  // quando falta coluna), pra nao depender de detectar qual delas ficou
  // faltando.
  _aplicarValidacoesLogCentral(sheet, headers);
  _normalizarTimestampsLogCentral(sheet, headers);
}

// _normalizarTimestampsLogCentral -- achado real (14/08, apoio ao
// scanner de retry que a Cowork 1 esta montando, pergunta sobre formato
// de data pra quem le Log_Central via Make). A PRIMEIRA versao deste
// backend (commit aedc20e, antes do schema aprovado Geovane/Cowork 2 em
// bbc16e9) gravava `criado_em`/`recebido_em`/`sincronizado_em` como Date
// NATIVO do Apps Script, nao texto ISO 8601 -- o guard `setNumberFormat
// ('@')` que protege essas colunas hoje so afeta ESCRITAS NOVAS numa
// celula; ele NAO reconverte retroativamente uma celula que ja tem um
// valor Date gravado (mudar o formato de exibicao de um valor existente
// nao muda o tipo/conteudo dele -- e' comportamento documentado do
// Sheets, nao um bug deste codigo). Se o Log_Central real coletou dado
// durante essa janela (nao verificavel remotamente daqui, sem acesso a
// planilha de producao), linhas antigas podem ter Date nativo nessas
// colunas ate hoje, misturado com linhas novas (texto) na MESMA coluna.
//
// Quem le essas colunas via Make (Cowork 1, scanner de retry) precisaria
// tratar os dois formatos na ponta dele -- ou este backend normaliza pra
// texto de uma vez, fechando a mistura na fonte. Escolhido normalizar
// aqui: mais simples exigir 1 formato de quem consome, e o backend e'
// quem tem acesso direto ao tipo real de cada celula (Make so ve o que
// o conector do Google Sheets devolve, que ja pode ter perdido a
// distincao). Idempotente e' automatico via `_garantirColunasOutboxLog
// Central` (roda toda vez que setupSheets() roda numa aba ja existente)
// -- no-op se toda celula ja for texto.
function _normalizarTimestampsLogCentral(sheet, headers) {
  const colunas = ['criado_em', 'enviado_em', 'recebido_em', 'sincronizado_em', 'Retry_Manual_Em'];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { linhasVerificadas: 0, celulasCorrigidas: 0 };

  let celulasCorrigidas = 0;
  colunas.forEach(nome => {
    const idx = headers.indexOf(nome);
    if (idx < 0) return;
    const range = sheet.getRange(2, idx + 1, lastRow - 1, 1);
    const valores = range.getValues();
    let mudou = false;
    for (let i = 0; i < valores.length; i++) {
      if (valores[i][0] instanceof Date) {
        // .toISOString() preserva o MESMO instante (UTC) -- so troca a
        // representacao, nunca desloca a hora real gravada.
        valores[i][0] = valores[i][0].toISOString();
        mudou = true;
        celulasCorrigidas++;
      }
    }
    if (mudou) range.setValues(valores);
  });
  return { linhasVerificadas: lastRow - 1, celulasCorrigidas: celulasCorrigidas };
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
// CENTRAL.md, ajuste 4 do auditor). Apps Script nao tem lock nativo por
// chave arbitraria (nao da pra travar "so a OS-123") -- a unica API real
// e script-inteiro/documento-inteiro. Por isso o lock cobre SO a reserva
// da entity_version + a linha de Intent Log (leitura+incremento+append,
// tudo rapido, metadado) -- NUNCA fn() (a mutacao real: upload, chamada
// externa, qualquer coisa lenta) fica de fora do lock, liberado antes de
// fn() rodar. Devolve {lockObtido, valor} pra separar "conseguiu o lock"
// de "o que o callback calculou" -- sem isso um valor legitimo
// devolvido pelo callback poderia ser confundido com falha de lock.
const LOCK_TIMEOUT_MS = 10000;

function _comLockDeOS(fn) {
  const lock = LockService.getScriptLock();
  const obtido = lock.tryLock(LOCK_TIMEOUT_MS);
  if (!obtido) {
    return { lockObtido: false, valor: null };
  }
  try {
    return { lockObtido: true, valor: fn() };
  } finally {
    lock.releaseLock();
  }
}

// _proximaVersaoEntidadeOS -- maior entity_version ja gravado em
// Log_Central pra este OS_ID, +1 (ou 1 se nenhum ainda). SO deve ser
// chamada de dentro de _comLockDeOS -- ler-incrementar fora do lock e
// exatamente a corrida que o ajuste 3 do auditor pede pra fechar.
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
//
// Padrao Intent Log (ajuste 3 do auditor): a linha de Log_Central e
// gravada como LOCAL_PENDING ANTES de fn() rodar, nao depois -- evita
// "mutacao aconteceu, ninguem sabe que precisa sincronizar" se fn()
// nunca chegar a rodar por algum motivo externo. Reserva da versao +
// esse append acontecem sob lock (rapido); fn() roda DEPOIS, fora do
// lock (ajuste 4 -- lock nunca durante upload/chamada externa).
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

    // Achado #1 (Geovane, revisao do T-LOG-02): reconhecer SO
    // status===SYNCED como "ja processado" deixava uma linha presa em
    // erro mesmo apos fn() ja ter rodado com SUCESSO (T-LOG-02: mutacao
    // OK, so a escrita do status falhou) cair no "reprocessa",
    // reexecutando fn() INTEIRA de novo -- duplicando linha nas funcoes
    // appendRow. Fix: com resultado_json valido (PROVA de que fn() rodou
    // e o que ela devolveu), NUNCA reexecuta -- devolve o cache, auto-
    // curando o status pra refletir o desfecho real (SYNCED se sucesso,
    // ou o status que o proprio resultado carrega se for uma recusa
    // canonica -- ver processarEGravarLog).
    //
    // Achado #2 (Geovane, revisao do proprio fix acima, MESMO DIA):
    // bloquear reexecucao tambem quando NAO HA resultado_json (T-LOG-01:
    // fn() genuinamente nunca completou) quebrava o retry automatico de
    // SYNC_ERROR de verdade -- o outbox do frontend (processarFilaOffline,
    // eletrium-field/index.html) reenvia com o MESMO operationId em todo
    // ciclo de backoff (confirmado por leitura do codigo real), esperando
    // que uma nova tentativa RODE fn() de novo. Sem resultado_json nao ha
    // NADA que poderia ser duplicado (fn() nunca produziu nada) -- entao
    // e seguro, e necessario, reexecutar. So o caso COM resultado_json
    // (mutacao PROVADAMENTE completa) bloqueia reexecucao.
    const resultadoBruto = dados[i][idxResultado];
    if (resultadoBruto) {
      try {
        const cache = JSON.parse(resultadoBruto);
        const statusReal = (cache && cache.success === false && cache.status) ? cache.status : 'QUEUED';
        const statusAtual = dados[i][idxStatus];
        // Achado da Cowork 1 (mesmo dia que o fix de QUEUED em _sucesso):
        // com QUEUED como terminal de sucesso, a auto-cura NAO PODE mais
        // reescrever incondicionalmente -- o 1A (ator externo, Make.com)
        // avanca a MESMA linha por QUEUED->SENDING->RECEIVED->SYNCED->
        // RECONCILED depois que este codigo termina. Curar de volta pra
        // QUEUED sobrescreveria progresso real do 1A. So e seguro curar
        // quando o status atual esta PRESO num estado anterior ao
        // terminal do lado do Sheets (LOCAL_PENDING: nunca chegou a
        // atualizar; SYNC_ERROR: e o proprio caso do T-LOG-02, escrita
        // do status falhou apos a mutacao ja ter tido sucesso) -- nunca
        // quando ja esta QUEUED/SENDING/RECEIVED/SYNCED/RECONCILED (sinal
        // de que o 1A ja tocou ou esta tocando a linha). Recusa
        // (cache.success===false) fica de fora dessa cautela -- nao ha
        // mutacao sincronizavel nesse caso, entao nao ha progresso do 1A
        // pra proteger.
        const seguroCurar = cache && cache.success === false
          ? true
          : (statusAtual === 'LOCAL_PENDING' || statusAtual === 'SYNC_ERROR');
        if (seguroCurar && statusAtual !== statusReal) {
          try {
            log.getRange(i + 1, idxStatus + 1).setValue(statusReal);
            const idxSincAutoCura = h.indexOf('sincronizado_em');
            if (idxSincAutoCura >= 0) log.getRange(i + 1, idxSincAutoCura + 1).setValue(new Date().toISOString());
          } catch (eCura) {
            // melhor esforco -- uma falha aqui nao impede devolver o
            // resultado cacheado, que e o que realmente importa.
          }
        }
        return cache;
      } catch (eParse) {
        // resultado corrompido -- trata como se nao existisse, cai pro
        // reprocessamento abaixo (mais seguro que devolver lixo).
      }
    }

    // Sem resultado_json utilizavel -- fn() nunca completou. Reserva
    // rapida (incrementa tentativas, marca SENDING) sob lock; fn() roda
    // DEPOIS, fora do lock (ajuste 4).
    const linhaNum = i + 1;
    const reserva = _comLockDeOS(() => {
      const tentativaAtual = (parseInt(dados[i][idxTentativas]) || 0) + 1;
      log.getRange(linhaNum, idxTentativas + 1).setValue(tentativaAtual);
      log.getRange(linhaNum, idxStatus + 1).setValue('SENDING');
      return true;
    });
    if (!reserva.lockObtido) return _recusa(operationId, 'Sistema ocupado, tente novamente em instantes', { error_code: 'CONEXAO_INDISPONIVEL', retryable: true, status: 'SYNC_ERROR' });
    return processarEGravarLog(log, linhaNum, h, fn, operationId);
  }

  // Primeira vez que este operation_id aparece -- Intent Log sob lock:
  // ler versao atual -> incrementar -> gravar a linha como LOCAL_PENDING
  // (rapido, so metadado) -> liberar lock -> SO ENTAO rodar fn() (fora
  // do lock) -> atualizar a MESMA linha pro desfecho final.
  const reserva = _comLockDeOS(() => {
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
    linha[idxStatus] = 'LOCAL_PENDING';
    linha[idxTentativas] = 1;
    const idxEntityType = h.indexOf('entity_type');
    const idxEntityId = h.indexOf('entity_id');
    const idxEntityVersion = h.indexOf('entity_version');
    if (idxEntityType >= 0) linha[idxEntityType] = entityType;
    if (idxEntityId >= 0) linha[idxEntityId] = entityId;
    if (idxEntityVersion >= 0) linha[idxEntityVersion] = versao;
    log.appendRow(linha);
    return log.getLastRow();
  });
  if (!reserva.lockObtido) return _recusa(operationId, 'Sistema ocupado, tente novamente em instantes', { error_code: 'CONEXAO_INDISPONIVEL', retryable: true, status: 'SYNC_ERROR' });
  return processarEGravarLog(log, reserva.valor, h, fn, operationId);
}

// processarEGravarLog -- roda fn() FORA de qualquer lock (ajuste 4). A
// linha ja existe como LOCAL_PENDING/SENDING (Intent Log, gravada antes
// desta chamada) -- aqui so atualiza o desfecho.
//
// T-LOG-01 (log criado, mutacao falha): fn() lanca excecao -- a linha
// (que ja existia) e marcada SYNC_ERROR, erro devolvido no envelope
// canonico (retryable:true, pra retry automatico do outbox).
//
// T-LOG-02 (mutacao ok, update do status do log falha): fn() teve
// sucesso -- a ENTIDADE JA FOI ALTERADA nesse ponto -- mas a escrita que
// marca SYNCED no Log_Central falha. Devolve sucesso pro chamador (a
// operacao realmente funcionou, seria desonesto dizer que falhou), mas
// tenta best-effort marcar a linha como SYNC_ERROR (nao deixar presa em
// LOCAL_PENDING pra sempre) com um resultado_json de que a mutacao
// funcionou -- pra a varredura periodica (ajuste 7 do auditor) achar e
// reconciliar essa linha, em vez dela ficar invisivel.
function processarEGravarLog(log, linhaNum, headers, fn, operationId) {
  const idxStatus = headers.indexOf('status');
  const idxResultado = headers.indexOf('resultado_json');
  const idxSinc = headers.indexOf('sincronizado_em');
  const idxErro = headers.indexOf('erro_detalhe');
  const idxErroCodigo = headers.indexOf('erro_codigo');

  let resultadoFn;
  try {
    resultadoFn = fn();
  } catch (e) {
    // T-LOG-01
    const mensagem = String((e && e.message) || e);
    const codigo = classificarErroLogCentral(mensagem);
    try { log.getRange(linhaNum, idxStatus + 1).setValue('SYNC_ERROR'); } catch (e1) { /* Log_Central inacessivel -- nada mais a tentar */ }
    try { log.getRange(linhaNum, idxErro + 1).setValue(mensagem); } catch (e1) { /* idem */ }
    try { if (idxErroCodigo >= 0) log.getRange(linhaNum, idxErroCodigo + 1).setValue(codigo); } catch (e1) { /* idem */ }
    return _recusa(operationId, mensagem, { error_code: codigo, retryable: true, status: 'SYNC_ERROR' });
  }

  // Achado adjacente (revisao do retry de SYNC_ERROR, mesmo dia): fn()
  // pode devolver uma recusa canonica SEM lancar excecao (ex.:
  // confirmarSegurancaPreExecucao com confirmacoes incompletas,
  // fecharFaseChecklist com fase invalida) -- isso e um retorno normal,
  // nao cai no catch acima. `_sucesso` ja preserva os campos de
  // resultadoFn quando ele e um _recusa() (Object.assign da preferencia
  // pro resultado sobre os defaults), entao `envelope.status` ja reflete
  // corretamente DIVERGENT/etc -- mas a ESCRITA na planilha usava
  // 'SYNCED' fixo, nao o status real. Corrigido: usa envelope.status.
  const envelope = _sucesso(operationId, resultadoFn);
  // Ordem de escrita deliberada (Geovane, achado de integracao):
  // resultado_json e o sinal de "mutacao completou" que
  // executarIdempotente usa pra decidir se um retry pode reexecutar
  // fn() -- grava-lo PRIMEIRO (antes de status/sincronizado_em) reduz a
  // janela onde um erro DEPOIS de fn() ja ter rodado deixaria essa prova
  // sem existir. Nao elimina o residual por completo (a propria escrita
  // de resultado_json ainda pode falhar) -- mas reduz de "qualquer uma
  // de 3 escritas falhar" pra "essa 1 escrita especifica falhar".
  try {
    log.getRange(linhaNum, idxResultado + 1).setValue(JSON.stringify(envelope));
    // 'QUEUED', nao 'SYNCED' -- ver comentario em _sucesso() (achado da
    // Cowork 1: SYNCED e' escrito pelo 1A/reconciliacao, nao aqui).
    log.getRange(linhaNum, idxStatus + 1).setValue(envelope.status || 'QUEUED');
    // sincronizado_em (coluna I) e TEXTO ISO 8601, nunca Date nativo —
    // mesma regra critica de criado_em/recebido_em.
    log.getRange(linhaNum, idxSinc + 1).setValue(new Date().toISOString());
    return envelope;
  } catch (eLog) {
    // T-LOG-02 -- resultadoFn existe, a mutacao ja aconteceu de verdade.
    // resultado_json PRIMEIRO de novo aqui (pode ter sido exatamente essa
    // escrita que lancou a excecao acima) -- e o sinal que mais importa
    // salvar, mesmo que status/erro_detalhe nao consigam.
    const mensagemLog = String((eLog && eLog.message) || eLog);
    try { log.getRange(linhaNum, idxResultado + 1).setValue(JSON.stringify(envelope)); } catch (e2) {}
    try { log.getRange(linhaNum, idxStatus + 1).setValue('SYNC_ERROR'); } catch (e2) {}
    try { log.getRange(linhaNum, idxErro + 1).setValue('Mutacao OK, falha ao registrar SYNCED: ' + mensagemLog); } catch (e2) {}
    return Object.assign({}, envelope, { log_sync_warning: mensagemLog });
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

// getFieldApiContract — leitura publica de metadado do servidor (mesmo
// padrao de canCloseOS/lerCamposOS: sem checagem de posse, nao e dado de
// negocio). Chamada como PRIMEIRA coisa no boot do frontend, antes de
// qualquer outra acao -- se o backend for republicado com uma mudanca
// quebradora (FIELD_API_CONTRACT incrementado), o frontend bloqueia com
// tela cheia em vez de continuar silenciosamente incompativel.
function getFieldApiContract() {
  return { field_api_contract: FIELD_API_CONTRACT };
}

// reprocessarOperacaoManual — retry manual acionado por um humano (botao
// "Tentar novamente" fora do outbox local do tecnico, Fase A do Code 2 --
// esse botao ja existente so cobre DIVERGENT via novo operationId; este
// endpoint e' NOVO, cobre o caso complementar: SYNC_ERROR que esgotou as
// 5 tentativas automaticas). Especificacao fechada (Geovane, 14/08):
//
// - So elegivel quando status==='SYNC_ERROR' E Teto_Excedido===true --
//   e' assim que a funcao distingue "esgotou o teto, precisa de humano"
//   de "ainda dentro do teto, o scanner automatico ja cobre" (fail-closed,
//   recusa qualquer outra combinacao, mesmo padrao do resto do projeto).
//   DIVERGENT nunca bate essa condicao (status diferente) -- nao e'
//   afetado por este caminho em nenhuma hipotese, dos dois lados: nem
//   avancado por aqui, nem tocado por engano.
// - Reseta Teto_Excedido->false, status->QUEUED. NAO zera `tentativas`
//   (preserva o historico acumulado) nem `erro_codigo`/`erro_detalhe` (o
//   "erro anterior" fica registrado, so deixa de bloquear).
// - Registra quem pediu (Retry_Manual_Por) e quando (Retry_Manual_Em,
//   ISO 8601 texto -- mesma cautela critica de criado_em/sincronizado_em).
//
// Nuance sinalizada, nao resolvida aqui (fora de escopo deste contrato):
// toda linha que bate essa condicao chega SEM resultado_json (SYNC_ERROR
// por excecao em processarEGravarLog nunca grava resultado_json -- so o
// caminho de sucesso grava). Ou seja, esta funcao pode produzir uma linha
// QUEUED com resultado_json vazio, diferente de todo outro QUEUED do
// sistema (que sempre tem resultado_json, e' o sinal de "mutacao ja
// aconteceu, so falta sincronizar"). O scanner (Cowork 1, ainda nao
// construido, REQUISITOS-SCANNER-RETRY.md) precisa saber distinguir isso:
// para ESTAS linhas, QUEUED significa "re-invocar o dispatcher com o
// operation_id original pra rodar fn() de novo" (mesmo mecanismo do
// retry automatico via resultado_json ausente em executarIdempotente),
// nao "repassar resultado_json pro SharePoint". Sinalizado no doc do
// scanner, nao decidido por este codigo.
//
// Sem verificarPosseOS -- nao e' uma acao de tecnico sobre "sua" OS, e'
// uma acao administrativa sobre uma linha de Log_Central (nao ha conceito
// de posse de uma linha de log). solicitanteId e' registrado como
// identificador de auditoria (quem clicou), nao validado contra nenhuma
// lista fechada (a natureza de quem opera esse botao -- gestor/admin --
// ainda nao tem uma tabela de identidade propria no projeto, diferente
// de Tecnicos_MEI).
function reprocessarOperacaoManual(operationId, solicitanteId) {
  if (!operationId) return { sucesso: false, erro: 'operationId obrigatorio' };
  if (!solicitanteId || !String(solicitanteId).trim()) return { sucesso: false, erro: 'solicitanteId obrigatorio' };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const log = ss.getSheetByName('Log_Central');
  if (!log) return { sucesso: false, erro: 'Log_Central nao encontrado' };

  const resultado = _comLockDeOS(() => {
    const dados = log.getDataRange().getValues();
    const h = dados[0];
    const idxOpId = h.indexOf('operation_id');
    const idxStatus = h.indexOf('status');
    const idxTeto = h.indexOf('Teto_Excedido');
    const idxRetryPor = h.indexOf('Retry_Manual_Por');
    const idxRetryEm = h.indexOf('Retry_Manual_Em');

    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][idxOpId]) !== String(operationId)) continue;

      const statusAtual = dados[i][idxStatus];
      const tetoAtual = idxTeto >= 0 ? dados[i][idxTeto] : false;
      if (statusAtual !== 'SYNC_ERROR' || tetoAtual !== true) {
        return { sucesso: false, erro: 'Retry manual so permitido para operacoes SYNC_ERROR com teto de tentativas excedido (status atual: ' + statusAtual + ', Teto_Excedido: ' + tetoAtual + ')' };
      }

      const linhaNum = i + 1;
      log.getRange(linhaNum, idxStatus + 1).setValue('QUEUED');
      if (idxTeto >= 0) log.getRange(linhaNum, idxTeto + 1).setValue(false);
      if (idxRetryPor >= 0) log.getRange(linhaNum, idxRetryPor + 1).setValue(solicitanteId);
      if (idxRetryEm >= 0) log.getRange(linhaNum, idxRetryEm + 1).setValue(new Date().toISOString());
      return { sucesso: true, operationId: operationId, status: 'QUEUED' };
    }
    return { sucesso: false, erro: 'Operacao nao encontrada: ' + operationId };
  });

  if (!resultado.lockObtido) return { sucesso: false, erro: 'Sistema ocupado, tente novamente em instantes' };
  return resultado.valor;
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

function salvarArquivoOS(osId, tecnicoId, campo, base64Data, mimeType, nomeArquivo, operationId, dispositivoId, token) {
  if (CAMPOS_ARQUIVO_PERMITIDOS.indexOf(campo) < 0) {
    return _recusa(operationId, 'Campo nao permitido: ' + campo);
  }
  // Onda 1 do rollout do token de sessao (Opcao A, E-TOCTOU-01,
  // PLANO-ROLLOUT-OPCAO-A-TOKEN-SESSAO.md) -- opcional durante a
  // transicao: chamador antigo sem token continua funcionando, so quem
  // manda token errado/expirado/de outro tecnico e recusado.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);
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
    if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

    const col = getCol(campo);
    if (!col) return _recusa(operationId, 'Coluna ' + campo + ' nao existe na planilha (rode rodarSetupSheets)');

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

function confirmarSegurancaPreExecucao(osId, tecnicoId, confirmacoes, temNaoConformidade, operationId, dispositivoId, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);
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
    if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

    const colEstado = getCol('Estado_Seguranca');
    if (!colEstado) return _recusa(operationId, 'Coluna Estado_Seguranca nao existe na planilha (rode rodarSetupSheets)');

    const c = confirmacoes || {};
    const faltando = CONFIRMACOES_SEGURANCA_MIN.filter(item => !c[item]);
    if (faltando.length) {
      return _recusa(operationId, 'Confirmacoes de seguranca incompletas', { faltando: faltando, blocking_reasons: faltando });
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

function salvarSelfieEPI(osId, tecnicoId, base64Selfie, mimeType, epiChecklist, diarioTexto, operationId, dispositivoId, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);
  // tipo_operacao pro Log_Central: sem categoria propria "selfie" na
  // lista aprovada -- aproximado pra UPLOAD_FOTO (a selfie e uma foto;
  // EPI/diario sao dados secundarios na mesma chamada). Sinalizado, nao
  // escolhido silenciosamente.
  return executarIdempotente(operationId, 'UPLOAD_FOTO', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

    const colSelfie = getCol('Selfie_URL');
    const colEpiOk = getCol('EPI_Checklist_OK');
    const colEpiJson = getCol('EPI_Checklist_JSON');
    const colDiario = getCol('Diario_Tecnico');
    const colDiarioOk = getCol('Diario_Preenchido');
    if (!colSelfie || !colEpiOk || !colEpiJson || !colDiario || !colDiarioOk) {
      return _recusa(operationId, 'Colunas de Selfie/EPI/Diario nao existem na planilha (rode rodarSetupSheets)');
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
// FAIL-CLOSED (auditor, ajuste 2): se a posse nao pode ser determinada
// por QUALQUER motivo -- OS nao encontrada, coluna ID_Tecnico ausente --
// BLOQUEIA a escrita. O fail-open anterior (coluna ausente = sempre
// autoriza) foi explicitamente reprovado pelo auditor pra producao:
// "nao pode ir pra producao". Sem exceção pra planilha ainda sem o
// schema -- se ID_Tecnico nao existe, rode rodarSetupSheets primeiro;
// nao ha caminho onde "nao sei quem e o dono" deveria autorizar a escrita.
function verificarPosseOS(osId, tecnicoId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  if (!osSheet) return { ok: false, erro: 'OS nao encontrada: ' + osId };
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { ok: false, erro: 'OS nao encontrada: ' + osId };

  const colTec = getCol('ID_Tecnico');
  if (!colTec) {
    return { ok: false, erro: 'Nao foi possivel determinar posse da OS ' + osId + ' (coluna ID_Tecnico ausente na planilha -- rode rodarSetupSheets)' };
  }

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
// Contrato canonico de resposta (auditor, ajuste 1 -- SUBSTITUI o fix
// pontual anterior de sucesso/erro/motivos): {success, status,
// operation_id, error_code, retryable, blocking_reasons} em TODA
// resposta de funcao de escrita, sucesso ou recusa. `status` usa o
// vocabulario ja aprovado (LOG_CENTRAL_STATUS_VALIDOS). `error_code`
// reusa LOG_CENTRAL_ERRO_CODIGO_VALIDOS via classificarErroLogCentral.
// `retryable` distingue recusa de regra de negocio (false) de falha
// transitoria (true -- lock ocupado, erro do Sheets). `erro` (mensagem
// legivel) e uma adicao ALEM dos 6 campos do auditor, sinalizada aqui --
// error_code sozinho nao e algo pra mostrar ao tecnico. Campos legados
// por funcao (blockingReasons/faltando/exigeJustificativa/mensagem)
// continuam presentes via `extras`, mais sucesso/motivos (nomes da
// versao anterior) -- nada que ja leia eles quebra.
// Achado da Cowork 1 (revisao do router 1A, mesmo dia): o terminal de
// sucesso do lado do Apps Script/Sheets tem que ser QUEUED, nao SYNCED.
// No vocabulario aprovado (LOG_CENTRAL_STATUS_VALIDOS), SYNCED/RECONCILED
// significam "confirmado sincronizado com o SharePoint" -- algo que so o
// 1A (ou a reconciliacao, ajuste 8 do auditor: "so marcar RECONCILED apos
// validacao efetiva do dado no destino") pode saber de verdade. Gravar
// SYNCED aqui, no momento em que a mutacao no Sheets terminou (nao
// quando ela de fato chegou no SharePoint), e uma mentira de estado --
// e o efeito pratico e que NENHUMA linha passa por QUEUED, entao o
// watchRows do 1A (ajuste 5) nunca teria o que processar no caminho
// feliz, so os erros. QUEUED e o terminal correto: "mutacao no Sheets
// concluida, pronta pro 1A pegar". SYNCED/RECONCILED passam a ser
// escritos exclusivamente pelo 1A/reconciliacao, nunca por este codigo.
function _sucesso(operationId, resultado) {
  return Object.assign({
    success: true,
    status: 'QUEUED',
    operation_id: operationId || null,
    error_code: null,
    retryable: false,
    blocking_reasons: [],
  }, resultado || {});
}

function _recusa(operationId, erro, extras) {
  extras = extras || {};
  const status = extras.status || 'DIVERGENT';
  const retryable = extras.retryable === true;
  const errorCode = extras.error_code || classificarErroLogCentral(erro);
  const blockingReasons = extras.blocking_reasons || extras.motivos || [erro];
  const base = {
    success: false,
    status: status,
    operation_id: operationId || null,
    error_code: errorCode,
    retryable: retryable,
    blocking_reasons: blockingReasons,
    erro: erro,
    sucesso: false,
    motivos: blockingReasons,
  };
  return Object.assign(base, extras);
}

// ─── encontrarOuCriarLinhaDiaria ──────────────────────────────────
// Achado da varredura de TOCTOU (Cowork 2, 15/08 -- 3a+ ocorrencia do
// mesmo padrao no dia, elevado a prioridade real): find-or-create
// classico, sem lock. Duas chamadas quase simultaneas pro MESMO
// tecnico+dia (2 operationId, ex.: iniciarOS e registrarUsoVeiculo
// disparados quase juntos) podiam ambas NAO encontrar a linha do dia
// (nenhuma tinha dado append ainda) e ambas criarem uma linha nova --
// 2 linhas de Diaria_Tecnico pro mesmo tecnico no mesmo dia, corrompendo
// agregacao de horas/pagamento. Fix: toda a decisao (achar OU criar)
// roda sob lock -- a 2a chamada, depois de esperar a 1a liberar,
// encontra a linha que a 1a acabou de criar, em vez de criar outra.
function encontrarOuCriarLinhaDiaria(sheet, tecnicoId, hoje) {
  const resultado = _comLockDeOS(() => {
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
  });
  // Sem lock obtido: melhor esforco, cai pro comportamento antigo (sem
  // lock) em vez de quebrar a chamada inteira -- mesmo espirito de
  // "Sistema ocupado" das outras guardas, mas esta funcao nao tem
  // operationId/_recusa no proprio escopo pra devolver esse envelope
  // (e' um helper interno, chamado de dentro de outras fn()); scan
  // direto e' o fallback mais seguro disponivel aqui.
  if (!resultado.lockObtido) {
    const dados = sheet.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const dataLinha = dados[i][0] instanceof Date
        ? Utilities.formatDate(dados[i][0], TZ, 'yyyy-MM-dd')
        : String(dados[i][0]).substring(0, 10);
      if (dataLinha === hoje && String(dados[i][1]) === String(tecnicoId)) return i + 1;
    }
    sheet.appendRow([hoje, tecnicoId, '', '', '', 0, 0, 0, 0, '', '', 0, 'Em campo', 0, '']);
    return sheet.getLastRow();
  }
  return resultado.valor;
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
function getOsDoTecnico(tecnicoId, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Se presente, prova identidade antes de qualquer leitura/escrita
  // especifica do tecnico. Nao ha conceito de posse de OS nestas funcoes.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
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
function getDiariaTecnico(tecnicoId, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Se presente, prova identidade antes de qualquer leitura/escrita
  // especifica do tecnico. Nao ha conceito de posse de OS nestas funcoes.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
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
function registrarInicioDia(tecnicoId, tecnicoNome, usaVeiculo, kmInicial, veiculoId, operationId, dispositivoId, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Identidade e validada antes de qualquer mutacao do tecnico.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return _recusa(operationId, 'Aba Diaria_Tecnico nao encontrada');
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
function registrarFimDia(tecnicoId, kmFinal, operationId, dispositivoId, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Identidade e validada antes de qualquer mutacao do tecnico.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  return executarIdempotente(operationId, 'APONTAMENTO', '', tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Diaria_Tecnico');
  if (!sheet) return _recusa(operationId, 'Aba Diaria_Tecnico nao encontrada');
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
  if (!linha) return _recusa(operationId, 'Registro do dia nao encontrado');
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
  if (!sheet) return _recusa(null, 'Aba Diaria_Tecnico nao encontrada');
  addMissingHeaders();
  const hoje = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const linha = encontrarOuCriarLinhaDiaria(sheet, tecnicoId, hoje);
  const colUsa = getColDiaria('Usa_Veiculo_Hoje');
  if (colUsa) sheet.getRange(linha, colUsa).setValue(usaVeiculo === true || usaVeiculo === 'true');
  return { sucesso: true };
}

// ─── iniciarOS ───────────────────────────────────────────────────
// Achado da varredura de TOCTOU (Cowork 2, 15/08): antes desta correcao
// NAO HAVIA NENHUMA checagem do Status atual -- nem sob lock, nem fora.
// Uma 2a chamada (duplo-toque, retry com operationId novo, 2
// dispositivos) reescrevia Hora_Inicio pro momento da 2a chamada
// (perdendo a hora real de inicio) e duplicava o segmento 'Inicio' +
// a entrada 'entrada' na diaria -- mesmo dano do TOCTOU ja corrigido em
// encerrarOS, só que sem nem precisar de corrida de verdade (uma 2a
// chamada SEQUENCIAL, sem lock nenhum, ja bastava).
function iniciarOS(osId, tecnicoId, tecnicoNome, local, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(null, posse.erro);

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(null, 'OS nao encontrada: ' + osId);

  // Guarda atomica: reconfirma+reserva o Status sob lock, mesmo
  // principio ja usado no fix de encerrarOS -- fecha tanto a corrida
  // quanto o caso mais simples (2a chamada sequencial sem lock nenhum).
  const colStatusGuard = getCol('Status');
  const guarda = _comLockDeOS(() => {
    const statusAgora = colStatusGuard ? osSheet.getRange(osRow, colStatusGuard).getValue() : '';
    if (statusAgora === 'Em Andamento' || statusAgora === 'Concluída' || statusAgora === 'Cancelada') {
      return statusAgora;
    }
    if (colStatusGuard) osSheet.getRange(osRow, colStatusGuard).setValue('Em Andamento');
    return null;
  });
  if (!guarda.lockObtido) return _recusa(null, 'Sistema ocupado, tente novamente em instantes');
  if (guarda.valor) {
    return _recusa(null, 'OS ja esta "' + guarda.valor + '" - nao pode ser iniciada de novo');
  }

  const updates = {
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
function iniciarOSComGeo(osId, tecnicoId, tecnicoNome, local, lat, lng, operationId, dispositivoId, token) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
    const localComGeo = (lat && lng)
      ? ((local ? local + ' ' : '') + '[' + lat + ',' + lng + ']')
      : (local || '');
    return iniciarOS(osId, tecnicoId, tecnicoNome, localComGeo, token);
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
// Achado da varredura de TOCTOU (Cowork 2, 15/08): nenhuma checagem de
// Em_Pausa_Agora existia antes desta correcao. Uma 2a chamada (corrida
// ou duplo-toque) recalculava horasSeg a partir da MESMA referencia
// (Hora_Ultima_Retomada/Hora_Inicio, que so retomarOS atualiza) e somava
// esse valor DE NOVO em Horas_Produtivas -- dobrando horas remuneraveis
// -- alem de incrementar Qtd_Interrupcoes e duplicar o segmento de
// pausa. Fix: toda a sequencia (ler estado, calcular horas, escrever)
// roda sob 1 lock, com guarda logo no inicio.
function pausarOS(osId, tecnicoId, tecnicoNome, motivo, osInterrupcaoId, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

  const colPausa = getCol('Em_Pausa_Agora');
  const colRet = getCol('Hora_Ultima_Retomada');
  const colIni = getCol('Hora_Inicio');
  const colProd = getCol('Horas_Produtivas');
  const colQtd = getCol('Qtd_Interrupcoes');

  const resultado = _comLockDeOS(() => {
    const jaPausada = colPausa ? osSheet.getRange(osRow, colPausa).getValue() === true : false;
    if (jaPausada) return { jaPausada: true };

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

    return { jaPausada: false, horasAcum: horasAcum };
  });

  if (!resultado.lockObtido) return _recusa(operationId, 'Sistema ocupado, tente novamente em instantes');
  if (resultado.valor.jaPausada) return _recusa(operationId, 'OS ja esta pausada');

  return {
    sucesso: true,
    hora: formatarHora(now),
    horasAcumuladas: formatarDuracao(resultado.valor.horasAcum)
  };
  });
}

// ─── retomarOS ───────────────────────────────────────────────────
// Achado da varredura de TOCTOU (Cowork 2, 15/08): nenhuma checagem de
// Em_Pausa_Agora existia -- nem que a OS estivesse REALMENTE pausada
// antes de retomar (retomar uma OS ja em andamento nao devia fazer
// nada), nem contra corrida (2 chamadas quase simultaneas inflando
// Qtd_Retomadas e duplicando o segmento 'Retomada'). Fix: mesmo padrao
// de pausarOS -- toda a sequencia sob 1 lock, guarda logo no inicio.
function retomarOS(osId, tecnicoId, tecnicoNome, operationId, dispositivoId) {
  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

  const colPausa = getCol('Em_Pausa_Agora');
  const colProd = getCol('Horas_Produtivas');
  const colQtdRet = getCol('Qtd_Retomadas');

  const resultado = _comLockDeOS(() => {
    const estaPausada = colPausa ? osSheet.getRange(osRow, colPausa).getValue() === true : false;
    if (!estaPausada) return { naoPausada: true };

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

    return { naoPausada: false, horasAcum: horasAcum };
  });

  if (!resultado.lockObtido) return _recusa(operationId, 'Sistema ocupado, tente novamente em instantes');
  if (resultado.valor.naoPausada) return _recusa(operationId, 'OS nao esta pausada');

  return {
    sucesso: true,
    hora: formatarHora(now),
    horasAcumuladas: formatarDuracao(resultado.valor.horasAcum)
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

// Achado red-team confirmado (Cowork 2, 14/08): sem dedupe, a MESMA URL
// repetida 2x no campo satisfazia o piso de 2 fotos como se fossem 2
// evidencias diferentes. Set() sobre as URLs validas fecha isso -- conta
// fotos UNICAS, nao ocorrencias de texto.
function contarFotosEvidencia(nota) {
  if (!nota) return 0;
  const urls = String(nota).split(/[\n,;]+/).map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s));
  return new Set(urls).size;
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
// Achado red-team confirmado (Cowork 2, 14/08, TOCTOU): o precheck de
// canCloseOS logo abaixo e' fresco (le a planilha na hora, nao confia em
// nenhum resultado de chamada anterior) -- mas roda SEM lock, mesmo
// principio de "fn() fora do lock" do ajuste 4 do auditor (Frente D).
// Isso deixa uma janela real: duas chamadas quase simultaneas pra MESMA
// OS (2 operationId diferentes, ou 2 dispositivos, ou um duplo-toque
// que a UI nao debounced) podem AMBAS ler o estado "ainda nao fechada"
// ANTES de qualquer uma escrever -- as duas passam no precheck, as duas
// prosseguem, e o resultado nao e so "a OS fecha" (isso seria inofensivo
// -- fechar 2x com o mesmo dado final): e' registrarSegmento() e
// atualizarDiaria() rodando 2x, duplicando o segmento de auditoria e
// somando Horas_Produtivas/diaria em dobro.
//
// Fix: trava CURTA, so pra reconfirmar+reservar o fechamento
// atomicamente (mesma disciplina de escopo minimo de lock ja usada em
// executarIdempotente -- nao trava a funcao inteira, so este guard).
// Se por acaso outra execucao ja fechou a OS entre o precheck (sem
// lock, acima) e este guard (com lock), a segunda chamada encontra
// Status ja 'Concluída'/'Cancelada' aqui dentro e e recusada com a
// MESMA mensagem que canCloseOS ja usa pro 4o... 5o motivo -- nunca
// chega a rodar registrarSegmento/atualizarDiaria uma 2a vez.
function encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(null, posse.erro);

  const check = canCloseOS(osId, { fotosURL: dadosEnc.fotosURL || '' });
  if (!check.allowed) {
    return _recusa(null, 'OS nao pode ser concluida ainda', { blockingReasons: check.blockingReasons, blocking_reasons: check.blockingReasons });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const now = new Date();
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(null, 'OS nao encontrada: ' + osId);

  const colStatusGuard = getCol('Status');
  const guarda = _comLockDeOS(() => {
    const statusAgora = colStatusGuard ? osSheet.getRange(osRow, colStatusGuard).getValue() : '';
    if (statusAgora === 'Concluída' || statusAgora === 'Cancelada') return statusAgora;
    // Reserva o fechamento AGORA, sob lock -- fecha a janela de corrida.
    // O resto da funcao (updates abaixo) sobrescreve 'Status' com o
    // mesmo valor final, sem custo real (nao e' um 3o estado transitorio).
    if (colStatusGuard) osSheet.getRange(osRow, colStatusGuard).setValue('Concluída');
    return null;
  });
  if (!guarda.lockObtido) return _recusa(null, 'Sistema ocupado, tente novamente em instantes');
  if (guarda.valor) {
    const motivo = 'OS ja esta "' + guarda.valor + '" - conclusao ja ocorreu ou foi cancelada';
    return _recusa(null, 'OS nao pode ser concluida ainda', { blockingReasons: [motivo], blocking_reasons: [motivo] });
  }

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
// operationId/dispositivoId (achado do cross-check do plano de deploy,
// 13/08): faltava migrar pra executarIdempotente, mesmo padrao das
// outras 4 funcoes do grupo (iniciarOSComKM/encerrarOSComKM/
// registrarKMFinalPendente/salvarResposta) -- retry de rede criava uma
// 2a OS de emergencia (risco DIFERENTE da colisao de ID por timestamp
// ja corrigida em 10/08). Lidos de `dados.operationId`/
// `dados.dispositivoId` (objeto unico, mesma convencao ja usada por
// esta funcao) em vez de parametros posicionais novos -- nao desloca
// nada pra quem ainda chama sem eles (executarIdempotente roda fn()
// direto se operationId for ausente, mesmo fallback ja estabelecido).
//
// novoId e' gerado DENTRO de fn(), nao antes -- critico pra correcao:
// fn() so roda de verdade UMA vez por operationId (protegido pelo
// resultado_json de executarIdempotente, igual toda outra funcao). Se
// novoId fosse gerado fora (pra virar o osId da reserva de
// entity_version), um retry legitimo (T-LOG-01, fn() nunca completou)
// geraria um novoId DIFERENTE a cada tentativa, e a linha do Log_Central
// (que grava o osId no momento da reserva, antes de fn() rodar) ficaria
// apontando pra um ID que nunca foi criado de verdade -- daria pra achar
// que corrigiu o problema mas na real so trocaria "qual ID duplica" por
// "Log_Central aponta pro ID errado". Por isso a reserva usa
// `entidade.id = operationId` (sempre estavel) em vez do osId ainda
// inexistente -- nao ha posse aplicavel aqui (a OS ainda nao existe,
// ninguem e dono dela ainda).
function criarOSEmergencia(dados) {
  const operationId = dados && dados.operationId;
  const dispositivoId = dados && dados.dispositivoId;
  return executarIdempotente(operationId, 'APONTAMENTO', '', dados && dados.tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const now = new Date();
    // Granularidade de minuto colidia em chamadas rapidas (achado real em teste,
    // 10/08) -- segundos + sufixo aleatorio de 3 digitos torna a colisao
    // desprezivel sem mudar o prefixo 'EMG-' que o resto do sistema reconhece.
    const novoId = 'EMG-' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    if (!osSheet) return _recusa(operationId, 'Aba Ordens_Servico nao encontrada');

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
  }, { tipo: 'APONTAMENTO', id: operationId || '' });
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
// tecnicoId (11o parametro, TRAILING) -- achado do cross-check do plano
// de deploy (13/08): faltava posse aqui, mesmo padrao ja usado em 7
// outras escritas criticas. Adicionado no FINAL da assinatura (nao no
// meio) pra nao deslocar nenhum parametro posicional ja usado por
// chamador nenhum (4 pontos reais no frontend + varios testes mock) --
// mesmo padrao ja usado quando operationId/dispositivoId foram
// adicionados. `tecnico` (nome, ja existia) continua sendo o valor
// gravado na coluna de exibicao 'Tecnico' de Checklist_Respostas;
// `tecnicoId` e usado SO pra posse e pro tecnico_id real do Log_Central
// (achado adjacente: antes desta correcao, Log_Central.tecnico_id pra
// CHECKLIST_RESPOSTA guardava o NOME, nao o ID -- inconsistente com
// todo o resto do projeto). CONTRATO-BACKEND-SALVARRESPOSTA-POSSE.md
// documenta a mudanca de assinatura que o frontend precisa aplicar --
// sem isso, o frontend atual (que nao envia tecnicoId) teria toda
// chamada recusada por posse indeterminada (fail-closed, deliberado).
function salvarResposta(osId, idSharePointOS, perguntaId, textoPergunta,
                        resposta, fotoUrl, tecnico, geraNC, operationId, dispositivoId, tecnicoId, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);
  return executarIdempotente(operationId, 'CHECKLIST_RESPOSTA', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const respSheet = ss.getSheetByName('Checklist_Respostas');
  if (!respSheet) return _recusa(operationId, 'Aba Checklist_Respostas nao encontrada');
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

// _ultimaRespostaPorPergunta -- achado real (13/08): salvarResposta()
// so faz appendRow, sem checar se a pergunta ja tinha resposta pra essa
// OS -- uma correcao legitima (reenvio com Timestamp novo) gera uma 2a
// linha, nao substitui a 1a. fecharFaseChecklist() usava .some() sobre
// TODAS as respostas da OS pra decidir Gerou_NC -- uma correcao que
// RESOLVE uma nao-conformidade (Gerou_NC true->false) nunca destravava
// Estado_Seguranca, porque a linha antiga (NC=true) continuava contando.
// Fix: reduz pra 1 linha por Pergunta_ID -- a de maior Timestamp -- antes
// de qualquer checagem. Empate ou Timestamp ausente (nao deveria
// acontecer, mas nao trava) cai pra "ultima no array" (ordem de
// insercao do appendRow), que e o proximo melhor sinal disponivel.
// _perguntaAlcancavel -- espelha a navegacao de getProximaPergunta
// (Pergunta_Pai/Condicao_Exibicao, mesmas colunas reais de
// Perguntas_Checklist): uma pergunta so e' genuinamente EXIGIVEL se o
// caminho ate ela (pai, avo, etc.) foi realmente percorrido com as
// respostas que levam a esse ramo especifico.
//
// Achado red-team confirmado (Cowork 2, 14/08): fecharFaseChecklist
// ANTES desta funcao so filtrava Fase_Execucao/Ativo/Obrigatoria, flat,
// SEM olhar Pergunta_Pai/Condicao_Exibicao -- o motor CHKV2
// (index.html, N3_TIPO/N4_*) tem VARIOS ramos mutuamente exclusivos sob
// a mesma Fase_Execucao (um tecnico so consegue percorrer 1 ramo por
// vez, a escolha de N3_TIPO decide qual). Se qualquer pergunta de um
// ramo NAO escolhido estivesse marcada Obrigatoria=true, ela entraria em
// obrigatoriasDaFase mas NENHUM tecnico jamais conseguiria responde-la
// (a UI nem mostra perguntas de ramos nao escolhidos) -- 'Execução'
// ficaria travada PERMANENTEMENTE pra qualquer OS que usasse esse motor,
// nao por falta de resposta real, mas por uma exigencia estruturalmente
// impossivel de satisfazer. Corrigido: so conta como "faltando" uma
// pergunta obrigatoria que o tecnico realmente PODERIA ter alcancado.
function _perguntaAlcancavel(id, porIdPergunta, respostasPorId, idxPai, idxCond) {
  const row = porIdPergunta[id];
  if (!row) return false; // pergunta obrigatoria referenciada mas que nao existe mais na planilha -- nao alcancavel, nao pode travar
  const paiId = idxPai >= 0 ? row[idxPai] : '';
  if (!paiId) return true; // raiz (sem pai) -- sempre alcancavel, mesmo comportamento de sempre
  if (!respostasPorId.hasOwnProperty(paiId)) return false; // pai nunca foi respondido -- este ramo nunca foi aberto
  const condicao = idxCond >= 0 ? row[idxCond] : '';
  if (condicao && condicao !== '' && condicao !== respostasPorId[paiId]) return false; // resposta real do pai nao leva a este ramo
  return _perguntaAlcancavel(paiId, porIdPergunta, respostasPorId, idxPai, idxCond); // reachability e' transitiva -- sobe a cadeia inteira
}

function _ultimaRespostaPorPergunta(respostas, idxPerg, idxTimestamp) {
  const porPergunta = new Map();
  respostas.forEach(row => {
    const perguntaId = row[idxPerg];
    const atual = porPergunta.get(perguntaId);
    const tsNovo = row[idxTimestamp] instanceof Date ? row[idxTimestamp].getTime() : 0;
    const tsAtual = atual && atual[idxTimestamp] instanceof Date ? atual[idxTimestamp].getTime() : -1;
    if (!atual || tsNovo >= tsAtual) porPergunta.set(perguntaId, row);
  });
  return porPergunta;
}

function fecharFaseChecklist(osId, tecnicoId, fase, operationId, dispositivoId, token) {
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);

  if (FASES_CHECKLIST_VALIDAS.indexOf(fase) < 0) {
    return _recusa(operationId, 'Fase invalida: ' + fase);
  }

  return executarIdempotente(operationId, 'CHECKLIST_RESPOSTA', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const osSheet = ss.getSheetByName('Ordens_Servico');
    const osRow = encontrarLinha(osSheet, osId, 0);
    if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

    const pergSheet = ss.getSheetByName('Perguntas_Checklist');
    if (!pergSheet) return _recusa(operationId, 'Aba Perguntas_Checklist nao encontrada');
    const pDados = pergSheet.getDataRange().getValues();
    const pH = pDados[0];
    const idxFase = pH.indexOf('Fase_Execucao');
    const idxObrig = pH.indexOf('Obrigatoria');
    const idxAtivo = pH.indexOf('Ativo');
    const idxIdPerg = pH.indexOf('ID_Pergunta');
    // Pergunta_Pai/Condicao_Exibicao -- mesmas colunas que
    // getProximaPergunta ja usa pra navegar o motor CHKV2 (N3_TIPO/N4_*,
    // ramos mutuamente exclusivos). Opcionais aqui (idx<0 tratado como
    // "sem pai" pra toda pergunta, reduz ao comportamento flat de
    // sempre) -- so entram na jogada se a planilha ja as tiver.
    const idxPai = pH.indexOf('Pergunta_Pai');
    const idxCond = pH.indexOf('Condicao_Exibicao');
    if (idxFase < 0 || idxObrig < 0) {
      return _recusa(operationId, 'Colunas Fase_Execucao/Obrigatoria nao existem na planilha (rode rodarSetupSheets)');
    }

    const ehVerdadeiro = (v) => v === true || v === 'TRUE' || v === 'true';
    const perguntasDaFase = pDados.slice(1)
      .filter(row => row[idxFase] === fase && ehVerdadeiro(row[idxAtivo]))
      .map(row => row[idxIdPerg]);
    const obrigatoriasDaFase = pDados.slice(1)
      .filter(row => row[idxFase] === fase && ehVerdadeiro(row[idxAtivo]) && ehVerdadeiro(row[idxObrig]))
      .map(row => row[idxIdPerg]);
    const porIdPergunta = {};
    pDados.slice(1).forEach(row => { porIdPergunta[row[idxIdPerg]] = row; });

    const respSheet = ss.getSheetByName('Checklist_Respostas');
    if (!respSheet) return _recusa(operationId, 'Aba Checklist_Respostas nao encontrada');
    const rDados = respSheet.getDataRange().getValues();
    const rH = rDados[0];
    const idxROS = rH.indexOf('ID_OS');
    const idxRPerg = rH.indexOf('Pergunta_ID');
    const idxRNC = rH.indexOf('Gerou_NC');
    const idxRTimestamp = rH.indexOf('Timestamp');
    const idxRResposta = rH.indexOf('Resposta_Dada');
    const respostasDaOS = rDados.slice(1).filter(row => String(row[idxROS]) === String(osId));
    // So a resposta MAIS RECENTE por pergunta conta -- uma correcao
    // legitima (Timestamp novo) tem que substituir a resposta anterior
    // nas checagens abaixo, nao se somar a ela. Ver comentario de
    // _ultimaRespostaPorPergunta.
    const ultimaPorPergunta = _ultimaRespostaPorPergunta(respostasDaOS, idxRPerg, idxRTimestamp);
    const idsRespondidos = Array.from(ultimaPorPergunta.keys());
    const respostasPorId = {};
    ultimaPorPergunta.forEach((row, id) => { respostasPorId[id] = idxRResposta >= 0 ? row[idxRResposta] : undefined; });

    // So bloqueia por pergunta obrigatoria REALMENTE alcancavel pelo
    // caminho que o proprio tecnico percorreu -- ver _perguntaAlcancavel
    // (achado red-team, ramos mutuamente exclusivos nao podem travar a
    // fase pra sempre).
    const obrigatoriasAlcancaveis = obrigatoriasDaFase.filter(id =>
      _perguntaAlcancavel(id, porIdPergunta, respostasPorId, idxPai, idxCond));
    const faltando = obrigatoriasAlcancaveis.filter(id => idsRespondidos.indexOf(id) < 0);
    if (faltando.length) {
      return _recusa(operationId, 'Fase incompleta: faltam perguntas obrigatorias (' + faltando.join(', ') + ')',
        { completa: false, fase: fase, faltando: faltando, blocking_reasons: faltando });
    }

    const temNC = perguntasDaFase.some(id => {
      const row = ultimaPorPergunta.get(id);
      return row && ehVerdadeiro(row[idxRNC]);
    });

    if (fase === 'Pré-Execução') {
      const colEstado = getCol('Estado_Seguranca');
      if (!colEstado) return _recusa(operationId, 'Coluna Estado_Seguranca nao existe na planilha (rode rodarSetupSheets)');
      const novoEstado = temNC ? 'Bloqueado' : 'Liberado';
      osSheet.getRange(osRow, colEstado).setValue(novoEstado);
      return { sucesso: true, completa: true, fase: fase, estado: novoEstado };
    }

    if (fase === 'Execução') {
      const colExec = getCol('Checklist_Execucao_Completo');
      if (!colExec) return _recusa(operationId, 'Coluna Checklist_Execucao_Completo nao existe na planilha (rode rodarSetupSheets)');
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

// ─── Token de sessao (Opcao A, DESENHO-FRENTE-E-AUTH-DISPATCHER.md) ──
// Fecha o E-TOCTOU-01 (P0 pro go-live, 15/08): ate aqui o backend confia
// cegamente no tecnicoId que vem no payload de cada chamada -- so prova
// POSSE (dono da OS), nunca IDENTIDADE (quem realmente esta chamando).
// validarPinTecnico emite este token no login; verificarTokenSessao
// revalida identidade+validade em cada operacao critica migrada
// (PLANO-ROLLOUT-OPCAO-A-TOKEN-SESSAO.md -- rollout por ondas, token
// opcional durante a transicao, mesmo padrao ja usado pro operation_id).
// Segredo PROPRIO (SESSAO_HMAC_SECRET), separado de OFERTA_HMAC_SECRET --
// vazar um nao compromete o outro. Reusa os mesmos primitivos HMAC
// (_bytesParaHex/_hexIgualConstante) ja provados no link de oferta.
const SESSAO_SEGREDO_PROPERTY = 'SESSAO_HMAC_SECRET';
const SESSAO_VALIDADE_SEGUNDOS = 24 * 60 * 60; // ~1 turno de trabalho, cobre virada de plantao

// Fail-closed: sem segredo configurado, nao emite token nenhum (null) --
// quem chama decide se trata isso como erro ou como "sessao sem token
// ainda", nunca finge sucesso.
function emitirTokenSessao(tecnicoId) {
  const segredo = PropertiesService.getScriptProperties().getProperty(SESSAO_SEGREDO_PROPERTY);
  if (!segredo) return null;
  const expiraEm = Math.floor(Date.now() / 1000) + SESSAO_VALIDADE_SEGUNDOS;
  const payload = String(tecnicoId) + '.' + expiraEm;
  const sig = _bytesParaHex(Utilities.computeHmacSha256Signature(payload, segredo));
  return { token: payload + '.' + sig, expiraEm: expiraEm };
}

// Token = tecnicoId + '.' + expiraEm + '.' + sig -- separa pelas 2
// ULTIMAS ocorrencias de '.' (pop, nao split[0]/[1]) pra tolerar um
// tecnicoId que por acaso contenha '.'.
// Fail-closed em toda direcao: sem segredo, token ausente/malformado,
// assinatura errada, expirado, OU tecnicoId embutido no token diferente
// do tecnicoId que a chamada afirma usar -- tudo vira invalido. Este
// ultimo caso e o cerne do E-TOCTOU-01: "autenticado como X, agindo
// como Y" so e barrado aqui, nao pela posse (verificarPosseOS so sabe
// comparar contra a OS, nunca prova quem esta do outro lado da chamada).
function verificarTokenSessao(token, tecnicoIdEsperado) {
  const segredo = PropertiesService.getScriptProperties().getProperty(SESSAO_SEGREDO_PROPERTY);
  if (!segredo || !token) return { ok: false, erro: 'Token de sessao ausente' };

  const partes = String(token).split('.');
  if (partes.length < 3) return { ok: false, erro: 'Token de sessao malformado' };
  const sig = partes.pop();
  const expiraEm = partes.pop();
  const tecnicoIdToken = partes.join('.');

  const payload = tecnicoIdToken + '.' + expiraEm;
  const sigEsperada = _bytesParaHex(Utilities.computeHmacSha256Signature(payload, segredo));
  if (!_hexIgualConstante(sigEsperada.toLowerCase(), String(sig).trim().toLowerCase())) {
    return { ok: false, erro: 'Token de sessao invalido' };
  }
  if (!/^\d+$/.test(expiraEm) || Math.floor(Date.now() / 1000) > Number(expiraEm)) {
    return { ok: false, erro: 'Token de sessao expirado' };
  }
  if (String(tecnicoIdToken) !== String(tecnicoIdEsperado)) {
    return { ok: false, erro: 'Token de sessao nao corresponde ao tecnico informado' };
  }
  return { ok: true };
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
  if (!sheet) return _recusa(operationId, 'Aba Alocacoes_Ofertas nao encontrada');

  const ultimaPre = _ultimaLinhaOferta(sheet, ofertaId);
  if (!ultimaPre) return _recusa(operationId, 'Oferta nao encontrada: ' + ofertaId);
  const gPre = (campo) => ultimaPre.valores[ultimaPre.headers.indexOf(campo)];

  if (String(gPre('Tecnico_ID')) !== String(tecnicoId)) {
    return _recusa(operationId, 'Tecnico ' + tecnicoId + ' nao tem posse desta oferta');
  }

  // OS_ID real da oferta -- lido ANTES de executarIdempotente pra
  // entity_version (monotonico POR OS, ARQUITETURA-SYNC-LOG-CENTRAL.md,
  // ponto 3) usar a chave certa. Corrige compromisso documentado na
  // entrega anterior desta fatia, que usava ofertaId no lugar do OS_ID
  // real por nao ter esta leitura prévia ainda.
  const osIdReal = gPre('OS_ID');

  return executarIdempotente(operationId, 'ACEITE_CLIENTE', osIdReal, tecnicoId, dispositivoId, () => {
    // 2 achados red-team confirmados (Cowork 2, 15/08), mesma categoria
    // do TOCTOU ja corrigido em encerrarOS:
    //
    // 1. Resposta duplicada (achado descrito como "dupla alocacao"):
    //    dois tecnicos DIFERENTES nunca conseguem passar a checagem de
    //    posse acima (Tecnico_ID e fixo por oferta desde criarOferta
    //    Alocacao -- so 1 tecnicoId satisfaz a igualdade, nao importa
    //    timing). O risco real e' outro: o MESMO tecnico, via 2
    //    operationId diferentes (duplo-toque, 2 aparelhos, retry que
    //    gerou novo id) -- a releitura fresca de baixo, SEM lock,
    //    nao impedia que 2 chamadas quase simultaneas lessem
    //    Status==='Pendente' ANTES de qualquer uma ter dado append,
    //    resultando em 2 linhas de resposta (ex.: Aceita + Recusada,
    //    ou Aceita 2x) pra mesma oferta -- exatamente o padrao ja
    //    corrigido em encerrarOS (comentario antigo aqui reivindicava
    //    protecao que so cobria retry da MESMA operationId, nao
    //    concorrencia real entre operationIds diferentes).
    // 2. Expiracao nunca era checada aqui -- so em getOfertaAlocacao
    //    (leitura, no momento em que o tecnico ABRE o link). Entre abrir
    //    o link e apertar "aceitar" pode passar qualquer tempo (nao e'
    //    so uma janela de corrida estreita) -- sem essa checagem, uma
    //    oferta expirada continuava aceitavel indefinidamente enquanto
    //    Status continuasse 'Pendente'.
    //
    // Fix pros dois: TODA a sequencia critica (releitura + checagem de
    // expiracao + checagem de status + validacao + appendRow) roda sob
    // UMA trava (_comLockDeOS) -- diferente de encerrarOS (onde so um
    // guard curto ficou sob lock, o resto continuou fora por ser mais
    // pesado), aqui a mutacao inteira e' 1 appendRow simples, do mesmo
    // porte do que o proprio Intent Log de executarIdempotente ja tranca
    // -- travar tudo e' simples e correto, sem motivo pra reserva parcial.
    const resultado = _comLockDeOS(() => {
      const ultima = _ultimaLinhaOferta(sheet, ofertaId);
      if (!ultima) return { tipo: 'erro', mensagem: 'Oferta nao encontrada: ' + ofertaId };
      const g = (campo) => ultima.valores[ultima.headers.indexOf(campo)];

      const expiraEm = g('Expira_Em');
      if (expiraEm && new Date(expiraEm).getTime() < Date.now()) {
        return { tipo: 'expirada', expiraEm: expiraEm };
      }

      if (g('Status') !== 'Pendente') {
        return { tipo: 'ja_respondida', status: g('Status') };
      }

      if (aceito !== true && !(motivoRecusa && String(motivoRecusa).trim())) {
        return { tipo: 'sem_motivo' };
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
        // .toISOString() (texto), NAO Date nativo -- achado adjacente
        // (14/08, mesma classe de bug ja corrigida repetidas vezes em
        // Log_Central/Ordens_Servico): Date nativo deixa o Sheets
        // autoconverter/aplicar timezone silenciosamente. So esta coluna
        // desta aba ainda usava o padrao antigo.
        new Date().toISOString(),
        aceito === true ? '' : String(motivoRecusa).trim(),
        operationId || ''
      ]);

      return { tipo: 'sucesso', status: novoStatus };
    });

    if (!resultado.lockObtido) {
      return _recusa(operationId, 'Sistema ocupado, tente novamente em instantes', { error_code: 'CONEXAO_INDISPONIVEL', retryable: true, status: 'SYNC_ERROR' });
    }
    const r = resultado.valor;
    if (r.tipo === 'erro') return _recusa(operationId, r.mensagem);
    if (r.tipo === 'expirada') return _recusa(operationId, 'Oferta expirada', { oferta_status: 'Expirada', expiraEm: r.expiraEm });
    if (r.tipo === 'ja_respondida') {
      // NAO usar `status` aqui (extras.status) -- colidiria com o campo
      // canonico do envelope (SYNCED/DIVERGENT/SYNC_ERROR). oferta_status
      // e o status DE NEGOCIO da oferta (Aceita/Recusada), campo distinto.
      return _recusa(operationId, 'Oferta ja foi respondida', { oferta_status: r.status });
    }
    if (r.tipo === 'sem_motivo') return _recusa(operationId, 'Motivo de recusa obrigatorio');
    return { sucesso: true, status: r.status };
  });
}

// criarOfertaAlocacao — gera o link de aceite de oferta (Secao 25,
// decisao de produto fechada 14/08: gestor solicita, backend gera
// offer_id + define tecnico/OS/validade + assina HMAC + retorna link;
// frontend so apresenta). Ate agora so existiam leitura
// (getOfertaAlocacao) e resposta (registrarAceiteOferta) -- quem gerava
// a linha "Pendente" inicial ficava fora do contrato original
// (CONTRATO-BACKEND-ACEITE-OFERTA.md), decisao adiada explicitamente pro
// console do gestor ("decisao separada"). Essa decisao foi tomada agora.
//
// Sem verificarPosseOS/executarIdempotente -- mesma categoria de
// reprocessarOperacaoManual: acao administrativa (gestor), nao acao de
// tecnico sobre "sua" OS. Sem autenticacao propria alem disso -- mesmo
// gap ja documentado do dispatcher inteiro (DESENHO-FRENTE-E-AUTH-
// DISPATCHER.md, Opcao A so desenhada, nao implementada), nao piora o
// que ja existe.
const DEFAULT_VALIDADE_OFERTA_HORAS = 48;

function criarOfertaAlocacao(osId, tecnicoId, escopoResumo, valorProposto, validadeHoras) {
  if (!osId) return { sucesso: false, erro: 'osId obrigatorio' };
  if (!tecnicoId) return { sucesso: false, erro: 'tecnicoId obrigatorio' };
  if (!escopoResumo || !String(escopoResumo).trim()) return { sucesso: false, erro: 'escopoResumo obrigatorio' };

  // Fail-closed: sem segredo configurado, nao ha "assinatura correta"
  // possivel -- mesma filosofia de verificarAssinaturaOferta, aqui do
  // lado de quem EMITE em vez de quem VALIDA.
  const segredo = PropertiesService.getScriptProperties().getProperty(OFERTA_SEGREDO_PROPERTY);
  if (!segredo) return { sucesso: false, erro: 'OFERTA_HMAC_SECRET nao configurado -- nao e possivel assinar o link' };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Alocacoes_Ofertas');
  if (!sheet) return { sucesso: false, erro: 'Aba Alocacoes_Ofertas nao encontrada' };

  const now = new Date();
  const ofertaId = 'OF-' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + Math.floor(100 + Math.random() * 900);
  const horas = Number(validadeHoras) > 0 ? Number(validadeHoras) : DEFAULT_VALIDADE_OFERTA_HORAS;
  const expiraEm = new Date(now.getTime() + horas * 60 * 60 * 1000);
  // Unix seconds -- MESMO formato que verificarAssinaturaOferta espera
  // no payload assinado (exp entra cru no HMAC, sem conversao).
  const exp = Math.floor(expiraEm.getTime() / 1000);

  const payload = String(ofertaId) + '|' + String(tecnicoId) + '|' + String(exp);
  const sig = _bytesParaHex(Utilities.computeHmacSha256Signature(payload, segredo));

  sheet.appendRow([
    ofertaId, osId, tecnicoId, String(escopoResumo).trim(), valorProposto || '',
    now.toISOString(), expiraEm.toISOString(), 'Pendente', '', '', ''
  ]);

  return {
    sucesso: true,
    ofertaId: ofertaId,
    tecnicoId: tecnicoId,
    exp: exp,
    sig: sig,
    // Fragmento pronto no formato exato que o frontend real ja espera
    // (eletrium-field-checklist3/index.html, location.hash:
    // "#oferta&id=...&tecnico=...&exp=...&sig=..."). O backend NAO
    // conhece a URL base publicada do frontend (GitHub Pages, fora deste
    // projeto Apps Script) -- devolve so o fragmento; quem chama (console
    // do gestor) concatena com a base real que ele conhece.
    linkFragmento: 'oferta&id=' + encodeURIComponent(ofertaId) + '&tecnico=' + encodeURIComponent(tecnicoId) + '&exp=' + exp + '&sig=' + sig
  };
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
function registrarMovimentoFerramental(osId, tecnicoId, patrimonioCodigo, tipoMovimento, estadoOk, observacao, operationId, dispositivoId, token) {
  if (FERRAMENTAL_TIPOS_VALIDOS.indexOf(tipoMovimento) < 0) {
    return _recusa(operationId, 'Tipo de movimento invalido: ' + tipoMovimento);
  }
  if (!patrimonioCodigo || !String(patrimonioCodigo).trim()) {
    return _recusa(operationId, 'Codigo de patrimonio obrigatorio');
  }
  if (tipoMovimento === 'Desmobilizacao' && estadoOk === false && !(observacao && String(observacao).trim())) {
    return _recusa(operationId, 'Observacao obrigatoria quando o estado nao esta OK');
  }

  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);

  return executarIdempotente(operationId, 'APONTAMENTO', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('Ferramental_Movimentos');
    if (!sheet) return _recusa(operationId, 'Aba Ferramental_Movimentos nao encontrada');

    const movimentoId = Utilities.getUuid();
    sheet.appendRow([
      movimentoId,
      osId,
      tecnicoId,
      String(patrimonioCodigo).trim(),
      tipoMovimento,
      estadoOk === true,
      observacao || '',
      // .toISOString() (texto), NAO Date nativo -- achado adjacente da
      // varredura de TOCTOU (15/08), mesma classe de bug ja corrigida
      // repetidas vezes em Log_Central/Ordens_Servico/Alocacoes_Ofertas.
      new Date().toISOString(),
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
function getVeiculoDoTecnico(tecnicoId, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Se presente, prova identidade antes de qualquer leitura/escrita
  // especifica do tecnico. Nao ha conceito de posse de OS nestas funcoes.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
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
function cadastrarOuEditarVeiculo(tecnicoId, tecnicoNome, tipoVeiculo, placa, modelo, token) {
  // Onda 3 do rollout da sessao HMAC (Opcao A): token opcional durante
  // a transicao. Se presente, prova identidade antes de qualquer leitura/escrita
  // especifica do tecnico. Nao ha conceito de posse de OS nestas funcoes.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(null, identidade.erro);
  }
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
function validarESalvarKMInicial(osId, tecnicoId, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl, operationId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

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
    return _recusa(operationId, mensagem, { exigeJustificativa: true, mensagem: mensagem });
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
function iniciarOSComKM(osId, tecnicoId, tecnicoNome, local, lat, lng, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId, token) {
  return executarIdempotente(operationId, 'REGISTRO_KM', osId, tecnicoId, dispositivoId, () => {
    const kmResult = validarESalvarKMInicial(osId, tecnicoId, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl, operationId);
    if (kmResult.erro || kmResult.exigeJustificativa) return kmResult;

    const localComGeo = (lat && lng) ? ((local ? local + ' ' : '') + '[' + lat + ',' + lng + ']') : (local || '');
    const res = iniciarOS(osId, tecnicoId, tecnicoNome, localComGeo, token);
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
function encerrarOSComKM(osId, tecnicoId, tecnicoNome, dadosEnc, lat, lng, operationId, dispositivoId, token) {
  return executarIdempotente(operationId, 'CONCLUSAO_OS', osId, tecnicoId, dispositivoId, () => {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    if (lat && lng) {
      registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'GPS_Saida', new Date(), 0, 0, '[' + lat + ',' + lng + ']');
    }
    return encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc, token);
  });
}

// ─── registrarKMFinalPendente ────────────────────────────────────────
// Preenche o KM final de uma OS já concluída, sem reabrir nada.
// Roda a mesma validacao de desvio (foto+texto) que o KM inicial usa.
function registrarKMFinalPendente(osId, tecnicoId, kmFinal, justificativaDesvio, fotoDesvioUrl, operationId, dispositivoId, token) {
  // Achado do cross-check do plano de deploy (13/08): faltava posse aqui --
  // mesmo padrao ja usado em salvarArquivoOS/confirmarSegurancaPreExecucao/
  // salvarSelfieEPI/iniciarOS/encerrarOS/fecharFaseChecklist/
  // registrarMovimentoFerramental. Sem isso, qualquer tecnicoId valido
  // fechava o KM final de uma OS que nao era dele.
  if (token !== undefined) {
    const identidade = verificarTokenSessao(token, tecnicoId);
    if (!identidade.ok) return _recusa(operationId, identidade.erro);
  }
  const posse = verificarPosseOS(osId, tecnicoId);
  if (!posse.ok) return _recusa(operationId, posse.erro);
  return executarIdempotente(operationId, 'REGISTRO_KM', osId, tecnicoId, dispositivoId, () => {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return _recusa(operationId, 'OS nao encontrada: ' + osId);

  const colStatus = getCol('Status');
  const status = colStatus ? String(osSheet.getRange(osRow, colStatus).getValue()) : '';
  if (status !== 'Concluída') return _recusa(operationId, 'OS nao esta concluida, KM final nao se aplica ainda');

  const colKmInicial = getCol('KM_Inicial_OS');
  const kmInicial = colKmInicial ? (parseFloat(osSheet.getRange(osRow, colKmInicial).getValue()) || 0) : 0;
  const kmFinalNum = parseFloat(kmFinal) || 0;

  if (kmFinalNum < kmInicial) {
    return _recusa(operationId, 'KM final nao pode ser menor que o KM inicial desta OS (' + kmInicial + ')');
  }

  const diferenca = kmFinalNum - kmInicial;
  if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
    const temFoto = !!fotoDesvioUrl;
    const temTexto = !!(justificativaDesvio && justificativaDesvio.trim());
    if (!temFoto || !temTexto) {
      const mensagem = 'Trecho de ' + Math.round(diferenca) + 'km dentro desta OS. '
        + 'Informe justificativa por texto E foto do odometro para continuar.';
      return _recusa(operationId, mensagem, { exigeJustificativa: true, mensagem: mensagem });
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

