# G3 — E2E-SYNC-CONFLICT — Rastreabilidade

Status do gate: FECHADO
Data de consolidação: 21/08/2026

## Natureza do nome

`E2E-SYNC-CONFLICT` é um rótulo de coordenação usado para o Gate G3. Na busca atual do repositório não foi localizado um artefato histórico cujo nome de arquivo seja exatamente `E2E-SYNC-CONFLICT`.

Isso não reabre o gate: a ausência era de nomenclatura/rastreabilidade documental, não evidência de regressão funcional.

## Escopo do G3

O G3 corresponde à validação integrada do conflito entre sincronização administrativa e estado operacional, incluindo a prova de que:

- o fluxo 1B respeita newest-wins;
- edição administrativa mais nova não é sobrescrita por dado administrativo antigo;
- campos operacionais de execução não são sobrescritos pelo caminho administrativo;
- conflito real é resolvido sem duplicação ou reintrodução silenciosa do estado stale.

## Relação com G2

G2 fecha a regra de reconciliação/newest-wins no 1B.
G3 fecha a prova integrada de conflito usando essa regra.

Portanto G3 depende semanticamente de G2, mas é gate distinto de evidência integrada.

## Uso daqui para frente

Toda documentação de status deve referir-se a este gate como:

**G3 — E2E-SYNC-CONFLICT (prova integrada de conflito/newest-wins)**

Este arquivo passa a ser o ponto de rastreabilidade nominal. Evidências primárias de execução (runs, operation IDs, timestamps e registros SharePoint/Sheets) devem ser vinculadas aqui quando consolidadas, sem alterar o status já fechado do gate salvo se nova evidência de regressão aparecer.
