import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const evidenceFiles = [
  "evidencias/README.md",
  "evidencias/testes-unitarios.md",
  "evidencias/testes-integracao.md",
  "evidencias/testes-concorrencia.md",
  "evidencias/carga-curta.md",
];
const successfulActionRun =
  "https://github.com/renansko/jugle-gaming-test/actions/runs/33705456587";

describe("README delivery evidence", () => {
  const readme = readFileSync("README.md", "utf8");

  test("appends verified delivery metrics after every existing tutorial section", () => {
    const finalExistingSection = readme.indexOf("## 6. Aprofunde-se");
    const evidenceSection = readme.indexOf("## 7. Evidências verificáveis da entrega");
    const observabilitySection = readme.indexOf("## 8. Métricas e observabilidade");

    expect(finalExistingSection).toBeGreaterThan(-1);
    expect(evidenceSection).toBeGreaterThan(finalExistingSection);
    expect(observabilitySection).toBeGreaterThan(evidenceSection);
  });

  test("links the live CI and reports only metrics supported by hardening", () => {
    expect(readme).toContain("actions/workflows/ci.yml/badge.svg?branch=main");
    expect(readme).toContain("| Testes unitários | 152 aprovados |");
    expect(readme).toContain("| Testes de integração | 28 aprovados |");
    expect(readme).toContain("| Testes de concorrência | 5 aprovados |");
    expect(readme).toContain("| Instâncias simultâneas | 3 réplicas saudáveis |");
    expect(readme).toContain("| Carga curta no CI | 1.398 requisições; 0 falhas técnicas |");
  });

  test("references the successful Action run and local evidence instead of issues", () => {
    expect(readme).toContain(successfulActionRun);
    expect(readme).not.toContain("github.com/renansko/jugle-gaming-test/issues/");

    for (const evidenceFile of evidenceFiles) {
      expect(readme).toContain(`](${evidenceFile})`);

      const evidence = readFileSync(evidenceFile, "utf8");
      expect(evidence).toContain("## Evidência verificável");
      expect(evidence).toContain("```mermaid");
      expect(evidence).toContain(successfulActionRun);
      expect(evidence).not.toContain("github.com/renansko/jugle-gaming-test/issues/");
      expect(evidence.toLowerCase()).not.toContain("issue #13");
    }
  });

  test("documents the container runner required by integration and concurrency suites", () => {
    const composePrefix =
      "docker compose -f compose.yaml -f compose.hardening.yaml";

    expect(readme).toContain(
      `${composePrefix} run --rm --no-deps test bun run test:integration`,
    );
    expect(readme).toContain(
      `${composePrefix} run --rm --no-deps test bun run test:concurrency`,
    );
    expect(readme).toContain("TEST_APP_URL=http://app:3000");
    expect(readme).toContain("0 pass");
    expect(readme).toContain("out-of-order samples");
  });
});
