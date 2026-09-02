# Instruções para Agentes

## Desenvolvimento Orientado a Testes (TDD Obrigatório)

Sempre comece qualquer demanda, nova funcionalidade ou correção de bug utilizando o fluxo de **TDD (Red-Green-Refactor)**:

1. **Red**: Escreva primeiro um teste que falha (expressando o comportamento, entrada/saída e contratos esperados).
2. **Green**: Implemente o código mínimo necessário para fazer o teste passar.
3. **Refactor**: Melhore a qualidade, arquitetura e limpeza do código mantendo a suíte de testes verde.
4. **Regra de Ouro**: Nunca escreva código de produção sem um teste prévio que falhe. Em correções de bugs, sempre reproduza a falha com um teste antes da correção.
5. Referência: [/tdd (aihero.dev)](https://www.aihero.dev/skills-tdd).

---

## Brain de Contexto

Antes de alterar módulos já documentados, leia [docs/brain/index.md](docs/brain/index.md) e consulte as páginas relacionadas.

O Brain registra contratos, invariantes, decisões, relações entre módulos e regras que não são fáceis de inferir apenas do código. Ele não substitui testes, ADRs ou documentação de API.

Quando uma alteração modificar comportamento, contrato, efeito colateral, integração ou regra de produto, atualize o código e o Brain no mesmo trabalho.

### Regras de Manutenção do Brain:

- confirme contratos importantes no código e nos testes antes de editar a documentação;
- não duplique implementação nem crie páginas para código trivial;
- corrija documentação obsoleta junto com a mudança que a tornou obsoleta;
- mantenha cada página com menos de 100 linhas;
- use nomes estáveis em `PascalCase` para páginas conceituais;
- mantenha links relativos e âncoras válidos;
- atualize o índice (`docs/brain/index.md`) quando páginas forem criadas, removidas ou renomeadas;
- registre mudanças relevantes em `docs/brain/log.md` no formato: `data | issue/PR | escopo`;
- nunca inclua segredos, credenciais, tokens, payloads reais ou dados pessoais.

---

## Qualidade de Código e Complexidade Ciclomática

- **Complexidade Ciclomática Máxima: 6**: Nenhuma função, método ou rotina deve ultrapassar a complexidade ciclomática de 6. Em caso de muitas ramificações (`if`, `else`, `switch/case`, loops, ternários ou operadores lógicos encadeados), refatore imediatamente extraindo funções auxiliares com responsabilidade única, utilizando *early returns* ou aplicando estratégias/handlers dedicados.
- **Legibilidade Humana e Clean Code**: O código deve priorizar a clareza para leitura humana. Utilize variáveis com nomes semânticos e descritivos, quebras verticais de linha entre etapas lógicas, interfaces/tipos explícitos e queries SQL bem formatadas em blocos legíveis.

## Agent skills

### Issue tracker

Issues são mantidas como markdown em `.scratch/<feature>/issues/`. Consulte `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os labels padrão `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` e `wontfix`. Consulte `docs/agents/triage-labels.md`.

### Domain docs

O repositório usa contexto único documentado no Brain e em `ARCHITECTURE.md`. Consulte `docs/agents/domain.md`.
