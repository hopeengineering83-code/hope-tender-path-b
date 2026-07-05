import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const audit = readFileSync("docs/audits/2026-06-06-post-608-non-overlap-audit.md", "utf8");

describe("post-608 non-overlap audit document", () => {
  it("records the PR #608 isolation rule and defer policy", () => {
    assert.match(audit, /Do \*\*not\*\* touch PR #608/);
    assert.match(audit, /DEFER UNTIL PR #608 IS RESOLVED/);
    assert.match(audit, /PR #608 changed-file avoidance list/);
  });

  it("preserves the product safety and Neon-saving rules", () => {
    assert.match(audit, /Generate Docs must create zero `GeneratedDocument` rows/);
    assert.match(audit, /Final ZIP must exactly match the Final Package Manifest/);
    assert.match(audit, /Chat\/workbench output must never enter Final ZIP automatically/);
    assert.match(audit, /Do not select `fileContent` in dashboard\/list\/panel queries/);
    assert.match(audit, /Avoid full `extractedText` in dashboard\/list\/status paths/);
  });

  it("keeps Anthropic last in the documented provider order", () => {
    assert.match(
      audit,
      /Provider fallback order must remain: Gemini -> OpenAI -> Mistral -> Together -> DeepSeek -> Groq -> OpenRouter -> Anthropic\./,
    );
  });

  it("defers known PR #608 overlap areas", () => {
    assert.match(audit, /Generate gate content-page logic/);
    assert.match(audit, /Recovery Command Center scroll targets/);
    assert.match(audit, /clientName` \/ `procuringEntityName/);
    assert.match(audit, /Export mandatory evidence blocker/);
    assert.match(audit, /AI copilot gate warnings/);
  });
});
