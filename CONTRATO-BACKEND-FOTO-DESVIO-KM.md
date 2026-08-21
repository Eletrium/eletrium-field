# Contrato proposto — Backend para foto de desvio de KM

Escrito pela sessão de frontend (`eletrium-field`, branch `checklist-3-fases`) para a
sessão de backend avaliar. Não implementado por aqui — Apps Script fora do escopo desta
sessão. Nenhuma linha de `Código.js`/`API.js` foi tocada.

## O que essa fatia entrega (KM encadeado, parte "Romper Cadeia")

`validarESalvarKMInicial` e `registrarKMFinalPendente` (`Código.js:1663-1717,1753-1789`)
já implementam a "herança" de KM (comparam contra a última OS do técnico hoje ou no dia
anterior, mesmo veículo) e já bloqueiam desvios acima do limiar exigindo justificativa
por **texto E foto**. O próprio código documenta a lacuna:

> `Código.js:1661-1662`: "LIMITAÇÃO CONHECIDA: captura de foto não existe no app ainda —
> enquanto isso, qualquer salto real fica bloqueado até existir."

Ou seja: hoje, qualquer técnico com um desvio de KM real (rota alternativa, veículo
trocado, etc.) fica **permanentemente travado** — não existe app-side nenhum jeito de
fornecer a foto exigida.

Esta fatia destrava isso reaproveitando a infraestrutura de upload já existente da
Frente B fatia 1 (`capturarEUpload`/`enviarPOSTNoCors`/`pollStatusOperacao`, sem
mudança de comportamento pros usos já existentes — ver teste de regressão). Duas telas
(`scr-iniciar-km`, compartilhada por "iniciar OS com KM" e "KM final pendente de OS já
concluída") ganharam um campo de foto real, que chama `salvarArquivoOS` com
`campo='KM_Foto_Desvio_URL'` e alimenta o resultado de volta pra `iniciarOSComKM`/
`registrarKMFinalPendente` como `fotoDesvioUrl`.

## O único bloqueio real: allow-list de `salvarArquivoOS`

```js
// Código.js:355
const CAMPOS_ARQUIVO_PERMITIDOS = ['Laudo_URL', 'Assinatura_URL'];
```

`KM_Foto_Desvio_URL` **já é uma coluna que o backend sabe escrever** (usada por
`set('KM_Foto_Desvio_URL', ...)` em `validarESalvarKMInicial`/`registrarKMFinalPendente`)
— só não está na allow-list de `salvarArquivoOS`, que recusa com
`{ sucesso: false, erro: 'Campo nao permitido: ...' }`. Contrato proposto:

```js
const CAMPOS_ARQUIVO_PERMITIDOS = ['Laudo_URL', 'Assinatura_URL', 'KM_Foto_Desvio_URL'];
```

Uma linha. Nenhuma coluna nova, nenhuma função nova, nenhuma mudança de schema.

## Estado até o contrato ser aplicado

O upload roda, mas o backend recusa (`SYNC_ERROR`, "Campo nao permitido"). O app mostra
"Falha ao enviar — tente novamente" — falha visível, não finge sucesso. Testado
explicitamente (`test/test-km-foto-desvio.js`, teste "estado ATUAL, antes do contrato").

## O que esta fatia NÃO entrega (fora do escopo, registrado pra não confundir)

A referência real de "KM encadeado" em SharePoint (`web/os.html:941-1186`, Frente A/
Cowork) tem botões explícitos "Herdar KM"/"Romper cadeia" e cria automaticamente uma OS
de logística de retorno ao romper. Nada disso existe aqui — o PWA já tinha a validação
de desvio funcionando (backend), só faltava o meio de cumprir a exigência de foto. Não
foi adicionado prefill de KM nem criação automática de OS — ficam como possível trabalho
futuro, não fizeram parte desta fatia.
