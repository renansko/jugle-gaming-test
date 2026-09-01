# Plano de entrega

Execução detalhada: [ISSUE-01 — Distributed Wagering Processor](../prd/issue-01/README.md).

## Estratégia

Construir por fatias verticais verificáveis. Cada fase só termina quando migrations, testes e Brain estão coerentes. A ordem reduz primeiro os riscos eliminatórios do desafio.

## Fase 0 — Fundação

- iniciar Bun, NestJS e TypeScript estrito;
- criar Docker Compose com PostgreSQL e LocalStack;
- configurar MikroORM, migrations reversíveis, lint e scripts;
- adicionar configuração validada, liveness e readiness;
- criar pipeline CI com build, lint e testes.

**Saída:** ambiente sobe com um comando, migrations `up/down/up` passam e readiness verifica PostgreSQL e SQS.

## Fase 1 — Núcleo financeiro

- implementar `Money`, `Wallet`, `WagerTransaction` e ledger imutável;
- criar schema com constraints, uniques e índices;
- implementar criação/consulta de wallet e ledger paginado;
- gerar `OPENING` e ledger na mesma transação.

**Saída:** testes unitários de dinheiro/invariantes e integração das constraints.

## Fase 2 — Transações e idempotência

- implementar o caso de uso único para HTTP e SQS;
- canonicalizar payload e calcular SHA-256;
- aplicar `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- usar lock por wallet e armazenar a resposta original para replay;
- definir status HTTP e taxonomia estável de falhas.

**Saída:** 50 requisições iguais geram um efeito; duas apostas de 80 sobre saldo 100 deixam saldo 20 e um débito.

## Fase 3 — Mensageria confiável

- provisionar fila FIFO e DLQ no LocalStack;
- implementar inbox persistente e ack após commit;
- gravar eventos na outbox dentro da transação;
- publicar lotes com `SKIP LOCKED`, retry e backoff;
- implementar shutdown gracioso.

**Saída:** redelivery, publishers concorrentes, retry, DLQ e crashes simulados passam em containers reais.

## Fase 4 — Ordem, reconciliação e operação

- reprocessar `PENDING_REFERENCE` com TTL/tentativas;
- implementar reconciliação por ledger;
- adicionar logs estruturados e métricas obrigatórias;
- documentar runbooks de falha e limitações.

**Saída:** referência invertida, reinício e consistência final são demonstrados.

## Fase 5 — Hardening e apresentação

- rodar três ou mais instâncias nos testes de concorrência;
- revisar plano de execução do banco e hot wallet;
- executar suíte limpa e validar links do Brain;
- preparar roteiro demonstrando decisões e cenários de falha;
- opcional: carga, OpenTelemetry e IdP externo.

## Definition of Done global

- `wallet.balance == saldo reconstruído pelo ledger` em toda suíte;
- nenhuma publicação ocorre antes do commit;
- nenhum teste crítico substitui PostgreSQL/SQS por mocks;
- toda migration possui reversão validada;
- documentação e código mudam juntos;
- `bun run check` executa lint, typecheck e testes;
- `bun run test:integration` e `bun run test:concurrency` usam containers reais.
