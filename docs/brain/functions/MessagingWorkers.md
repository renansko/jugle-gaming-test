# Funções de MessagingWorkers

## consume

`consume(message: SqsMessage): Promise<ConsumeDecision>`

Valida envelope, detecta redeliveries (`receiveCount > 1` ou replay idempotente), deduplica pela inbox e chama `ProcessWagerTransaction`. O delete no SQS ocorre somente após o commit transacional completo. Retorna `ACK`, `RETRY` ou `DLQ`.

## publishBatch

`publishBatch(limit: number): Promise<PublishBatchResult>`

Reivindica mensagens vencidas sem bloquear outros publishers, publica fora da transação de reivindicação e marca sucesso ou agenda retry. Duplicação após falha ambígua é aceita.

## retryPendingReferences

`retryPendingReferences(limit: number): Promise<RetryBatchResult>`

Reprocessa referências elegíveis com claim `SKIP LOCKED`, lease e backoff
persistidos na transação. Uma agenda nula é tratada como vencida para permitir
recuperação de registros legados. Ao exceder tentativas/TTL, rejeita com
`REFERENCE_NOT_FOUND`, cria evento e encerra o ciclo.

## shutdown

`shutdown(gracePeriodMs: number): Promise<void>`

Interrompe novos polls, aguarda mensagens ativas em voo até o prazo (`gracePeriodMs`). Se todas concluírem, emite métrica de drain e encerra o cliente. Se o prazo expirar, altera a visibilidade das mensagens pendentes para zero (`VisibilityTimeout: 0`) para assunção imediata por outra instância, emite métricas de devolução/falha e destrói o cliente.

