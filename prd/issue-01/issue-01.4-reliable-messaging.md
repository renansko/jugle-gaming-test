# ISSUE-01.4 — Mensageria confiável

## Estado

`IN PROGRESS` · prioridade crítica · depende de: ISSUE-01.3.

## Resultado esperado

Entrada e saída SQS `at-least-once` sem duplicar efeitos, com inbox/outbox atômicos, retry, DLQ e recuperação multi-instância.

## Escopo

- consumidor da fila `wager-transactions.fifo`;
- inbox persistente por `(consumerName, messageId)`;
- transactional outbox e eventos mínimos versionados;
- publishers concorrentes com `SKIP LOCKED` e lease recuperável;
- classificação de erros, retry/backoff, DLQ e shutdown gracioso.

## Tarefas

- [ ] Validar envelope SQS e reaproveitar `ProcessWagerTransaction`.
- [ ] Persistir inbox, efeitos financeiros e outbox na mesma transação.
- [ ] Fazer ack somente após commit.
- [x] Criar classes concretas para os quatro eventos mínimos.
- [x] Implementar publisher em lotes sem lock durante chamada de rede.
- [ ] Implementar retry exponencial com jitter e limite de tentativas.
- [ ] Encaminhar falhas permanentes/esgotadas à DLQ.
- [ ] Tratar `SIGTERM`, trabalho em voo e visibility timeout.

## Critérios de aceite

- [ ] Redelivery após commit/antes do ack não duplica saldo ou ledger.
- [ ] Crash após commit/antes de publicar deixa evento recuperável.
- [ ] Dois publishers não perdem eventos nem duplicam indefinidamente.
- [ ] Erro de negócio faz ack; transitório volta; permanente chega à DLQ.
- [ ] `WalletBalanceChanged` só existe quando o saldo muda.
- [ ] Inbox detecta `messageId` reutilizado com payload divergente.
- [ ] Nenhum evento é publicável antes do commit financeiro.

## Testes/evidências

Usar PostgreSQL e LocalStack reais para redelivery, dois publishers, indisponibilidade temporária, DLQ, reinício e shutdown.

## Fora de escopo

Reconciliação, expiração de referências, dashboards e autenticação externa.

## Documentação relacionada

[Inbox/Outbox](../../docs/brain/entities/InboxOutbox.md) · [Workers](../../docs/brain/services/MessagingWorkers.md) · [Eventos](../../docs/brain/resources/IntegrationEvents.md)
