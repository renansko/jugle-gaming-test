# Failure Codes

## Negócio, terminais

- `INSUFFICIENT_FUNDS`: BET excede saldo.
- `REVERSAL_WOULD_NEGATIVE`: reversão produziria saldo negativo.
- `REFERENCE_NOT_FOUND`: referência expirou após reprocessamento.
- `REFERENCE_NOT_PROCESSED`: transação referenciada não está em estado processado.
- `INVALID_REFERENCE_KIND`: tipo referenciado não permitido.
- `REFERENCE_SCOPE_MISMATCH`: provider/player/wallet/moeda/rodada diverge.
- `REFERENCE_AMOUNT_MISMATCH`: reversão não corresponde ao valor integral.
- `REFERENCE_ALREADY_REVERSED`: reversão do mesmo tipo já existe.
- `CURRENCY_MISMATCH`: moeda da operação diverge da wallet.

## Contrato/conflito

- `INVALID_PAYLOAD`: DTO ou dinheiro inválido.
- `IDEMPOTENCY_KEY_REQUIRED`: identidade ausente.
- `IDEMPOTENCY_CONFLICT`: mesma chave com payload diferente.
- `WALLET_NOT_FOUND`: wallet indicada não existe.
- `PROVIDER_IDENTITY_MISMATCH`: identidade do canal e payload divergem.

## Infraestrutura

- `DEPENDENCY_UNAVAILABLE`: PostgreSQL/SQS indisponível, repetível.
- `MESSAGE_PERMANENT_FAILURE`: mensagem não processável, elegível à DLQ.
- `INTERNAL_FAILURE`: erro inesperado com correlação, sem detalhe sensível.

## Regra de transporte

O código é estável e legível por máquina. Mensagem humana pode evoluir sem mudar a decisão de retry do cliente.

