# Hardening e evidências

## Execução limpa

Use os comandos de “Hardening em três instâncias” do [README](../README.md). Eles sobem PostgreSQL e LocalStack, validam `up/down/up`, iniciam três réplicas do serviço e executam `bun run hardening` no container de testes.

O comando cobre `bun run check`, integração HTTP, concorrência, índices, planos SQL e links do Brain. A saída do job de CI é a evidência versionável de versões, duração e resultado.

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

## Limitações atuais

Não há meta artificial de RPS, telemetria OpenTelemetry, double-entry ledger, IdP completo ou deploy AWS. A carga e métricas p50/p95/p99 continuam opcionais. Esta máquina não tinha o Docker Desktop ativo na preparação inicial; execute o roteiro em um runner com Docker para produzir os números finais.
