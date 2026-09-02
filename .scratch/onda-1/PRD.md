# Onda 1 — Mensageria confiável e recuperação

Status: `CONCLUÍDA`

Fonte: `prd/issue-01/prd-waves-0-1-reliable-messaging-execution.md`.

A Onda 0 foi concluída com três execuções consecutivas do hardening. A Onda 1
foi executada em três trilhas e encerrada por um gate integrado. As issues
operacionais concluídas foram removidas; o histórico permanente permanece no
PRD fonte, no Brain e nas evidências de hardening.

O gate integrado foi concluído em 2026-09-02 sobre stack limpa, com PostgreSQL,
LocalStack e três réplicas saudáveis. A regressão registrou 79 testes unitários,
19 de integração e 4 de concorrência, todos verdes.

## Entregas concluídas

- consumidor SQS atômico;
- publicação outbox recuperável;
- referências pendentes recuperáveis;
- gate integrado da Onda 1.

## Regras

- Cada issue segue RED, GREEN, REFACTOR e registra evidências.
- PostgreSQL e LocalStack reais são obrigatórios nos cenários críticos.
- Alterações compartilhadas são integradas serialmente pelo mantenedor.
- Nenhuma issue fecha sem critérios de aceite, Brain e regressão atualizados.
