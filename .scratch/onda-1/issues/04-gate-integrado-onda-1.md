# 04 — Gate integrado da Onda 1
Status: `closed`
Type: `AFK`
Labels: none

## Parent

`.scratch/onda-1/PRD.md` · gate de integração e evidências.

## What to build

Integrar serialmente as três trilhas da Onda 1 e executar a regressão
compartilhada. Consolidar contratos, documentação do Brain, evidências TDD e
um relatório reproduzível que confirme o estado dos bloqueios do roadmap.

## Acceptance criteria

- [x] As issues 01, 02 e 03 estão verdes e suas dependências de fechamento foram satisfeitas.
- [x] A regressão unitária, integração e concorrência passa em uma stack limpa.
- [x] O fluxo consumidor → operação → outbox → publicação → referência pendente é demonstrável.
- [x] PostgreSQL, LocalStack e pelo menos três réplicas são usados nos cenários exigidos.
- [x] Brain, índice, log e links refletem os contratos finais sem páginas obsoletas.
- [x] Cada trilha contém evidência RED, GREEN, REFACTOR, comandos e resultados.
- [x] Onda 0 permanece marcada como concluída e Ondas 2–4 permanecem bloqueadas.
- [x] Limitações, decisões e riscos remanescentes estão registrados sem segredos ou PII.

## Blocked by

- [01 — Consumidor SQS atômico](01-consumidor-sqs-atomico.md)
- [02 — Publicação outbox recuperável](02-publicacao-outbox-recuperavel.md)
- [03 — Referências pendentes recuperáveis](03-referencias-pendentes-recuperaveis.md)

## Comments

- 2026-09-02 — preparação limpa: `down -v`, infraestrutura reconstruída e
  migrations validadas por `up → down → up`; três réplicas `app` ficaram
  simultaneamente saudáveis antes da regressão.
- 2026-09-02 — GREEN integrado: `docker compose -f compose.yaml -f
  compose.hardening.yaml run --rm --no-deps test bun run hardening` concluiu
  com 79 testes unitários, 19 de integração e 4 de concorrência, sem falhas.
- O mesmo gate concluiu Biome, TypeScript, quatro índices/planos críticos e 23
  links do Brain. `messaging.spec.ts` comprovou consumidor → operação atômica
  → outbox → fila de eventos; `pending-reference.spec.ts` comprovou resolução
  fora de ordem, reconciliação e rejeição terminal publicada.
- Evidência TDD: os RED/GREEN/REFACTOR pertencem às issues 01–03 e estão
  registrados em cada trilha. Esta issue não alterou comportamento de produção;
  executou a regressão compartilhada e consolidou a prova reproduzível.
- Riscos remanescentes: entrega SQS/outbox continua `at-least-once`; não existe
  consumidor downstream interno; lifecycle de processo, matriz completa de
  crash/restart e gates das Ondas 2–4 permanecem fora do escopo e bloqueados.
