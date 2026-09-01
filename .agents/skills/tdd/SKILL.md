---
name: tdd
description: >-
  Executa o ciclo rigoroso de Test-Driven Development (Red-Green-Refactor) antes de escrever qualquer código de produção.
  Use sempre ao iniciar uma nova demanda, implementar uma funcionalidade ou corrigir bugs no repositório.
---

# TDD Skill: Red-Green-Refactor Loop

Esta skill guia o agente no desenvolvimento estrito orientado a testes (TDD). A regra inegociável é: **nenhum código de produção é escrito sem um teste prévio falhando**.

---

## 🔁 O Ciclo Red-Green-Refactor

```mermaid
stateDiagram-v2
    [*] --> RED : Nova Feature ou Bugfix
    
    RED --> GREEN : Escrever Teste que Falha
    note right of RED: 1. Definir comportamento e contrato\n2. Executar e confirmar falha real
    
    GREEN --> REFACTOR : Implementar Código Mínimo
    note right of GREEN: 1. Fazer o teste passar\n2. Não antecipar otimizações
    
    REFACTOR --> RED : Próximo Caso de Teste
    note right of REFACTOR: 1. Melhorar design e clareza\n2. Eliminar duplicações\n3. Garantir suite verde
    
    REFACTOR --> [*] : Todos os Cenários Cobertos
```

---

## 📋 Regras de Ouro

1. **Red (Teste Primeiro)**:
   - Escreva o teste antes da implementação.
   - O teste deve verificar comportamento público observável, contratos e invariantes.
   - Execute o teste e confirme que ele realmente falha pelo motivo esperado (não por erro de sintaxe/importação).
2. **Green (Código Mínimo)**:
   - Escreva apenas o código estritamente necessário para fazer o teste passar.
   - Evite antecipar abstrações desnecessárias antes de ter testes que as justifiquem.
3. **Refactor (Limpeza sem quebras)**:
   - Com os testes verdes, refatore o código para melhorar nomes, modularidade e desacoplamento.
   - Execute a suíte de testes completa para garantir zero regressões.
4. **Bugfix via TDD**:
   - Nunca corrija um bug diretamente.
   - Escreva um teste que reproduza exatamente o bug reportado (Red), depois corrija o código até o teste passar (Green).

---

## 📂 Referências

- [aihero.dev/skills-tdd](https://www.aihero.dev/skills-tdd)
