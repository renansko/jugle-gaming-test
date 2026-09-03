# WagerTransaction

## Propósito

Representa a intenção do provedor, sua identidade idempotente, eventual referência e resultado auditável.

## Identidade

- ID interno UUIDv7;
- `idempotencyKey` único globalmente;
- `(providerId, externalTransactionId)` único;
- `payloadHash` detecta reutilização divergente.

## Estados e Transições

Os estados da transação são: `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED` e `FAILED`.

### Tabela de Transições Válidas

| Estado de Origem | Estado de Destino | Gatilho / Motivo |
|---|---|---|
| `PENDING` | `PROCESSED` | Operação executada com sucesso (débito/crédito/loss aplicado). |
| `PENDING` | `PENDING_REFERENCE` | Operação dependente (WIN/REFUND/ROLLBACK) chegou antes da transação pai. |
| `PENDING` | `REJECTED` | Rejeição de negócio (ex: saldo insuficiente, regra violada). |
| `PENDING` | `FAILED` | Falha permanente irrecuperável. |
| `PENDING_REFERENCE` | `PROCESSED` | Transação pai encontrada pelo worker e operação concluída. |
| `PENDING_REFERENCE` | `REJECTED` | TTL / limite de tentativas esgotado sem encontrar a referência. |
| `PENDING_REFERENCE` | `FAILED` | Falha permanente durante reprocessamento. |

### Invariantes de Estados Terminais

`PROCESSED`, `REJECTED` e `FAILED` são estritamente **terminais**:
- Qualquer chamada de transição a partir de um estado terminal lança exceção de domínio (`DomainError: INVALID_TRANSACTION_TRANSITION`).
- Tentativas de reexecução de transações terminais com a mesma `idempotencyKey` e `payloadHash` são tratadas como **replay idempotente**, retornando o resultado original persistido sem alterar estado ou recalcular saldo.

- `OPENING` é interno;
- `LOSS` processa sem alterar saldo;
- `REFUND` e `ROLLBACK` exigem referência válida;
- reexecução terminal retorna o resultado original;
- conflito de hash nunca é tratado como replay;
- rejeição persiste `failureCode` estável.

## Resultado original

Persistir o saldo observado após o processamento para que o replay não retorne o saldo atual da wallet.

## Encapsulamento de Domínio e Métodos de Transição

O agregado `WagerTransaction` encapsula todas as transições de estado via métodos de domínio:
- `markProcessed(observedBalance, now)`: avança `PENDING` ou `PENDING_REFERENCE` para `PROCESSED`;
- `markRejected(failureCode, observedBalance, now)`: transiciona para `REJECTED` gravando o código estável;
- `markPendingReference(nextAttemptAt, now)`: transiciona para `PENDING_REFERENCE` agendando busca;
- `linkReference(referenceTransactionId)`: associa id da transação referenciada;
- `clearReferenceLease()`: limpa token e expiração do lease de reprocessamento;
- `scheduleReferenceRetry(nextAttemptAt, leaseUntil)`: incrementa tentativas e define próxima janela.

Qualquer transição direta a partir de estados terminais é bloqueada com `DomainError`.

## Mapeamento de Persistência

A camada de persistência MikroORM é desacoplada através de `wagerTransactionToDomain` e `wagerTransactionToPersistence` (`src/infrastructure/persistence/mappers/wager-transaction.mapper.ts`). O serviço de aplicação nunca muta diretamente propriedades de entidade ORM.

## Código

`src/domain/wagering/wager-transaction.ts` e mappers em `src/infrastructure/persistence/mappers/`.
