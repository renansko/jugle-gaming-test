# SQS Messages

## Filas

- `wager-transactions.fifo`;
- `wager-transactions-dlq.fifo`.

## Envelope de entrada

Campos obrigatórios: `messageId`, `type`, `occurredAt` e `data`. `type` deve ser `WagerTransactionRequested`; `data` usa o mesmo contrato de negócio do HTTP e inclui `idempotencyKey`.

## Metadados FIFO

- `MessageGroupId = walletId` para reduzir reordenação na mesma wallet;
- `MessageDeduplicationId = messageId` como otimização;
- inbox PostgreSQL continua sendo a garantia de deduplicação.

## Compatibilidade

Campos desconhecidos no envelope são rejeitados para evitar interpretação ambígua. Eventos futuros usam tipo/versão explícitos. Datas são ISO-8601 UTC e dinheiro é string decimal.

## Política operacional

Long polling, visibility timeout maior que o p99 esperado e extensão controlada para mensagens longas. Erro de negócio faz ack; falha transitória não faz ack; após `maxReceiveCount`, a mensagem segue para DLQ.

