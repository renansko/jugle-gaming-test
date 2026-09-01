# Distributed Wagering Processor

Planejamento de um serviço financeiro distribuído para processar apostas de múltiplos provedores, baseado no [desafio da Jungle Gaming](https://github.com/junglegaming/backend-challenge). A documentação segue a proposta de wiki enxuta do [LLM Brain Backend](https://github.com/renansko/llm-brain-backend).

## Stack decidida

| Área | Escolha |
|---|---|
| Runtime, pacotes e testes | Bun 1.x |
| Linguagem | TypeScript estrito |
| Framework | NestJS |
| Persistência | PostgreSQL + MikroORM |
| Mensageria | AWS SQS FIFO via LocalStack |
| Ambiente local | Docker Compose |
| Migrations | MikroORM, versionadas com `up` e `down` |

## Comece aqui

1. [Plano de entrega](docs/DELIVERY_PLAN.md) — fases, critérios e sequência de implementação.
2. [Arquitetura](ARCHITECTURE.md) — decisões, limites e estratégia transacional.
3. [Brain](docs/brain/index.md) — mapa de domínio, contratos e convenções.
4. [ISSUE-01](prd/issue-01/README.md) — backlog executável derivado do plano de entrega.

## Objetivo técnico

Preservar, com múltiplas instâncias e entrega `at-least-once`, estas invariantes:

- dinheiro nunca usa ponto flutuante;
- saldo nunca fica negativo;
- cada mudança de saldo corresponde a exatamente um lançamento imutável;
- reentregas não duplicam efeitos;
- eventos só ficam publicáveis após o commit financeiro;
- o saldo materializado sempre pode ser reconciliado com o ledger.

## Escopo inicial

O MVP inclui API HTTP, consumidor SQS, inbox/outbox transacionais, reprocessamento de referências, DLQ, reconciliação, health checks, métricas e testes reais de concorrência. Autenticação será representada por uma porta/guard sem implementação de IdP no primeiro timebox.

## Estrutura planejada do código

```text
src/
├── domain/          # Entidades, value objects, eventos e erros puros
├── application/     # Casos de uso e portas
├── infrastructure/  # MikroORM, PostgreSQL, SQS, workers e telemetria
└── interfaces/      # HTTP, DTOs, validação e composição NestJS
tests/
├── unit/
├── integration/
├── concurrency/
└── fixtures/
```

## Executar localmente

Pré-requisitos: Docker Desktop com Compose v2. O container da aplicação traz o Bun 1.1.38, portanto não exige instalação local do runtime.

```sh
cp .env.example .env
docker compose up --build
```

Serviços: aplicação em `http://localhost:3000`, PostgreSQL interno e LocalStack em `http://localhost:4566`. O bootstrap do LocalStack cria `wager-transactions.fifo` e `wager-transactions-dlq.fifo`; a primeira usa a segunda como DLQ.

Em outro terminal, confira a aplicação:

```sh
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Com Bun instalado localmente, os comandos reproduzíveis são:

```sh
bun install
bun run check
bun run migration:fresh
bun run test:integration
```

`migration:fresh` executa todas as migrations `up`, reverte o schema até a versão inicial (`down --to 0`) e executa um novo `up`. Para limpar os dados locais, execute `docker compose down -v`.

## Inspeção e Testes das Filas SQS (`awslocal`)

Para inspecionar, publicar mensagens manualmente e testar as filas e a DLQ no LocalStack, recomendamos o uso da CLI [`awslocal`](https://github.com/localstack/awscli-local).

### Instalação da CLI

- **Via pipx (recomendado)**:
  ```sh
  pipx install awscli-local awscli
  ```
- **Via pip**:
  ```sh
  pip install awscli-local awscli
  ```

### Comandos úteis para o dia a dia

1. **Listar filas ativas**:
   ```sh
   awslocal sqs list-queues
   ```

2. **Publicar uma aposta diretamente na fila SQS**:
   ```sh
   awslocal sqs send-message \
     --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
     --message-group-id "wallet-user-01" \
     --message-deduplication-id "tx-001" \
     --message-body '{"provider":"evolution","externalReference":"bet-001","userId":"usr-01","amount":5000,"currency":"BRL","type":"bet"}'
   ```

3. **Inspecionar eventos gerados (`wager-events.fifo`)**:
   ```sh
   awslocal sqs receive-message \
     --queue-url http://localhost:4566/000000000000/wager-events.fifo \
     --max-number-of-messages 10
   ```

4. **Inspecionar mensagens na Dead Letter Queue (`wager-transactions-dlq.fifo`)**:
   ```sh
   awslocal sqs receive-message \
     --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo
   ```

5. **Limpar mensagens de uma fila (purge)**:
   ```sh
   awslocal sqs purge-queue --queue-url http://localhost:4566/000000000000/wager-transactions.fifo
   ```

## Hardening em três instâncias

O fluxo final usa PostgreSQL e LocalStack reais. Ele remove a porta publicada da aplicação, inicia três réplicas internas e executa os testes pelo serviço `test` na mesma rede Docker:

```sh
docker compose -f compose.yaml -f compose.hardening.yaml down -v
docker compose -f compose.yaml -f compose.hardening.yaml up -d --build postgres localstack
docker compose -f compose.yaml -f compose.hardening.yaml run --rm app bun run migration:fresh
docker compose -f compose.yaml -f compose.hardening.yaml up -d --scale app=3 app
docker compose -f compose.yaml -f compose.hardening.yaml run --rm test bun run hardening
docker compose -f compose.yaml -f compose.hardening.yaml down -v
```

`bun run hardening` consolida as suítes de integração e concorrência, verifica os índices críticos e valida links internos do Brain. Veja [o roteiro de evidências](docs/HARDENING.md).

O primeiro `bun install` cria `bun.lock`; ele deve ser versionado junto de qualquer atualização de dependência.
