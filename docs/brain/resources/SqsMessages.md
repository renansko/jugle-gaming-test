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

## Política operacional e DLQ

- Long polling com visibility timeout padrão e renovação periódica para operações em voo;
- **Payload permanentemente inválido**: JSON malformado ou violação de esquema segue direto à DLQ com razão `invalid_payload` e é removido da fila principal sem efeitos colaterais no banco;
- **Falha de domínio permanente**: erros como `WALLET_NOT_FOUND` ou incompatibilidade de contrato seguem à DLQ com razão `permanent_failure`;
- **Falha transitória e backoff**: falhas de infraestrutura não fazem ACK e ajustam visibilidade com backoff exponencial. Ao atingir o limite configurável (`SQS_MAX_RECEIVE_COUNT`, padrão 5), a mensagem é roteada à DLQ com `max_retries_exceeded`;
- O consumidor normaliza `money` e `amount/currency` para o contrato financeiro antes de calcular o hash da inbox. Metadados de transporte não alteram a identidade do payload.
