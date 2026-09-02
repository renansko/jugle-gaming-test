# ISSUE-01 — Distributed Wagering Processor

## Objetivo

Entregar o serviço financeiro distribuído descrito no [plano de entrega](../../docs/DELIVERY_PLAN.md), preservando correção monetária, idempotência, concorrência multi-instância e recuperação após falhas.

## Status

`CONCLUÍDA` — as seis issues foram encerradas e seus arquivos operacionais removidos.

## Sequência

| Ordem | Issue | Resultado | Dependência |
|---|---|---|---|
| 1 | ISSUE-01.1 | Fundação executável | concluída |
| 2 | ISSUE-01.2 | Núcleo financeiro auditável | concluída |
| 3 | ISSUE-01.3 | Transações concorrentes e idempotentes | concluída |
| 4 | ISSUE-01.4 | Mensageria com inbox/outbox | concluída |
| 5 | ISSUE-01.5 | Referências, reconciliação e operação | concluída |
| 6 | ISSUE-01.6 | Evidências finais e apresentação | concluída |

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
