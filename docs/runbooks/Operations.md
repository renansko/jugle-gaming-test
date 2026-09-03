# Operações financeiras

## Referência pendente

Uma reversão pode chegar antes da operação de origem. O worker tenta novamente com backoff e lease recuperável. Investigue pelo `correlationId` e `transactionId`; não altere o estado diretamente no banco.

Após o TTL, a operação termina em `REFERENCE_NOT_FOUND` e gera evento de rejeição. Confirme a ausência da operação de origem no provedor antes de decidir qualquer compensação manual.

## Divergência de saldo

Chame `POST /wallets/:walletId/reconciliation`. O resultado compara o saldo materializado com a soma do ledger e não corrige nada automaticamente. Preserve a resposta, localize a sequência de lançamentos pelo `walletId` nos logs e escale para correção controlada.

## Readiness indisponível

`/health/live` indica apenas que o processo está ativo. Se `/health/ready` falhar, verifique PostgreSQL e SQS; não direcione tráfego de escrita até as dependências voltarem a ficar prontas.

## Recuperação de consumer, redelivery e graceful shutdown

Em desligamentos (`SIGTERM`), o consumer cessa novos polls e dispõe de até `SHUTDOWN_GRACE_PERIOD_MS` para concluir mensagens em voo. Se o prazo for atingido, a visibilidade das mensagens pendentes é zerada imediatamente (`VisibilityTimeout: 0`) para assunção imediata por outra réplica.

Se um processo for encerrado após o commit financeiro no PostgreSQL e antes do delete no SQS, a mensagem sofrerá redelivery. O consumidor identifica o replay via `inbox_messages`, registra o evento `sqs_message_redelivered`, incrementa `sqs_redeliveries_total`, preserva a unicidade financeira e remove a mensagem da fila.

Picos em `shutdown_failures_total` ou `consumer_visibility_released_total` sugerem transações excedendo a tolerância de shutdown; investigue locks e latência.

