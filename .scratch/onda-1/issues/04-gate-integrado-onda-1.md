# 04 — Gate integrado da Onda 1
Status: `needs-triage`
Type: `AFK`
Labels: `needs-triage`

## Parent

`.scratch/onda-1/PRD.md` · gate de integração e evidências.

## What to build

Integrar serialmente as três trilhas da Onda 1 e executar a regressão
compartilhada. Consolidar contratos, documentação do Brain, evidências TDD e
um relatório reproduzível que confirme o estado dos bloqueios do roadmap.

## Acceptance criteria

- [x] As issues 01, 02 e 03 estão verdes e suas dependências de fechamento foram satisfeitas.
- [ ] A regressão unitária, integração e concorrência passa em uma stack limpa.
- [ ] O fluxo consumidor → operação → outbox → publicação → referência pendente é demonstrável.
- [ ] PostgreSQL, LocalStack e pelo menos três réplicas são usados nos cenários exigidos.
- [ ] Brain, índice, log e links refletem os contratos finais sem páginas obsoletas.
- [ ] Cada trilha contém evidência RED, GREEN, REFACTOR, comandos e resultados.
- [ ] Onda 0 permanece marcada como concluída e Ondas 2–4 permanecem bloqueadas.
- [ ] Limitações, decisões e riscos remanescentes estão registrados sem segredos ou PII.

## Blocked by

- [01 — Consumidor SQS atômico](01-consumidor-sqs-atomico.md)
- [02 — Publicação outbox recuperável](02-publicacao-outbox-recuperavel.md)
- [03 — Referências pendentes recuperáveis](03-referencias-pendentes-recuperaveis.md)

## Comments
