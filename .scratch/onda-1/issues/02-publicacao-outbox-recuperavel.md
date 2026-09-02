# 02 — Publicação outbox recuperável

Status: `closed`
Type: `AFK`
Labels: `needs-triage`

## Parent

`.scratch/onda-1/PRD.md` · subtrilha `01.4.3`.

## What to build

Entregar a publicação concorrente da outbox com claims disjuntos, leases
recuperáveis e chamadas SQS fora do lock SQL. O caminho deve sobreviver a
falhas totais, parciais e resultados ambíguos sem perder eventos.

## Acceptance criteria

- [x] Dois publishers concorrentes reivindicam lotes disjuntos com
      `FOR UPDATE SKIP LOCKED`.
- [x] O lock SQL é liberado antes da chamada de rede ao SQS.
- [x] Lease abandonado volta a ser elegível após expiração.
- [x] Falha total registra tentativa, backoff e próxima execução.
- [x] Falha parcial atualiza somente as mensagens que falharam.
- [x] Resultado ambíguo mantém identidade estável e permite duplicação
      at-least-once sem perder o evento.
- [x] Testes verificam publicação, retry, lease e concorrência contra
      PostgreSQL e LocalStack reais.
- [x] RED, GREEN, REFACTOR e evidências ficam registrados nesta issue.

## Blocked by

None para implementação — pode começar em paralelo com a issue 01.

## Closure dependency

O fechamento depende da integração end-to-end com o consumidor da [issue 01](01-consumidor-sqs-atomico.md).

## Comments

- RED: `tests/unit/outbox-publisher.spec.ts` exige commit do claim antes do
  `send` e falha contra o publisher anterior.
- GREEN: claim/finalização foram separados em transações curtas; `lease_token`
  foi adicionado pela migration `20260901000500`.
- REFACTOR: sucesso e falha são finalizados por conjuntos independentes, com
  updates condicionais ao token.
- 2026-09-01 — fechamento: testes determinísticos cobrem resposta parcial e
  transporte ambíguo com identidade estável; PostgreSQL/LocalStack reais cobrem
  publishers concorrentes, lotes disjuntos, publicação e recuperação de lease
  expirado. A asserção usa o estado durável porque arquivos de integração rodam
  em paralelo e outro publisher dirigido pode reivindicar uma linha elegível.
- Evidência: `bun run hardening` em Docker — 79 unitários, 19 integrações e 4
  testes de concorrência, todos verdes; índices obrigatórios verificados.
