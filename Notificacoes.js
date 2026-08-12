// ============================================================
//  ELETRIUM OS — Notificacoes.gs  (M6 — via Gmail)
//  Notificações automáticas sem Power Automate
//  Adicionar como novo arquivo .gs com nome: Notificacoes
// ============================================================

const ADMIN_MAIL = 'geovane@eletrium.com.br';
const APP_LINK   = 'https://script.google.com/macros/s/AKfycbzCQReGH4Z9n5Miy9JNQA4BlAckhXdOYSpJ0nYlRdb8gWCqd2mEiODyl2qQSto10Cx9ZQ/exec';

// ─────────────────────────────────────────────
//  ENVIADOR CENTRAL DE E-MAIL
// ─────────────────────────────────────────────
function _enviarEmail(para, assunto, corpo) {
  try {
    MailApp.sendEmail({
      to:      para,
      subject: assunto,
      body:    corpo,
      name:    'Eletrium OS'
    });
    console.log(`E-mail enviado → ${para} | ${assunto}`);
  } catch(e) {
    console.error('_enviarEmail():', e.message);
  }
}

function _corpoBase(titulo, linhas, rodape) {
  return [
    '════════════════════════════════════════',
    `  ELETRIUM OS — ${titulo}`,
    '════════════════════════════════════════',
    '',
    ...linhas,
    '',
    '────────────────────────────────────────',
    rodape || '',
    `Sistema: ${APP_LINK}`,
    '────────────────────────────────────────',
    'Eletrium Comércio e Serviços Ltda.',
    '(31) 3511-8558  |  contato@eletrium.com.br  |  Betim / MG',
    '',
    'Este é um e-mail automático gerado pelo sistema Eletrium OS.'
  ].join('\n');
}

// ─────────────────────────────────────────────
//  NOVA OS CRIADA
//  Chamar ao final de _createOS() no API.gs
// ─────────────────────────────────────────────
function notificarNovaOS(p) {
  // p = { id, nomeCliente, nomeTecnico, tipoServico, criticidade, prazo }
  const assunto = `[Eletrium OS] 🆕 Nova OS — ${p.id} — ${p.nomeCliente}`;
  const corpo   = _corpoBase('NOVA ORDEM DE SERVIÇO', [
    `OS:           ${p.id}`,
    `Cliente:      ${p.nomeCliente}`,
    `Técnico:      ${p.nomeTecnico}`,
    `Tipo:         ${p.tipoServico}`,
    `Criticidade:  ${p.criticidade}`,
    `Prazo SLA:    ${p.prazo || 'Não definido'}`,
  ], 'Acesse o sistema para acompanhar o andamento.');

  _enviarEmail(ADMIN_MAIL, assunto, corpo);

  // Notifica também o técnico se tiver e-mail cadastrado
  if (p.emailTecnico) {
    const corpoTec = _corpoBase('NOVA OS ATRIBUÍDA A VOCÊ', [
      `OS:           ${p.id}`,
      `Cliente:      ${p.nomeCliente}`,
      `Tipo:         ${p.tipoServico}`,
      `Criticidade:  ${p.criticidade}`,
      `Prazo SLA:    ${p.prazo || 'Não definido'}`,
      '',
      'Acesse o aplicativo para visualizar os detalhes e iniciar a execução.',
    ]);
    _enviarEmail(p.emailTecnico, assunto, corpoTec);
  }
}

// ─────────────────────────────────────────────
//  OS CONCLUÍDA
//  Chamar ao final de _concluirOS() no API.gs
// ─────────────────────────────────────────────
function notificarOSConcluida(idOS) {
  try {
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const rows = ss.getSheetByName('Ordens_Servico').getDataRange().getValues();
    const h    = rows[0];
    const row  = rows.find((r,i) => i>0 && r[0]===idOS);
    if (!row) return;
    const get  = k => { const v=row[h.indexOf(k)]; return (v instanceof Date ? _fmtDt(v) : String(v||'—')); };

    const assunto = `[Eletrium OS] ✅ OS Concluída — ${idOS} — NPS: ${get('NPS')}/10`;
    const corpo   = _corpoBase('OS CONCLUÍDA', [
      `OS:           ${idOS}`,
      `Cliente:      ${get('Nome_Cliente')}`,
      `Técnico:      ${get('Nome_Tecnico')}`,
      `Tipo:         ${get('Tipo_Servico')}`,
      `Conclusão:    ${get('Data_Conclusao')}`,
      `Duração:      ${get('Duracao_Horas')}h`,
      `NPS:          ${get('NPS')}/10`,
      `Oportunidade: ${get('Flag_Oportunidade')}`,
      get('Desc_Oportunidade') !== '—' ? `Descrição:    ${get('Desc_Oportunidade')}` : '',
      '',
      get('URL_Relatorio') !== '—' ? `Relatório: ${get('URL_Relatorio')}` : '',
    ].filter(Boolean));

    _enviarEmail(ADMIN_MAIL, assunto, corpo);

    // Notificação de oportunidade separada
    if (get('Flag_Oportunidade') === 'Sim') {
      notificarOportunidade(
        idOS,
        get('Nome_Cliente'),
        get('Nome_Tecnico'),
        get('Desc_Oportunidade'),
        get('URL_Relatorio')
      );
    }
  } catch(e) {
    console.error('notificarOSConcluida():', e.message);
  }
}

// ─────────────────────────────────────────────
//  OPORTUNIDADE COMERCIAL
// ─────────────────────────────────────────────
function notificarOportunidade(idOS, cliente, tecnico, descricao, urlRelatorio) {
  const assunto = `[Eletrium OS] 🔍 OPORTUNIDADE — ${cliente}`;
  const corpo   = _corpoBase('OPORTUNIDADE COMERCIAL IDENTIFICADA', [
    `Cliente:      ${cliente}`,
    `Técnico:      ${tecnico}`,
    `OS de origem: ${idOS}`,
    `Descrição:    ${descricao || 'Anomalia identificada em campo'}`,
    '',
    'Entre em contato com o cliente para follow-up comercial.',
    urlRelatorio && urlRelatorio !== '—' ? `\nRelatório: ${urlRelatorio}` : '',
  ].filter(Boolean));

  _enviarEmail(ADMIN_MAIL, assunto, corpo);
}

// ─────────────────────────────────────────────
//  VERIFICAÇÃO DE SLAs — roda a cada hora
// ─────────────────────────────────────────────
function verificarSLAs() {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const rows    = ss.getSheetByName('Ordens_Servico').getDataRange().getValues();
  const h       = rows[0];
  const alertaH = parseInt(_getConfigVal(ss, 'ALERTA_ANTEC_H')) || 4;
  const agora   = new Date();
  const ativos  = ['Pendente','Preparação','Em Andamento'];

  // Controle anti-spam: guarda OS já notificadas hoje
  const cache   = CacheService.getScriptCache();

  rows.slice(1).forEach(row => {
    if (!row[0]) return;
    const status = row[h.indexOf('Status')];
    if (!ativos.includes(status)) return;

    const prazoVal = row[h.indexOf('Prazo_SLA')];
    if (!prazoVal) return;

    const dtPrazo       = new Date(prazoVal);
    const diffH         = (dtPrazo - agora) / 3600000;
    const idOS          = row[h.indexOf('ID_OS')];
    const cliente       = row[h.indexOf('Nome_Cliente')] || idOS;
    const tecnico       = row[h.indexOf('Nome_Tecnico')] || '—';
    const crit          = row[h.indexOf('Criticidade')]  || '—';
    const emailTecnico  = _emailTecnico(ss, row[h.indexOf('ID_Tecnico')]);

    if (diffH < 0) {
      // Notifica SLA vencido apenas 1x por hora por OS
      const chave = `sla_vencido_${idOS}_${agora.getHours()}`;
      if (cache.get(chave)) return;
      cache.put(chave, '1', 3600);

      const assunto = `🚨 [SLA VENCIDO] OS ${idOS} — ${Math.abs(Math.round(diffH))}h de atraso`;
      const corpo   = _corpoBase('🚨 SLA VENCIDO', [
        `OS:           ${idOS}`,
        `Cliente:      ${cliente}`,
        `Técnico:      ${tecnico}`,
        `Criticidade:  ${crit}`,
        `Status atual: ${status}`,
        `Atraso:       ${Math.abs(Math.round(diffH))}h`,
        '',
        'AÇÃO NECESSÁRIA: Entre em contato com o técnico imediatamente.',
      ]);
      _enviarEmail(ADMIN_MAIL, assunto, corpo);
      if (emailTecnico) _enviarEmail(emailTecnico, assunto, corpo);

    } else if (diffH <= alertaH) {
      // Alerta de SLA prestes a vencer — 1x por OS por dia
      const chave = `sla_alerta_${idOS}_${agora.toDateString()}`;
      if (cache.get(chave)) return;
      cache.put(chave, '1', 86400);

      const assunto = `⏱ [ALERTA SLA] OS ${idOS} vence em ${Math.round(diffH)}h`;
      const corpo   = _corpoBase('⏱ ALERTA DE PRAZO', [
        `OS:              ${idOS}`,
        `Cliente:         ${cliente}`,
        `Técnico:         ${tecnico}`,
        `Criticidade:     ${crit}`,
        `Horas restantes: ${Math.round(diffH)}h`,
        '',
        'Verifique o andamento e acione o técnico se necessário.',
      ]);
      _enviarEmail(ADMIN_MAIL, assunto, corpo);
      if (emailTecnico) _enviarEmail(emailTecnico, assunto, corpo);
    }
  });
}

// ─────────────────────────────────────────────
//  RELATÓRIO DIÁRIO — roda às 08h
// ─────────────────────────────────────────────
function relatorioDiario() {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const rows = ss.getSheetByName('Ordens_Servico').getDataRange().getValues();
  const h    = rows[0];
  const data = rows.slice(1).filter(r=>r[0]);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const ativos = ['Pendente','Preparação','Em Andamento'];

  const ativas      = data.filter(r=>ativos.includes(r[h.indexOf('Status')]));
  const concHoje    = data.filter(r=>r[h.indexOf('Status')]==='Concluída' && r[h.indexOf('Data_Conclusao')] && new Date(r[h.indexOf('Data_Conclusao')])>=hoje);
  const vencidas    = ativas.filter(r=>{ const p=r[h.indexOf('Prazo_SLA')]; return p && new Date(p)<new Date(); });
  const oportunid   = data.filter(r=>r[h.indexOf('Flag_Oportunidade')]==='Sim');

  const linhasAtivas = ativas.map(r=>
    `  • ${r[h.indexOf('ID_OS')]} | ${r[h.indexOf('Nome_Cliente')]||'—'} | ${r[h.indexOf('Status')]} | Crit: ${r[h.indexOf('Criticidade')]}`
  );

  const assunto = `[Eletrium OS] 📊 Resumo do dia — ${_fmtDt(new Date())}`;
  const corpo   = _corpoBase('RESUMO DIÁRIO', [
    `Data:                  ${_fmtDt(new Date())}`,
    `OS ativas:             ${ativas.length}`,
    `Concluídas hoje:       ${concHoje.length}`,
    `SLA vencidos:          ${vencidas.length}`,
    `Oportunidades abertas: ${oportunid.length}`,
    '',
    ativas.length ? 'OS EM ABERTO:' : 'Nenhuma OS em aberto.',
    ...linhasAtivas,
  ]);

  _enviarEmail(ADMIN_MAIL, assunto, corpo);
}

// ─────────────────────────────────────────────
//  INSTALAR TRIGGERS — execute UMA VEZ
// ─────────────────────────────────────────────
function instalarTriggers() {
  // Remove todos os triggers antigos deste projeto
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  // Verifica SLA diariamente (mudei de everyHours(1) para everyDays(1))
  ScriptApp.newTrigger('verificarSLAs')
    .timeBased().everyDays(1).atHour(7).create();
    
  // Relatório diário às 08h
  ScriptApp.newTrigger('relatorioDiario')
    .timeBased().atHour(8).everyDays(1).create();
    
  console.log('✅ Triggers instalados:\n- verificarSLAs: diariamente às 07h\n- relatorioDiario: diariamente às 08h');
}

// ─────────────────────────────────────────────
//  TESTE MANUAL
// ─────────────────────────────────────────────
function testarNotificacoes() {
  _enviarEmail(
    ADMIN_MAIL,
    '[Eletrium OS] ✅ Teste de notificação',
    _corpoBase('TESTE DE INTEGRAÇÃO', [
      'Este e-mail confirma que o sistema de notificações',
      'do Eletrium OS está funcionando corretamente.',
      '',
      `Enviado em: ${new Date().toLocaleString('pt-BR')}`,
    ])
  );
  console.log('✅ E-mail de teste enviado para ' + ADMIN_MAIL);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function _emailTecnico(ss, idTecnico) {
  if (!idTecnico) return null;
  const rows = ss.getSheetByName('Tecnicos_MEI').getDataRange().getValues();
  const row  = rows.find((r,i) => i>0 && r[0]===idTecnico);
  return row ? row[4] : null;
}

function _fmtDt(d) {
  return Utilities.formatDate(
    d instanceof Date ? d : new Date(d),
    'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'
  );
}

