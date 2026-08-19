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

`test-onda2-token-sessao.js` adiciona 11 verificações para:

- compatibilidade transicional sem token;
- token válido;
- token inválido;
- token expirado;
- token de outro técnico;
- posse obrigatória mesmo sem token;
- preservação dos parâmetros legados;
- roteamento correto do token no dispatcher para `pausarOS` e `retomarOS`.

O total histórico de 684 não deve ser reescrito como novo PASS automaticamente. Após a Onda 2, o baseline só pode ser atualizado depois de uma execução real do runner no checkout candidato.

## Regra de aceite

Código versionado não equivale a teste executado. Para marcar a Onda 2 como `PASS`, registrar:

- commit/branch executados;
- versão do Node;
- comando usado;
- arquivos PASS/FAIL;
- contagem de asserções reportada pelos testes;
- zero falhas de regressão.
