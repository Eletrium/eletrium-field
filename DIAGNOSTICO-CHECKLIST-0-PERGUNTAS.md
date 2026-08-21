# Diagnóstico — Checklist NR-10 com "0 pergunta(s) respondida(s)" (15/08)

Pedido do dono: determinar se "0 pergunta(s) respondida(s)" (observado em 2 OSes reais hoje,
incluindo `OS-E2E-CONFLICT-01`/Biomig) é (a) bug de carregamento do frontend, ou (b) dado
genuinamente vazio em `Perguntas_Checklist`. **Registrando o diagnóstico completo antes de
decidir — não presumo qual dos dois é, porque não tenho acesso à planilha real pra confirmar.**

## Achado estrutural, independente da dúvida (a)/(b) — mais importante que o esperado

`_iniciarFaseExecucao(os)` (`eletrium-field-checklist3/index.html`) decide entre 2 motores:
```js
if (os.checklist_version && VERSIONS[os.checklist_version]) { CHKV2.inicializar(os); return; }
// senao: motor legado (CHK), getProximaPergunta ao vivo
```
`VERSIONS = { "v1.0": { raizes: ["N3_TIPO"] } }` já existe no frontend, com **18 perguntas
reais** em `POOL_PERGUNTAS` (Tipo de Serviço → ramos de Reaperto/Limpeza/Diagnóstico/
Instalação/Medição/Segurança) — infraestrutura completa, não é o problema.

**Confirmado por leitura direta do backend real** (`pwa\Código.js:1441-1514`,
`getOsDoTecnico`): o objeto de cada OS retornado (`result.push({...})`) **não inclui o campo
`checklist_version` em lugar nenhum**. `Checklist_Versionado.js:234-239` (comentário de
especificação, não código) dizia que isso "foi aplicado localmente — ver Código.js linha
~326" — **não está mais lá** (nem em nenhuma outra linha da função real hoje).

**Consequência**: `os.checklist_version` chega **sempre `undefined`** pro frontend, pra
**qualquer OS, de qualquer técnico**. A condição `os.checklist_version && VERSIONS[...]` é
**sempre falsa** — o motor versionado (`CHKV2`, com as 18 perguntas prontas) **nunca roda em
produção hoje**, pra nenhuma OS. Todo checklist de Execução, sem exceção, cai no motor legado
(`CHK`, `getProximaPergunta` ao vivo) — não é um problema específico da OS Biomig, é o
comportamento de TODA OS.

Isto **não é bug meu** (não decido isso — é ausência de 1 campo na resposta do backend,
`pwa\Código.js`, território do Code 1) — só registrando porque muda o que "0 perguntas"
significa: não há como uma OS estar usando o motor versionado hoje, então a origem do
problema só pode estar no caminho do motor legado.

## O caminho do motor legado — onde "0 perguntas" pode vir de 2 lugares diferentes

`getProximaPergunta(disciplinaNome, null, null, osId)` (`pwa\Código.js:2202-2235`) filtra
candidatas por `row[idxDisc] !== disciplinaNome` — **comparação exata**, sem fallback.

### (a) Se o app que gerou essas 2 observações ainda manda `disciplina='NR-10'`

Este worktree **já corrigiu isso** — `CHK.disciplina` é `''` desde antes de hoje (comentário
no próprio código, `index.html`, bloco `const CHK = {...}`: *"achado real (10/08): toda linha
de Perguntas_Checklist tem Disciplina vazia hoje... o valor antigo 'NR-10' nunca casava com
nada e getProximaPergunta sempre devolvia null mesmo pra pergunta raiz"*) — descrevendo
EXATAMENTE o sintoma relatado hoje. Se o app usado nas 2 OSes reais ainda tem o valor antigo
(`'NR-10'`), **toda e qualquer OS teria 0 perguntas sempre**, mesmo com `Perguntas_Checklist`
cheia de linhas ativas — porque `'' !== 'NR-10'` é verdade pra 100% das linhas.

**Mesmo padrão do achado do KM final mais cedo hoje**: nenhum commit deste worktree foi
deployado ainda — se o app real ainda tem o `disciplina` antigo, é exatamente esta classe de
problema (fix já existe aqui, não chegou em produção), não um bug novo.

### (b) Se o app já manda `disciplina=''` e AINDA ASSIM vem 0

Aí a causa é genuinamente do lado do dado: `Perguntas_Checklist` não tem nenhuma linha com
`Ativo` reconhecido como verdadeiro (`Código.js:2221`: só aceita `true`/`'TRUE'`/`'true'`
literalmente — qualquer outro valor, incluindo checkbox desmarcado, string vazia, ou `FALSE`,
conta como inativa) **e** `Pergunta_Pai` vazio (candidata a raiz) **e** `Disciplina` batendo
com o que o app manda. Sem isso, `getProximaPergunta` devolve `null` na primeira chamada — e
"0 pergunta(s) respondida(s)" é o comportamento CORRETO pra esse estado de dado, não um bug.

## Teste que já existe, e prova o comportamento correto (não decide a/b sozinho)

`test-checklist-3-fases.js`/outros deste worktree já mockam `getProximaPergunta` devolvendo
`null` de propósito, exatamente pra confirmar que "0 perguntas → Concluído" é o comportamento
ESPERADO quando não há pergunta nenhuma — isso não muda com este diagnóstico, só confirma que
o app reage certo a um estado de dado vazio, seja ele legítimo (b) ou causado por um bug amont
(a).

## Como decidir (a) vs (b) sem eu ter acesso à planilha real

**Teste único, decisivo, que só o Geovane/Code 1 conseguem rodar** (acesso direto ao Apps
Script ou à planilha):
1. Chamar `getProximaPergunta('', null, null, 'OS-E2E-CONFLICT-01')` diretamente (editor do
   Apps Script, ou via `gsCallReal` no console do navegador contra a URL real) — **com
   `disciplina=''` explicitamente, não `'NR-10'`**.
   - Se devolver uma pergunta real → a planilha está OK, e o app que gerou a observação de "0
     perguntas" ainda está mandando o `disciplina` antigo → **(a), bug de deploy defasado**,
     mesma classe do achado do KM.
   - Se devolver `null` mesmo assim → conferir `Perguntas_Checklist`: existe linha com
     `Pergunta_Pai` vazio E `Ativo` literalmente `TRUE`/`true`/`true` (boolean)? Se não → **(b),
     dado ausente/mal configurado**, não é bug de código nenhum.
2. Alternativa mais simples, sem editor: abrir o app real (o que a Biomig realmente usa) e
   inspecionar o `<script>` carregado (visualizar código-fonte da página) procurando por
   `disciplina: ''` vs `disciplina: 'NR-10'` no objeto `CHK` — confirma direto qual versão está
   no ar, sem precisar rodar nada no backend.

## Recomendação (sinalizando, não decidindo sozinho)

- Se for (a): mesma recomendação do achado do KM — priorizar o deploy deste worktree (ou pelo
  menos a correção pontual do `disciplina`), não uma mudança de código nova.
- Se for (b): é achado de dado (`Perguntas_Checklist` vazia/mal configurada pro tipo de serviço
  da Biomig), cadastro no admin — fora do meu escopo, como o dono já antecipou.
- **De qualquer forma**: o campo `checklist_version` ausente em `getOsDoTecnico` (achado
  estrutural acima) vale a pena corrigir no backend independente da causa de (a)/(b) — sem ele,
  as 18 perguntas já prontas do motor versionado nunca são usadas por ninguém, e todo o
  checklist de Execução do projeto inteiro depende só do motor legado ao vivo, mais frágil.
