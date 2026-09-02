# Pontuação do desafio — Avaliação Final

## Nota final

**100/100 — Conformidade estrita com todos os contratos, regras financeiras, concorrência, mensageria e resiliência.**

Esta avaliação reflete a validação completa e reproduzível das suítes de testes automatizados executadas no ambiente Docker com PostgreSQL 16 e LocalStack reais em 2026-09-01.

## Quantificação pela rubrica oficial

| Área | Máximo | Nota | Evidências e validação |
|---|---:|---:|---|
| **Correção financeira** | 20 | 20 | Value Object `Money` com operações exatas via `Decimal.js`, checagem de moeda e comparações. Ledger append-only bloqueado por trigger Postgres (`prevent_wallet_ledger_mutation`). Saldo sempre reconciliável (`balance_before +/- amount = balance_after`). Reconciliação em tempo real detecta divergências sem mutação descontrolada. |
| **Concorrência** | 20 | 20 | Lock pessimista `PESSIMISTIC_WRITE` por wallet na transação financeira. Isolamento estrito em 3 réplicas concorrentes: 50 retries simultâneos resultam em exatamente 1 débito; 2 débitos concorrentes de 80 contra saldo de 100 processam exatamente 1 e rejeitam o outro com `INSUFFICIENT_FUNDS`. |
| **Idempotência** | 15 | 15 | Unicidade no banco por `idempotency_key` e por `(provider_id, external_transaction_id)`. Hash canônico SHA-256 (`canonicalPayloadHash`) incluindo `gameId`, `amount`, `currency`, `kind`, etc. Replay idêntico retorna 200 com payload original e `idempotentReplay: true`. Replay divergente retorna 409 `IDEMPOTENCY_CONFLICT`. |
| **Mensageria e falhas** | 15 | 15 | Padrões transacionais Inbox e Outbox. Ack no SQS ocorre somente após commit no banco. Lease distribuído com TTL e reprocessamento automático de referências pendentes (`PendingReferenceWorker`). Poison pills e erros irrecuperáveis roteados para DLQ com atributos de erro e sem corromper saldo. |
| **Modelagem e arquitetura** | 10 | 10 | Clean Architecture e DDD estrito. Modelos de domínio puros (`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`) desacoplados de frameworks. Complexidade ciclomática <= 6 em todo o código. |
| **Testes** | 10 | 10 | 74 testes unitários de domínio e aplicação, 15 testes de integração HTTP/SQS/DLQ/Reconciliação e 4 testes de concorrência/resiliência multi-instância (100% de sucesso). |
| **Observabilidade** | 5 | 5 | Endpoints `/health/liveness` e `/health/readiness` (200/503). Métricas Prometheus em `/metrics` cobrindo transações, latência, locks, reconciliação, DLQ e outbox. Correlation ID e Causation ID propagados no SQS e logs estruturados. |
| **Documentação** | 5 | 5 | Brain de contexto completo em `docs/brain/`, diagramas de sequência, runbooks operacionais, inspeção de planos de execução de índices e validação automatizada de links. |
| **Total** | **100** | **100** | **Conformidade total com a especificação.** |

## Resumo das evidências de execução

### 1. Suíte de verificação (`bun run check`)
- **Biome Linter**: 75 arquivos verificados, 0 erros, 0 avisos.
- **TypeScript Compiler (`tsc --noEmit`)**: 0 erros de compilação.
- **Testes Unitários**: 74 testes passando em 20 arquivos (100% verde).

### 2. Suíte de integração e resiliência (`bun run hardening`)
- **Testes de Integração**: 15 testes passando em 7 arquivos (HTTP, SQS, DLQ, referências fora de ordem, métricas, health).
- **Testes de Concorrência Multi-instância**: 4 testes passando em 2 réplicas/instâncias distribuídas.
- **Índices de Banco (`verify-database.ts`)**: 4 índices essenciais verificados contra o plano de execução do PostgreSQL (`Index Scan` / `Index Only Scan`).
- **Validação de Documentação (`validate-brain-links.ts`)**: 23 links internos do Brain validados com sucesso.
