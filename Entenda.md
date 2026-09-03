# Arquitetura: Distributed Wagering Processor

> **Resumo**: Motor transacional financeiro para processamento concorrente de apostas e prêmios com garantia estrita de consistência monetária, idempotência de ponta a ponta e persistência transacional de mensageria (Outbox/Inbox).

---

## 1. Visão Geral & Escopo do Sistema

O sistema gerencia carteiras de jogadores e executa débitos (apostas), créditos (vitórias/reembolsos) e reconciliação contínua, unificando entradas síncronas (HTTP) e assíncronas (SQS).

```mermaid
graph LR
    subgraph Clientes["Clientes & Provedores"]
        Web["API / Mobile"]
        SQSQueue["Fila AWS SQS (FIFO)"]
    end

    subgraph Core["Núcleo Modular NestJS"]
        API["HTTP Controllers"]
        Consumer["SqsWagerConsumer"]
        Service["WageringService (Core Financeiro)"]
        Publisher["OutboxPublisher (Worker)"]
        Recon["ReconciliationService"]
    end

    subgraph DB["PostgreSQL 16 (Fonte da Verdade)"]
        Wallets[("Wallets")]
        Ledger[("WalletLedgerEntries")]
        Tx[("WagerTransactions")]
        Outbox[("OutboxMessages")]
        Inbox[("InboxMessages")]
    end

    Web --> API
    SQSQueue --> Consumer
    API --> Service
    Consumer --> Service
    Service --> Wallets
    Service --> Ledger
    Service --> Tx
    Service --> Outbox
    Service --> Inbox
    Publisher --> Outbox
    Publisher -.->|Publica Eventos| SQSQueue
    Recon -.->|Auditoria| Wallets
    Recon -.->|Auditoria| Ledger
```

---

## 2. Contexto do Problema: O que Acontece Sem Esse Design?

Sem os mecanismos de lock pessimista por linha e outbox transacional, dois problemas críticos de sistemas financeiros ocorrem:

### A. Condição de Corrida (Gasto Duplo)
```mermaid
sequenceDiagram
    autonumber
    actor P1 as Requisição 1 (Aposta R$ 50)
    actor P2 as Requisição 2 (Aposta R$ 50)
    participant DB as Banco sem Lock (Saldo: R$ 50)

    Note over P1,P2: Chegam no mesmo milissegundo
    P1->>DB: 1. SELECT balance (Retorna R$ 50 - Saldo OK)
    P2->>DB: 2. SELECT balance (Retorna R$ 50 - Saldo OK)
    P1->>DB: 3. UPDATE balance = 50 - 50 = R$ 0
    P2->>DB: 4. UPDATE balance = 50 - 50 = R$ 0 (ou -R$ 50)
    Note over DB: CORRUPÇÃO: O jogador apostou R$ 100 com apenas R$ 50!
```

### B. Dual-Write Inconsistente (Mensageria Desconectada do Banco)
```mermaid
sequenceDiagram
    autonumber
    participant App as Aplicação
    participant DB as PostgreSQL
    participant SQS as Fila SQS

    App->>DB: 1. UPDATE wallet (Debita R$ 50)
    App->>DB: 2. COMMIT
    App-xSQS: 3. Publica Evento (FALHA DE REDE / CRASH!)
    Note over App,SQS: O dinheiro foi debitado, mas nenhum outro serviço sabe da aposta.
```

---

## 3. Decisões de Arquitetura & Trade-offs

| Decisão Adotada | Alternativa Rejeitada | Justificativa / Trade-off |
| :--- | :--- | :--- |
| **Lock Pessimista no SQL (`FOR UPDATE` por Wallet)** | Lock Otimista (`version++`) | O lock pessimista serializa transações da **mesma carteira**, evitando overhead de retries em alta contenção. Carteiras distintas executam 100% paralelas. |
| **Transactional Outbox & Inbox** | Publicação direta no SQS durante o request | Garante atomicidade Dual-Write: a mensagem só é enviada se a transação do banco for commitada com sucesso. |
| **Ledger Append-Only (Livro-Razão)** | Apenas atualizar a coluna `balance` | Permite rastreabilidade contábil imutável e reconciliação matemática: `wallet.balance == SUM(ledger)`. |
| **Precisão `decimal.js` + `numeric(20,2)`** | Tipos `number` / `float` IEEE 754 | Elimina risco de dízimas periódicas e perda de centavos em operações aritméticas. |

```mermaid
flowchart TD
    subgraph EscolhaConcorrencia["Estratégia de Concorrência"]
        Req["Nova Transação"] --> CheckStrategy{"Qual o modelo de Lock?"}
        CheckStrategy -->|Lock Otimista| Opt["Muitos conflitos sob alta taxa de cliques -> CPU e latência altas (Descartado)"]
        CheckStrategy -->|Lock Pessimista na Linha| Pess["SELECT ... FOR UPDATE por wallet_id -> Zero retries, isolamento perfeito (Adotado)"]
    end

    subgraph EscolhaMensageria["Estratégia de Mensageria"]
        OutboxDecision{"Como garantir entrega?"}
        OutboxDecision -->|Publicar Direto| Direct["Risco de evento sem commit ou commit sem evento (Descartado)"]
        OutboxDecision -->|Transactional Outbox| OutboxPattern["Mesma transação SQL do débito -> Zero inconsistência (Adotado)"]
    end
```

---

## 4. Fluxo Visual de Execução Ponta a Ponta

```mermaid
sequenceDiagram
    autonumber
    actor Player as Provedor / Cliente
    participant API as API / SQS Consumer
    participant Service as WageringService
    participant DB as PostgreSQL (ACID)
    participant Publisher as Outbox Publisher Worker
    participant SQS as AWS SQS

    Player->>API: 1. POST /transactions (idempotency_key, amount)
    API->>Service: 2. ProcessWagerTransaction()
    
    activate Service
    Service->>DB: 3. BEGIN TRANSACTION
    Service->>DB: 4. Valida Idempotência (idempotency_key + payload_hash)
    Service->>DB: 5. SELECT wallet WHERE id = :id FOR UPDATE (Trava a Carteira)
    
    alt Saldo Insuficiente
        Service->>DB: Registra Rejeição Auditável & ROLLBACK
        Service-->>API: 422 Unprocessable Entity (INSUFFICIENT_FUNDS)
        API-->>Player: Aposta Recusada
    else Saldo Válido
        Service->>DB: 6. UPDATE wallet SET balance = balance - amount
        Service->>DB: 7. INSERT INTO wallet_ledger_entries (Append-Only)
        Service->>DB: 8. INSERT INTO wager_transactions (Status: COMPLETED)
        Service->>DB: 9. INSERT INTO outbox_messages (Status: PENDING)
        Service->>DB: 10. COMMIT (Unit of Work Atômico)
        Service-->>API: 11. Transação Confirmada
        API-->>Player: 12. 200 OK (Saldo Atualizado)
    end
    deactivate Service

    Note over DB,Publisher: Processamento Assíncrono Desacoplado
    Publisher->>DB: 13. SELECT outbox FOR UPDATE SKIP LOCKED
    Publisher->>SQS: 14. Publica Mensagem (Batch)
    SQS-->>Publisher: 15. ACK do SQS
    Publisher->>DB: 16. UPDATE outbox SET status = 'PUBLISHED'
```

---

## 5. Modelo de Dados & Ciclo de Vida das Entidades

### A. Modelo Entidade-Relacionamento
```mermaid
erDiagram
    WALLETS ||--o{ WALLET_LEDGER_ENTRIES : "possui histórico imutável"
    WALLETS ||--o{ WAGER_TRANSACTIONS : "recebe operações financeiras"
    WAGER_TRANSACTIONS ||--o| WALLET_LEDGER_ENTRIES : "gera lançamento contábil"
    WAGER_TRANSACTIONS ||--o| OUTBOX_MESSAGES : "gera evento de integração"

    WALLETS {
        uuid id PK
        string player_id UK
        string currency UK
        numeric balance "CHECK (balance >= 0)"
        int version
        datetime updated_at
    }

    WALLET_LEDGER_ENTRIES {
        uuid id PK
        uuid wallet_id FK
        uuid transaction_id FK
        string type "DEBIT / CREDIT"
        numeric amount
        numeric balance_after
        datetime created_at
    }

    WAGER_TRANSACTIONS {
        uuid id PK
        string idempotency_key UK
        string provider_id UK
        string external_transaction_id UK
        string status "PENDING / COMPLETED / REJECTED"
        string payload_hash "SHA-256"
        numeric amount
    }

    OUTBOX_MESSAGES {
        uuid id PK
        string event_type
        jsonb payload
        string status "PENDING / PUBLISHED / FAILED"
        datetime next_attempt_at
    }

    INBOX_MESSAGES {
        string consumer_name PK
        string message_id PK
        datetime processed_at
    }
```

### B. Máquina de Estados da Transação
```mermaid
stateDiagram-v2
    [*] --> PENDING_VALIDATION : Chegada da Requisição
    
    PENDING_VALIDATION --> COMPLETED : Saldo suficiente e referência válida
    PENDING_VALIDATION --> REJECTED : Saldo insuficiente ou regra de negócio
    PENDING_VALIDATION --> PENDING_REFERENCE : Transação pai (BET) ainda não chegou
    
    PENDING_REFERENCE --> COMPLETED : Transação pai resolvida pelo Worker
    PENDING_REFERENCE --> REJECTED : Timeout de resolução de referência expirado
    
    COMPLETED --> [*]
    REJECTED --> [*]
```

---

## 6. Resiliência e Árvore de Decisão de Falhas

```mermaid
flowchart TD
    Start([Mensagem Recebida do SQS]) --> CheckInbox{Mensagem já está na tabela Inbox?}
    
    CheckInbox -- Sim (Mensagem Repetida) --> AckImmediate[Envia ACK imediato ao SQS e encerra]
    CheckInbox -- Não (Mensagem Nova) --> StartTx[Abre Transação PostgreSQL]
    
    StartTx --> CheckIdempotency{Idempotency Key já existe?}
    CheckIdempotency -- Sim & Hash Idêntico --> ReturnSaved[Retorna resultado anterior + Registra Inbox]
    CheckIdempotency -- Sim & Hash Diferente --> RejectConflict[Rejeita com IDEMPOTENCY_CONFLICT]
    CheckIdempotency -- Não --> LockWallet[SELECT wallet FOR UPDATE]
    
    LockWallet --> CheckBalance{Saldo >= Valor?}
    CheckBalance -- Não --> BusinessReject[Registra Transação REJECTED + Commit + ACK]
    CheckBalance -- Sim --> ApplyDebit[Aplica Débito + Ledger + Outbox + Inbox]
    
    ApplyDebit --> CommitDB{Commit no Banco Teve Sucesso?}
    CommitDB -- Sim --> SendAck[Envia ACK ao SQS]
    CommitDB -- Falha Infra / DB Fora --> Rollback[ROLLBACK total + SQS reentrega com Backoff]
    
    Rollback --> MaxRetries{Excedeu limite de tentativas?}
    MaxRetries -- Sim --> MoveDLQ[Encaminha para Dead Letter Queue - DLQ]
    MaxRetries -- Não --> RetryLater[Aguardar visibilidade da fila]
```

---

## 7. Referências e Arquivos do Projeto

- [ARCHITECTURE.md](ARCHITECTURE.md) — Diretrizes arquiteturais gerais.
- [docs/brain/index.md](docs/brain/index.md) — Índice de contratos e invariantes do sistema.
- [docs/brain/conventions/Concurrency.md](docs/brain/conventions/Concurrency.md) — Estratégia de concorrência e isolamento.
- [docs/brain/conventions/Idempotency.md](docs/brain/conventions/Idempotency.md) — Padrão de idempotência e hash canônico.
- [docs/brain/services/MessagingWorkers.md](docs/brain/services/MessagingWorkers.md) — Especificação dos workers de fila e outbox.
- [docs/DELIVERY_PLAN.md](docs/DELIVERY_PLAN.md) — Fases de entrega e critérios de aceite.
