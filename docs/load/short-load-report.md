# Relatório de carga curta — issue #13

Commit-base: `e7c6159a852ab76e8cd675a3344f1a6289b14cf1`

Execução: 2026-09-02
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

- Linux WSL2 `6.6.87.2`, 16 CPUs AMD Ryzen 7 5800H, 8,25 GB de RAM;
- Bun 1.1.38 e Docker 29.6.2;
- aquecimento de 2 s, medição de 10 s e concorrência 8;
- massa isolada `load-2026-09-02T23-28-14-312Z-24742286`;
- mistura: BETs aceitas, saldo insuficiente, replay exato e conflito idempotente;
- término por duração; falha técnica, divergência ou outbox não convergente falha o job;
- nenhuma meta mínima de RPS.

## Resultado do cliente

| operações | ops/s | p50 | p95 | p99 | sucesso | rejeição | conflito | falha técnica |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.284 | 128,4 | 61,78 ms | 106,37 ms | 127,06 ms | 885 | 109 | 290 | 0 |

## Sinais internos e invariantes

- pico de `outbox_pending`: 1.418; valor final: 0; `outbox_lag_ms` final: 0;
- 1.284 transações da massa, sendo 1.156 processadas e 128 rejeitadas;
- 1.164 lançamentos de ledger e 2.440 eventos de outbox, iguais às fórmulas esperadas;
- `inbox_messages = 0`, esperado porque esta carga usa o canal HTTP;
- oito wallets reconciliadas com `wallet.balance == saldo reconstruído pelo ledger`.

As latências e o throughput acima são do cliente. As séries do Prometheus são
internas à aplicação e aparecem no dashboard provisionado do Grafana. O ensaio
é curto, local e sensível à contenção do host; não representa capacidade de
produção nem estabelece um SLO.
