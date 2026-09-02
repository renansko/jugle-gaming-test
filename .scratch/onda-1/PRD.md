# Onda 1 — Mensageria confiável e recuperação

Status: `READY`

Fonte: `prd/issue-01/prd-waves-0-1-reliable-messaging-execution.md`.

A Onda 0 foi concluída com três execuções consecutivas do hardening. A Onda 1
avança em três trilhas AFK que podem iniciar em paralelo. A integração de
componentes compartilhados e o fechamento das trilhas seguem os bloqueios
descritos nas issues abaixo. As Ondas 2–4 permanecem bloqueadas.

## Issues

- [01 — Consumidor SQS atômico](issues/01-consumidor-sqs-atomico.md)
- [02 — Publicação outbox recuperável](issues/02-publicacao-outbox-recuperavel.md)
- [03 — Referências pendentes recuperáveis](issues/03-referencias-pendentes-recuperaveis.md)
- [04 — Gate integrado da Onda 1](issues/04-gate-integrado-onda-1.md)

## Regras

- Cada issue segue RED, GREEN, REFACTOR e registra evidências.
- PostgreSQL e LocalStack reais são obrigatórios nos cenários críticos.
- Alterações compartilhadas são integradas serialmente pelo mantenedor.
- Nenhuma issue fecha sem critérios de aceite, Brain e regressão atualizados.
