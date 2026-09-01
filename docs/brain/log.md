# Log

- 2026-08-31 | planejamento inicial | Brain, arquitetura e plano de entrega do Distributed Wagering Processor.
- 2026-08-31 | ISSUE-01 | Plano convertido em seis issues executáveis em `prd/issue-01`.
- 2026-08-31 | ISSUE-01.1 | Fundação NestJS/Bun com configuração validada, migration reversível, LocalStack FIFO/DLQ e health checks.
- 2026-08-31 | ISSUE-01.2 | Núcleo financeiro com valores exatos, wallet versionada, ledger append-only e API de wallets paginada.
- 2026-08-31 | ISSUE-01.4 | Inbox/outbox persistentes, eventos versionados e workers SQS com publicação concorrente e lease recuperável.
- 2026-08-31 | ISSUE-01.3 | Processamento idempotente de apostas com hash canônico, lock por wallet, releitura pela chave ou identidade do provider, retry limitado para deadlock/serialização, referências auditáveis e API de consulta/submissão.
- 2026-08-31 | ISSUE-01.5 | Reprocessamento recuperável de referências pendentes, expiração auditável e reconciliação somente leitura do ledger.
- 2026-08-31 | ISSUE-01.6 | Fluxo reproduzível de hardening com três réplicas, suítes HTTP/concorrência, inspeção de índices e validação de links do Brain.
- 2026-08-31 | WagerTransaction | Formalização e testes da máquina de estados, transições válidas e proteção de estados terminais.
- 2026-08-31 | TDD Suite | Conclusão e validação estrita (52 testes unitários, Biome lint e TSC limpo) para ISSUE-01.1, ISSUE-01.2 e ISSUE-01.3.
