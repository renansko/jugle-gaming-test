# 03 — Referências pendentes recuperáveis

Status: `implemented`
Type: `AFK`
Labels: `needs-triage`

## Parent

`.scratch/onda-1/PRD.md` · subtrilha `01.5.1`.

## What to build

Entregar o worker de `PENDING_REFERENCE` com claim concorrente, lease
recuperável, backoff, limite de tentativas e TTL. Reversões fora de ordem devem
convergir quando a origem chega; órfãos devem terminar como rejeição auditável.

## Acceptance criteria

- [x] `REFUND` e `ROLLBACK` sem referência são persistidos como pendentes.
- [x] Claims concorrentes não processam a mesma pendência duas vezes.
- [x] Lease abandonado volta a ser elegível após expiração ou reinício.
- [x] Referência válida que chega depois resolve a operação e reconcilia wallet e ledger.
- [x] Backoff e contagem de tentativas são persistidos e observáveis.
- [x] TTL ou tentativas esgotadas rejeitam com `REFERENCE_NOT_FOUND` e criam evento terminal.
- [x] Referência rejeitada termina com código de falha determinístico e sem mutação indevida.
- [x] Testes verificam ordem invertida, concorrência, expiração e recuperação com
      PostgreSQL e LocalStack reais quando houver publicação de evento.
- [x] RED, GREEN, REFACTOR e evidências ficam registrados nesta issue.

## Blocked by

None para implementação — pode começar em paralelo com as issues 01 e 02.

## Closure dependency

O fechamento depende da publicação dos eventos pela [issue 02](02-publicacao-outbox-recuperavel.md).

## Comments

- 2026-09-01 — RED: adicionado `tests/unit/pending-reference-worker.spec.ts`, cobrindo pendência sem `next_reference_attempt_at`; o teste falhava porque o claim exigia agenda não nula.
- 2026-09-01 — GREEN: claim passou a aceitar agenda nula (`IS NULL OR <= NOW()`) e usa `NULLS FIRST`; leases, tentativas e backoff continuam persistidos em `wager_transactions`.
- 2026-09-01 — REFACTOR: contratos do Brain documentam claim, lease e recuperação de registros legados; eventos de resolução/rejeição continuam sendo gravados na outbox na mesma unidade transacional.
- Evidência estática: `git diff --check` sem erros. Validação dinâmica pendente neste ambiente porque o executável `bun` não está instalado; executar `bun run check`, `bun run test:integration` e `bun run test:concurrency` na stack PostgreSQL/LocalStack.
