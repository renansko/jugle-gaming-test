# Observability

## Logs

JSON estruturado com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`. Não registrar payload completo, saldo, credenciais ou PII desnecessária.

## OpenTelemetry & Métricas

Instrumentação baseada no OpenTelemetry API (`@opentelemetry/api`) através de [OpenTelemetryBridge](../../../src/infrastructure/observability/opentelemetry.ts).

### Instrumentos e Séries:
- `wager_transactions_total`: contador de transações por `kind` e `status`;
- `idempotency_replays_total`: contador de replays idempotentes bem-sucedidos;
- `reconciliation_divergences_total`: contador de divergências detectadas;
- `wallet_lock_duration_ms`: gauge do tempo sob lock `PESSIMISTIC_WRITE`;
- `wager_processing_latency_ms`: gauge de latência do processamento financeiro;
- `outbox_pending` e `outbox_lag_ms`: medidores da fila de eventos da outbox.

Labels usam baixa cardinalidade. O endpoint `/metrics` suporta negociação de conteúdo (formato texto padrão Prometheus e JSON).

## Dashboards Visuais

- **Dashboard Web Embutido (`/dashboard`)**: UI responsiva (Dark Mode, Glassmorphism) servida diretamente pelo NestJS na porta `3000`, atualizada em tempo real a cada 2s via polling de `/metrics` e `/health/ready`.
- **Grafana + Prometheus (`compose.yaml`)**: Grafana pré-configurado na porta `3001` e Prometheus na porta `9090` com scrapers e dashboard JSON provisionado.

## Saúde (Health Checks)

- `GET /health/live`: Liveness verifica o event loop e o processo.
- `GET /health/ready`: Readiness verifica PostgreSQL (pool e query ativa) e LocalStack SQS (list queues).
