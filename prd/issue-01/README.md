# ISSUE-01 — Distributed Wagering Processor

## Objetivo

Entregar o serviço financeiro distribuído descrito no [plano de entrega](../../docs/DELIVERY_PLAN.md), preservando correção monetária, idempotência, concorrência multi-instância e recuperação após falhas.

## Status

`READY` — a primeira issue pode ser iniciada; as demais seguem a cadeia de dependências.

## Sequência

| Ordem | Issue | Resultado | Dependência |
|---|---|---|---|
| 1 | [ISSUE-01.1](issue-01.1-foundation.md) | Fundação executável | nenhuma |
| 2 | [ISSUE-01.2](issue-01.2-financial-core.md) | Núcleo financeiro auditável | 01.1 |
| 3 | [ISSUE-01.3](issue-01.3-transactions-idempotency.md) | Transações concorrentes e idempotentes | 01.2 |
| 4 | [ISSUE-01.4](issue-01.4-reliable-messaging.md) | Mensageria com inbox/outbox | 01.3 |
| 5 | [ISSUE-01.5](issue-01.5-operations-reconciliation.md) | Referências, reconciliação e operação | 01.4 |
| 6 | [ISSUE-01.6](issue-01.6-hardening.md) | Evidências finais e apresentação | 01.5 |

## Regras de execução

- concluir uma issue somente com critérios de aceite e testes verdes;
- fazer commits pequenos, vinculados ao ID da issue;
- atualizar código, migrations, testes e Brain no mesmo trabalho;
- não antecipar escopo opcional antes dos riscos eliminatórios;
- registrar impedimentos e decisões novas em `ARCHITECTURE.md` ou no Brain.

## Definition of Done do épico

- `wallet.balance` coincide com o saldo reconstruído pelo ledger;
- dinheiro nunca passa por `number`, `float` ou `double`;
- redelivery e concorrência não duplicam efeitos;
- PostgreSQL protege unicidade, imutabilidade e saldo não negativo;
- inbox, operação financeira, ledger e outbox são atômicos;
- ack e publicação acontecem somente após commit;
- migrations são versionadas e reversíveis;
- testes críticos usam PostgreSQL e LocalStack reais;
- três ou mais instâncias preservam as invariantes;
- documentação e comandos de reprodução estão atualizados.

## Referências

- [Arquitetura](../../ARCHITECTURE.md)
- [Brain](../../docs/brain/index.md)
- [Convenção de testes](../../docs/brain/conventions/Testing.md)
- [Regras do produto](../../docs/brain/product/WageringRules.md)

