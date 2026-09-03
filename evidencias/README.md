# Catálogo de evidências executadas

## Visão geral e objetivo

```mermaid
mindmap
  root((Evidências))
    Unidade
    Integração
    Concorrência
    Carga curta
```

Este catálogo liga cada afirmação verificável ao comando, ao resultado registrado
e ao [Action verde](https://github.com/renansko/jugle-gaming-test/actions/runs/33705456587)
que permite auditá-la.

## Contexto do problema

```mermaid
flowchart TD
    Claim["Afirmação no README"] --> Proof{"Possui prova rastreável?"}
    Proof -->|"Não"| Risk["Resultado não auditável"]
    Proof -->|"Sim"| Evidence["Comando + resultado + fonte"]
```

Uma contagem isolada não demonstra comportamento. A evidência precisa separar
suítes funcionais, concorrência e desempenho, além de declarar limitações.

## Decisões e trade-offs

```mermaid
flowchart LR
    Raw["Log bruto"] --> Detail["Completo, porém volátil"]
    Versioned["Resumo versionado"] --> Choice["Rastreável e legível"]
    CI["Execução pública"] --> Audit["Fonte independente"]
    Choice --> Audit
```

Os resumos Markdown preservam resultados estáveis; o CI é a autoridade para a
execução pública. Artefatos temporários de runtime não são versionados.

## Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Reviewer as Avaliador
    participant Readme as README
    participant Evidence as Evidência
    participant Source as Teste ou CI
    Reviewer->>Readme: Seleciona uma prova
    Readme->>Evidence: Abre o resumo versionado
    Evidence->>Source: Informa comando e fonte
    Reviewer->>Source: Reproduz ou audita
```

## Estrutura e invariantes

```mermaid
flowchart TD
    Catalog["evidencias/README.md"] --> Unit["testes-unitarios.md"]
    Catalog --> Integration["testes-integracao.md"]
    Catalog --> Concurrency["testes-concorrencia.md"]
    Catalog --> Load["carga-curta.md"]
    Load --> Invariant["wallet.balance = ledger"]
```

Cada arquivo contém escopo, comando, resultado, interpretação e limitações.
Resultados de carga nunca são promovidos a meta mínima de RPS.

## Resiliência e falhas

```mermaid
flowchart TD
    Run["Executar validação"] --> Exit{"Exit code zero?"}
    Exit -->|"Não"| Fail["Não publicar como prova verde"]
    Exit -->|"Sim"| Contract{"Invariantes válidas?"}
    Contract -->|"Não"| Fail
    Contract -->|"Sim"| Publish["Registrar evidência"]
```

Uma execução falha por erro técnico ou quebra de invariante, não por throughput
abaixo de um valor arbitrário.

## Evidência verificável

```mermaid
flowchart LR
    Unit["Unidade: 152"] --> Gate["Hardening: 185 testes"]
    Integration["Integração: 28"] --> Gate
    Concurrency["Concorrência: 5"] --> Gate
    Load["Carga CI: 1.398 requisições"] --> Report["Artefato do Action"]
```

| Evidência | Resultado versionado |
|---|---|
| [Testes unitários](testes-unitarios.md) | 152 aprovados |
| [Testes de integração](testes-integracao.md) | 28 aprovados |
| [Testes de concorrência](testes-concorrencia.md) | 5 aprovados em três réplicas |
| [Carga curta](carga-curta.md) | 1.398 requisições; 0 falhas técnicas; invariantes válidas |

## Referências no código

- [Suítes de testes](../tests)
- [Workflow de CI](../.github/workflows/ci.yml)
- [Relatório de carga](../docs/load/short-load-report.md)
- [Action verde — run 33705456587](https://github.com/renansko/jugle-gaming-test/actions/runs/33705456587)
