# Hardening e evidências

## Execução limpa

Use os comandos de “Hardening em três instâncias” do [README](../README.md). Eles sobem PostgreSQL e LocalStack, validam `up/down/up`, iniciam três réplicas do serviço e executam `bun run hardening` no container de testes.

O comando cobre `bun run check`, integração HTTP, concorrência, índices, planos SQL e links do Brain. A saída do job de CI é a evidência versionável de versões, duração e resultado.

## Evidência do gate da Onda 1

Em 2026-09-02, a issue local 04 foi executada após `down -v`. As migrations
passaram por `up → down → up`, e três réplicas `app` permaneceram saudáveis
antes e durante o runner iniciado com `--no-deps`.

O comando `bun run hardening` concluiu sem falhas:

- Biome e TypeScript verdes;
- 79 testes unitários, 19 de integração e 4 de concorrência;
- índices de outbox, referência pendente, ledger e lookup do provider verificados;
- 23 links internos do Brain validados.

O cenário `messaging.spec.ts` demonstra entrada SQS, inbox e operação financeira
atômicas, ledger reconciliado, outbox e publicação na fila de eventos. O cenário
`pending-reference.spec.ts` demonstra referência fora de ordem, resolução pelo
worker, reconciliação e rejeição terminal publicada para órfãos expirados.

## Cenários demonstrados

- 50 reentregas simultâneas com a mesma chave produzem uma única aposta e um único débito;
- duas apostas de 80 sobre saldo 100 terminam em uma processada, uma rejeitada e saldo 20;
- após cada cenário, a reconciliação compara o saldo da wallet ao ledger e exige igualdade;
- `verify:database` confirma os índices de outbox, referência pendente, ledger e lookup do provedor e imprime os planos SQL.

## Roteiro curto

1. Explique que PostgreSQL, não a fila, guarda as invariantes por meio de transação, uniques e lock por wallet.
2. Rode o teste de 50 retries e mostre uma transação/lançamento para o débito.
3. Rode a disputa 100–80–80 e mostre a reconciliação com saldo 20.
4. Mostre `PENDING_REFERENCE`, backoff e o endpoint de reconciliação como caminhos de recuperação, sem correção automática.

## Crash, retry e DLQ

Depois de um commit, a reentrega encontra inbox/idempotência e não recria efeito. Se a publicação falhar, o registro da outbox permanece elegível depois do lease e outro publisher o reivindica. Payload inválido ou conflito de `messageId` segue para a DLQ; consulte `docs/runbooks/Operations.md` antes de qualquer ação manual.

## Carga curta

O comando `bun run test:load`, documentado no README, mede uma massa isolada em
três réplicas, valida contagens e reconciliação e exige convergência da outbox.
O CI publica `artifacts/load-report.*`; desempenho não é gate de aprovação.

## Limitações atuais

Não há meta artificial de RPS, double-entry ledger, IdP completo ou deploy AWS.
Entrega SQS/outbox é
`at-least-once`; consumidores downstream devem deduplicar pelo ID estável do
evento. Lifecycle completo de processo e a matriz ampla de crash/restart
permanecem nos gates posteriores, não cobertos pelo fechamento da Onda 1.
