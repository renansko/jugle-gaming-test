# Idempotency

## Identidade

O header/campo `idempotencyKey` é a fonte da verdade. `(providerId, externalTransactionId)` oferece uma segunda barreira de unicidade.

## Hash

Selecionar somente campos de negócio, normalizar dinheiro para duas casas, ordenar chaves recursivamente, serializar JSON UTF-8 sem espaços e calcular SHA-256 hexadecimal. Metadados de transporte ficam fora.

## Decisão

- chave inexistente: tentar inserir e processar;
- mesma chave e mesmo hash: retornar resposta original com replay;
- mesma chave e hash diferente: `IDEMPOTENCY_CONFLICT`;
- corrida de insert: capturar unique violation e reler dentro de nova tentativa curta, tanto pela chave quanto pela identidade do provider; payload diferente é conflito.

## SQS

Inbox deduplica `(consumerName, messageId)` e também compara hash. A deduplicação FIFO é apenas uma otimização temporal.

## Proibição

Cache em memória, singleton e confiança exclusiva no broker não satisfazem a garantia multi-instância.
