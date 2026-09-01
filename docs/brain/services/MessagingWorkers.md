# MessagingWorkers

## Responsabilidade

Consumir solicitações, publicar outbox e reprocessar referências pendentes com segurança multi-instância.

## Componentes

- `SqsWagerConsumer`: valida envelope, chama o caso de uso e decide ack/retry/DLQ.
- `OutboxPublisher`: reivindica e publica eventos pendentes.
- `PendingReferenceWorker`: reapresenta transações elegíveis.
- `ShutdownCoordinator`: em `SIGTERM`, interrompe polling e conclui ou libera trabalho em curso.

## Dependências

Cliente SQS, relógio, unit of work, repositórios e métricas.

## Garantias

- entrada e saída são `at-least-once`;
- deduplicação é persistente;
- erros de negócio fazem ack; transitórios voltam; permanentes esgotados vão à DLQ;
- nenhum lock SQL é mantido durante chamada de rede ao SQS.

## Funções públicas

Veja [contratos](../functions/MessagingWorkers.md).

## Código planejado

`src/infrastructure/messaging/workers/`.
