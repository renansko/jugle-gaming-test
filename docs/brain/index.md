# Brain

## Como utilizar

Este é o ponto de entrada para decisões, invariantes e contratos do sistema. Consulte também [Arquitetura](../../ARCHITECTURE.md), [Plano de entrega](../DELIVERY_PLAN.md) e [ISSUE-01](../../prd/issue-01/README.md).

## Entidades

- [Money](entities/Money.md) — Representação monetária exata e imutável.
- [Wallet](entities/Wallet.md) — Aggregate root do saldo por jogador e moeda.
- [WagerTransaction](entities/WagerTransaction.md) — Operação de aposta, estados e referências.
- [WalletLedgerEntry](entities/WalletLedgerEntry.md) — Registro financeiro imutável e reconciliável.
- [InboxOutbox](entities/InboxOutbox.md) — Registros persistentes de consumo e publicação.

## Serviços

- [WageringService](services/WageringService.md) — Caso de uso financeiro compartilhado por HTTP e SQS.
- [MessagingWorkers](services/MessagingWorkers.md) — Consumidor, publisher e reprocessadores.
- [ReconciliationService](services/ReconciliationService.md) — Compara saldo materializado e ledger.

## Funções públicas

- [WageringService](functions/WageringService.md) — Contratos para wallet e transações.
- [MessagingWorkers](functions/MessagingWorkers.md) — Contratos dos workers assíncronos.

## Recursos

- [HttpApi](resources/HttpApi.md) — Endpoints, respostas e semântica HTTP.
- [SqsMessages](resources/SqsMessages.md) — Envelope de entrada e política da fila.
- [IntegrationEvents](resources/IntegrationEvents.md) — Eventos versionados gravados na outbox.

## Convenções

- [DatabaseTransactions](conventions/DatabaseTransactions.md) — Fronteiras atômicas e migrations.
- [Concurrency](conventions/Concurrency.md) — Lock por wallet e publishers concorrentes.
- [Idempotency](conventions/Idempotency.md) — Hash canônico, replay e deduplicação.
- [Testing](conventions/Testing.md) — Pirâmide e cenários obrigatórios reais.
- [Observability](conventions/Observability.md) — Logs, métricas e health checks.

## Runbooks

- [Operations](../runbooks/Operations.md) — Diagnóstico de pendências, divergências e readiness.

## Produto

- [WageringRules](product/WageringRules.md) — Vocabulário e efeitos de cada operação.
- [FailureCodes](product/FailureCodes.md) — Taxonomia estável de rejeições e falhas.

## Mapa de símbolos planejado

- `Money` → [Money](entities/Money.md)
- `Wallet` → [Wallet](entities/Wallet.md)
- `WagerTransaction` → [WagerTransaction](entities/WagerTransaction.md)
- `ProcessWagerTransaction` → [WageringService](services/WageringService.md)
- `SqsWagerConsumer` e `OutboxPublisher` → [MessagingWorkers](services/MessagingWorkers.md)
