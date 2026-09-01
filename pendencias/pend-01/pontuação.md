# Pontuação estimada do desafio

## Nota estimada

**77/100 — boa base técnica, com risco relevante de incompatibilidade contratual.**

Esta é uma estimativa conservadora baseada na rubrica oficial, inspeção estática
do código, migrations, testes e documentação em 2026-09-01. Não representa a
nota da Jungle Gaming.

`bun run check` não foi executado porque o runtime Bun não está instalado no
ambiente desta auditoria. As suítes com PostgreSQL e LocalStack também não foram
reexecutadas. Por isso, pontos dependentes de execução foram concedidos apenas
parcialmente, mesmo quando há testes no repositório.

## Quantificação pela rubrica oficial

| Área | Máximo | Estimativa | Evidência e desconto |
|---|---:|---:|---|
| Correção financeira | 20 | 17 | `Money`, saldo não negativo, ledger, reversões e reconciliação existem. Desconto por contrato monetário divergente e comportamentos incompletos de `Money`. |
| Concorrência | 20 | 16 | Lock pessimista por wallet e cenários multi-instância estão implementados. Evidência completa não foi reproduzida nesta auditoria. |
| Idempotência | 15 | 11 | Unicidades persistentes, hash canônico e replay existem. `gameId` ausente do contrato e do hash permite equivalência indevida de payloads. |
| Mensageria e falhas | 15 | 12 | Inbox/outbox, ack após commit, retry, DLQ e workers existem. Execução real e recuperação completa não foram reproduzidas. |
| Modelagem e arquitetura | 10 | 6 | Boundaries e domínio sem decorators estão claros. `WagerTransaction` é anêmica e Inbox/Outbox existem principalmente como modelos ORM. |
| Testes | 10 | 6 | Há testes unitários, integração e concorrência. Faltam contratos literais da API e cobertura individual de consultas; a suíte completa não foi executada aqui. |
| Observabilidade | 5 | 4 | Health, métricas, correlação e reconciliação estão presentes. Falta evidência executada da matriz operacional completa. |
| Documentação | 5 | 5 | README, arquitetura, Brain, runbooks e backlog são extensos e rastreáveis. |
| **Total** | **100** | **77** | **Estimativa atual.** |

## Riscos que podem reduzir a avaliação real

1. O payload oficial de wallet usa `initialBalance` como objeto, enquanto a API
   atual espera string e moeda achatada.
2. O payload oficial de transação usa `money` e `gameId`; o schema atual espera
   `amount`/`currency` e rejeita `gameId`.
3. `gameId` não participa do hash idempotente nem da persistência.
4. O modelo de domínio de `WagerTransaction` não encapsula os dados e consultas
   sugeridos pelo enunciado.
5. A ausência de uma execução limpa de `hardening` impede comprovar todos os
   pontos de integração, concorrência e crash recovery.

Esses riscos não foram classificados como falha eliminatória já comprovada. Se
uma banca executar apenas os exemplos literais do README oficial, porém, a
incompatibilidade dos DTOs pode causar uma penalização maior que a estimada.

## Caminho para elevar a nota

| Entrega | Ganho estimado | Faixa após validação |
|---|---:|---:|
| Corrigir DTOs, persistir `gameId` e incluí-lo no hash | +5 a +7 | 82–84 |
| Completar entidades e respectivos testes de domínio | +3 a +5 | 85–89 |
| Cobrir todos os endpoints com contratos literais | +2 a +3 | 87–92 |
| Executar e anexar evidências limpas de hardening | +3 a +5 | 90–97 |

Os ganhos não são estritamente cumulativos: uma mesma correção pode contribuir
para mais de uma área da rubrica, e o avaliador pode distribuir os pontos de
forma diferente.

## Regra para reavaliação

A pontuação só deve subir quando houver evidência reproduzível:

- teste inicialmente vermelho para cada lacuna;
- implementação mínima que o torne verde;
- `bun run check` verde;
- `bun run hardening` verde em checkout limpo;
- comandos, versões, duração e resultados registrados;
- saldo final sempre igual ao saldo reconstruído pelo ledger.

## Fonte

Rubrica: [seção 14 do backend challenge](https://github.com/junglegaming/backend-challenge#14-avalia%C3%A7%C3%A3o--100-pontos).
