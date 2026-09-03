# MessagingWorkers

## Responsabilidade

Consumir solicitações, publicar outbox e reprocessar referências pendentes com segurança multi-instância.

## Componentes

- `SqsWagerConsumer`: valida envelope, chama o caso de uso e decide ack/retry/DLQ.
- `OutboxPublisher`: reivindica e publica eventos pendentes.
- `PendingReferenceWorker`: reivindica e reapresenta transações elegíveis, com
  lease recuperável, backoff e limite de tentativas persistidos.
- `ShutdownCoordinator`: em `SIGTERM`, interrompe polling e conclui ou libera trabalho em curso.

## Dependências

Cliente SQS, relógio, unit of work, repositórios e métricas.

## Garantias

- entrada e saída são `at-least-once`;
- deduplicação é persistente;
- erros de negócio fazem ack; transitórios voltam; permanentes esgotados vão à DLQ;
- interrupção do consumer após o commit financeiro e antes do delete recupera estritamente uma vez via inbox, sem lançamentos adicionais;
- em `SIGTERM`, o polling cessa e mensagens em voo concluem no prazo (`SHUTDOWN_GRACE_PERIOD_MS`) ou recebem visibilidade zero para assunção imediata por outra réplica;
- uma reversão pendente converge quando a referência válida aparece; o estado pendente anterior não impede a reaplicação;
- leases expirados e pendências sem agenda voltam a ser elegíveis;
- nenhum lock SQL é mantido durante chamada de rede ao SQS;
- publicação total agenda backoff e limpa o lease; resposta parcial finaliza
  apenas sucessos e agenda retry apenas das falhas; resultado ambíguo conserva
  o ID estável para duplicação at-least-once.

## Funções públicas

Veja [contratos](../functions/MessagingWorkers.md).

## Código planejado

`src/infrastructure/messaging/workers/`.
