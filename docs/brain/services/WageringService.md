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

## Arquitetura Hexagonal & Ports

Para isolar o domínio das entidades do MikroORM, o serviço interage através de portas de repositório e mappers bidirecionais:
- `WalletRepositoryPort`, `WagerTransactionRepositoryPort`, `WalletLedgerRepositoryPort`, `InboxRepositoryPort`, `OutboxRepositoryPort`;
- Mappers sincronizam os agregados de domínio (`WagerTransaction`, `Wallet`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`) antes do flush atômico.
- Complexidade ciclomática de todos os métodos estritamente mantida <= 6.

## Código

`src/application/wagering/wagering.service.ts`, portas em `src/application/ports/` e mappers em `src/infrastructure/persistence/mappers/`.

