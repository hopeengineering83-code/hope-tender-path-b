// Regression tests for quality gap fixes from phase 5.
//
// Phase 5 addresses:
//   section-reorderer.ts: over-broad ^submission regex was tearing
//   "## Submission Instructions Acknowledged" out of Section A and
//   placing it at rank 900 (after Declaration), before the Submission
//   Control Sheet heading.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reorderToCanonicalSequence } from "../lib/engine/generation/section-reorderer";

// ─── 1. source-scan: regex is precise ────────────────────────────────────────

describe("section-reorderer — rank-900 regex is precise", () => {
  it("does NOT use ^submission as a catch-all", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/section-reorderer.ts"), "utf8");
    assert.ok(
      !src.includes("/^submission control sheet|^submission/i"),
      "rank-900 regex must NOT use ^submission as a catch-all — it tears sub-headings out of Section A",
    );
  });

  it("uses a word-boundary precise match", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/section-reorderer.ts"), "utf8");
    assert.ok(
      src.includes("submission control sheet\\b") || src.includes("^submission control sheet$"),
      "rank-900 entry must use a word-boundary or end-anchor to avoid matching sub-headings",
    );
  });
});

// ─── 2. functional: Submission Instructions Acknowledged stays in Section A ──

describe("reorderToCanonicalSequence — Submission Instructions Acknowledged stays in Section A", () => {
  it("does not move ## Submission Instructions Acknowledged to the end", () => {
    const input = [
      "# Section A: Company Profile",
      "",
      "## A.1 Company Overview",
      "Company profile text here with ETB 120M project.",
      "",
      "## Submission Instructions Acknowledged",
      "- Submit by email to tender@client.org",
      "- Technical proposal only, no financial content",
      "",
      "# Section B: Relevant Experience",
      "",
      "Hospital X ETB 120M 2019 — full design supervision.",
      "",
      "# Submission Control Sheet",
      "",
      "## Submission Recipients",
      "- tender@client.org",
      "",
      "## Submission Rules",
      "- Deadline: 30 June 2026",
    ].join("\n");

    const result = reorderToCanonicalSequence(input);

    const sectionBIdx = result.indexOf("# Section B");
    const submissionInstructionsIdx = result.indexOf("## Submission Instructions Acknowledged");
    const controlSheetIdx = result.indexOf("# Submission Control Sheet");

    assert.ok(submissionInstructionsIdx !== -1, "Submission Instructions Acknowledged must be present");
    assert.ok(sectionBIdx !== -1, "Section B must be present");
    assert.ok(controlSheetIdx !== -1, "Submission Control Sheet must be present");

    assert.ok(
      submissionInstructionsIdx < sectionBIdx,
      `Submission Instructions Acknowledged (at char ${submissionInstructionsIdx}) must appear before Section B (at char ${sectionBIdx}) — it belongs in Section A, not at the end`,
    );

    assert.ok(
      controlSheetIdx > sectionBIdx,
      `Submission Control Sheet (at char ${controlSheetIdx}) must appear after Section B (at char ${sectionBIdx})`,
    );
  });

  it("does not move ## Submission Rules out of Submission Control Sheet", () => {
    const input = [
      "# Section A: Company Profile",
      "",
      "Company profile text here.",
      "",
      "# Submission Control Sheet",
      "",
      "## Submission Recipients",
      "- tender@client.org",
      "",
      "## Submission Rules",
      "- Deadline: 30 June 2026",
      "",
      "## Document Format Requirements",
      "- PDF format required",
    ].join("\n");

    const result = reorderToCanonicalSequence(input);

    const controlSheetIdx = result.indexOf("# Submission Control Sheet");
    const submissionRulesIdx = result.indexOf("## Submission Rules");
    const docFormatIdx = result.indexOf("## Document Format Requirements");

    assert.ok(controlSheetIdx !== -1, "Submission Control Sheet heading must be present");
    assert.ok(submissionRulesIdx !== -1, "Submission Rules must be present");
    assert.ok(docFormatIdx !== -1, "Document Format Requirements must be present");

    // Submission Rules should come after the Submission Control Sheet heading
    assert.ok(
      submissionRulesIdx > controlSheetIdx,
      "Submission Rules must stay after the Submission Control Sheet heading",
    );
  });

  it("still places # Submission Control Sheet at rank 900 (after Declaration)", () => {
    const input = [
      "# Submission Control Sheet",
      "",
      "## Submission Recipients",
      "- email@client.org",
      "",
      "# Section A: Company Profile",
      "",
      "Profile text with ETB 50M Hospital project.",
      "",
      "# Declaration of Eligibility",
      "",
      "We confirm eligibility.",
    ].join("\n");

    const result = reorderToCanonicalSequence(input);

    const sectionAIdx = result.indexOf("# Section A");
    const declarationIdx = result.indexOf("# Declaration");
    const controlSheetIdx = result.indexOf("# Submission Control Sheet");

    assert.ok(sectionAIdx !== -1 && declarationIdx !== -1 && controlSheetIdx !== -1);
    assert.ok(sectionAIdx < declarationIdx, "Section A must appear before Declaration");
    assert.ok(declarationIdx < controlSheetIdx, "Declaration must appear before Submission Control Sheet");
  });
});
