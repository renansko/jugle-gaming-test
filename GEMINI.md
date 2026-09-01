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
