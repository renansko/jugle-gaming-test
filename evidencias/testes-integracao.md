# Evidência de testes de integração

## Visão geral e objetivo

```mermaid
flowchart LR
    Tests["Testes"] --> App["Aplicação real"]
    App --> PG["PostgreSQL"]
    App --> SQS["LocalStack SQS"]
```

Comprovar contratos HTTP, persistência, mensageria, DLQ, referências e métricas
contra dependências reais.

## Contexto do problema

```mermaid
flowchart TD
    Unit["Mocks verdes"] --> Risk["Integração ainda desconhecida"]
    Risk --> Real["PostgreSQL + SQS reais"]
    Real --> Proof["Contrato integrado"]
```

Testes isolados não detectam divergências de schema, constraints, ACK, retry ou
serialização na fronteira externa.

## Decisões e trade-offs

```mermaid
flowchart LR
    Fake["Fakes: rápidos"] --> Unit["Cobertura isolada"]
    Containers["Containers: mais lentos"] --> Choice["Prova integrada"]
    Choice --> Confidence["Maior fidelidade"]
```

O custo de containers é aceito no gate para validar as mesmas tecnologias do
ambiente documentado.

## Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Test as Suíte
    participant API as Aplicação
    participant PG as PostgreSQL
    participant SQS as LocalStack
    Test->>API: Envia operação
    API->>PG: Commit financeiro e outbox
    API->>SQS: Publica ou consome evento
    Test->>PG: Confere estado e ledger
    Test->>SQS: Confere ACK, retry ou DLQ
```

## Estrutura e invariantes

```mermaid
flowchart TD
    Tx["Transação"] --> Atomic["Atomicidade"]
    Ledger["Ledger"] --> Reconcile["Reconciliação"]
    Inbox["Inbox"] --> Idempotency["Idempotência"]
    Outbox["Outbox"] --> Delivery["Entrega recuperável"]
```

As verificações relevantes confirmam saldo reconstruível, contagens coerentes
e efeitos financeiros atômicos.

## Resiliência e falhas

```mermaid
flowchart TD
    Message["Mensagem"] --> Valid{"Válida?"}
    Valid -->|"Não"| DLQ["DLQ sem efeito financeiro"]
    Valid -->|"Sim"| Commit{"Commit concluído?"}
    Commit -->|"Não"| Retry["Retry"]
    Commit -->|"Sim"| Ack["ACK"]
```

A suíte diferencia falha transitória, rejeição de domínio e mensagem inválida.

## Evidência verificável

```mermaid
flowchart LR
    Command["bun run test:integration"] --> Result["19 testes aprovados"]
    Result --> Stack["PostgreSQL + LocalStack"]
```

O job `integration` do Action 33703096311 executou `bun run hardening` e aprovou
**19 testes de integração** com PostgreSQL e LocalStack. A contagem não inclui
os quatro testes de concorrência executados em seguida.

## Referências no código

- [Testes de integração](../tests/integration)
- [Harness compartilhado](../tests/support)
- [Workflow de CI](../.github/workflows/ci.yml)
- [Action verde — job `integration`](https://github.com/renansko/jugle-gaming-test/actions/runs/33703096311)
