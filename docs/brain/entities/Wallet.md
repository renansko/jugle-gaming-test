# Wallet

## Propósito

Aggregate root que materializa o saldo de um jogador em uma moeda e é a unidade de concorrência do sistema.

## Estado relevante

- `id`, `playerId`, `currency`;
- `balance: Money`;
- `version`, `createdAt`, `updatedAt`.

## Invariantes

- uma wallet por `(playerId, currency)`;
- saldo nunca negativo;
- moeda da operação igual à moeda da wallet;
- saldo só muda junto com um ledger entry;
- `version` começa em 1 e incrementa apenas quando o saldo muda.

## Transições

- `open`: cria wallet e, se o saldo inicial for positivo, `OPENING` + crédito.
- `debit`: recusa saldo insuficiente e retorna o lançamento correspondente.
- `credit`: credita e retorna o lançamento correspondente.
- `rehydrate`: reconstrói estado persistido sem repetir regras históricas.

## Concorrência

Toda mudança bloqueia somente a linha da wallet até o commit. Wallets diferentes continuam paralelas.

## Código planejado

`src/domain/wallet/wallet.ts`, repositório em `src/application/ports/wallet-repository.ts` e adapter MikroORM.

