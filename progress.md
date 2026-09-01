# Progresso — conclusão da ISSUE-01.4, 01.5 e 01.6

Atualizado em 2026-08-31. Este arquivo é o ponto de retomada caso a sessão seja interrompida.

## Objetivo atual

Concluir:

- ISSUE-01.4: mensageria confiável com inbox/outbox atômicos, workers ativos, retry, DLQ e shutdown;
- ISSUE-01.5: referências fora de ordem, reconciliação, métricas e operação;
- ISSUE-01.6: matriz de integração, concorrência, crash/restart e evidências reproduzíveis.

## Instruções obrigatórias na retomada

1. Ler `docs/brain/index.md` e as páginas relacionadas antes de novas mudanças.
2. Usar a skill `.agents/skills/tdd/SKILL.md` rigorosamente.
3. A partir deste ponto, escrever cada novo teste primeiro, executar e confirmar RED, implementar o mínimo para GREEN e então refatorar.
4. Não marcar checklists das issues antes de obter evidência verde.
5. Atualizar código, testes, Brain e `docs/brain/log.md` juntos.

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

## Verificações executadas

- `biome lint` inicialmente encontrou apenas dois problemas introduzidos:
  - `let sent` implícito em `outbox-publisher.ts`;
  - imports de lifecycle que deveriam ser type-only.
- ambos foram corrigidos, mas o lint ainda precisa ser reexecutado.
- typecheck local continua bloqueado porque o `node_modules` preexistente não contém `decimal.js`; validar dentro do Docker com instalação limpa.
- anteriormente, `docker compose config` passou e os 23 links do Brain passaram.

## Próximo ciclo TDD imediato

### RED 1 — atomicidade e redelivery SQS

Criar `tests/integration/messaging.spec.ts` usando PostgreSQL e LocalStack reais:

1. criar wallet por HTTP;
2. enviar `WagerTransactionRequested` pela FIFO;
3. aguardar processamento;
4. reenviar o mesmo envelope com outro `MessageDeduplicationId`;
5. confirmar uma inbox, uma transação, um débito e reconciliação consistente;
6. confirmar eventos recebidos em `wager-events.fifo`.

Executar e confirmar falha antes de ajustar mais código.

### RED 2 — DLQ

- enviar payload inválido;
- confirmar chegada à `wager-transactions-dlq.fifo` e ausência de efeito financeiro.

### RED 3 — referência fora de ordem e expiração

- submeter REFUND/ROLLBACK antes da referência;
- inserir a origem e aguardar resolução pelo worker;
- para expiração, envelhecer `created_at` e tornar `next_reference_attempt_at` elegível via SQL;
- confirmar `REFERENCE_NOT_FOUND`, evento de rejeição e reconciliação consistente.

### RED 4 — divergência e métricas

- injetar divergência controlada alterando apenas `wallet.balance` em wallet isolada;
- confirmar resposta, ausência de autocorreção e contador em `/metrics`;
- restaurar a wallet ao final do teste.

### RED 5 — concorrência/hardening

Completar testes para:

- wallets diferentes em paralelo;
- dois publishers disputando outbox sem perda;
- reinício após commit/antes do ack;
- restart com outbox pendente;
- shutdown durante long polling;
- invariantes finais de saldo, ledger, transações, inbox e outbox.

## Pendências de código conhecidas

- Reexecutar lint; revisar o tipo `EntityManager` usado por `OutboxPublisher.updateGauges()`.
- Adicionar métrica explícita para conflitos de idempotência e deadlocks.
- Propagar `correlationId` do HTTP para `WageringService` e reconciliação.
- Documentar e testar `REFERENCE_NOT_PROCESSED` em `FailureCodes.md`.
- Decidir se eventos que excedem tentativas precisam de DLQ de eventos separada ou permanecem recuperáveis na outbox.
- Revisar `MessagingCoordinator` para garantir que shutdown não aguarde timers desnecessariamente.
- Verificar se a fila de eventos precisa de redrive policy própria.

## Documentação ainda não atualizada

- `docs/brain/entities/InboxOutbox.md`;
- `docs/brain/services/MessagingWorkers.md`;
- `docs/brain/services/ReconciliationService.md`;
- `docs/brain/resources/SqsMessages.md`;
- `docs/brain/resources/IntegrationEvents.md`;
- `docs/brain/conventions/Observability.md`;
- `docs/brain/product/FailureCodes.md`;
- `docs/runbooks/Operations.md`;
- `docs/HARDENING.md` e `README.md`;
- `docs/brain/log.md`;
- checklists/status de ISSUE-01.4, 01.5 e 01.6 somente após testes verdes.

## Comandos finais planejados

```sh
docker compose -f compose.yaml -f compose.hardening.yaml down -v
docker compose -f compose.yaml -f compose.hardening.yaml up -d --build postgres localstack
docker compose -f compose.yaml -f compose.hardening.yaml run --rm app bun run migration:fresh
docker compose -f compose.yaml -f compose.hardening.yaml up -d --scale app=3 app
docker compose -f compose.yaml -f compose.hardening.yaml run --rm test bun run hardening
docker compose -f compose.yaml -f compose.hardening.yaml down -v
```

Não declarar conclusão se qualquer etapa acima falhar ou se a matriz crash/restart ainda não tiver evidência.
