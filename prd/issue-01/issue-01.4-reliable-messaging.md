# ISSUE-01.4 — Mensageria confiável

## Estado

`DONE` · prioridade crítica · depende de: ISSUE-01.3.

## Resultado esperado

Entrada e saída SQS `at-least-once` sem duplicar efeitos, com inbox/outbox atômicos, retry, DLQ e recuperação multi-instância.

## Escopo

- consumidor da fila `wager-transactions.fifo`;
- inbox persistente por `(consumerName, messageId)`;
- transactional outbox e eventos mínimos versionados;
- publishers concorrentes com `SKIP LOCKED` e lease recuperável;
- classificação de erros, retry/backoff, DLQ e shutdown gracioso.

## Tarefas

- [x] Validar envelope SQS e reaproveitar `ProcessWagerTransaction`.
- [x] Persistir inbox, efeitos financeiros e outbox na mesma transação.
- [x] Fazer ack somente após commit.
- [x] Criar classes concretas para os quatro eventos mínimos.
- [x] Implementar publisher em lotes sem lock durante chamada de rede.
- [x] Implementar retry exponencial com jitter e limite de tentativas.
- [x] Encaminhar falhas permanentes/esgotadas à DLQ.
- [x] Tratar `SIGTERM`, trabalho em voo e visibility timeout.

## Critérios de aceite

- [x] Redelivery após commit/antes do ack não duplica saldo ou ledger.
- [x] Crash após commit/antes de publicar deixa evento recuperável.
- [x] Dois publishers não perdem eventos nem duplicam indefinidamente.
- [x] Erro de negócio faz ack; transitório volta; permanente chega à DLQ.
- [x] `WalletBalanceChanged` só existe quando o saldo muda.
- [x] Inbox detecta `messageId` reutilizado com payload divergente.
- [x] Nenhum evento é publicável antes do commit financeiro.

## Testes/evidências

Usar PostgreSQL e LocalStack reais para redelivery, dois publishers, indisponibilidade temporária, DLQ, reinício e shutdown.

## Fora de escopo

Reconciliação, expiração de referências, dashboards e autenticação externa.

## Documentação relacionada

[Inbox/Outbox](../../docs/brain/entities/InboxOutbox.md) · [Workers](../../docs/brain/services/MessagingWorkers.md) · [Eventos](../../docs/brain/resources/IntegrationEvents.md)
