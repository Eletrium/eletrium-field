> **CONCLUSÃO CURTA**: a exigência "texto E foto" é real e intencional (não é bug de lógica). A
> captura de foto **já existe e já funciona** neste worktree (commit `734bbd9`, 12/08) —
> incluindo especificamente o fluxo "KM final pendente" que o relato descreve. O relato bate
> com o comportamento de ANTES desse commit, quando a foto era exigida mas genuinamente não
> capturável (bloqueio permanente de verdade). **Não implementei a mudança de regra sugerida**
> (aceitar só texto) — faria o app regredir de um estado já corrigido e testado pra um estado
> pior, com base numa premissa que não se confirma neste código. Ver "O que fazer agora" no
> fim.

# Investigação P0 — KM final bloqueado permanentemente (15/08)

Relato do Geovane, dado real: ao registrar KM final de uma OS, desvio de rota (12km e também
6412km, em ocasiões diferentes) exige justificativa por texto E foto do odômetro — mas a
captura de foto "não está implementada nesta versão", tornando o fechamento impossível pra
qualquer técnico com desvio de rota.

## 1. A exigência é "texto E foto" de verdade?

**Sim, confirmado por leitura direta do backend real** (`pwa\Código.js:3350-3358`,
`registrarKMFinalPendente`):
```js
const diferenca = kmFinalNum - kmInicial;
if (diferenca > KM_LIMIAR_INTRA_DIA_KM) {
  const temFoto = !!fotoDesvioUrl;
  const temTexto = !!(justificativaDesvio && justificativaDesvio.trim());
  if (!temFoto || !temTexto) {
    return _recusa(operationId, mensagem, { exigeJustificativa: true, mensagem });
  }
}
```
`!temFoto || !temTexto` é literalmente "recusa se faltar QUALQUER um dos dois" — ou seja, "E"
mesmo, não "OU". Não é um bug de digitação nem inversão de operador — é o design deliberado do
contrato de foto de desvio de KM (mesmo padrão do checklist: nunca aceitar uma NC sem evidência
fotográfica).

**Achado adjacente, real, fora do meu território (constante do backend)**: `KM_LIMIAR_INTRA_DIA_KM
= 5` (`Código.js:3160`) — **5 km**. Isso explica por que tanto 12km quanto 6412km disparam
igual: a condição é só `diferenca > 5`, a mesma resposta booleana pros dois números — não há
dois bugs diferentes, é o MESMO limiar baixo demais pra distinguir "desvio suspeito" de
"deslocamento normal do trabalho". Na prática, qualquer OS com mais de 5km de trecho dispara
esse gate — o que bate com a percepção de "qualquer técnico com desvio de rota fica preso".
**Sinalizando, não decidindo**: ajustar esse valor é decisão de negócio do lado do backend
(Code 1/Geovane), não algo que eu mudo — só documentando que é a causa raiz de por que isso
dispara tão frequentemente, independente do problema da foto.

## 2. A captura de foto realmente não existe?

**Não neste worktree — já existe desde 12/08.** Confirmado por leitura do código real
(`eletrium-field-checklist3/index.html`):
- `capturarFotoDesvioKM()` (linhas 1494-1505) já trata os DOIS modos da tela compartilhada
  (`APP.telaKmModo`): `'iniciar'` (KM inicial) e `'final-pendente'` (exatamente o fluxo do
  relato — KM final de uma OS já concluída, pendente de fechamento).
- O `<input type="file" id="km-desvio-foto-input">` (linha 773) já existe na tela, com um
  comentário explícito no próprio código (linhas 765-770) dizendo: *"antes disto era um alerta
  dizendo que a foto era obrigatoria mas nao capturavel, o que bloqueava PERMANENTEMENTE
  qualquer desvio real de KM (achado documentado no proprio backend, Codigo.js:1661-1662)."*
- O texto **"captura ainda não disponível nesta versão do app"** que o relato cita **existe no
  código** — mas pertence a uma tela DIFERENTE (não conformidade do checklist, `index.html:679`
  e `2810`), não à tela de KM. Não encontrei esse texto em nenhum lugar do fluxo de KM.

**Teste que já existia, e que já passava antes desta investigação** (`test-km-foto-desvio.js`,
caso "ponta a ponta (KM final pendente): mesma trava, mesmo destravamento") prova exatamente o
cenário do relato: bloqueia sem foto, destrava com foto+texto, no modo `'final-pendente'`
especificamente.

**Teste novo desta investigação** (`test-p0-km-desvio-rota-diaria.js`, 2/2) — espelha a FÓRMULA
REAL do backend (não uma aproximação) e usa os NÚMEROS EXATOS do relato (12km e 6412km) pra
confirmar sem ambiguidade nenhuma:
- Sem justificativa/foto → bloqueia.
- Só texto, sem foto → **continua bloqueando** (prova ponta a ponta que "E" é respeitado, não
  só documentado).
- Texto + foto → **fecha de verdade** (a OS sai do estado pendente).
- Repetido com o valor grande (6412km) → mesmo resultado, confirma que a magnitude do desvio
  não muda o comportamento (não é um bug ligado ao tamanho do número).

## 3. Por que o relato e o código não batem?

A explicação mais provável, dado tudo que já era sabido nesta sessão (repetido várias vezes:
"sem deploy real, sem push de branch principal"): **nenhum commit deste worktree foi deployado
pra produção ainda**. O relato descreve o comportamento de ANTES do commit `734bbd9` (quando a
foto era exigida mas genuinamente impossível de capturar) — e a OS real presa que o Geovane
encontrou é evidência consistente disso: ela ficou presa porque, no momento em que o técnico
tentou fechá-la, o app que ele estava usando de fato não tinha captura de foto nenhuma.

## O que fazer agora

**Não implementei a mudança sugerida** ("aceitar justificativa só por texto até a foto
existir") — a foto já existe e já está testada; relaxar a regra agora seria regredir uma
proteção que já funciona, baseado numa premissa que não se confirma neste código. Se eu
tivesse implementado isso sem essa checagem, o retrabalho seria: reverter a regressão mais
tarde quando alguém notasse que a foto "voltou a não ser exigida" sem motivo.

**O fix real é de deploy, não de código**: este worktree já resolve o cenário relatado. Fica
pra decisão do Geovane:
1. Confirmar que o app que o técnico da OS presa estava usando é de fato uma versão anterior a
   este fix (checável comparando a URL/versão do app que ele tinha aberto, ou simplesmente
   pela data — `734bbd9` é de 12/08).
2. Priorizar o deploy deste worktree (ou pelo menos a fatia de KM foto desvio) — sem isso,
   TODO técnico com mais de 5km de trecho numa OS (achado do item 1 acima) vai continuar preso,
   não só o caso já identificado.
3. Avaliar separadamente se `KM_LIMIAR_INTRA_DIA_KM = 5` deveria subir — é backend, decisão do
   Code 1/Geovane, só sinalizada aqui.

**A OS real presa**: conforme instruído, não mexida.

Suíte completa revalidada, zero regressão: **150/150** (21 arquivos).
