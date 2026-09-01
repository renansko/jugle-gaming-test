# Wagering Rules

## Vocabulário

- `BET`: débito; rejeita saldo insuficiente.
- `WIN`: crédito; pode referenciar BET da rodada.
- `LOSS`: resultado processado sem saldo ou ledger.
- `REFUND`: crédito que reverte uma BET processada.
- `ROLLBACK`: movimento inverso de BET, WIN ou REFUND processado.
- `OPENING`: crédito interno de abertura, nunca aceito externamente.

## Referências

REFUND/ROLLBACK exigem mesmo provider, player, wallet, moeda e rodada; valor deve ser integralmente igual. A mesma referência só pode ser revertida uma vez por tipo.

Referência ausente não é falha imediata: vira `PENDING_REFERENCE`. Ao exceder TTL/tentativas, termina como rejeitada e emite evento.

## Distinções importantes

- aposta sem saldo e reversão que causaria negativo têm códigos diferentes;
- rejeitada não altera saldo nem cria ledger;
- processar `LOSS` cria evento de transação, mas não de saldo;
- replay devolve o saldo observado originalmente, não o saldo corrente.

