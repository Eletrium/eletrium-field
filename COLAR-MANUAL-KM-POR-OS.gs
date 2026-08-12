// ============================================================
// COLAR MANUAL — KM por-OS (Opção 2, decisão de 06/08/2026)
// ============================================================
// Gerado em 10/08/2026 pelo Claude Code porque a sessão `clasp`
// autenticada não enxerga o projeto Apps Script real da Eletrium
// entre os 11 projetos a que tem acesso (bloqueio de conta, ainda
// sem resolução — ver docs/INVENTARIO-PWA-0805.md). Este arquivo
// reúne SÓ o diff necessário, já com os 2 bugs encontrados e
// corrigidos nesta sessão, pronto para colar direto no editor do
// Apps Script (script.google.com) — sem depender de clasp push.
//
// COMO APLICAR (3 passos, nessa ordem):
//   1. Em Código.js: dentro de setupSheets(), no array `novos`,
//      adicione as 6 colunas da SEÇÃO 1 abaixo (se ainda não existirem).
//   2. Em Código.js: cole a SEÇÃO 2 inteira em qualquer lugar do
//      arquivo (fora de outras funções).
//   3. Em API.js: dentro do switch(action) de executarAcao, adicione
//      os 4 case da SEÇÃO 3 (em qualquer posição, antes do `default`).
//   4. Salvar, testar com testarDoPost() ou uma chamada manual, e só
//      DEPOIS disso publicar o index.html novo do eletrium-field
//      (senão toda chamada a iniciarOSComKM falha com "Ação desconhecida").
//
// Bugs corrigidos nesta sessão (não estavam no rascunho original de
// 06/08, achados ao revisar antes de aplicar):
//   - _iniciarOSDeVerdade (frontend, não está neste arquivo — está no
//     index.html do eletrium-field) ramifica entre iniciarOSComKM e
//     iniciarOSComGeo dependendo se há veículo hoje, em vez de sempre
//     chamar iniciarOSComKM com km=null (isso gravaria KM_Inicial_OS=0
//     de verdade e poluiria o banner de pendências).
//   - confirmarKMFinalPendente (idem, frontend) restaura o onclick do
//     botão pro estado normal depois de esvaziar a fila de pendências.
// Nenhum bug foi encontrado nas funções de backend abaixo — coladas
// exatamente como vieram da sessão de 06/08.
// ============================================================


// ======================= SEÇÃO 1 =======================
// Colunas novas em Ordens_Servico — adicionar ao array `novos`
// dentro de setupSheets() em Código.js (se ainda não estiverem lá):

/*
  'KM_Inicial_OS', 'KM_Final_OS', 'Veiculo_ID_OS',
  'KM_Justificativa_Desvio', 'KM_Foto_Desvio_URL', 'KM_Flag_Revisao'
*/


// ======================= SEÇÃO 2 =======================
// Colar em Código.js (bloco autocontido, não toca em nenhuma função existente):

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
  const iTec = Math.max(col('ID_Tecnico'), col('Nome_Tecnico'));
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
  const iTec = Math.max(col('ID_Tecnico'), col('Nome_Tecnico'));
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
  if (!osRow) return { erro: 'OS nao encontrada: ' + osId };

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
    return {
      sucesso: false,
      exigeJustificativa: true,
      mensagem: 'Diferenca de ' + Math.round(kmInicialNum - referencia) + 'km detectada (' + tipoComparacao + '). '
        + 'Informe justificativa por texto E foto do odometro para continuar.'
    };
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
function iniciarOSComKM(osId, tecnicoId, tecnicoNome, local, lat, lng, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl) {
  const kmResult = validarESalvarKMInicial(osId, tecnicoId, kmInicial, veiculoId, justificativaDesvio, fotoDesvioUrl);
  if (kmResult.erro || kmResult.exigeJustificativa) return kmResult;

  const localComGeo = (lat && lng) ? ((local ? local + ' ' : '') + '[' + lat + ',' + lng + ']') : (local || '');
  const res = iniciarOS(osId, tecnicoId, tecnicoNome, localComGeo);
  if (!res.erro) res.kmFlag = kmResult.flag || null;
  return res;
}

// ─── encerrarOSComKM ────────────────────────────────────────────────
// KM sai daqui — o fechamento da OS (checklist/assinatura/hora) não
// espera mais o técnico chegar na base. KM_Final_OS fica pendente,
// preenchido depois via registrarKMFinalPendente.
function encerrarOSComKM(osId, tecnicoId, tecnicoNome, dadosEnc, lat, lng) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (lat && lng) {
    registrarSegmento(ss, osId, tecnicoId, tecnicoNome, 'GPS_Saida', new Date(), 0, 0, '[' + lat + ',' + lng + ']');
  }
  return encerrarOS(osId, tecnicoId, tecnicoNome, dadosEnc);
}

// ─── registrarKMFinalPendente ────────────────────────────────────────
// Preenche o KM final de uma OS já concluída, sem reabrir nada.
// Roda a mesma validacao de desvio (foto+texto) que o KM inicial usa.
function registrarKMFinalPendente(osId, tecnicoId, kmFinal, justificativaDesvio, fotoDesvioUrl) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const osSheet = ss.getSheetByName('Ordens_Servico');
  const osRow = encontrarLinha(osSheet, osId, 0);
  if (!osRow) return { erro: 'OS nao encontrada: ' + osId };

  const colStatus = getCol('Status');
  const status = colStatus ? String(osSheet.getRange(osRow, colStatus).getValue()) : '';
  if (status !== 'Concluida') return { erro: 'OS nao esta concluida, KM final nao se aplica ainda' };

  const colKmInicial = getCol('KM_Inicial_OS');
  const kmInicial = colKmInicial ? (parseFloat(osSheet.getRange(osRow, colKmInicial).getValue()) || 0) : 0;
  const kmFinalNum = parseFloat(kmFinal) || 0;

  if (kmFinalNum < kmInicial) {
    return { sucesso: false, erro: 'KM final nao pode ser menor que o KM inicial desta OS (' + kmInicial + ')' };
  }

  const diferenca = kmFinalNum - kmInicial;
  if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
    const temFoto = !!fotoDesvioUrl;
    const temTexto = !!(justificativaDesvio && justificativaDesvio.trim());
    if (!temFoto || !temTexto) {
      return {
        sucesso: false,
        exigeJustificativa: true,
        mensagem: 'Trecho de ' + Math.round(diferenca) + 'km dentro desta OS. '
          + 'Informe justificativa por texto E foto do odometro para continuar.'
      };
    }
  }

  const set = (campo, val) => { const col = getCol(campo); if (col) osSheet.getRange(osRow, col).setValue(val); };
  set('KM_Final_OS', kmFinalNum);
  if (justificativaDesvio) set('KM_Justificativa_Desvio', justificativaDesvio);
  if (fotoDesvioUrl) set('KM_Foto_Desvio_URL', fotoDesvioUrl);

  return { sucesso: true };
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
  const iTec = Math.max(col('ID_Tecnico'), col('Nome_Tecnico'));
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
    if (String(row[iStatus]) !== 'Concluida') continue;
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


// ======================= SEÇÃO 3 =======================
// Colar em API.js, dentro do switch(action) de executarAcao,
// antes do `default:`:

/*
    // KM por-OS (Opção 2, 06/08) — aditivo, ver bloco correspondente em Código.js.
    // encerrarOSComKM tem 6 parâmetros posicionais (p[0]..p[5]) — o KM final NÃO
    // entra aqui, é preenchido depois via registrarKMFinalPendente.
    case 'iniciarOSComKM':
      return iniciarOSComKM(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9]);
    case 'encerrarOSComKM':
      return encerrarOSComKM(p[0], p[1], p[2], p[3], p[4], p[5]);
    case 'registrarKMFinalPendente':
      return registrarKMFinalPendente(p[0], p[1], p[2], p[3], p[4]);
    case 'getOSsPendentesKMFinal':
      return getOSsPendentesKMFinal(p[0]);
*/


// ======================= TESTE DE ACEITE (rastreabilidade) =======================
// - OS com salto >5km intra-dia (ou >20% inter-dia) sem foto+texto deve
//   recusar com exigeJustificativa:true; com os dois, aprova e grava.
// - OS concluída sem KM final deve aparecer no banner até 3 dias depois.
// - Frontend (index.html do eletrium-field) já está adaptado e verificado
//   à parte — pergunte ao Claude Code pelo diff do index.html se ainda não
//   foi publicado (Parte 3 do pacote de 06/08 + os 2 bugs corrigidos).
// Origem: decisões de 06/08/2026. Responsável: Geovane.
