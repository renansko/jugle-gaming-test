# Integration Events

## Envelope

`eventId`, `eventType`, `version`, `aggregateId`, `correlationId`, `causationId?`, `occurredAt` e `data` imutável.

## Eventos mínimos

- `WagerTransactionProcessed.v1`: qualquer operação aplicada, inclusive `LOSS`.
- `WagerTransactionRejected.v1`: rejeição de negócio.
- `WalletBalanceChanged.v1`: somente quando o saldo muda.
- `WagerTransactionPendingReference.v1`: referência ainda ausente.

## Regras

- cada evento possui subclasse concreta, tipo e versão fixos;
- outbox armazena o envelope serializado;
- `Money` vira `{ amount, currency }`, nunca instância de classe;
- consumidor deduplica por `eventId`;
- evolução compatível adiciona campos opcionais; quebra de contrato incrementa versão.

## Correlação

HTTP cria/propaga `correlationId`; SQS propaga o envelope. `causationId` aponta para request, message ou evento que originou o novo evento.

