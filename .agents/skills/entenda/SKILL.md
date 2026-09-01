---
name: entenda
description: >-
  Gera documentação técnica altamente visual, direta e profunda sobre arquitetura, funcionalidades e código,
  onde CADA seção possui seu próprio diagrama Mermaid (fluxograma, sequência, estados, ER, mindmap).
  Use sempre que o usuário pedir para "entender", "explicar", documentar com diagramas ou usar a skill Entenda / ELI5.
---

# Skill Entenda: Explainer Visual de Arquitetura & Código

Esta skill gera documentação técnica clara, direta e **intensamente visual**. A regra fundamental desta skill é que **cada seção conceitual deve ser acompanhada por um diagrama Mermaid contextual** (fluxogramas, diagramas de sequência, mapas mentais, diagramas de estado ou modelos ER), garantindo que o leitor compreenda o fluxo de engenharia em segundos.

---

## 🎨 Tipos de Diagramas por Seção

O Markdown suporta múltiplos formatos de diagramas Mermaid nativos. Combine o formato certo para cada seção:

| Seção | Formato Mermaid Recomendado | O que deve ilustrar |
| :--- | :--- | :--- |
| **1. Visão Geral** | `mindmap` ou `graph LR` | Fronteiras do sistema, componentes principais e responsabilidades. |
| **2. O Problema** | `sequenceDiagram` ou `graph TD` | O cenário de erro/falha que aconteceria sem a solução (ex: race condition). |
| **3. Decisões & Trade-offs** | `quadrantChart` ou `flowchart LR` | Comparativo visual entre as abordagens consideradas e a escolhida. |
| **4. Fluxo Principal** | `sequenceDiagram` | Passo a passo ponta a ponta com numeração e limites transacionais. |
| **5. Modelagem & Invariantes** | `erDiagram` ou `stateDiagram-v2` | Estrutura de dados, relacionamentos e ciclo de vida de status. |
| **6. Resiliência & Falhas** | `flowchart TD` | Árvore de decisão para idempotência, retries, DLQ e rollbacks. |

---

## 📐 Estrutura Padrão Obrigatória

Cada documento gerado deve conter:

1. **Visão Geral & Objetivo** + *Diagrama de Contexto/Mindmap*
2. **Contexto do Problema** + *Diagrama Visual do Cenário de Risco*
3. **Decisões de Arquitetura & Trade-offs** + *Diagrama Comparativo/Matriz*
4. **Fluxo Ponta a Ponta** + *Diagrama de Sequência Transacional*
5. **Estrutura de Dados & Invariantes** + *Diagrama ER / Agregados*
6. **Resiliência e Tratamento de Falhas** + *Fluxograma de Decisão de Erros*
7. **Referências no Código** + Links diretos para os arquivos

---

## 🚀 Diretrizes de Redação

- **Zero enrolação**: Títulos objetivos e texto conciso e técnico.
- **Visual-first**: O diagrama deve falar por si só; o texto serve para explicar nuances e contratos.
- **Sintaxe Segura**: Sempre usar aspas em rótulos com caracteres especiais no Mermaid (`id["Texto (Info)"]`) para evitar quebras de renderização.
