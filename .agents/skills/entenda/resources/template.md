# {Nome do Componente / Arquitetura}

> **Resumo**: {Descrição técnica direta em 1-2 linhas sobre a responsabilidade do módulo}.

---

## 1. Visão Geral & Escopo

{Descrição do papel do componente e seus limites arquiteturais.}

```mermaid
graph LR
    subgraph Entrada["Portas de Entrada"]
        HTTP[API HTTP]
        Queue[Consumidor SQS]
    end
    subgraph Core["Núcleo da Aplicação"]
        AppService["Serviço Principal"]
        Domain["Regras de Domínio"]
    end
    subgraph Persistencia["Persistência & Mensageria"]
        Postgres[("PostgreSQL")]
        OutboxQueue["Fila de Eventos"]
    end
    HTTP --> AppService
    Queue --> AppService
    AppService --> Domain
    AppService --> Postgres
    AppService --> OutboxQueue
```

---

## 2. Contexto do Problema & Riscos Evitados

{Explicação dos desafios de concorrência, consistência ou falhas.}

```mermaid
sequenceDiagram
    autonumber
    Note over Cliente1,Cliente2: Cenário de Concorrência sem a Solução
    Cliente1->>DB: Lê Saldo (R$ 50)
    Cliente2->>DB: Lê Saldo (R$ 50)
    Cliente1->>DB: Debita R$ 50 (Saldo vira R$ 0)
    Cliente2->>DB: Debita R$ 50 (Saldo vira -R$ 50 - CORRUPÇÃO!)
```

---

## 3. Decisões de Arquitetura & Trade-offs

| Decisão Adotada | Alternativa Rejeitada | Justificativa / Trade-off |
| :--- | :--- | :--- |
| **{Escolha A}** | {Alternativa B} | {Motivo técnico do trade-off} |

```mermaid
flowchart TD
    Req[Requisição de Transação] --> LockType{Qual estratégia de Lock?}
    LockType -->|Lock Otimista| Opt["Alta contenção gera muitos Retries (Rejeitado)"]
    LockType -->|Lock Pessimista por Linha| Pess["Serializa só a carteira em questão, zero retries (Adotado)"]
```

---

## 4. Fluxo Visual de Execução Ponta a Ponta

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / Produtor
    participant API as Gateway / Controller
    participant Service as Serviço de Aplicação
    participant DB as PostgreSQL
    participant Worker as Worker Assíncrono

    Client->>API: 1. Envia Comando
    API->>Service: 2. Processa Transação
    Service->>DB: 3. BEGIN & Lock na Entidade
    Service->>DB: 4. Persiste Entidade + Ledger + Outbox
    Service->>DB: 5. COMMIT
    Service-->>API: 6. Sucesso
    API-->>Client: 7. Resposta 200 OK
    Worker->>DB: 8. Drena Outbox (SKIP LOCKED)
```

---

## 5. Modelo de Dados & Invariantes

### Estrutura de Agregados
```mermaid
erDiagram
    WALLET ||--o{ WALLET_LEDGER_ENTRY : "histórico imutável"
    WALLET ||--o{ WAGER_TRANSACTION : "transações"
    WAGER_TRANSACTION ||--o| OUTBOX_MESSAGE : "evento gerado"

    WALLET {
        uuid id PK
        string player_id
        string currency
        numeric balance
    }
    WALLET_LEDGER_ENTRY {
        uuid id PK
        uuid wallet_id FK
        numeric amount
        numeric balance_after
    }
```

---

## 6. Resiliência e Árvore de Decisão de Falhas

```mermaid
flowchart TD
    In[Mensagem Recebida] --> CheckInbox{Existe no Inbox?}
    CheckInbox -- Sim --> AckDup[Descarta e envia ACK imediato]
    CheckInbox -- Não --> Exec[Executa Transação Financeira]
    
    Exec --> Success{Sucesso?}
    Success -- Sim --> CommitAll[Commit DB + ACK no SQS]
    Success -- Falha Negócio --> PersistReject[Persiste Rejeição + ACK]
    Success -- Falha Infra --> RollbackRetry[Rollback + Reentrega / DLQ]
```

---

## 7. Referências e Arquivos Relacionados

- [`src/...`](file:///absolute/path/to/file.ts) — {Papel do arquivo}
- [`docs/brain/...`](file:///absolute/path/to/doc.md) — {Documento de decisão}
