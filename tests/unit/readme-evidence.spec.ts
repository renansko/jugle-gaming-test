import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const evidenceFiles = [
  "evidencias/README.md",
  "evidencias/testes-unitarios.md",
  "evidencias/testes-integracao.md",
  "evidencias/testes-concorrencia.md",
  "evidencias/carga-curta.md",
];

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
    expect(readme).toContain("| Testes unitários | 79 aprovados |");
    expect(readme).toContain("| Testes de integração | 19 aprovados |");
    expect(readme).toContain("| Testes de concorrência | 4 aprovados |");
    expect(readme).toContain("| Instâncias simultâneas | 3 réplicas saudáveis |");
    expect(readme).toContain("issues/12");
    expect(readme).toContain("p50/p95/p99 ainda não foram medidos");
  });

  test("references the public evidence catalog and every test evidence file", () => {
    expect(readme).toContain("https://github.com/renansko/jugle-gaming-test/issues/13");

    for (const evidenceFile of evidenceFiles) {
      expect(readme).toContain(`](${evidenceFile})`);

      const evidence = readFileSync(evidenceFile, "utf8");
      expect(evidence).toContain("## Evidência verificável");
      expect(evidence).toContain("```mermaid");
      expect(evidence).toContain("issue #13");
    }
  });
});
