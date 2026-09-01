# ISSUE-01.2 — Núcleo financeiro auditável

## Estado

`COMPLETED` · prioridade crítica · depende de: ISSUE-01.1.

## Resultado esperado

Domínio monetário exato, wallet consistente e ledger append-only protegidos também pelo schema PostgreSQL.

## Escopo

- `Money`, `Wallet`, `WagerTransaction` e `WalletLedgerEntry`;
- factories `create/from/rehydrate` e transições explícitas;
- schema com constraints, uniques, FKs e índices;
- criação e consulta de wallet e ledger paginado;
- `OPENING` e crédito inicial na mesma transação.

## Tarefas

- [x] Implementar `Money` imutável com `decimal.js` e escala 2.
- [x] Implementar aggregate `Wallet` com versionamento e saldo não negativo.
- [x] Implementar estados terminais de `WagerTransaction`.
- [x] Implementar ledger imutável e validação `before ± amount = after`.
- [x] Criar entities/mappers MikroORM sem decorators no domínio.
- [x] Criar migration com `numeric(20,2)` e constraints obrigatórias.
- [x] Implementar `POST/GET /wallets` e consulta paginada do ledger.
- [x] Adicionar backlinks `@wiki` aos símbolos públicos.

## Critérios de aceite

- [x] Nenhum caminho monetário usa `number` ou ponto flutuante.
- [x] Uma wallet por `(playerId, currency)` é garantida no banco.
- [x] `balance >= 0` e `version >= 1` são constraints reais.
- [x] Saldo inicial positivo cria uma `OPENING` e um crédito atomicamente.
- [x] `LOSS` e rejeições não geram ledger.
- [x] Ledger não pode ser alterado/excluído pelo papel da aplicação.
- [x] Cursor do ledger é opaco e estável.

## Testes/evidências

- `tests/unit/domain/money.spec.ts`: precisão sem float drift, subtração com `INSUFFICIENT_FUNDS` e rejeição de moedas divergentes.
- `tests/unit/domain/wallet.spec.ts`: aggregate com versionamento e bloqueio de saldo negativo.
- `tests/unit/domain/wallet-ledger-entry.spec.ts`: validação matemática `before ± amount = after`.
- `tests/unit/domain/wager-transaction.spec.ts`: estados terminais e transições válidas.
- `tests/unit/application/wallet.service.spec.ts`: criação com `OPENING` e paginação com cursor.

## Fora de escopo

Regras completas de aposta, SQS, inbox/outbox e concorrência multi-instância.

## Documentação relacionada

[Money](../../docs/brain/entities/Money.md) · [Wallet](../../docs/brain/entities/Wallet.md) · [Ledger](../../docs/brain/entities/WalletLedgerEntry.md)
