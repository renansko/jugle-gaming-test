# WalletLedgerEntry

## Propósito

Registro append-only que prova cada alteração de saldo e permite reconstrução e reconciliação.

## Campos essenciais

`id`, `walletId`, `transactionId`, `direction`, `money`, `balanceBefore`, `balanceAfter`, `createdAt`.

## Invariantes

- `balanceBefore ± money == balanceAfter`;
- no máximo uma entrada por `(walletId, transactionId)`;
- somente transações que mudam saldo geram entrada;
- valores e saldos usam mesma moeda;
- entradas não podem ser atualizadas nem excluídas pela aplicação.

## Imutabilidade no banco

Permissões do usuário da aplicação não concedem `UPDATE`/`DELETE` na tabela; trigger defensiva pode recusar mutações. Migrations administrativas continuam controladas por papel separado.

## Paginação

Cursor opaco baseado em `(createdAt, id)`, com ordenação estável e limite máximo configurado.

## Código planejado

`src/domain/wallet/wallet-ledger-entry.ts` e adapter de consulta paginada em infraestrutura.

