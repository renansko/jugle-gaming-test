# Inbox e Outbox

## InboxMessage

Deduplica mensagens recebidas por `(consumerName, messageId)`. Guarda `payloadHash`, recebimento e processamento para detectar reuso divergente do mesmo ID.

## OutboxMessage

Guarda envelope de evento versionado, tentativas, próxima tentativa e publicação.
Durante uma reivindicação, `leaseUntil` e um `leaseToken` identificam o lote
que pode finalizá-lo. Um registro pendente é elegível quando `publishedAt` é
nulo, `nextAttemptAt <= now` e o lease está vazio ou expirado.

## Invariantes

- inbox, transação financeira, ledger e outbox compartilham a transação SQL;
- ack SQS ocorre somente após commit;
- outbox nunca é marcada publicada antes da confirmação do SQS;
- falha de publicação agenda retry com backoff e jitter;
- publicação duplicada é possível e faz parte do contrato;
- resultados ambíguos mantêm o mesmo `id`/`MessageDeduplicationId` e podem ser
  reenviados sem perder o evento;
- a finalização exige o token do lease, evitando que uma instância antiga
  sobrescreva a reivindicação recuperada por outra.

## Concorrência

Publishers usam lotes curtos com `FOR UPDATE SKIP LOCKED`. Reivindicação vencida precisa poder ser recuperada por outra instância.

## Encapsulamento de Domínio
- `OutboxMessage.claim(leaseToken, leaseUntil)`: atribui token único e data limite do lease;
- `OutboxMessage.markPublished(publishedAt)`: remove leases e define publicação;
- `OutboxMessage.recordFailure(nextAttemptAt)`: incrementa tentativas, limpa lease e agenda retry;
- `InboxMessage.recordProcessed(processedAt)`: registra carimbo de processamento auditável.

## Mapeamento de Persistência
Mappers bidirecionais isolam os agregados das entidades MikroORM:
- `inboxMessageToDomain` e `inboxMessageToPersistence`;
- `outboxMessageToDomain` e `outboxMessageToPersistence`.

## Código

Entidades em `src/domain/messaging/`; mappers em `src/infrastructure/persistence/mappers/`; workers em `src/infrastructure/messaging/`.
