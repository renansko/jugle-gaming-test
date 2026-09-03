# Observability

## Logs

Em produção, o bootstrap usa `ConsoleLogger` em modo JSON compacto, sem cores ou
prefixos textuais. Cada registro ocupa uma linha JSON parseável e mantém nível,
contexto e mensagem estruturada. Em desenvolvimento e teste, o logger padrão do
Nest é preservado.

Logs de negócio incluem `correlationId`, `messageId`, `transactionId`, `walletId`
e `providerId`. Não registrar payload completo, saldo, credenciais ou PII
desnecessária.

## OpenTelemetry & Métricas

Instrumentação baseada no OpenTelemetry API (`@opentelemetry/api`) através de [OpenTelemetryBridge](../../../src/infrastructure/observability/opentelemetry.ts).

### Instrumentos e Séries:
- `wager_transactions_total`: contador de transações por `kind` e `status`;
- `idempotency_replays_total`: contador de replays idempotentes bem-sucedidos;
- `reconciliation_divergences_total`: contador de divergências detectadas;
- `wallet_lock_duration_ms`: gauge do tempo sob lock `PESSIMISTIC_WRITE`;
- `wager_processing_latency_ms`: histograma da latência financeira com buckets,
  soma e contagem; percentis nunca são inferidos do último valor;
- `outbox_pending` e `outbox_lag_ms`: medidores da fila de eventos da outbox;
- `lock_retries_total`, `deadlocks_total`, `lock_contention_total`: rastreamento de contenção e deadlocks;
- `shutdown_outcomes_total`: resultados de encerramento (`clean_drain`, `timeout_release`, `failure`);
- `sqs_retries_total` e `sqs_dlq_total`: falhas temporárias e roteamento para DLQ;
- `consumer_drain_total`: total de shutdowns com drain de mensagens em voo concluído com sucesso;
- `consumer_visibility_released_total`: mensagens devolvidas com visibilidade 0 durante timeout de encerramento;
- `sqs_redeliveries_total`: total de mensagens recebidas em redelivery (`receiveCount > 1` ou replay);
- `shutdown_failures_total`: encerramentos que excederam o prazo (`SHUTDOWN_GRACE_PERIOD_MS`).

Eventos de log padronizados distinguem `wager_completed`, `wager_replay`, `wager_resolved`, `wager_expired`, `lock_retry`, `shutdown_started`, `shutdown_completed`, `consumer_drain_completed`, `consumer_visibility_released` e `consumer_shutdown_timeout`.

Labels usam baixa cardinalidade. O endpoint `/metrics` suporta negociação de conteúdo (formato texto padrão Prometheus e JSON).

## Dashboards e Métricas

- **Grafana + Prometheus (`compose.yaml`)**: Grafana pré-configurado na porta
  `3001` e Prometheus na porta `9090`. O dashboard provisionado deriva
  throughput e p50/p95/p99 de counters e histogramas, além de mostrar falhas,
  rejeições, conflitos, locks, retries, DLQ, reconciliação e outbox.

No ambiente local, o TSDB do Prometheus é efêmero. Após suspensão do host, um
retrocesso do relógio do Docker pode gerar `out-of-order samples`; com o target
saudável, reiniciar apenas o Prometheus descarta as amostras com timestamp futuro.

## Saúde (Health Checks)

- `GET /health/live`: Liveness verifica o event loop e o processo.
- `GET /health/ready`: Readiness verifica PostgreSQL (pool e query ativa) e LocalStack SQS (list queues).
