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

DTOs rejeitam campos desconhecidos. Dinheiro entra e sai como string decimal. Erros usam `code`, `message`, `correlationId` e detalhes seguros. Endpoints de health são explicitamente públicos; os demais passam pelo guard global e pelo `ProviderIdentityPort`. O adaptador atual autoriza tudo: esta versão não valida credenciais nem restringe acesso. A troca futura do adaptador deve validar a credencial e o `providerId` declarado antes de executar o caso de uso.

## Versionamento

Versão inicial implícita. Mudança incompatível introduz `/v2`; campos novos opcionais preservam a versão.
