# Evidência de carga curta — issue #13

## Visão geral e objetivo

```mermaid
flowchart LR
    Runner["Cliente Bun"] --> Apps["3 réplicas"]
    Apps --> PG["PostgreSQL"]
    Apps --> SQS["LocalStack"]
    Prom["Prometheus"] --> Apps
    Prom --> Grafana["Grafana"]
```

Medir uma carga curta reproduzível e confirmar que desempenho observado não
compromete as invariantes financeiras.

## Contexto do problema

```mermaid
flowchart TD
    Throughput["Throughput alto"] --> Question{"Estado financeiro correto?"}
    Question -->|"Não"| Invalid["Resultado inválido"]
    Question -->|"Sim"| Evidence["Desempenho + invariantes"]
```

RPS e percentis isolados não constituem sucesso quando há falha técnica,
outbox pendente ou divergência entre wallet e ledger.

## Decisões e trade-offs

```mermaid
flowchart LR
    Threshold["Meta fixa de RPS"] --> Reject["Descartada"]
    Report["Medição honesta"] --> Choice["Escolhida"]
    Choice --> Limits["Ambiente e limitações explícitos"]
```

Não há meta mínima de RPS. O gate falha por erro técnico, quebra de invariante
ou outbox sem convergência.

## Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Runner as test:load
    participant Apps as 3 réplicas
    participant DB as PostgreSQL
    participant Metrics as Prometheus
    Runner->>Apps: Aquece por 2 s
    Runner->>Apps: Mede por 10 s, concorrência 8
    Apps->>DB: Persiste operações e outbox
    Runner->>Metrics: Captura sinais internos
    Runner->>DB: Confere contagens e reconciliação
```

## Estrutura e invariantes

```mermaid
flowchart TD
    Operations["1.284 operações"] --> Transactions["1.284 transações"]
    Transactions --> Ledger["1.164 lançamentos"]
    Transactions --> Outbox["2.440 eventos"]
    Ledger --> Reconcile["8 wallets reconciliadas"]
    Outbox --> Converge["Pendência final zero"]
```

As fórmulas de contagem e `wallet.balance == saldo reconstruído pelo ledger`
foram verificadas automaticamente ao término.

## Resiliência e falhas

```mermaid
flowchart TD
    Outcome{"Resultado da operação"} --> Success["Sucesso: 885"]
    Outcome --> Rejection["Rejeição: 109"]
    Outcome --> Conflict["Conflito: 290"]
    Outcome --> Technical["Falha técnica: 0"]
    Technical --> Gate{"Zero e invariantes válidas?"}
    Gate -->|"Sim"| Green["Exit code 0"]
```

Categorias de resultado permanecem separadas para não classificar rejeições de
negócio ou conflitos idempotentes como indisponibilidade técnica.

## Evidência verificável

```mermaid
flowchart LR
    Run["Execução 2026-09-02"] --> Rate["128,4 ops/s"]
    Run --> P50["p50 61,78 ms"]
    Run --> P95["p95 106,37 ms"]
    Run --> P99["p99 127,06 ms"]
    Run --> Exit["Exit code 0"]
```

O relatório versionado registra commit, ambiente, massa isolada, comandos,
metodologia, 1.284 operações e convergência da outbox de pico 1.418 para zero.
São métricas locais do cliente, não um SLO de produção.

## Referências no código

- [Relatório completo](../docs/load/short-load-report.md)
- [Runner de carga](../scripts/load/run-short-load.ts)
- [Contrato do relatório](../scripts/load/load-report.ts)
- [Dashboard Grafana](../docker/grafana/provisioning/dashboards/wagering-dashboard.json)
- [Issue #13](https://github.com/renansko/jugle-gaming-test/issues/13)
