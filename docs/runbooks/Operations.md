# Operações financeiras

## Referência pendente

Uma reversão pode chegar antes da operação de origem. O worker tenta novamente com backoff e lease recuperável. Investigue pelo `correlationId` e `transactionId`; não altere o estado diretamente no banco.

Após o TTL, a operação termina em `REFERENCE_NOT_FOUND` e gera evento de rejeição. Confirme a ausência da operação de origem no provedor antes de decidir qualquer compensação manual.

## Divergência de saldo

Chame `POST /wallets/:walletId/reconciliation`. O resultado compara o saldo materializado com a soma do ledger e não corrige nada automaticamente. Preserve a resposta, localize a sequência de lançamentos pelo `walletId` nos logs e escale para correção controlada.

## Readiness indisponível

`/health/live` indica apenas que o processo está ativo. Se `/health/ready` falhar, verifique PostgreSQL e SQS; não direcione tráfego de escrita até as dependências voltarem a ficar prontas.
