# Evidência de testes unitários — issue #13

## Visão geral e objetivo

```mermaid
flowchart LR
    Domain["Domínio"] --> Unit["Testes unitários"]
    App["Aplicação"] --> Unit
    Infra["Infraestrutura"] --> Unit
    Unit --> Fast["Feedback determinístico"]
```

Provar regras isoladas, contratos documentais e instrumentação sem depender da
stack distribuída.

## Contexto do problema

```mermaid
flowchart TD
    Change["Mudança"] --> Test{"Contrato unitário verde?"}
    Test -->|"Não"| Stop["Interromper gate"]
    Test -->|"Sim"| Next["Avançar para testes reais"]
```

Testes unitários reduzem o espaço de falha, mas não comprovam PostgreSQL, SQS
ou disputa entre réplicas.

## Decisões e trade-offs

```mermaid
flowchart LR
    Isolated["Isolado e rápido"] --> Chosen["Unidade"]
    Real["Dependências reais"] --> Integration["Integração"]
    Chosen --> Gate["Gate combinado"]
    Integration --> Gate
```

A evidência unitária é apresentada separadamente para não sugerir cobertura de
integrações reais.

## Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Avaliador
    participant Bun as Bun test
    participant Tests as tests/unit
    Dev->>Bun: bun run test:unit
    Bun->>Tests: Executa especificações
    Tests-->>Bun: Aprova ou falha
    Bun-->>Dev: Exit code
```

## Estrutura e invariantes

```mermaid
flowchart TD
    Money["Money exato"] --> Suite["Unidade"]
    Wallet["Saldo e ledger"] --> Suite
    Idempotency["Idempotência"] --> Suite
    Metrics["Métricas e dashboard"] --> Suite
    Docs["Contratos documentais"] --> Suite
```

O conjunto cobre domínio financeiro, aplicação, workers, observabilidade e os
contratos de documentação executáveis.

## Resiliência e falhas

```mermaid
flowchart TD
    Command["bun run test:unit"] --> Exit{"Exit code 0?"}
    Exit -->|"Não"| Reject["Evidência inválida"]
    Exit -->|"Sim"| Record["Registrar contagem"]
```

Falha, timeout ou interrupção invalidam a execução; não se registra resultado
parcial como suíte verde.

## Evidência verificável

```mermaid
flowchart LR
    Command["bun run check"] --> Current["85 testes aprovados"]
    Baseline["Hardening registrado"] --> Result["79 testes aprovados"]
```

O check local em Docker de 2026-09-02 aprovou **85 testes unitários**, com lint
e TypeScript verdes. O hardening registrado em 2026-09-01 aprovou **79**; essa
contagem anterior permanece identificada para não reescrever evidência
histórica. A execução pública atual deve ser consultada no CI.

## Referências no código

- [Testes unitários](../tests/unit)
- [Script `test:unit`](../package.json)
- [Workflow de CI](../.github/workflows/ci.yml)
- [Issue #13](https://github.com/renansko/jugle-gaming-test/issues/13)
