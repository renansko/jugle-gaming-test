# Observability

## Logs

JSON estruturado com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`. Não registrar payload completo, saldo, credenciais ou PII desnecessária.

## Métricas mínimas

- transações por kind/status/failure code;
- duplicatas e conflitos de idempotência;
- retries, DLQ e idade da mensagem;
- conflitos/deadlocks e duração de lock;
- outbox pendente, lag, tentativas e falhas;
- latência HTTP e de processamento;
- divergências de reconciliação.

Os contadores de reconciliação, reprocessamento pendente e publicação de outbox usam apenas labels fixas de status. A ocorrência individual é registrada como JSON com `correlationId` e `transactionId`.

Labels usam cardinalidade limitada: IDs ficam em logs, nunca em labels.

Cada réplica expõe as séries operacionais obrigatórias desde o bootstrap com valor zero. A descoberta de métricas não depende da primeira execução dos workers.

## Saúde

Liveness verifica apenas o event loop/processo. Readiness verifica conexão PostgreSQL, migrations esperadas e acesso às filas SQS.

## Alertas planejados

DLQ crescente, outbox lag acima do SLO, readiness falha, taxa de erro transitório e qualquer divergência de reconciliação.
