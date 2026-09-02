# Progresso — Conclusão de ISSUE-01.4, 01.5 e 01.6

Atualizado em 2026-09-02. As trilhas locais 01, 02 e 03 e o gate integrado 04
da Onda 1 foram fechados via TDD e regressão compartilhada em stack limpa com
PostgreSQL, LocalStack e três réplicas. Ondas 2–4 continuam bloqueadas.

## Status do escopo implementado: GREEN

- [x] **Onda 1 / issue 04**: gate limpo com migrations `up/down/up`, 79 testes
  unitários, 19 de integração, 4 de concorrência, índices críticos e 23 links
  do Brain validados.

- [x] **ISSUE-01.1**: Fundação NestJS/Bun, banco PostgreSQL, LocalStack SQS FIFO/DLQ, migrations e health checks.
- [x] **ISSUE-01.2**: Núcleo financeiro, `Money` decimal exato, `Wallet` versionada com lock pessimista, `WalletLedgerEntry` append-only e paginação cursor-based.
- [x] **ISSUE-01.3**: Transações idempotentes, hash canônico, locking pessimista ordenado, replay seguro e transições de estado.
- [x] **ISSUE-01.4**: Mensageria SQS FIFO confiável, atomicidade Inbox/Outbox no mesmo `transactional()`, workers em background, DLQ e graceful shutdown.
- [x] **ISSUE-01.5**: Resolução de referências fora de ordem (`PENDING_REFERENCE`), expiração com auditoria, reconciliação somente leitura e métricas operacionais (`/metrics`).
- [x] **ISSUE-01.6**: Concorrência multi-instância (3 réplicas), integridade matemática e invariantes do banco, verificação de planos de execução/índices e documentação do Brain validada.

Observação: parte do código de produção abaixo foi alterada antes de a skill TDD aparecer no contexto. A retomada deve criar testes de regressão para cada comportamento já modificado antes de novas alterações de produção.

## Alterações já aplicadas

### Configuração e filas

- `AppConfig` agora exige `SQS_EVENT_QUEUE_URL` e expõe `eventQueueUrl`.
- `.env.example`, `compose.yaml` e `compose.hardening.yaml` receberam a URL `wager-events.fifo`.
- `docker/localstack/init-queues.sh` cria `wager-events.fifo`.
- readiness passou a verificar fila de comandos, DLQ e fila de eventos.
- `Dockerfile` copia `bun.lockb` antes do install e usa `bun install --frozen-lockfile`.
- `.dockerignore` foi criado para excluir `node_modules`, `dist`, `.git`, `.env` e logs.

### NestJS e ciclo de vida

- `WageringModule` agora exporta `WageringService`, corrigindo a injeção no `MessagingModule`.
- `main.ts` chama `app.enableShutdownHooks()`.
- criado `src/infrastructure/messaging/messaging-coordinator.ts`:
  - inicia consumer, outbox publisher e pending-reference worker;
  - mantém loops independentes;
  - registra erros de worker;
  - interrompe long polling e aguarda tarefas no shutdown.
- `MessagingCoordinator` foi registrado no `MessagingModule`.

### Inbox/outbox

- `WageringContext` recebeu `inbox` com `consumerName`, `messageId` e `payloadHash`.
- `WageringService.execute()` agora consulta/grava a inbox dentro do mesmo `transactional()` da transação financeira, wallet, ledger e outbox.
- reuso de `messageId` com hash divergente gera `MESSAGE_PERMANENT_FAILURE`.
- replay idempotente também registra a inbox atomicamente quando necessário.
- `SqsWagerConsumer` não persiste mais a inbox em uma segunda transação.
- hash da inbox usa JSON canônico do envelope validado.
- consumer estende visibility timeout a cada 30 segundos enquanto processa.
- payload permanente vai para DLQ; falha transitória fica sem ack para redrive.
- consumer coleta métricas de idade, replay, retry e DLQ.
- `OutboxPublisher` publica em `eventQueueUrl`, não mais na fila de comandos.
- falha de transporte libera lease, incrementa tentativa e agenda backoff com jitter.
- publisher usa `EntityManager.fork()` e expõe `stop()`.

### Persistência, referência e reconciliação

- consultas fora de transação em wallet, wagering e reconciliação passaram a usar `EntityManager.fork()`.
- lookup após conflito único em `WageringService` usa um fork isolado.
- REFUND/ROLLBACK agora rejeitam referência cujo status não seja `PROCESSED`, usando `REFERENCE_NOT_PROCESSED`.
- pending-reference worker usa fork e expira também por máximo de 10 tentativas.
- `OperationalMetrics` recebeu gauges (`observe`/`set`).
- criado `GET /metrics` por `OperationalMetricsController`.
- métricas iniciais adicionadas para status/failure code, replay, latência, lock, workers e outbox.

## Verificação final

Em 2026-09-02, o hardening foi reexecutado em ambiente Docker limpo. As
migrations passaram por `up → down → up`; lint e TypeScript ficaram verdes;
79 testes unitários, 19 de integração e 4 de concorrência passaram. As três
réplicas permaneceram saudáveis, os índices críticos foram verificados e 23
links do Brain foram validados.

## Próximas decisões opcionais

- decidir se eventos que excedem tentativas precisam de DLQ de eventos separada
  ou permanecem recuperáveis na outbox;
- avaliar métricas explícitas para conflitos de idempotência e deadlocks;
- avaliar propagação de `correlationId` do HTTP para o serviço financeiro e a
  reconciliação.
