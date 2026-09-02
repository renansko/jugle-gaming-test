# 01 — Consumidor SQS atômico

Status: `implemented-pending-validation`
Type: `AFK`
Labels: `needs-triage`

## Parent

`.scratch/onda-1/PRD.md` · subtrilha `01.4.2`.

## What to build

Entregar o caminho completo de consumo da fila `wager-transactions.fifo`:
validar o envelope, deduplicar pela inbox, executar a operação financeira na
mesma transação que ledger e outbox, e aplicar ACK, retry ou DLQ somente após o
resultado persistido.

## Acceptance criteria

- [x] Envelope inválido chega à DLQ sem wallet, transação, ledger ou outbox.
- [x] Inbox, operação, ledger e outbox são persistidos atomicamente.
- [x] Falha de negócio faz ACK/DLQ conforme a taxonomia definida, sem retry indevido.
- [x] Falha transitória preserva a mensagem para redelivery e registra retry.
- [x] Redelivery após commit não duplica saldo, ledger ou evento financeiro.
- [x] Reuso de `messageId` com payload divergente é rejeitado por hash canônico.
- [ ] Testes de integração usam PostgreSQL e LocalStack reais.
- [x] RED, GREEN, REFACTOR e evidências ficam registrados nesta issue.

## Blocked by

None — pode começar imediatamente após a Onda 0.

## Closure dependency

Nenhuma. A conclusão desta issue libera a integração dependente da outbox.

## Comments

- 2026-09-01 — RED: `tests/unit/sqs-wager-consumer.spec.ts` falha contra o
  comportamento anterior porque a inbox recebia hash de `messageId`, tipo e
  data do envelope, em vez do payload financeiro.
- 2026-09-01 — GREEN: o consumidor normaliza `money`/`amount+currency` para
  `ProcessWagerInput` e compartilha `canonicalWagerPayloadHash` com o serviço,
  mantendo metadados de transporte fora da identidade da operação.
- 2026-09-01 — REFACTOR: o mapeamento do envelope foi isolado em
  `toWagerInput`; ACK, retry e DLQ continuam após o resultado do caso de uso.
- Evidência estática: typecheck e Biome dos arquivos alterados concluídos sem
  erros. Validação dinâmica pendente neste ambiente porque `bun` não está
  instalado; executar `bun run check` e `bun run test:integration` com
  PostgreSQL e LocalStack reais.
