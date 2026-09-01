# ReconciliationService

## Responsabilidade

Reconstruir o saldo de uma wallet a partir do ledger e compará-lo ao saldo materializado.

## Dependências

Repositórios de wallet e ledger, logger estruturado e contador de divergências.

## Contrato

Retorna `storedBalance`, `calculatedBalance`, `difference`, `consistent` e `checkedEntries`. Usa a entrada `OPENING` como origem do saldo reconstruído.

## Regras

- operação somente leitura;
- não corrige divergência automaticamente;
- valores permanecem `Money`/strings decimais;
- divergência gera log e métrica sem expor payload financeiro completo.

## Operação

- referências pendentes são reivindicadas com lease recuperável, reprocessadas com backoff e expiram por TTL;
- a expiração termina em `REFERENCE_NOT_FOUND` e grava o evento de rejeição na outbox;
- o endpoint `POST /wallets/:walletId/reconciliation` devolve os valores decimais como strings, inclusive a diferença com sinal.

## Código planejado

`src/application/wallet/reconcile-wallet.ts`.
