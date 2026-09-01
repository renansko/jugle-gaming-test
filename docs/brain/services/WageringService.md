# WageringService

## Responsabilidade

Orquestrar criação de wallets e processamento de transações mantendo idempotência, saldo, ledger e eventos atômicos. A mesma operação atende adaptadores HTTP e SQS.

## Não faz

- não controla ack, polling ou DLQ;
- não implementa autenticação;
- não publica diretamente no SQS;
- não contém detalhes do MikroORM.

## Dependências

Unit of Work, repositórios de wallet/transação/ledger/inbox/outbox, relógio, gerador de IDs e hasher canônico.

## Efeitos colaterais

Insere ou altera registros dentro de uma única transação. Eventos são apenas enfileirados na outbox.

## Funções públicas

Veja [contratos](../functions/WageringService.md).

## Código planejado

`src/application/wagering/process-wager-transaction.ts` e `src/application/wallet/create-wallet.ts`.

