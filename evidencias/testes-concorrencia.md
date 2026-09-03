# Evidência de testes de concorrência

## Visão geral e objetivo

```mermaid
flowchart LR
    Requests["Requisições paralelas"] --> Apps["3 réplicas"]
    Apps --> Lock["Lock por wallet"]
    Lock --> PG["PostgreSQL"]
```

Provar idempotência e invariantes financeiras sob disputa real entre pelo menos
três réplicas da aplicação.

## Contexto do problema

```mermaid
sequenceDiagram
    participant A as Réplica A
    participant B as Réplica B
    participant DB as Wallet
    A->>DB: Tenta debitar
    B->>DB: Tenta debitar
    DB-->>A: Uma decisão serializada
    DB-->>B: Replay ou rejeição coerente
```

Sem coordenação no banco, requisições simultâneas poderiam duplicar débitos ou
produzir saldo negativo.

## Decisões e trade-offs

```mermaid
flowchart LR
    Process["Um processo"] --> Simple["Mais simples"]
    Replicas["3 réplicas reais"] --> Choice["Fidelidade distribuída"]
    Choice --> Cost["Gate mais caro"]
```

O Compose remove a porta host da aplicação e distribui chamadas pelo DNS
interno, aceitando maior tempo de execução para evitar uma falsa prova local.

## Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Test as Suíte
    participant Apps as 3 réplicas
    participant PG as PostgreSQL
    Test->>Apps: Dispara operações paralelas
    Apps->>PG: Disputam locks e unicidade
    PG-->>Apps: Serializa efeitos
    Test->>PG: Reconstrói saldos pelo ledger
    PG-->>Test: Invariantes preservadas
```

## Estrutura e invariantes

```mermaid
stateDiagram-v2
    [*] --> Pendente
    Pendente --> Processada: Uma operação válida
    Pendente --> Rejeitada: Saldo insuficiente
    Processada --> [*]: Um único efeito
    Rejeitada --> [*]: Nenhum débito
```

Retry idêntico produz um débito; duas apostas de 80 sobre saldo 100 deixam uma
processada e outra rejeitada; wallets distintas avançam em paralelo.

## Resiliência e falhas

```mermaid
flowchart TD
    Parallel["Disputa paralela"] --> Outcome{"Resultado"}
    Outcome --> Replay["Replay idempotente"]
    Outcome --> Rejection["Rejeição de negócio"]
    Outcome --> Failure["Falha técnica"]
    Replay --> Reconcile["Reconciliação final"]
    Rejection --> Reconcile
    Failure --> Red["Gate falha"]
```

Falhas técnicas permanecem separadas de rejeições válidas e conflitos
idempotentes.

## Evidência verificável

```mermaid
flowchart LR
    Command["bun run test:concurrency"] --> Result["4 testes aprovados"]
    Result --> Replicas["3 réplicas saudáveis"]
```

O job `integration` do Action 33697194049 aprovou **4 testes de concorrência**
em três réplicas, incluindo a reconciliação matemática do banco.

## Referências no código

- [Testes de concorrência](../tests/concurrency)
- [Compose de hardening](../compose.hardening.yaml)
- [Convenção de concorrência](../docs/brain/conventions/Concurrency.md)
- [Action verde — job `integration`](https://github.com/renansko/jugle-gaming-test/actions/runs/33697194049)
