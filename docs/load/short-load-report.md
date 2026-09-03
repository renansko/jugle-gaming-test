# Relatório de carga curta no GitHub Actions

Commit: `db917b04ee9923b652ada190524852b6c6239489`

Execução: [GitHub Actions 33697194049](https://github.com/renansko/jugle-gaming-test/actions/runs/33697194049)
Exit code: `0`

```mermaid
flowchart LR
    Runner["Cliente Bun"] --> Apps["3 réplicas"]
    Apps --> PG["PostgreSQL 16.14"]
    Apps --> SQS["LocalStack 3.8.1"]
    Prom["Prometheus"] --> Apps
    Prom --> Grafana["Grafana"]
    PG --> Check["Contagens + reconciliação"]
```

## Ambiente e método

- Linux Azure `6.17.0-1022-azure`, 2 CPUs AMD EPYC 9V74 e 8,32 GB de RAM;
- Bun 1.1.38 e Docker 28.0.4;
- aquecimento de 2 s, medição de 10 s e concorrência 8;
- massa isolada `load-2026-09-02T23-56-09-837Z-2b12f4f4`;
- mistura: BETs aceitas, saldo insuficiente, replay exato e conflito idempotente;
- término por duração; falha técnica, divergência ou outbox não convergente falha o job;
- nenhuma meta mínima de RPS.

## Resultado do cliente

| operações | ops/s | p50 | p95 | p99 | sucesso | rejeição | conflito | falha técnica |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.001 | 100,1 | 70,80 ms | 175,90 ms | 282,40 ms | 730 | 91 | 180 | 0 |

## Sinais internos e invariantes

- pico de `outbox_pending`: 903; valor final: 0; `outbox_lag_ms` final: 0;
- 1.001 transações da massa, sendo 901 processadas e 100 rejeitadas;
- 909 lançamentos de ledger e 1.902 eventos de outbox, iguais às fórmulas esperadas;
- `inbox_messages = 0`, esperado porque esta carga usa o canal HTTP;
- oito wallets reconciliadas com `wallet.balance == saldo reconstruído pelo ledger`.

As latências e o throughput acima são do cliente. As séries do Prometheus são
internas à aplicação e aparecem no dashboard provisionado do Grafana. O ensaio
é curto, local e sensível à contenção do host; não representa capacidade de
produção nem estabelece um SLO.
