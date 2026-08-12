// ============================================================
//  ELETRIUM OS — Relatorio.gs  (M5)
//  Adicionar como novo arquivo .gs com nome: Relatorio
//  Geração automática de Relatório Técnico em Google Docs
// ============================================================

// ─────────────────────────────────────────────
//  ENTRADA PRINCIPAL
//  Chamada pelo API.gs quando OS é concluída
//  Também pode ser chamada manualmente para
//  reprocessar uma OS existente
// ─────────────────────────────────────────────
function gerarRelatorio(idOS) {
  try {
    const ss     = SpreadsheetApp.openById(SHEET_ID);
    const dados  = _coletarDadosOS(ss, idOS);
    if (!dados)  { console.error('OS não encontrada: ' + idOS); return null; }

    const pasta  = _obterPastaCliente(ss, dados);
    const doc    = _criarDocumento(dados, pasta);
    const url    = doc.getUrl();

    // Grava URL do relatório de volta na OS
    _gravarUrlRelatorio(ss, idOS, url);

    // Envia por e-mail se cliente tiver e-mail cadastrado
    if (dados.emailCliente) _enviarPorEmail(dados, url);

    console.log('Relatório gerado: ' + url);
    return url;
  } catch(e) {
    console.error('gerarRelatorio():', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
//  COLETAR TODOS OS DADOS DA OS
// ─────────────────────────────────────────────
function _coletarDadosOS(ss, idOS) {
  // OS principal
  const osRows = ss.getSheetByName('Ordens_Servico').getDataRange().getValues();
  const osH    = osRows[0];
  const osRow  = osRows.find((r,i) => i>0 && r[0]===idOS);
  if (!osRow) return null;
  const os = {};
  osH.forEach((h,j) => { os[h] = osRow[j] instanceof Date ? osRow[j] : osRow[j]; });

  // Cliente
  const cliRows = ss.getSheetByName('Clientes').getDataRange().getValues();
  const cliRow  = cliRows.find((r,i) => i>0 && r[0]===os.ID_Cliente);
  const cli     = cliRow ? {
    razaoSocial: cliRow[1], fantasia: cliRow[2], cnpj: cliRow[3],
    responsavel: cliRow[5], telefone: cliRow[6], email: cliRow[7],
    endereco: cliRow[8], cidade: cliRow[9], uf: cliRow[10]
  } : {};

  // Técnico
  const tecRows = ss.getSheetByName('Tecnicos_MEI').getDataRange().getValues();
  const tecRow  = tecRows.find((r,i) => i>0 && r[0]===os.ID_Tecnico);
  const tec     = tecRow ? { nome: tecRow[1], cpf: tecRow[2], especialidades: tecRow[6] } : {};

  // Matriz
  const matRows = ss.getSheetByName('Matriz_Atividades').getDataRange().getValues();
  const matH    = matRows[0];
  const matRow  = matRows.find((r,i) => i>0 && r[0]===os.ID_Matriz);
  const mat     = {};
  if (matRow) matH.forEach((h,j) => mat[h] = matRow[j]);

  // Materiais
  const mRows = ss.getSheetByName('OS_Materiais').getDataRange().getValues();
  const mH    = mRows[0];
  const mats  = mRows.slice(1).filter(r => r[0] && r[1]===idOS).map(r => {
    const o={}; mH.forEach((h,j) => o[h]=r[j]); return o;
  });

  // Checklist
  const chkRows = ss.getSheetByName('OS_Checklist').getDataRange().getValues();
  const chkH    = chkRows[0];
  const chks    = chkRows.slice(1).filter(r => r[0] && r[1]===idOS).map(r => {
    const o={}; chkH.forEach((h,j) => o[h]=r[j]); return o;
  });

  // Config
  const cfg = {
    empresa:  _getConfigVal(ss, 'EMPRESA_NOME')   || 'Eletrium Comércio e Serviços Ltda.',
    cnpj:     _getConfigVal(ss, 'EMPRESA_CNPJ')   || '',
    email:    _getConfigVal(ss, 'EMPRESA_EMAIL')  || '',
    tel:      _getConfigVal(ss, 'EMPRESA_TEL')    || '',
    cidade:   _getConfigVal(ss, 'EMPRESA_CIDADE') || 'Betim / MG',
  };

  return { os, cli, tec, mat, mats, chks, cfg,
           emailCliente: cli.email || null };
}

// ─────────────────────────────────────────────
//  PASTA NO DRIVE: Clientes > Nome > Ano
// ─────────────────────────────────────────────
function _obterPastaCliente(ss, dados) {
  const pastaId  = _getConfigVal(ss, 'DRIVE_PASTA_ID');
  const raiz     = DriveApp.getFolderById(pastaId);
  const nomeCliente = (dados.cli.fantasia || dados.cli.razaoSocial || dados.os.ID_Cliente || 'Cliente').replace(/[\/\\:*?"<>|]/g, '-');
  const ano      = new Date().getFullYear().toString();

  // Pasta do cliente
  let pastaCliente;
  const itCli = raiz.getFoldersByName(nomeCliente);
  pastaCliente = itCli.hasNext() ? itCli.next() : raiz.createFolder(nomeCliente);

  // Pasta do ano
  let pastaAno;
  const itAno = pastaCliente.getFoldersByName(ano);
  pastaAno = itAno.hasNext() ? itAno.next() : pastaCliente.createFolder(ano);

  return pastaAno;
}

// ─────────────────────────────────────────────
//  CRIAR DOCUMENTO GOOGLE DOCS
// ─────────────────────────────────────────────
function _criarDocumento(d, pasta) {
  const nomeDoc = `Relatorio_Tecnico_${d.os.ID_OS}_${_fmtData(new Date())}`;
  const doc     = DocumentApp.create(nomeDoc);
  const body    = doc.getBody();

  body.clear();
  _estiloDocumento(doc);

  _secaoCabecalho(body, d);
  _secaoOS(body, d);
  _secaoExecucao(body, d);
  _secaoMedicoes(body, d);
  _secaoMateriais(body, d);
  _secaoChecklist(body, d);
  _secaoConclusao(body, d);
  _secaoRodape(body, d);

  doc.saveAndClose();

  // Move para pasta correta no Drive
  const file = DriveApp.getFileById(doc.getId());
  pasta.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  return doc;
}

// ─────────────────────────────────────────────
//  ESTILOS GLOBAIS DO DOCUMENTO
// ─────────────────────────────────────────────
function _estiloDocumento(doc) {
  doc.getBody().setMarginTop(56).setMarginBottom(56).setMarginLeft(72).setMarginRight(72);
}

// ─────────────────────────────────────────────
//  SEÇÃO 1 — CABEÇALHO COM IDENTIDADE VISUAL
// ─────────────────────────────────────────────
function _secaoCabecalho(body, d) {
  // Linha verde topo
  const linhaVerde = body.appendParagraph('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
  _pStyle(linhaVerde, 7, false, '#22B573', null, 'LEFT');
  linhaVerde.setSpacingAfter(6).setSpacingBefore(0);

  // Bloco empresa
  const nomeEmp = body.appendParagraph(d.cfg.empresa.toUpperCase());
  _pStyle(nomeEmp, 16, true, '#22B573');

  const subEmp = body.appendParagraph(
    `CNPJ: ${d.cfg.cnpj}   |   ${d.cfg.tel}   |   ${d.cfg.email}   |   ${d.cfg.cidade}`
  );
  _pStyle(subEmp, 9, false, '#AEAEAE');

  // Separador
  _separador(body);

  // Título do documento
  const titulo = body.appendParagraph('RELATÓRIO TÉCNICO DE SERVIÇO');
  _pStyle(titulo, 18, true, '#FFFFFF', '#0D1117', 'CENTER');
  titulo.setSpacingBefore(10).setSpacingAfter(10);

  const subtitulo = body.appendParagraph(`${d.os.ID_OS}  ·  ${d.os.Tipo_Servico || 'Serviço'}  ·  Emitido em ${_fmtDataHora(new Date())}`);
  _pStyle(subtitulo, 9, false, '#555555', null, 'CENTER');

  _separador(body);
  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 2 — DADOS DA OS
// ─────────────────────────────────────────────
function _secaoOS(body, d) {
  _tituloSecao(body, '1. IDENTIFICAÇÃO DA ORDEM DE SERVIÇO');

  const tabDados = [
    ['Número da OS',    d.os.ID_OS                    || '—'],
    ['Tipo de Serviço', d.os.Tipo_Servico              || '—'],
    ['Status',          'CONCLUÍDA'                         ],
    ['Criticidade',     d.os.Criticidade               || '—'],
    ['Data de Abertura',_fmtDataHoraVal(d.os.Data_Abertura)],
    ['Data de Início',  _fmtDataHoraVal(d.os.Data_Inicio)  ],
    ['Data de Conclusão',_fmtDataHoraVal(d.os.Data_Conclusao)],
    ['Duração Total',   d.os.Duracao_Horas ? d.os.Duracao_Horas + ' h' : '—'],
  ];
  _tabela2Col(body, tabDados);
  _espacar(body);

  _tituloSecao(body, '2. DADOS DO CLIENTE');
  const tabCli = [
    ['Razão Social',    d.cli.razaoSocial              || '—'],
    ['Nome Fantasia',   d.cli.fantasia                 || '—'],
    ['CNPJ / CPF',      d.cli.cnpj                     || '—'],
    ['Responsável',     d.cli.responsavel              || '—'],
    ['Telefone',        d.cli.telefone                 || '—'],
    ['E-mail',          d.cli.email                    || '—'],
    ['Endereço',        (d.cli.endereco || '—') + (d.cli.cidade ? ' — ' + d.cli.cidade + '/' + d.cli.uf : '')],
  ];
  _tabela2Col(body, tabCli);
  _espacar(body);

  _tituloSecao(body, '3. DADOS DO TÉCNICO RESPONSÁVEL');
  const tabTec = [
    ['Nome',            d.tec.nome                     || '—'],
    ['CPF',             d.tec.cpf                      || '—'],
    ['Especialidades',  d.tec.especialidades           || '—'],
    ['Empresa',         d.cfg.empresa                       ],
  ];
  _tabela2Col(body, tabTec);
  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 3 — EXECUÇÃO DO SERVIÇO
// ─────────────────────────────────────────────
function _secaoExecucao(body, d) {
  _tituloSecao(body, '4. DESCRIÇÃO DO SERVIÇO EXECUTADO');

  if (d.mat.Atividade) {
    const pAtiv = body.appendParagraph('Atividade: ' + d.mat.Atividade);
    _pStyle(pAtiv, 11, true, '#222222');
  }

  if (d.mat.Normas_Vinculadas) {
    const pNorm = body.appendParagraph('Normas aplicáveis: ' + d.mat.Normas_Vinculadas);
    _pStyle(pNorm, 10, false, '#555555');
  }

  if (d.os.Descricao) {
    const pDesc = body.appendParagraph('Descrição: ' + d.os.Descricao);
    _pStyle(pDesc, 11, false, '#222222');
  }

  const obsText = d.os.Obs_Tecnicas || 'Serviço executado conforme escopo definido, sem ocorrências relevantes além das descritas neste relatório.';
  const pObs = body.appendParagraph(obsText);
  _pStyle(pObs, 11, false, '#222222');
  pObs.setSpacingBefore(8);

  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 4 — MEDIÇÕES (condicional)
// ─────────────────────────────────────────────
function _secaoMedicoes(body, d) {
  if (!d.os.Medicoes && d.mat.Requer_Medicao !== 'Sim') return;

  _tituloSecao(body, '5. MEDIÇÕES E AFERIÇÕES');

  if (d.mat.Referencia_Medicao) {
    const pRef = body.appendParagraph('Referência normativa: ' + d.mat.Referencia_Medicao);
    _pStyle(pRef, 10, false, '#555555');
  }

  const tabMed = [
    ['Unidade de medição',  d.mat.Unidade_Medicao    || '—'],
    ['Resultado obtido',    d.os.Medicoes             || '—'],
    ['Conformidade',        d.os.Medicoes ? 'Verificar conforme referência' : 'Não aplicável'],
  ];
  _tabela2Col(body, tabMed);
  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 5 — MATERIAIS
// ─────────────────────────────────────────────
function _secaoMateriais(body, d) {
  _tituloSecao(body, '6. MATERIAIS UTILIZADOS');

  if (!d.mats || !d.mats.length) {
    const p = body.appendParagraph('Nenhum material aplicado neste serviço.');
    _pStyle(p, 11, false, '#888888', null, 'CENTER');
    _espacar(body); return;
  }

  const tabMat = [['Descrição','Qtd','Un','Custo Unit.','Total']];
  let totalGeral = 0;
  d.mats.forEach(m => {
    const cu  = parseFloat(m.Custo_Unitario) || 0;
    const qt  = parseFloat(m.Quantidade) || 0;
    const tot = cu * qt;
    totalGeral += tot;
    tabMat.push([
      m.Descricao || '—',
      String(qt),
      m.Unidade || 'Un',
      cu > 0 ? 'R$ ' + cu.toFixed(2) : '—',
      tot > 0 ? 'R$ ' + tot.toFixed(2) : '—',
    ]);
  });
  tabMat.push(['','','','TOTAL','R$ ' + totalGeral.toFixed(2)]);
  _tabelaMultiCol(body, tabMat);
  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 6 — CHECKLIST DE SEGURANÇA
// ─────────────────────────────────────────────
function _secaoChecklist(body, d) {
  _tituloSecao(body, '7. PROTOCOLO DE SEGURANÇA — STAGE GATE');

  const statusGate = d.os.Stage_Gate_OK === 'Sim' ? '✔ APROVADO' : '— Não registrado';
  const pGate = body.appendParagraph('Status do Stage Gate: ' + statusGate);
  _pStyle(pGate, 11, true, d.os.Stage_Gate_OK === 'Sim' ? '#22B573' : '#888888');

  if (d.chks && d.chks.length) {
    const tabChk = [['Tipo','Item','Verificado']];
    d.chks.forEach(c => tabChk.push([
      c.Tipo_Item || '—', c.Descricao_Item || '—',
      c.Marcado === 'Sim' ? '✔' : '✘'
    ]));
    _tabelaMultiCol(body, tabChk);
  } else {
    const p = body.appendParagraph('Checklist de segurança registrado no sistema. Itens verificados conforme Matriz de Atividades.');
    _pStyle(p, 10, false, '#555555');
  }
  _espacar(body);
}

// ─────────────────────────────────────────────
//  SEÇÃO 7 — CONCLUSÃO E ASSINATURA
// ─────────────────────────────────────────────
function _secaoConclusao(body, d) {
  _tituloSecao(body, '8. CONCLUSÃO E ACEITE DO CLIENTE');

  const nps = d.os.NPS !== undefined && d.os.NPS !== '' && d.os.NPS !== null;
  const tabConc = [
    ['Resultado do serviço', 'Serviço concluído com êxito'],
    ['Avaliação do cliente (NPS)', nps ? d.os.NPS + ' / 10' : '—'],
    ['Oportunidade identificada', d.os.Flag_Oportunidade || 'Não'],
  ];
  if (d.os.Desc_Oportunidade) tabConc.push(['Descrição da oportunidade', d.os.Desc_Oportunidade]);
  _tabela2Col(body, tabConc);

  _espacar(body);

  // Área de assinaturas
  const pAss = body.appendParagraph('ASSINATURAS');
  _pStyle(pAss, 10, true, '#AEAEAE', null, 'CENTER');

  // Tabela de assinaturas
  const tblAss = body.appendTable([
    ['Técnico Responsável','Cliente / Responsável'],
    ['\n\n\n' + (d.tec.nome||''),'  \n\n\n' + (d.cli.responsavel||d.cli.razaoSocial||'')],
  ]);
  tblAss.setColumnWidth(0,225).setColumnWidth(1,225);
  const hdAss = tblAss.getRow(0);
  hdAss.getCell(0).setBackgroundColor('#0D1117');
  hdAss.getCell(1).setBackgroundColor('#0D1117');
  [0,1].forEach(c => {
    const cell = hdAss.getCell(c);
    cell.getChild(0).asParagraph().editAsText()
      .setFontSize(10).setBold(true).setForegroundColor('#FFFFFF');
    cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  });
  const dataLinha = tblAss.getRow(1);
  [0,1].forEach(c => {
    dataLinha.getCell(c).getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  });

  _espacar(body);
}

// ─────────────────────────────────────────────
//  RODAPÉ
// ─────────────────────────────────────────────
function _secaoRodape(body, d) {
  _separador(body);
  const pRod = body.appendParagraph(
    `${d.cfg.empresa}  ·  CNPJ ${d.cfg.cnpj}  ·  ${d.cfg.tel}  ·  ${d.cfg.cidade}  ·  Documento gerado automaticamente pelo sistema Eletrium OS`
  );
  _pStyle(pRod, 8, false, '#AEAEAE', null, 'CENTER');
}

// ─────────────────────────────────────────────
//  HELPERS DE FORMATAÇÃO
// ─────────────────────────────────────────────
function _tituloSecao(body, texto) {
  const p = body.appendParagraph(texto);
  _pStyle(p, 11, true, '#FFFFFF', '#22B573');
  p.setSpacingBefore(14).setSpacingAfter(8).setIndentStart(8).setIndentEnd(8);
}

function _tabela2Col(body, linhas) {
  const tbl = body.appendTable(linhas.map(l => [l[0], l[1]]));
  tbl.setColumnWidth(0, 170).setColumnWidth(1, 280);
  for (let i = 0; i < tbl.getNumRows(); i++) {
    const row = tbl.getRow(i);
    // Coluna chave
    row.getCell(0).getChild(0).asParagraph().editAsText()
      .setFontSize(9).setBold(true).setForegroundColor('#333333');
    row.getCell(0).setBackgroundColor(i%2===0 ? '#F5F5F5' : '#FFFFFF');
    // Coluna valor
    row.getCell(1).getChild(0).asParagraph().editAsText()
      .setFontSize(10).setBold(false).setForegroundColor('#000000');
    row.getCell(1).setBackgroundColor(i%2===0 ? '#F5F5F5' : '#FFFFFF');
  }
}

function _tabelaMultiCol(body, linhas) {
  const tbl = body.appendTable(linhas);
  for (let i = 0; i < tbl.getNumRows(); i++) {
    const row = tbl.getRow(i);
    const isCab = i === 0;
    for (let j = 0; j < row.getNumCells(); j++) {
      const cell = row.getCell(j);
      cell.setBackgroundColor(isCab ? '#0D1117' : (i%2===0 ? '#F5F5F5' : '#FFFFFF'));
      cell.getChild(0).asParagraph().editAsText()
        .setFontSize(isCab ? 9 : 10)
        .setBold(isCab)
        .setForegroundColor(isCab ? '#FFFFFF' : '#000000');
    }
  }
}

function _pStyle(p, size, bold, color, bg, align) {
  const txt = p.editAsText();
  txt.setFontSize(size || 11);
  txt.setBold(bold || false);
  if (color) txt.setForegroundColor(color);
  if (bg)    p.setBackgroundColor(bg);
  if (align) {
    const map = {LEFT:DocumentApp.HorizontalAlignment.LEFT,
                 CENTER:DocumentApp.HorizontalAlignment.CENTER,
                 RIGHT:DocumentApp.HorizontalAlignment.RIGHT};
    p.setAlignment(map[align]||DocumentApp.HorizontalAlignment.LEFT);
  }
}

function _separador(body) {
  body.appendHorizontalRule();
}

function _espacar(body) {
  const p = body.appendParagraph('');
  p.editAsText().setFontSize(6);
  p.setSpacingAfter(4);
}

// ─────────────────────────────────────────────
//  GRAVAR URL NA OS E ENVIAR E-MAIL
// ─────────────────────────────────────────────
function _gravarUrlRelatorio(ss, idOS, url) {
  const aba   = ss.getSheetByName('Ordens_Servico');
  const dados = aba.getDataRange().getValues();
  const h     = dados[0];
  const col   = k => h.indexOf(k)+1;
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] !== idOS) continue;
    aba.getRange(i+1, col('URL_Relatorio')).setValue(url);
    break;
  }
}

function _enviarPorEmail(d, url) {
  try {
    const adminEmail = d.cfg.email;
    const assunto    = `[Eletrium OS] Relatório Técnico — ${d.os.ID_OS} — ${d.cli.razaoSocial||d.os.ID_Cliente}`;
    const corpo      = `Prezado(a) ${d.cli.responsavel || 'Cliente'},\n\n` +
      `O serviço abaixo foi concluído e o relatório técnico está disponível para consulta:\n\n` +
      `OS: ${d.os.ID_OS}\n` +
      `Tipo: ${d.os.Tipo_Servico||'—'}\n` +
      `Técnico: ${d.tec.nome||'—'}\n` +
      `Conclusão: ${_fmtDataHoraVal(d.os.Data_Conclusao)}\n` +
      (d.os.NPS ? `Avaliação NPS: ${d.os.NPS}/10\n` : '') +
      `\nAcesse o relatório: ${url}\n\n` +
      `Atenciosamente,\n${d.cfg.empresa}\n${d.cfg.tel} | ${d.cfg.cidade}`;

    // Envia para o cliente
    if (d.emailCliente) MailApp.sendEmail(d.emailCliente, assunto, corpo);
    // Cópia para admin
    if (adminEmail) MailApp.sendEmail(adminEmail, '[CÓPIA] ' + assunto, corpo);
  } catch(e) {
    console.error('_enviarPorEmail:', e.message);
  }
}

// ─────────────────────────────────────────────
//  HELPERS DE DATA
// ─────────────────────────────────────────────
function _fmtData(d) {
  return Utilities.formatDate(d instanceof Date ? d : new Date(d), 'America/Sao_Paulo', 'yyyyMMdd');
}
function _fmtDataHora(d) {
  return Utilities.formatDate(d instanceof Date ? d : new Date(d), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
}
function _fmtDataHoraVal(val) {
  if (!val) return '—';
  try { return _fmtDataHora(val instanceof Date ? val : new Date(val)); }
  catch(e) { return String(val); }
}

// ─────────────────────────────────────────────
//  TESTE MANUAL — execute no editor para testar
//  Substitua o ID pela OS de teste
// ─────────────────────────────────────────────
function testarRelatorio() {
  const url = gerarRelatorio('OS-2026-001');
  if (url) Logger.log('✅ Relatório gerado: ' + url);
  else     Logger.log('❌ Falha na geração');
}