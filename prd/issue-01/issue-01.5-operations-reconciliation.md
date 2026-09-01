# ISSUE-01.5 — Ordem, reconciliação e operação

## Estado

`IN PROGRESS` · prioridade alta · depende de: ISSUE-01.4.

## Resultado esperado

O serviço recupera operações fora de ordem, detecta divergências financeiras e fornece sinais operacionais suficientes para diagnóstico.

## Escopo

- worker de `PENDING_REFERENCE` com tentativas, TTL e backoff;
- endpoint de reconciliação do ledger;
- logs estruturados, métricas e health checks finais;
- runbooks de falhas e limitações conhecidas.

## Tarefas

- [x] Persistir tentativas e próxima execução de referência pendente.
- [x] Reprocessar lotes concorrentes com reivindicação recuperável.
- [x] Rejeitar expiração com `REFERENCE_NOT_FOUND` e evento.
- [x] Reconstruir saldo pelo ledger sem corrigir divergências.
- [x] Adicionar logs com IDs de correlação e sem payload financeiro completo.
- [x] Instrumentar métricas iniciais com baixa cardinalidade.
- [x] Finalizar liveness/readiness e documentar runbooks.

## Critérios de aceite

- [ ] REFUND/ROLLBACK anterior à referência termina corretamente após a chegada dela.
- [ ] Referência inexistente expira de forma auditável e determinística.
- [ ] Reconciliação retorna saldo armazenado, calculado, diferença e quantidade de entradas.
- [ ] Divergência gera resposta, log e métrica; não gera correção silenciosa.
- [ ] Métricas cobrem status, duplicatas, retries, DLQ, locks, outbox lag e latência.
- [ ] Logs propagam `correlationId` sem segredos ou labels de alta cardinalidade.

## Testes/evidências

Cobrir ordem invertida, expiração, divergência injetada, reinício do worker e comportamento de health durante indisponibilidade.

## Fora de escopo

Correção automática, dashboards sofisticados, OpenTelemetry completo e SLO de produção.

## Documentação relacionada

[Reconciliação](../../docs/brain/services/ReconciliationService.md) · [Observabilidade](../../docs/brain/conventions/Observability.md) · [Failure codes](../../docs/brain/product/FailureCodes.md)
