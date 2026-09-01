# HTTP API

## Escrita

- `POST /wallets`: cria wallet; `201`, `409` em duplicidade.
- `POST /wagering/transactions`: exige `Idempotency-Key`; `200` processada/replay, `202` pendente, `409` conflito de chave, `422` rejeição de negócio, `503` falha transitória.
- `POST /wallets/:walletId/reconciliation`: executa comparação somente leitura.

## Consulta

- `GET /wallets/:walletId`;
- `GET /wallets/:walletId/ledger?cursor=...&limit=50`;
- `GET /wagering/transactions/:transactionId`;
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`.

## Saúde

- `GET /health/live`: processo vivo, sem dependências.
- `GET /health/ready`: PostgreSQL e SQS alcançáveis.

## Convenções

DTOs rejeitam campos desconhecidos. Dinheiro entra e sai como string decimal. Erros usam `code`, `message`, `correlationId` e detalhes seguros. Endpoints de health são públicos; os demais passam por `ProviderIdentityPort`.

## Versionamento

Versão inicial implícita. Mudança incompatível introduz `/v2`; campos novos opcionais preservam a versão.

