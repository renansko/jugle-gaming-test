# Manutenção do Brain

1. Comece por `index.md`.
2. Leia as páginas do conceito antes de modificar código relacionado.
3. Confirme contratos críticos em código, migrations e testes.
4. Atualize o Brain quando comportamento, contrato ou integração mudar.
5. Registre contexto não óbvio; não copie a implementação.
6. Não crie páginas para detalhes triviais ou privados.
7. Mantenha cada página com menos de 100 linhas.
8. Atualize índice e log ao adicionar, remover ou renomear páginas.
9. Valide links relativos e âncoras.
10. Não inclua segredos ou dados sensíveis.

## Backlinks planejados

Classes e casos de uso públicos devem receber comentários `@wiki`, por exemplo:

```ts
/**
 * @wiki docs/brain/entities/Wallet.md
 * @wiki docs/brain/services/WageringService.md
 */
```

