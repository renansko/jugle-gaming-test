# Testing

## Unidade

Testar Money, Wallet, transições, referências, conflito de moeda, falhas e hash canônico sem NestJS ou banco.

## Integração

Usar PostgreSQL e LocalStack reais em containers para migrations/constraints, atomicidade, inbox, outbox, retry, DLQ e recuperação.

## Concorrência obrigatória

- mesma aposta 50 vezes em paralelo gera um débito;
- duas apostas de 80 disputam saldo 100;
- wallets distintas avançam em paralelo;
- pelo menos três instâncias processam simultaneamente;
- crash após commit e antes do ack;
- dois publishers disputam outbox;
- referência chega antes da origem;
- reinício preserva consistência final.

## Invariante final

Cada teste relevante consulta o banco e confirma `wallet.balance == saldo reconstruído pelo ledger`, além de contagens de transação, ledger e outbox.

## Determinismo

Relógio, UUID e jitter são injetáveis; testes de race usam barreiras/latches, não sleeps como sincronização principal.

Em `NODE_ENV=test`, loops automáticos de mensageria ficam desabilitados por padrão. `TEST_WORKERS_AUTOSTART` só é válido nesse ambiente; o harness invoca consumer, publisher e worker de referências de forma dirigida, ainda contra PostgreSQL e LocalStack reais.

O consumer mantém long poll de 20 segundos em produção. Chamadas dirigidas do
harness usam 1 segundo para não transformar fila vazia em espera ou timeout do
teste.

O harness drena a outbox em lotes limitados até ficar ociosa. Testes que inspecionam a fila de eventos removem todas as mensagens recebidas, evitando resíduos entre repetições sobre a mesma stack.

## Hardening reproduzível

`compose.hardening.yaml` remove a porta host da aplicação e o Compose escala `app` para três instâncias. O serviço `test` acessa `http://app:3000` pela rede interna; assim, retries e disputas percorrem réplicas reais com PostgreSQL e LocalStack compartilhados. `bun run hardening` reúne integração, concorrência, inspeção de índices/planos e validação dos links do Brain.
