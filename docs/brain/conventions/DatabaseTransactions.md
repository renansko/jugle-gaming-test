# Database Transactions

## Regra

Tudo que confirma uma operação financeira participa da mesma transação PostgreSQL: idempotência/transação, wallet, ledger, inbox quando aplicável e outbox.

## Aplicação

- abrir transação na camada de aplicação via Unit of Work;
- adquirir locks em ordem determinística;
- evitar chamadas de rede enquanto houver transação aberta;
- confirmar antes de ack ou publicação;
- rollback completo em erro transitório.

## Migrations

Cada migration possui `up` e `down`, nome ordenável e escopo pequeno. CI executa banco vazio `up`, `down` da última mudança e novo `up`. Mudança destrutiva de produção exigiria estratégia expand/contract.

## Constraints

Unicidade, saldo não negativo, enums/estados e integridade referencial pertencem ao schema. Validação em TypeScript melhora mensagens, mas não substitui o banco.

## Risco evitado

Commits parciais criariam saldo sem ledger, inbox sem efeito ou evento perdido.

