# G5 — Token de Sessão / Regressão

## Baseline recebida no handoff

- 684 testes reportados como PASS pelo Code 1 no checkout original.
- Onda 1 concluída no checkpoint `2f08b21b0f52f9c1d48b3bce447747b9e287d18a`.
- A cópia versionada da suíte entrou em `e8fde3e1e1fe804fd9dbea5f3d48c1f304c61e96`.

## Execução portátil

Os testes históricos ainda contêm caminhos absolutos Windows para `Código.js` e `API.js`.
Para preservar a evidência original sem reescrever 29 arquivos, use o runner:

```bash
node tests/g5-token-sessao/run-all-portable.js
```

O runner executa cada `test-*.js` em processo Node isolado e carrega `portable-fs-preload.js`, que redireciona **somente** os dois caminhos absolutos legados para os arquivos do checkout atual.

## Onda 2

`test-onda2-token-sessao.js` adiciona 12 verificações para:

- compatibilidade transicional sem token;
- token válido com posse válida;
- **token válido do próprio técnico com posse negada** (achado bloqueante do red-team Cowork 2);
- token inválido;
- token expirado;
- token de outro técnico;
- posse obrigatória mesmo sem token;
- preservação dos parâmetros legados;
- roteamento correto do token no dispatcher para `pausarOS` e `retomarOS`.

A combinação `token válido + posse negada` é obrigatória porque impede que uma regressão com early-return após a autenticação pule `verificarPosseOS`. O teste deve bloquear um técnico autenticado tentando operar uma OS que não possui e deve provar que a função legada não foi delegada.

O total histórico de 684 não deve ser reescrito como novo PASS automaticamente. Após a Onda 2, o baseline só pode ser atualizado depois de uma execução real do runner no checkout candidato.

## Achados de red-team não bloqueantes da Onda 2

- O harness de Onda 2 usa mocks para isolar sessão/posse; a regressão completa continua sendo executada pelo runner versionado e o E2E real pertence à homologação integrada.
- Padronização final do envelope canônico de recusa permanece fora deste patch mínimo enquanto não houver quebra funcional observada neste PR.
- A Onda 2 cobre apenas os endpoints definidos para esta fatia; os demais pontos sensíveis a posse seguem para as ondas previstas no rollout.
- O tratamento de `operationId` vazio deve ser revisto junto da padronização contratual, sem ampliar este PR de autenticação.

## Regra de aceite

Código versionado não equivale a teste executado. Para marcar a Onda 2 como `PASS`, registrar:

- commit/branch executados;
- versão do Node;
- comando usado;
- arquivos PASS/FAIL;
- contagem de asserções reportada pelos testes;
- zero falhas de regressão.
