# ISSUE-01.6 — Hardening e evidências finais

## Estado

`DONE` · prioridade alta · depende de: ISSUE-01.5.

## Resultado esperado

Uma entrega reproduzível, demonstrável e resistente aos cenários eliminatórios do desafio em três ou mais instâncias.

## Escopo

- suíte final unitária, integração e concorrência;
- execução com três ou mais instâncias;
- revisão de índices, locks, hot wallet e planos SQL;
- documentação de setup, decisões, trade-offs e limitações;
- roteiro de demonstração e relatório de evidências.

## Tarefas

- [x] Automatizar ambiente de testes multi-instância.
- [x] Consolidar `bun run check`, `test:integration` e `test:concurrency`.
- [x] Verificar planos de consulta e índices das rotas/workers críticos.
- [x] Executar matriz de crash/restart e invariantes pós-teste.
- [x] Revisar migrations `up/down/up` desde banco vazio.
- [x] Validar backlinks e links do Brain.
- [x] Preparar roteiro curto de arquitetura e falhas.
- [x] Registrar limitações e próximos passos opcionais.

## Critérios de aceite

- [x] Três ou mais instâncias preservam saldo, idempotência e ledger.
- [x] Todos os cenários obrigatórios passam de modo repetível.
- [x] Toda suíte encerra confirmando saldo materializado igual ao ledger.
- [x] Setup completo funciona a partir de checkout limpo.
- [x] Documentação permite reproduzir crashes, retry e DLQ.
- [x] Nenhuma falha eliminatória permanece aberta.

## Evidências finais

Anexar comandos, versões, duração, resultado dos testes e observações de contenção. Se houver carga opcional, registrar ambiente, throughput, p50/p95/p99, erro, conflitos e outbox lag.

## Fora de escopo

Meta artificial de RPS, microserviços, double-entry ledger, IdP completo e deploy produtivo em AWS.

## Documentação relacionada

[Testes](../../docs/brain/conventions/Testing.md) · [Arquitetura](../../ARCHITECTURE.md) · [Plano](../../docs/DELIVERY_PLAN.md)
