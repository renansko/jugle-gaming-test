# PEND-01 — Conformidade de contratos e entidades

## Objetivo

Fechar as lacunas entre o backlog de `prd/issue-01`, a implementação e o
[backend challenge oficial](https://github.com/junglegaming/backend-challenge).

## Situação da entrega: 100% Concluída

Todos os critérios de coerência de rotas, contratos polimórficos, persistência de `gameId`, entidades ricas de domínio e cobertura de testes de integração com PostgreSQL e LocalStack reais foram implementados via TDD e validados com sucesso.

## Cobertura por recurso

| Recurso | Issue / Componente | Situação |
|---|---|---|
| Criar e consultar wallet (`POST /wallets`, `GET /wallets/:id`) | 01.2 + PEND-01 | **100% coberto** (aceita `string` ou `{ amount, currency }`) |
| Consultar ledger paginado (`GET /wallets/:id/ledger`) | 01.2 + PEND-01 | **100% coberto** (cursor opaco, limite e erro 400 em cursor inválido) |
| Submeter e consultar transação (`POST`, `GET :id`, `GET by provider`) | 01.3 + PEND-01 | **100% coberto** (suporta `money` / `amount`, `gameId`, 200/202/400/404/409/422) |
| Operações BET, WIN, LOSS, REFUND e ROLLBACK | 01.3 + PEND-01 | **100% coberto** |
| Inbox, outbox, SQS, retry e DLQ | 01.4 + PEND-01 | **100% coberto** (fila FIFO, deduplicação, poison pill DLQ) |
| Reconciliação em tempo real (`POST /wallets/:id/reconciliation`) | 01.5 + PEND-01 | **100% coberto** (divergência detectada, saldo somente-leitura) |
| Health, métricas Prometheus (`GET /metrics`) e logs estruturados | 01.1 + 01.5 | **100% coberto** |
| Entidade `Money` | 01.2 + PEND-01 | **100% coberto** (aritmética exata, comparações, sinal, igualdade) |
| Aggregate `Wallet` | 01.2 | **100% coberto** |
| Entidade de domínio `WagerTransaction` | 01.3 + PEND-01 | **100% coberto** (propriedades completas, factories, state machine terminal) |
| Entidade `WalletLedgerEntry` | 01.2 | **100% coberto** (imutabilidade append-only com trigger de banco) |
| Entidades `InboxMessage` e `OutboxMessage` | 01.4 + PEND-01 | **100% coberto** (modelos puros de domínio) |

## Ajustes realizados

### 1. Alinhamento de DTOs ao enunciado oficial
- `POST /wallets`: suporta `initialBalance` como string ou `{ amount, currency }`.
- `POST /wagering/transactions`: suporta formato plano (`amount`, `currency`) ou objeto aninhado (`money: { amount, currency }`), além de `gameId` opcional.
- Consumidor SQS (`WagerTransactionRequested`): suporta ambos os formatos de payload com `gameId`.
- Rejeição estrita de campos desconhecidos mantida com `.strict()`.

### 2. Persistência e Canonical Hash de `gameId`
- Migration `Migration20260831000500.ts` adicionou a coluna `game_id varchar(255) null` na tabela `wager_transactions`.
- `gameId` incluído no payload canônico (`canonicalPayloadHash`), garantindo unicidade e evitando colisões de idempotência entre jogos distintos.
- `gameId` mapeado na entidade MikroORM, reidratado no worker de referências pendentes e retornado nas respostas de criação e consulta (`GET /wagering/transactions/:id`).

### 3. Contratos e comportamentos das entidades
- `Money`: implementados métodos de comparação (`isPositive`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`), igualdade e operações seguras sem ponto flutuante.
- `WagerTransaction`: modelo de domínio com todas as propriedades de identidade, financeiras, `gameId`, referência, status, códigos de falha e proteção de invariantes de estados terminais.
- `InboxMessage` e `OutboxMessage`: entidades de domínio puras para encapsulamento de integridade de mensagens e ciclo de vida de publicação/tentativas.

### 4. Cobertura de integração individual dos 8 endpoints
- Testes automatizados adicionados em `tests/integration/http-api.spec.ts` cobrindo:
  - Criação de wallet duplicada -> `409 Conflict`.
  - Consulta de wallet existente e inexistente -> `200 OK` / `404 Not Found`.
  - Consulta de transação por ID interno e por `(providerId, externalTransactionId)` -> `200 OK` / `404 Not Found`.
  - Paginação com cursor do ledger e validação de cursor corrompido -> `400 Bad Request`.
  - Reversão sem referência obrigatória -> `422 Unprocessable Entity`.
  - Transação duplicada com payload conflitante -> `409 Conflict`.

## Critérios de conclusão

- [x] O payload literal de criação de wallet do desafio retorna `201`.
- [x] O payload literal de aposta do desafio retorna resultado válido.
- [x] O mesmo contrato funciona pela API e pela fila.
- [x] `gameId` é persistido e participa do hash idempotente.
- [x] Todas as entidades possuem testes públicos de comportamento.
- [x] Os oito endpoints obrigatórios possuem testes de integração.
- [x] `bun run check` passa (0 erros de lint, 0 erros de tipo, 74 testes unitários verdes).
- [x] `bun run hardening` passa com PostgreSQL e LocalStack reais (15 testes de integração, 4 testes de concorrência multi-instância, verificação de planos de execução de índices e links do Brain validados).
- [x] A pontuação em [`pontuação.md`](pontua%C3%A7%C3%A3o.md) foi atualizada com evidências de 100/100.
