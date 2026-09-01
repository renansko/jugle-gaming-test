# Money

## Propósito

Value object imutável para representar valor decimal exato e moeda ISO-4217 sem usar ponto flutuante.

## Estado

- `amount`: decimal com escala fixa de duas casas, serializado como string.
- `currency`: código ISO-4217 em maiúsculas.

## Invariantes

- rejeitar vazio, sinal inesperado, `NaN`, infinito e notação científica;
- rejeitar mais de duas casas e contratos de entrada negativos;
- operações exigem moedas iguais;
- toda operação retorna nova instância;
- JSON sempre usa `{ amount: string, currency: string }`.

## Persistência

Mapear para `numeric(20,2)` e `char(3)`. O adaptador recebe string do driver e reidrata `Money`; nenhuma fronteira pode converter o valor para `number`.

## Código planejado

`src/domain/shared/money.ts` e testes em `tests/unit/domain/money.spec.ts`.

