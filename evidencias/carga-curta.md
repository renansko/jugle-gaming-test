# Evidência de carga curta

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
    Operations["1.001 requisições"] --> Transactions["1.001 transações"]
    Transactions --> Ledger["909 lançamentos"]
    Transactions --> Outbox["1.902 eventos"]
    Ledger --> Reconcile["8 wallets reconciliadas"]
    Outbox --> Converge["Pendência final zero"]
```

As fórmulas de contagem e `wallet.balance == saldo reconstruído pelo ledger`
foram verificadas automaticamente ao término.

## Resiliência e falhas

```mermaid
flowchart TD
    Outcome{"Resultado da operação"} --> Success["Sucesso: 730"]
    Outcome --> Rejection["Rejeição: 91"]
    Outcome --> Conflict["Conflito: 180"]
    Outcome --> Technical["Falha técnica: 0"]
    Technical --> Gate{"Zero e invariantes válidas?"}
    Gate -->|"Sim"| Green["Exit code 0"]
```

Categorias de resultado permanecem separadas para não classificar rejeições de
negócio ou conflitos idempotentes como indisponibilidade técnica.

## Evidência verificável

```mermaid
flowchart LR
    Run["Action 33697194049"] --> Rate["100,1 req/s"]
    Run --> P50["p50 70,80 ms"]
    Run --> P95["p95 175,90 ms"]
    Run --> P99["p99 282,40 ms"]
    Run --> Exit["Exit code 0"]
```

O artefato do Action registra commit, ambiente, massa isolada, comandos,
metodologia, 1.001 requisições e convergência da outbox de pico 903 para zero.
São métricas do runner hospedado pelo GitHub, não um SLO de produção.

## Referências no código

- [Relatório completo](../docs/load/short-load-report.md)
- [Runner de carga](../scripts/load/run-short-load.ts)
- [Contrato do relatório](../scripts/load/load-report.ts)
- [Dashboard Grafana](../docker/grafana/provisioning/dashboards/wagering-dashboard.json)
- [Action verde — job `load-test`](https://github.com/renansko/jugle-gaming-test/actions/runs/33697194049)
