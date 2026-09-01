# ISSUE-01.1 — Fundação executável

## Estado

`COMPLETED` · prioridade crítica · depende de: nenhuma.

## Resultado esperado

Um projeto Bun/NestJS estrito que sobe com PostgreSQL e LocalStack, executa migrations reversíveis e expõe health checks confiáveis.

## Escopo

- Bun 1.x como runtime, gerenciador e test runner;
- NestJS com TypeScript estrito e módulos por boundary;
- Docker Compose para aplicação, PostgreSQL e LocalStack;
- MikroORM e primeira migration versionada;
- configuração validada, lint, typecheck, testes e CI;
- liveness independente e readiness para PostgreSQL/SQS.

## Tarefas

- [x] Inicializar `package.json`, `bun.lock`, `tsconfig.json` e NestJS.
- [x] Criar `src/domain`, `application`, `infrastructure` e `interfaces`.
- [x] Criar Dockerfiles e `compose.yaml` com health checks.
- [x] Provisionar filas FIFO/DLQ no bootstrap do LocalStack.
- [x] Configurar MikroORM e convenção de migrations `up/down`.
- [x] Validar variáveis de ambiente no startup sem registrar segredos.
- [x] Implementar `/health/live` e `/health/ready`.
- [x] Criar scripts `check`, `test:unit`, `test:integration` e CI.

## Critérios de aceite

- [x] `docker compose up --build` deixa serviços saudáveis.
- [x] `bun run check` passa em checkout limpo (52 testes unitários, Biome lint e TSC).
- [x] TypeScript está com `strict: true` e sem supressões globais.
- [x] Migration executa `up`, `down` e novo `up` em banco vazio.
- [x] Liveness funciona com dependências indisponíveis.
- [x] Readiness falha quando PostgreSQL ou SQS não responde.
- [x] README contém comandos reproduzíveis.

## Testes/evidências

- `tests/unit/app-config.spec.ts`: validação estrita de variáveis de ambiente sem expor segredos.
- `tests/unit/dependencies-health.service.spec.ts`: reporte de status down para DB e SQS.
- `tests/unit/health.controller.spec.ts`: independência do liveness e status 503 no readiness sob falhas.
- `bun run check`: 52 testes verdes, zero erros no Biome e zero erros de tipagem TSC.

## Fora de escopo

Domínio financeiro, autenticação completa, observabilidade avançada e deploy em AWS.

## Documentação relacionada

[Arquitetura](../../ARCHITECTURE.md) · [Transações](../../docs/brain/conventions/DatabaseTransactions.md)
