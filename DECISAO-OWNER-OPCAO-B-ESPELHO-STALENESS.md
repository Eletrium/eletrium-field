# DECISÃO OWNER — Opção B com indicador de staleness

Status: APROVADA COMO DIRETRIZ DE ARQUITETURA
Data: 21/08/2026

## Decisão

A Opção B é aprovada como mecanismo preferencial.

A alternativa que exporia dado agregado de negócio por canal sem autenticação é rejeitada: reduzir complexidade técnica à custa de ampliar superfície de exposição é regressão de segurança, não simplificação aceitável.

## Condição obrigatória

A Opção B só é válida se o consumidor conseguir distinguir explicitamente espelho saudável de espelho possivelmente desatualizado.

O mecanismo deve carregar, no mínimo, semântica equivalente a:

- instante da última atualização bem-sucedida do espelho;
- estado de frescor/staleness derivável sem heurística de UI;
- comportamento fail-closed quando a idade do espelho ultrapassar o limite operacional definido;
- nenhuma apresentação de dado espelhado como atual quando não houver confirmação recente de sincronização.

Os nomes exatos dos campos permanecem detalhe de implementação; a semântica acima é obrigatória.

## Justificativa

O incidente já observado no cenário de Reaquecimento demonstrou que cenários Make podem ficar desativados ou deixar de atualizar silenciosamente. Portanto, ausência de indicador de staleness é risco real já materializado neste projeto, não risco teórico.

## Segurança

- Dado agregado de negócio não deve ser movido para canal público/não autenticado apenas para simplificar leitura.
- Espelho não é nova fonte de verdade; continua sendo projeção/cache da fonte autoritativa.
- Staleness não deve ser inferido por mensagem ou ausência de erro: precisa ser informação explícita/objetiva.
- Em estado stale, o consumidor deve degradar de forma visível e segura, sem fingir atualidade.

## Ownership

- Owner da decisão/gate: ChatGPT / coordenação G5-G6.
- Implementação técnica recomendada: Code 3, por ter produzido a investigação do fluxo e do risco.
- Red-team independente: Cowork 2 ou revisor independente que não tenha implementado o mecanismo.

## Gate

Esta decisão não autoriza G6 nem deploy. Antes de entrar no candidato, exigir:

1. implementação materializada em branch revisável;
2. teste com espelho fresco;
3. teste com espelho stale;
4. teste com cenário de atualização indisponível/desativado;
5. prova de que canal não autenticado não passa a expor dado agregado;
6. red-team independente sem bloqueante.
