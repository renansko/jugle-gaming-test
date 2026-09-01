# ISSUE-01.3 — Transações concorrentes e idempotentes

## Estado

`COMPLETED` · prioridade crítica · depende de: ISSUE-01.2.

## Resultado esperado

Um único caso de uso aplica BET, WIN, LOSS, REFUND e ROLLBACK com replay persistente, locks por wallet e respostas auditáveis.

## Escopo

- `ProcessWagerTransaction` compartilhável por HTTP e SQS;
- hash SHA-256 de JSON canônico e idempotência persistente;
- lock pessimista por wallet e retry técnico limitado;
- regras de referência/reversão e failure codes;
- endpoints de submissão e consulta de transações.

## Tarefas

- [x] Implementar canonicalização determinística do payload.
- [x] Persistir `idempotencyKey`, `payloadHash` e resposta original.
- [x] Implementar fluxo transacional com `SELECT ... FOR UPDATE`.
- [x] Aplicar regras de BET, WIN, LOSS, REFUND e ROLLBACK.
- [x] Impedir reversões duplicadas com constraints/índices.
- [x] Mapear validação, conflito, rejeição, pendência e falha transitória para HTTP.
- [x] Implementar consultas por ID interno e identidade do provedor.

## Critérios de aceite

- [x] Replay idêntico retorna o resultado original e `idempotentReplay=true`.
- [x] Mesma key com hash diferente retorna `IDEMPOTENCY_CONFLICT`.
- [x] Duas BET de 80 sobre saldo 100 resultam em uma processada, uma rejeitada e saldo 20.
- [x] O cenário concorrente gera exatamente um débito no ledger.
- [x] Wallets diferentes processam em paralelo.
- [x] Referências validam provider, player, wallet, moeda, rodada, tipo e valor.
- [x] Reversão que negativaria saldo usa failure code específico (`REVERSAL_WOULD_NEGATIVE`).

## Testes/evidências

- `tests/unit/application/canonical-payload.spec.ts`: ordenação canônica e detecção de mutações.
- `tests/unit/application/wagering.service.spec.ts`: cobertura completa de replay, conflitos de idempotência, BET, WIN, LOSS, REFUND e ROLLBACK.
- `tests/concurrency/multi-instance.spec.ts`: concorrência real entre instâncias no PostgreSQL.

## Fora de escopo

Polling SQS, inbox, outbox publisher, DLQ e reprocessamento agendado.

## Documentação relacionada

[Idempotência](../../docs/brain/conventions/Idempotency.md) · [Concorrência](../../docs/brain/conventions/Concurrency.md) · [Regras](../../docs/brain/product/WageringRules.md)
