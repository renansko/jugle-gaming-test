# Evidência de testes unitários

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
    Action["Action 33697194049"] --> Command["bun run check"]
    Command --> Result["87 testes aprovados"]
```

O job `check` do Action 33697194049 aprovou **87 testes unitários**, com lint e
TypeScript verdes. O job `integration` repetiu essa suíte dentro de
`bun run hardening` antes dos testes com dependências reais.

## Referências no código

- [Testes unitários](../tests/unit)
- [Script `test:unit`](../package.json)
- [Workflow de CI](../.github/workflows/ci.yml)
- [Action verde — job `check`](https://github.com/renansko/jugle-gaming-test/actions/runs/33697194049)
