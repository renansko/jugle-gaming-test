# Funções de WageringService

## createWallet

`execute(input: CreateWalletInput): Promise<CreateWalletOutput>`

Cria uma wallet única por jogador/moeda. Saldo positivo cria `OPENING`, ledger e eventos na mesma transação. Retorna conflito para duplicata.

## processWagerTransaction

`execute(input: ProcessWagerInput, context: RequestContext): Promise<ProcessWagerOutput>`

### Pré-condições

- DTO e dinheiro válidos;
- idempotency key presente;
- identidade do provider coerente com o canal.

### Comportamento

Calcula o hash canônico, resolve replay/conflito, bloqueia a wallet, aplica regras e persiste transação, ledger, inbox opcional e outbox atomicamente.

### Retorno

ID, status, failure code opcional, saldo observado e `idempotentReplay`.

### Erros esperados

- `InvalidPayload`: contrato inválido;
- `IdempotencyConflict`: chave já usada com outro hash;
- `WalletNotFound` ou conflito de identidade/moeda;
- `TransientInfrastructureFailure`: operação segura para retry.

Rejeições de negócio são resultados persistidos, não exceções que apagam a auditoria.

