# PRD — Execução segura das Ondas 0 e 1

## Estado

`ONDA 0 CONCLUÍDA` em 2026-09-01. O hardening dirigido passou três vezes consecutivas sobre a mesma stack com PostgreSQL, LocalStack e três réplicas saudáveis; nenhuma Onda 2–4 foi iniciada.

## Problem Statement

O repositório possui uma implementação inicial de mensageria, inbox, outbox e recuperação de referências, mas o baseline público ainda não comprova de forma determinística os critérios eliminatórios. O CI unitário está verde, enquanto o fluxo Docker de hardening falha ao reconciliar a stack durante a execução do container de testes, reduzindo as três réplicas e encerrando a aplicação da qual a suíte depende.

As subissues de fechamento também existem fora do checkout principal. Isso impede que uma nova sessão ou um checkout limpo descubra os contratos, bloqueios e evidências exigidas. Além disso, o plano original propõe executar consumidor, outbox e referências simultaneamente, embora os critérios integrados de outbox e referências dependam de capacidades anteriores.

Precisamos estabelecer um baseline reproduzível e um harness determinístico antes de desenvolver e integrar as três trilhas da Onda 1. O trabalho paralelo deve ser permitido apenas onde os contratos forem independentes; nenhuma issue pode ser encerrada enquanto seus bloqueadores declarados permanecerem abertos.

## Solution

Executar primeiro uma Onda 0 serial que fixe o commit público de referência, torne o CI Docker verde, preserve três réplicas durante o hardening, versione o backlog necessário e entregue um harness capaz de controlar explicitamente consumidor, publisher e worker de referências usando PostgreSQL e LocalStack reais.

Depois do harness comprovado por três execuções consecutivas, iniciar a Onda 1 com até três trilhas paralelas: consumidor SQS, núcleo da outbox e núcleo de referências pendentes. Cada trilha segue TDD rigoroso e possui responsabilidade de produção e teste claramente definida. Critérios end-to-end dependentes são integrados e encerrados somente depois que seus bloqueadores estiverem verdes.

O escopo termina quando a Onda 1 estiver integrada e suas regressões compartilhadas estiverem verdes. Lifecycle completo, Prometheus/Grafana, concorrência financeira final, matriz de crash/restart e gate eliminatório permanecem para ondas posteriores.

## User Stories

1. Como integrador, quero fixar um commit de referência explícito, para que todas as sessões avaliem e modifiquem a mesma versão.
2. Como integrador, quero preservar mudanças locais não versionadas, para que a criação do baseline não apague nem misture trabalho anterior.
3. Como agente executor, quero encontrar o PRD e os bloqueios no checkout, para que eu não dependa de caminhos locais externos ou do histórico de outra sessão.
4. Como mantenedor, quero que o job Docker termine verde antes da implementação da Onda 1, para que falhas preexistentes não sejam atribuídas às novas mudanças.
5. Como mantenedor, quero que a execução do runner de testes não reduza a aplicação de três réplicas para uma, para que o hardening realmente exercite o cenário multi-instância.
6. Como autor de testes, quero desativar loops automáticos por uma configuração validada e exclusiva de teste, para que workers não consumam dados antes da etapa dirigida.
7. Como autor de testes, quero invocar consumidor, publisher e worker de referências explicitamente, para que cada transição observada tenha uma causa controlada.
8. Como autor de testes, quero PostgreSQL e LocalStack reais, para que transações, locks, constraints, visibility timeout e comportamento SQS sejam exercitados.
9. Como autor de testes, quero factories de infraestrutura com interfaces pequenas e estáveis, para que novos cenários reutilizem preparação sem esconder asserções de negócio.
10. Como autor de testes, quero IDs exclusivos e limpeza segura por cenário, para que uma execução não interfira na seguinte.
11. Como autor de testes, quero polling com timeout e diagnóstico do último estado, para que a suíte não dependa de esperas arbitrárias.
12. Como mantenedor, quero uma prova RED determinística da interferência dos workers automáticos, para que o harness corrija uma falha reproduzível em vez de introduzir um teste flaky.
13. Como mantenedor, quero três execuções consecutivas do harness verde, para que a Onda 1 comece sobre uma base minimamente estável.
14. Como consumidor SQS, quero validar o envelope antes do processamento, para que mensagens inválidas não produzam efeitos financeiros.
15. Como consumidor SQS, quero deduplicar por inbox persistente e comparar o hash canônico, para que redelivery seja seguro e reutilização divergente de `messageId` seja detectada.
16. Como operador, quero que ACK aconteça somente depois do commit, para que uma falha não confirme trabalho financeiro incompleto.
17. Como operador, quero uma taxonomia explícita para falhas de negócio, transitórias e permanentes, para que ACK, retry e DLQ sejam previsíveis.
18. Como auditor financeiro, quero inbox, transação, wallet, ledger e outbox na mesma transação SQL, para que estados parciais nunca fiquem visíveis.
19. Como auditor financeiro, quero reconstruir o saldo com sinal de crédito e débito após cada cenário relevante, para que saldo materializado e ledger permaneçam consistentes.
20. Como publisher, quero reivindicar lotes disjuntos com lease recuperável, para que duas instâncias publiquem sem manter lock SQL durante chamadas SQS.
21. Como publisher, quero persistir retry e próxima tentativa depois de falha total ou parcial, para que eventos confirmados não sejam perdidos.
22. Como integrador downstream, quero eventos com identidade estável em duplicações ambíguas, para que consumidores possam implementar idempotência sem depender da deduplicação temporal da fila.
23. Como operador, quero que um claim abandonado volte a ser elegível depois do lease, para que a morte de um publisher não retenha eventos indefinidamente.
24. Como jogador, quero que `REFUND` e `ROLLBACK` recebidos antes da referência sejam persistidos, para que a operação possa convergir quando a origem chegar.
25. Como worker de referências, quero reivindicar pendências com lease e tentativas persistentes, para que várias instâncias não resolvam a mesma reversão duas vezes.
26. Como operador, quero recuperar um claim de referência depois de reinício, para que nenhuma pendência dependa da instância que a reivindicou.
27. Como auditor, quero que TTL ou tentativas esgotadas resultem em rejeição auditável e evento correspondente, para que uma referência inexistente tenha estado terminal determinístico.
28. Como integrador, quero que o núcleo da outbox e o núcleo de referências possam avançar depois do harness, para aproveitar paralelismo sem falsificar a conclusão das issues.
29. Como integrador, quero impedir o fechamento da outbox antes da integração com o consumidor aplicável, para que critérios end-to-end não sejam marcados sem prova.
30. Como integrador, quero impedir o fechamento das referências antes da publicação de seus eventos pela outbox, para que o fluxo completo seja comprovado.
31. Como mantenedor, quero que cada entrega informe RED, falha esperada, GREEN, arquivos alterados, testes e riscos, para que a integração seja auditável.
32. Como mantenedor do Brain, quero atualizar contratos e decisões no mesmo trabalho, para que a documentação permaneça alinhada ao comportamento comprovado.
33. Como integrador, quero uma regressão compartilhada depois das três trilhas, para que alterações isoladamente verdes não quebrem contratos entre módulos.
34. Como responsável pela entrega, quero encerrar este PRD sem iniciar ondas posteriores, para que o trabalho permaneça dentro do escopo autorizado.

## Implementation Decisions

- O commit público `5e6e763` é a referência inicial. A expressão “criar commit-base porque não existem commits” não se aplica a este repositório.
- Mudanças locais existentes não fazem parte automaticamente do baseline. Elas devem ser preservadas e classificadas antes de qualquer integração.
- Onda 0 é serial e bloqueante: baseline, CI Docker, backlog acessível, harness determinístico e três execuções verdes.
- O runner de testes deve usar a stack já escalada sem fazer o Compose reconciliar ou reduzir as réplicas da aplicação.
- A configuração que desativa loops automáticos deve ser validada, limitada ao ambiente de teste e aplicada aos processos da aplicação que participam da suíte dirigida.
- O harness será um módulo profundo: expõe preparação isolada, acesso ao ORM e SQS reais, invocação dirigida dos workers, polling diagnosticável e limpeza segura por uma interface pequena.
- Esperas fixas não são mecanismo principal de sincronização. Estado observável, barreiras, relógio injetável e polling limitado são preferidos.
- O consumidor terá uma decisão explícita de resultado equivalente a ACK, RETRY ou DLQ. A taxonomia de códigos de domínio deve determinar a decisão sem tratar todo erro de negócio como falha permanente.
- A inbox persistente usa a identidade composta do consumidor e da mensagem, acompanhada do hash canônico do payload.
- Inbox, operação financeira, ledger e outbox pertencem à mesma fronteira transacional.
- O publisher da outbox reivindica lotes curtos com `FOR UPDATE SKIP LOCKED`, libera a transação antes da rede e usa lease recuperável.
- Falhas totais e parciais do lote atualizam somente os registros correspondentes e persistem tentativas e próxima elegibilidade.
- Duplicação depois de sucesso SQS e falha antes de marcar `published` é parte do contrato `at-least-once`.
- Como não existe consumidor interno dos eventos publicados que altere saldo, a prova da duplicação ambígua será identidade estável do evento, elegibilidade/publicação correta e ausência de novos efeitos pelo publisher. Idempotência financeira de um downstream inexistente não será alegada.
- O worker de referências persiste tentativa, próxima execução e lease. Resolução, expiração e rejeição continuam usando as mesmas invariantes financeiras do caso de uso principal.
- `01.4.2` pode ser implementada após `01.4.1`.
- O núcleo de claim, lease e retry de `01.4.3` pode avançar após `01.4.1`, mas a issue não fecha antes dos critérios integrados dependentes de `01.4.2`.
- O núcleo de persistência, claim, TTL e recuperação de `01.5.1` pode avançar após `01.4.1`, mas a issue não fecha antes da integração exigida com a outbox.
- Arquivos e configurações compartilhados possuem integração serial. Subagentes podem propor mudanças, mas o agente principal integra módulos globais, configuração, migrations, Compose, scripts e documentação compartilhada.
- Cada módulo de produção terá um único proprietário ativo por vez. Instrumentação em módulo alheio é coordenada com seu proprietário.
- O Brain e o registro de mudanças são atualizados quando comportamento, contrato, efeito colateral ou integração mudar.
- Nenhuma atividade das Ondas 2, 3 ou 4 está autorizada por este PRD.

## Testing Decisions

- Todo código de produção novo ou corrigido seguirá RED, GREEN e REFACTOR. Um teste que já nasce verde será registrado como caracterização, não como RED.
- Bons testes verificam comportamento observável: registros persistidos, saldo e ledger, mensagens nas filas, ACK ou redelivery, elegibilidade por lease e estados terminais. Eles não acoplam expectativas à estrutura interna de métodos.
- O RED do harness será controlado por barreira ou failpoint de teste, evitando depender de uma corrida probabilística.
- O harness será testado contra PostgreSQL e LocalStack reais. Mocks dessas dependências não satisfazem critérios críticos.
- O consumidor será testado para envelope válido e inválido, atomicidade, redelivery, conflito de hash, falha de negócio com ACK, falha transitória sem ACK, falha permanente e DLQ.
- A outbox será testada com dois publishers, lotes disjuntos, lease abandonado, falha total, falha parcial e resultado ambíguo de publicação.
- O worker de referências será testado para ordem invertida, resolução única, concorrência, reinício, lease vencido, TTL, tentativas esgotadas e referência rejeitada.
- Cada cenário financeiro relevante confirma o saldo armazenado, a soma assinada do ledger e as contagens esperadas de transação, inbox e outbox.
- IDs exclusivos isolam cenários. Limpeza de filas compartilhadas ocorre somente em uma janela serial controlada.
- Suítes Docker, limpeza global de filas e cenários de processo são serializados. Testes unitários independentes podem executar em paralelo.
- O harness deve passar três vezes consecutivas a partir de estado limpo antes de liberar a Onda 1.
- Cada trilha executa seus testes afetados. O integrador executa regressão unitária e de integração compartilhada antes de aceitar a entrega.
- A execução final desta fase deve provar que a stack mantém três réplicas durante os testes que afirmam comportamento multi-instância.
- Evidências mínimas por ciclo incluem comando do RED, motivo da falha, comando do GREEN, resultado, alterações, riscos e documentação atualizada.
- Os testes existentes de API HTTP, health, idempotência e concorrência são prior art, mas não substituem os novos testes dirigidos de mensageria e recuperação.

## Out of Scope

- Lifecycle completo com `SIGTERM`, grace period e processo real, além do mínimo necessário ao harness.
- Prometheus, Grafana, dashboards e provisioning de observabilidade.
- Suíte final de concorrência financeira em três instâncias.
- Matriz completa de crash, restart e indisponibilidade.
- Gate eliminatório e pacote final de evidências.
- OpenTelemetry, autenticação externa, deploy AWS e metas artificiais de throughput.
- Criação de um consumidor downstream apenas para provar idempotência dos eventos publicados.
- Execução simultânea de múltiplas stacks Docker com portas dinâmicas, salvo se for indispensável ao determinismo da Onda 0.

## Further Notes

- O job público de integração do baseline falha depois que a execução do container de testes reconcilia a stack e remove duas das três réplicas. Essa falha é o primeiro bloqueio objetivo da Onda 0.
- As subissues detalhadas foram produzidas fora do checkout principal. Elas devem ser copiadas para o repositório ou publicadas no tracker antes de serem tratadas como fonte de verdade por outras sessões.
- Links absolutos do Windows não são portáveis e devem ser substituídos por links relativos ou referências do tracker.
- A inexistência de configuração em `docs/agents/` impede que esta skill escolha com segurança entre GitHub Issues e markdown local. Este PRD foi, portanto, gerado como artefato local e não publicado externamente.
- Estado esperado ao concluir: Onda 0 comprovadamente verde; `01.4.2`, `01.4.3` e `01.5.1` implementadas e integradas conforme seus bloqueios; nenhuma Onda 2–4 iniciada.
