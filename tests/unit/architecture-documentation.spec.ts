import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const architecture = readFileSync("ARCHITECTURE.md", "utf8");

const requiredSections = [
  "## 1. Visão geral e objetivo",
  "## 2. Como organizei o trabalho",
  "## 3. Contexto do problema",
  "## 4. Decisões e trade-offs",
  "## 5. Fluxo ponta a ponta",
  "## 6. Dados e invariantes",
  "## 7. Resiliência e falhas",
  "## 8. Escalabilidade e limites comprovados",
  "## 9. Observabilidade e evidências",
  "## 10. Perguntas para o cliente",
  "## 11. Referências no código",
];

describe("ARCHITECTURE decision record", () => {
  test("follows the visual explainer structure", () => {
    for (const section of requiredSections) {
      expect(architecture).toContain(section);
    }

    expect(architecture.match(/```mermaid/g)?.length).toBeGreaterThanOrEqual(
      requiredSections.length,
    );
  });

  test("records the agreed reasoning and messaging guarantees", () => {
    const expectedDecisions = [
      "Brain → PRD → issues → TDD",
      "MessageGroupId = walletId",
      "PENDING_REFERENCE",
      "Inbox não ordena mensagens",
      "SELECT ... FOR UPDATE",
      "Transactional Outbox",
      "at-least-once",
      "wallet.balance == saldo reconstruído pelo ledger",
      "CD ficou fora do escopo",
    ];

    for (const decision of expectedDecisions) {
      expect(architecture).toContain(decision);
    }
  });

  test("separates measured capacity from assumptions and client discovery", () => {
    expect(architecture).toContain("1.001 operações");
    expect(architecture).toContain("100,1 operações/s");
    expect(architecture).toContain("não representa capacidade de produção");
    expect(architecture).toContain(
      "O externalTransactionId é único por provedor ou por jogo?",
    );
  });

  test("uses portable repository links and does not claim implemented authentication", () => {
    expect(architecture).not.toContain("file:///");
    expect(architecture).toContain("AllowAllProviderIdentity");
    expect(architecture).toContain("não oferece autenticação efetiva");
  });
});
