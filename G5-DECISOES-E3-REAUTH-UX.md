# G5 — Decisões owner para E3-10, E3-14 e E3-24

Status: DECIDIDO — pré-enforcement
Data: 2026-08-21
Branch de implementação: `chatgpt/g5-reauth-backend-20260821`

## E3-10 — pausarOS / retomarOS

**Decisão:** entram integralmente no contrato `REAUTH_REQUIRED`.

`HMAC_Onda2.js` não possui uma `_recusa()` runtime própria. `_validarSessaoEPosseOnda2()` chama a `_recusa()` global de `Código.js`. Na implementação REAUTH, a recusa de **sessão** desse helper deve passar por `_recusaSessao()`, enquanto a recusa de **posse** continua sendo `_recusa()` normal.

Regra:
- sessão expirada válida + mesmo técnico => `reauth_required:true`, `retryable:false`;
- assinatura inválida / vazio / malformado / payload corrompido / identidade divergente => `reauth_required:false`, `retryable:false`;
- posse negada => não é REAUTH.

## E3-14 — usuário cancela o prompt de reautenticação numa leitura síncrona

**Decisão:** cancelar aborta a leitura pendente. A leitura não fica aguardando indefinidamente e não vai para outbox.

Comportamento:
1. limpar/invalidar o token expirado local;
2. descartar a tentativa de leitura que gerou o prompt;
3. não fazer replay automático;
4. voltar à última tela estável anterior à leitura;
5. mostrar estado persistente: `Sessão não renovada. Entre novamente para continuar.`;
6. nenhuma transição que dependia daquela leitura pode ser presumida.

### Caso bootstrap (`getDiariaHoje` após login)

Como `getDiariaHoje` decide entre `Inicio do Dia` e `Home`, não existe tela operacional segura para assumir. Se o usuário cancelar a reautenticação:
- voltar para a tela de login/seleção de técnico;
- manter no máximo o técnico selecionado como conveniência visual, sem tratá-lo como sessão autenticada;
- não chamar `carregarHome()` como fallback;
- não inferir que a diária existe ou não existe.

## E3-24 — leitura síncrona + sessão expirada + dispositivo offline

**Decisão:** não tentar login enquanto offline e não substituir a resposta do servidor por cache genérico.

Comportamento:
1. detectar que a sessão precisa ser renovada;
2. se `navigator.onLine === false`, não abrir fluxo de PIN que dependa do backend;
3. manter a tela estável anterior e exibir estado explícito `Sessão expirada — sem conexão. Reconecte para continuar.`;
4. manter apenas em memória um descritor de replay da leitura (não IndexedDB/outbox, pois é leitura e não há mutação a preservar);
5. ao evento `online`, solicitar reautenticação;
6. se reautenticação do mesmo técnico for bem-sucedida, repetir a leitura uma única vez;
7. se o usuário cancelar, aplicar E3-14;
8. se o app fechar antes da reconexão, nada precisa ser persistido: leitura pode ser refeita no próximo boot.

### Cache

Cache só pode ser exibido quando houver **contrato explícito de cache para aquele endpoint**, com proveniência/freshness conhecida. Mesmo assim, cache é informativo/read-only e não satisfaz a leitura autoritativa nem libera mutações dependentes dela.

Para `getDiariaHoje`, o Field atual não possui cache canônico da diária. Portanto:
- **não usar cache local para decidir Home vs Inicio do Dia**;
- exibir indisponibilidade offline até reconectar e reautenticar.

## Invariantes para os testes E3

- `reauth_required:true => retryable:false`.
- `retryable:false` não implica `reauth_required:true`.
- reauth só para token expirado depois de estrutura + assinatura + identidade válidas.
- leitura síncrona nunca entra no outbox.
- cancelamento nunca produz replay automático.
- offline nunca transforma dado local não contratual em resposta autoritativa.
- replay após reauth ocorre no máximo uma vez por leitura.
- replay só com o mesmo técnico que originou a leitura.
