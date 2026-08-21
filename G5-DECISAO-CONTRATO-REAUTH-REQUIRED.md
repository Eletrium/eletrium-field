# G5 — Decisão de Contrato REAUTH_REQUIRED

Status: **DECISÃO DO OWNER — PRÉ-ENFORCEMENT**

Esta decisão não implementa runtime, não autoriza enforcement de token e não cria G6.

## Eixo 1 — Onde o sinal entra no contrato

**DECISÃO: campo booleano dedicado `reauth_required`.**

Não usar `status` novo para autenticação. Os status existentes pertencem à máquina de estados de sincronização/Log_Central e não devem ser contaminados com estado de sessão.

Não usar `error_code` como sinal primário de UX de reautenticação. O catálogo atual de `error_code` e `classificarErroLogCentral()` foram desenhados para falhas de sincronização/dado; autenticação é outro domínio.

Regra de consumo no Field:

```text
if (response.reauth_required === true) {
  iniciar fluxo de reautenticação
}
```

Ausência ou `false` nunca pode ser interpretada como pedido de novo login.

`retryable` continua significando retry técnico automático. `reauth_required` é uma ação de autenticação humana/aplicacional distinta.

## Eixo 2 — Quais rejeições acionam reautenticação

**DECISÃO: somente sessão validamente identificada como EXPIRADA.**

Entre os tipos já exercitados no G5:

| Rejeição | `reauth_required` |
|---|---:|
| assinatura inválida | false |
| token vazio | false |
| token malformado | false |
| payload corrompido | false |
| token de outro técnico / identidade divergente | false |
| token expirado | **true** |

Regra formal:

```text
reauth_required === true  => retryable === false
retryable === false       !=> reauth_required === true
```

O backend só poderá marcar `reauth_required:true` depois de confirmar que o token é estruturalmente válido, tem assinatura válida, corresponde ao técnico alegado e está expirado. Entrada forjada/malformada não pode induzir fluxo normal de re-login.

Quando o enforcement futuro tornar token ausente uma rejeição, ausência de token no backend não será tratada automaticamente como `reauth_required:true`; o Field deve impedir chamadas protegidas sem sessão local válida e direcionar ao login antes da chamada.

## Implementação backend necessária antes do enforcement

A implementação não deve depender de parsing de texto de `identidade.erro` em nove ou mais guards.

Direção aprovada:

1. `verificarTokenSessao()` passa a devolver metadado estruturado de sessão, incluindo `reauth_required:true` somente para expiração válida.
2. Criar um helper único para converter falha de identidade em `_recusa`, por exemplo `_recusaSessao(operationId, identidade)`.
3. Todos os guards de sessão devem usar esse helper; fazer sweep completo de todos os call-sites reais de `verificarTokenSessao()` antes do enforcement, sem assumir que a contagem histórica de 9 continua completa.
4. `_recusa` deve expor `reauth_required` como booleano explícito em recusas de sessão; nenhuma regra de UX deve depender de `classificarErroLogCentral()`.
5. `retryable:false` permanece em toda recusa de sessão.

Esta alteração é aditiva enquanto token é opcional e não exige, por si só, incremento do `FIELD_API_CONTRACT`.

## Eixo 3 — UX Field: leitura e escrita têm tratamento diferente

### Leituras síncronas

Aplicável às leituras por técnico que bloqueiam fluxo/tela.

Quando `reauth_required:true`:

1. cancelar a transição dependente daquela leitura;
2. exibir mensagem de sessão expirada;
3. solicitar login novamente;
4. após autenticação do MESMO técnico, repetir a leitura automaticamente **uma única vez**;
5. se a repetição voltar a pedir reauth, interromper e mostrar erro, sem loop.

Para rejeições de sessão com `reauth_required:false`, não abrir login automaticamente; tratar como erro de integridade/identidade/cliente.

### Escritas / Outbox

A fila local NÃO deve armazenar um token congelado junto da operação. O token vigente deve ser injetado **no momento do envio**, preservando payload e `operationId`.

Quando uma escrita recebe `reauth_required:true`:

1. não descartar a operação;
2. não criar nova `operationId`;
3. não classificar como retry técnico;
4. não incrementar backoff/tentativas técnicas por causa da expiração;
5. manter a operação localmente bloqueada por autenticação (metadado local, sem criar novo status no Log_Central);
6. solicitar reautenticação quando houver conectividade;
7. após login do MESMO técnico, reenviar a mesma operação com token novo e a mesma `operationId`.

Se outro técnico entrar no mesmo aparelho, operações pendentes do técnico anterior **não podem** ser reenviadas com a nova identidade. Permanecem bloqueadas até o técnico proprietário voltar a autenticar ou até fluxo administrativo futuro resolver a pendência.

Offline: captura de campo e enfileiramento podem continuar sem rede; a validade da sessão é aplicada no envio/reenvio. A expiração de token não pode apagar trabalho já capturado offline.

## Interceptor central do Field

A interpretação de `reauth_required` deve ficar na camada comum de chamadas/transporte do Field, não copiada manualmente em cada tela. As telas podem decidir como preservar contexto, mas a detecção da sessão expirada deve ser única.

## Enforcement e versão do contrato

Durante migração:

```text
Backend: token opcional
FIELD_API_CONTRACT: v1
```

No gate em que token se tornar obrigatório:

```text
Backend: token obrigatório
FIELD_API_CONTRACT: v2
Field candidato: deve declarar/esperar v2
```

Tornar um parâmetro antes opcional em obrigatório é mudança quebradora e deve falhar claramente em version skew.

## Testes obrigatórios antes do enforcement

1. expirado válido => `reauth_required:true`, `retryable:false`;
2. assinatura inválida => `reauth_required:false`;
3. vazio => false;
4. malformado => false;
5. payload corrompido => false;
6. token X usado como Y => false;
7. `reauth_required:true` nunca acompanha `retryable:true`;
8. leitura expirada => login + replay único;
9. escrita expirada => preserva `operationId` e payload, sem retry técnico;
10. reauth do mesmo técnico => replay com token novo;
11. login de técnico diferente => fila anterior NÃO é reenviada;
12. fila offline não congela token antigo dentro do item;
13. enforcement sem token => falha clara;
14. skew Field v1 x backend v2 => boot bloqueado pelo contrato.

## Eixo 4

O conteúdo literal do Eixo 4 da proposta da Cowork 2 não ficou disponível nos anexos/índice desta conversa. **Nenhuma decisão foi inventada para esse eixo.** Incorporar o texto literal quando estiver disponível e decidir antes da implementação final do contrato.
