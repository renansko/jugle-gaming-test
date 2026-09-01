# PEND-01 — Conformidade de contratos e entidades

## Objetivo

Fechar as lacunas entre o backlog de `prd/issue-01`, a implementação atual e o
[backend challenge oficial](https://github.com/junglegaming/backend-challenge).

## Conclusão da auditoria

O backlog cobre as capacidades principais: wallet, ledger, apostas, reversões,
idempotência, concorrência, mensageria, reconciliação e operação. Ele não torna
todos os contratos de entrada e todos os comportamentos das entidades critérios
de aceite verificáveis.

O desafio não exige CRUD genérico. Não há requisito de `PUT`, `PATCH` ou
`DELETE`; ledger e transações terminais são intencionalmente imutáveis.

## Cobertura por recurso

| Recurso | Issue atual | Situação |
|---|---|---|
| Criar e consultar wallet | 01.2 | coberto |
| Consultar ledger paginado | 01.2 | coberto |
| Submeter e consultar transação | 01.3 | coberto |
| BET, WIN, LOSS, REFUND e ROLLBACK | 01.3 | coberto |
| Inbox, outbox, SQS, retry e DLQ | 01.4 | coberto funcionalmente |
| Reconciliação | 01.5 | coberto |
| Health, métricas e logs | 01.1 e 01.5 | coberto |
| `Money` | 01.2 | contrato parcial |
| `Wallet` | 01.2 | coberto |
| `WagerTransaction` | 01.2 e 01.3 | modelo de domínio parcial |
| `WalletLedgerEntry` | 01.2 | coberto |
| `InboxMessage` e `OutboxMessage` | 01.4 | comportamento coberto; modelo parcial |

## Pendências obrigatórias

### 1. Alinhar DTOs ao enunciado

- aceitar `initialBalance: { amount, currency }` em `POST /wallets`;
- aceitar `money: { amount, currency }` em HTTP e SQS;
- aceitar `gameId` na transação;
- manter rejeição de campos realmente desconhecidos;
- criar testes de contrato a partir dos exemplos literais do enunciado.

Risco atual: os schemas Zod usam dinheiro achatado e, por serem estritos,
rejeitam o payload oficial que contém `gameId` e `money`.

### 2. Persistir `gameId`

- incluir `gameId` no caso de uso, entidade ORM e migration;
- incluí-lo no payload canônico usado pelo hash idempotente;
- reidratá-lo no worker de referências pendentes;
- devolvê-lo nas consultas quando fizer parte do contrato adotado.

Sem isso, duas requisições que diferem apenas pelo jogo podem ser consideradas o
mesmo payload idempotente.

### 3. Completar os contratos das entidades

- `Money`: cobrir comparações, sinal, negação e serialização textual exigidas
  pelo comportamento adotado;
- `WagerTransaction`: encapsular identidade, dados financeiros, referência,
  timestamps, estados e transições;
- `InboxMessage`: explicitar recebimento, processamento e replay divergente;
- `OutboxMessage`: explicitar enqueue, elegibilidade, publicação e retry;
- manter domínio sem decorators de NestJS ou MikroORM.

### 4. Provar os endpoints individualmente

Adicionar testes de integração para:

- criação duplicada de wallet;
- consulta de wallet existente e inexistente;
- paginação e cursor inválido do ledger;
- consulta de transação por ID interno;
- consulta por `(providerId, externalTransactionId)`;
- todos os formatos e status de erro descritos no contrato HTTP.

## Critérios de conclusão

- [ ] O payload literal de criação de wallet do desafio retorna `201`.
- [ ] O payload literal de aposta do desafio retorna resultado válido.
- [ ] O mesmo contrato funciona pela API e pela fila.
- [ ] `gameId` é persistido e participa do hash idempotente.
- [ ] Todas as entidades possuem testes públicos de comportamento.
- [ ] Os oito endpoints obrigatórios possuem testes de integração.
- [ ] `bun run check` passa.
- [ ] `bun run hardening` passa com PostgreSQL e LocalStack reais.
- [ ] A pontuação em [`pontuação.md`](pontua%C3%A7%C3%A3o.md) é reavaliada com as
  evidências finais.

## Fora de escopo

- CRUD administrativo não solicitado;
- alteração ou exclusão de ledger;
- alteração de transações terminais;
- autenticação completa com IdP;
- double-entry ledger, OpenTelemetry e teste de carga.
