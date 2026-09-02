# Funções de MessagingWorkers

## consume

`consume(message: SqsMessage): Promise<ConsumeDecision>`

Valida envelope, deduplica pela inbox e chama `ProcessWagerTransaction`. Retorna `ACK`, `RETRY` ou `DLQ`; o adapter aplica a decisão depois do commit.

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

Interrompe novos polls, aguarda operações em voo até o limite e deixa mensagens não concluídas recuperáveis por visibility timeout.
