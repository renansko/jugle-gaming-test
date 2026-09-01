# Padrões Mermaid para a Skill Entenda

Ao gerar diagramas Mermaid nos documentos técnicos, use o padrão mais adequado para a natureza do fluxo:

---

## 1. Fluxo de Execução / Decisão (Flowchart)

Ideal para branches lógicos, pipelines e árvores de decisão.

```mermaid
flowchart TD
    Start([Início da Requisição]) --> Auth{Autenticado?}
    Auth -- Não --> Err401[Retorna 401 Unauthorized]
    Auth -- Sim --> Lock[Adquire Pessimistic Lock na Carteira]
    
    Lock --> CheckFunds{Saldo >= Valor?}
    CheckFunds -- Não --> ErrFunds[Rejeita: INSUFFICIENT_FUNDS]
    CheckFunds -- Sim --> ApplyDebit[Aplica Débito no Saldo]
    
    ApplyDebit --> WriteLedger[Grava WalletLedgerEntry]
    WriteLedger --> WriteOutbox[Grava OutboxEvent]
    WriteOutbox --> Commit[Commit da Transação DB]
    Commit --> Done([Retorna 200 OK])
```

---

## 2. Comunicação entre Serviços e Componentes (Sequence Diagram)

Ideal para fluxos distribuídos, workers, filas (SQS/Kafka), outbox pattern e chamadas HTTP.

```mermaid
sequenceDiagram
    autonumber
    actor Player as Jogador / API Client
    participant API as Wagering API
    participant DB as PostgreSQL
    participant Worker as Outbox Publisher
    participant SQS as AWS SQS

    Player->>API: POST /transactions (Aposta)
    activate API
    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT wallet FOR UPDATE
    API->>DB: UPDATE wallet (balance - valor)
    API->>DB: INSERT INTO ledger_entries
    API->>DB: INSERT INTO outbox_events (Status: PENDING)
    API->>DB: COMMIT
    API-->>Player: 200 OK (Transação Aceita)
    deactivate API

    Note over Worker,DB: Assíncrono / Background Polling
    Worker->>DB: SELECT pending events FOR UPDATE SKIP LOCKED
    Worker->>SQS: Publish Message (Batch)
    SQS-->>Player: Ack (MessageId)
    Worker->>DB: UPDATE outbox_events (Status: PUBLISHED)
```

---

## 3. Máquina de Estados / Ciclo de Vida (State Diagram)

Ideal para transações financeiras, status de pedidos e ciclo de vida de entidades.

```mermaid
stateDiagram-v2
    [*] --> PENDING : Criada
    PENDING --> PROCESSING : Worker pegou para executar
    PROCESSING --> COMPLETED : Sucesso financeiro
    PROCESSING --> FAILED : Erro de negócio / saldo
    PROCESSING --> CANCELLED : Cancelada por timeout
    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

---

## 4. Estrutura de Agregados e Entidades (ER Diagram)

Ideal para demonstrar relacionamentos entre Aggregates e Ledger.

```mermaid
erDiagram
    WALLET ||--o{ WALLET_LEDGER_ENTRY : "possui histórico imutável"
    WALLET ||--o{ WAGER_TRANSACTION : "registra operações"
    WAGER_TRANSACTION ||--o| WALLET_LEDGER_ENTRY : "gera débito/crédito"
    WAGER_TRANSACTION ||--o| OUTBOX_EVENT : "gera evento de integração"

    WALLET {
        uuid id PK
        string player_id
        string currency
        bigint balance_cents
        int version
    }

    WALLET_LEDGER_ENTRY {
        uuid id PK
        uuid wallet_id FK
        uuid transaction_id FK
        string type
        bigint amount_cents
        bigint balance_after_cents
        datetime created_at
    }
```
