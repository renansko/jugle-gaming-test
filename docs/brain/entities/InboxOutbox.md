# Inbox e Outbox

## InboxMessage

Deduplica mensagens recebidas por `(consumerName, messageId)`. Guarda `payloadHash`, recebimento e processamento para detectar reuso divergente do mesmo ID.

## OutboxMessage

Guarda envelope de evento versionado, tentativas, próxima tentativa e publicação. Um registro pendente é elegível quando `publishedAt` é nulo e `nextAttemptAt <= now`.

## Invariantes

- inbox, transação financeira, ledger e outbox compartilham a transação SQL;
- ack SQS ocorre somente após commit;
- outbox nunca é marcada publicada antes da confirmação do SQS;
- falha de publicação agenda retry com backoff e jitter;
- publicação duplicada é possível e faz parte do contrato.

## Concorrência

Publishers usam lotes curtos com `FOR UPDATE SKIP LOCKED`. Reivindicação vencida precisa poder ser recuperada por outra instância.

## Código planejado

Entidades em `src/domain/messaging/`; adapters e workers em `src/infrastructure/messaging/`.

