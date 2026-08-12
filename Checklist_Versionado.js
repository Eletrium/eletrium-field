// ================================================================
// CHECKLIST VERSIONADO (Fat-Client) — decidido em 06/08/2026
// Substitui a leitura ao vivo de Perguntas_Checklist por estrutura
// fixa no código. Termografia EXCLUÍDA do escopo (Eletrium não
// trabalha esse tipo de serviço por OS no momento).
//
// REDESENHO 10/08 — motor trocado de "lista plana por fase" para
// TREE-WALK CONDICIONAL, espelhando getProximaPergunta() real
// (Código.js linha ~725): a próxima pergunta é o primeiro FILHO ativo
// da pergunta atual cujo Condicao_Exibicao bate com a resposta dada
// (ou sem condição), ordenado por Ordem. Sem filho batendo = fim do
// ramo. Isso substitui o modelo anterior (VERSIONS com arrays de
// pergunta por fase, todas mostradas juntas) que NÃO correspondia ao
// comportamento real do motor ao vivo.
//
// PENDENTE DE APLICAÇÃO NO PROJETO REAL — mesma situação do bloco KM
// POR-OS em Código.js: sem acesso clasp ao projeto Apps Script real,
// este arquivo é referência para colagem manual. Ver
// COLAR-MANUAL-KM-POR-OS.gs para o padrão de aplicação.
//
// ⚠️ ATENÇÃO — Pergunta_Pai/Condicao_Exibicao/Tipo_Resposta/
// Foto_Obrigatoria/Ordem ABAIXO SÃO RECONSTRUÇÃO POR INFERÊNCIA,
// NÃO DADO REAL. O pacote de 06/08 só trouxe texto+opções por
// pergunta (tipo:"choice" uniforme, sem pai/condição/foto) — a
// estrutura de árvore abaixo foi inferida por mim a partir do padrão
// de nomes (N3_TIPO = raiz; N4_<RAMO>_* = filhos do ramo escolhido em
// N3_TIPO) e da agrupação por fase do pacote original. É um palpite
// estruturado para destravar o motor, NÃO uma cópia da planilha real.
// Confirmar contra Get-PnPListItem de Perguntas_Checklist (campos
// ID_Pergunta, Pergunta_Pai, Condicao_Exibicao, Tipo_Resposta, Ordem,
// Ativo) e Opcoes_Resposta (Pergunta_ID, Ordem, Aciona_NC) antes de
// publicar — sem isso, NENHUMA parte deste arquivo pode ir para
// produção, nem a árvore nem o texto das perguntas.
// ================================================================

const CHECKLIST_VERSION_ATUAL = 'v1.0';

// pai: null = raiz (mostrada sempre, sem depender de resposta anterior).
// condicaoExibicao: valor exato da resposta do PAI que precisa ter sido
//   dada para esta pergunta aparecer (null = não filtra, mas só usado
//   quando pai também é null aqui, já que toda pergunta com pai real
//   tem uma condição — igual ao motor ao vivo, que só pula a checagem
//   de Condicao_Exibicao quando o campo vem vazio na planilha).
// ordem: desempate entre irmãos (mesma pai) — TODO confirmar contra Ordem real.
// tipoResposta: só "Unica" está confirmada pelo pacote original (tipo:"choice"
//   em toda pergunta) — Multipla/Matriz_Risco do motor antigo não tem
//   equivalente aqui ainda porque nenhuma pergunta do pacote pedia isso.
// fotoObrigatoria: default false — TODO confirmar Foto_Obrigatoria real por pergunta.
const POOL_PERGUNTAS = {
  "N3_TIPO": {
    texto: "Tipo de Serviço", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: null, condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Reaperto de Conexoes", nc: false },
      { label: "Limpeza/Adequacao de Painel", nc: false },
      { label: "Diagnostico de Falha", nc: false },
      { label: "Instalacao de Componente", nc: false },
      { label: "Medicao Eletrica", nc: false },
      { label: "Adequacao de Seguranca NR-10", nc: false }
    ]
  },

  // ─── Ramo Reaperto (condicaoExibicao = "Reaperto de Conexoes") ──────
  "N4_REAP_ANOM": {
    texto: "Anomalia (Reaperto)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Reaperto de Conexoes", ordem: 1,
    opcoes: [
      { label: "Oxidacao", nc: false }, { label: "Frouxidao", nc: false },
      { label: "Sobreaquecimento visivel", nc: false }, { label: "Rompimento parcial de fio", nc: false }
    ]
  },
  "N4_REAP_TORQ": {
    texto: "Torque (Reaperto)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_REAP_ANOM", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Sim", nc: false },
      { label: "Nao-ajustado durante o servico", nc: false }
    ]
  },
  "N4_REAP_ACAO": {
    texto: "Ação (Reaperto)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_REAP_TORQ", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Reaperto realizado", nc: false },
      { label: "Substituicao de terminal", nc: false },
      { label: "Substituicao de cabo", nc: false }
    ]
  },
  "N4_REAP_EST": {
    texto: "Estado do Reaperto", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_REAP_ACAO", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Conforme-preventivo", nc: false },
      { label: "Nao conforme-frouxidao/oxidacao severa", nc: true }
    ]
  },

  // ─── Ramo Limpeza (condicaoExibicao = "Limpeza/Adequacao de Painel") ─
  "N4_LIMP_TIPO": {
    texto: "Tipo de Limpeza", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Limpeza/Adequacao de Painel", ordem: 2,
    opcoes: [
      { label: "Limpeza a seco", nc: false }, { label: "Limpeza com produto especifico", nc: false },
      { label: "Aspiracao de residuos", nc: false }
    ]
  },
  "N4_LIMP_ADEQ": {
    texto: "Adequação (Limpeza)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_LIMP_TIPO", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Identificacao de circuitos", nc: false }, { label: "Sinalizacao de seguranca", nc: false },
      { label: "Vedacao de aberturas", nc: false }, { label: "Organizacao de cabos", nc: false },
      { label: "Nenhuma adequacao adicional", nc: false }
    ]
  },
  "N4_LIMP_EST": {
    texto: "Estado da Limpeza", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_LIMP_ADEQ", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Conforme", nc: false },
      { label: "Nao conforme-poeira", nc: true },
      { label: "Nao conforme-umidade/corrosao", nc: true },
      { label: "Nao conforme-insetos/roedores", nc: true }
    ]
  },

  // ─── Ramo Diagnóstico (condicaoExibicao = "Diagnostico de Falha") ────
  "N4_DIAG_SINT": {
    texto: "Sintoma (Diagnóstico)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Diagnostico de Falha", ordem: 3,
    opcoes: [
      { label: "Painel nao energiza", nc: false }, { label: "Disjuntor desarma", nc: false },
      { label: "Ruido anormal", nc: false }, { label: "Odor de queimado", nc: false },
      { label: "Faisca/centelhamento", nc: false }, { label: "Outro", nc: false }
    ]
  },
  "N4_DIAG_CAUSA": {
    texto: "Causa (Diagnóstico)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_DIAG_SINT", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Curto-circuito", nc: false }, { label: "Sobrecarga", nc: false },
      { label: "Falha de isolamento", nc: false }, { label: "Componente danificado", nc: false },
      { label: "Falha de conexao", nc: false }, { label: "Nao identificada", nc: false }
    ]
  },
  "N4_DIAG_COMP": {
    texto: "Componente (Diagnóstico)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_DIAG_CAUSA", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Disjuntor", nc: false }, { label: "Contator", nc: false }, { label: "Rele", nc: false },
      { label: "Transformador", nc: false }, { label: "Barramento", nc: false },
      { label: "Cabo", nc: false }, { label: "Fonte", nc: false }
    ]
  },
  "N4_DIAG_ACAO": {
    texto: "Ação (Diagnóstico)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_DIAG_COMP", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Reparo imediato", nc: false }, { label: "Substituicao de componente", nc: false },
      { label: "Isolamento da area", nc: false }, { label: "Intervencao programada", nc: false }
    ]
  },

  // ─── Ramo Instalação (condicaoExibicao = "Instalacao de Componente") ─
  "N4_INST_COMP": {
    texto: "Componente (Instalação)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Instalacao de Componente", ordem: 4,
    opcoes: [
      { label: "Disjuntor", nc: false }, { label: "DPS", nc: false }, { label: "Contator", nc: false },
      { label: "Rele", nc: false }, { label: "Fusivel", nc: false }, { label: "Barramento", nc: false },
      { label: "Botoeira", nc: false }, { label: "Sinalizador", nc: false }
    ]
  },
  "N4_INST_TESTE": {
    texto: "Teste de Instalação", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_INST_COMP", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Aprovado", nc: false },
      { label: "Reprovado-nova tentativa", nc: true },
      { label: "Reprovado-escalado p/ engenharia", nc: true }
    ]
  },

  // ─── Ramo Medição (condicaoExibicao = "Medicao Eletrica") ────────────
  "N4_MED_TIPO": {
    texto: "Tipo de Medição", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Medicao Eletrica", ordem: 5,
    opcoes: [
      { label: "Tensao", nc: false }, { label: "Corrente", nc: false },
      { label: "Resistencia de isolamento", nc: false }, { label: "Resistencia de aterramento", nc: false },
      { label: "Continuidade", nc: false }
    ]
  },
  "N4_MED_RES": {
    texto: "Resultado da Medição", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_MED_TIPO", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Dentro da norma", nc: false },
      { label: "Fora da norma-acao corretiva", nc: true },
      { label: "Fora da norma-area isolada", nc: true }
    ]
  },

  // ─── Ramo Segurança (condicaoExibicao = "Adequacao de Seguranca NR-10") ─
  "N4_SEG_ITEM": {
    texto: "Item de Segurança", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N3_TIPO", condicaoExibicao: "Adequacao de Seguranca NR-10", ordem: 6,
    opcoes: [
      { label: "Sinalizacao de risco eletrico", nc: false },
      { label: "Bloqueio e etiquetagem(LOTO)", nc: false },
      { label: "Aterramento temporario", nc: false },
      { label: "Distancia de seguranca", nc: false },
      { label: "EPI coletivo disponivel", nc: false }
    ]
  },
  "N4_SEG_CONF": {
    texto: "Conformidade (Segurança)", tipoResposta: "Unica", fotoObrigatoria: false,
    pai: "N4_SEG_ITEM", condicaoExibicao: null, ordem: 1,
    opcoes: [
      { label: "Conforme", nc: false },
      { label: "Nao conforme-acao corretiva aplicada", nc: true },
      { label: "Nao conforme-intervencao programada", nc: true }
    ]
  }
};

// Raízes por versão — o motor ao vivo suporta múltiplas raízes por
// Disciplina (candidatas sem Pergunta_Pai), mas o pacote de 06/08 só
// tinha uma (N3_TIPO). Estrutura em array já preparada para mais.
const VERSIONS = {
  "v1.0": { raizes: ["N3_TIPO"] }
};

// ======================= BACKEND: expor a versão =======================
// Em getOsDoTecnico() (Código.js), adicionar ao objeto de cada OS retornada:
//
//   checklist_version: CHECKLIST_VERSION_ATUAL
//
// (aplicado localmente — ver Código.js linha ~326, dentro do result.push({...}))

// ======================= TESTE DE ACEITE (rastreabilidade) =======================
// - Checklist de OS com checklist_version desconhecida (ou ausente, se o
//   backend ainda não foi republicado) deve bloquear a renderização do
//   MOTOR NOVO — o frontend cai de volta pro fluxo antigo (getProximaPergunta
//   ao vivo) em vez de travar a tela inteira, para não quebrar o checklist
//   de TODOS os técnicos enquanto o backend não é republicado (mesma lógica
//   de "ordem de publicação" do KM por-OS). Ver ChecklistController no
//   index.html do eletrium-field.
// - Próxima pergunta = primeiro filho ATIVO de Pergunta_Pai cuja
//   Condicao_Exibicao bate com a resposta dada (ou sem condição), por Ordem
//   crescente — idêntico a getProximaPergunta(). Sem filho batendo = fim
//   do checklist (finalizar()).
// - NC sem foto+texto deve impedir avanço; com os dois (quando foto
//   existir no app — hoje NUNCA existe), deve permitir.
// - PUBLICAÇÃO PAUSADA em 10/08 até confirmação real de Pergunta_Pai/
//   Condicao_Exibicao/Tipo_Resposta/Foto_Obrigatoria/Ordem (a árvore acima
//   é inferência estrutural, não dado confirmado) — ver aviso no topo.
// - Responsável de negócio: Geovane.
