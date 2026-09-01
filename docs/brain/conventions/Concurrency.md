# Concurrency

## Unidade

`walletId` é a unidade de serialização. Não existe lock global.

## Escrita financeira

Carregar a wallet com `FOR UPDATE` dentro da transação, validar saldo/referência e persistir via Unit of Work. A unique de idempotência resolve corridas de primeira inserção; a transação perdedora relê o resultado.

## Reversões

Bloquear wallet e registros de referência em ordem determinística. Uniques condicionais impedem duas reversões do mesmo tipo mesmo sob corrida.

## Outbox

Publishers reivindicam registros com `FOR UPDATE SKIP LOCKED` e lease recuperável. O lock não atravessa a chamada SQS.

## Retry

Deadlock ou falha de serialização recebe retry limitado, exponencial e com jitter. Erro de domínio não é repetido.

## Evidência

Testes usam paralelismo real e pelo menos três processos. O caso 100 - 80 - 80 deve produzir um processado, um rejeitado, saldo 20 e um ledger debit.

