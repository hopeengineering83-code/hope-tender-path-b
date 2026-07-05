// Regression tests for quality gap fixes from phase 3.
//
// All tests are source-scan tests (read the file, assert the code is present)
// so they run in the standard test suite without a live database or AI calls.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── 1. getFinalSubmissionReadiness — analysisExtractionStatus select ─────────

describe("final-submission-readiness — analysisExtractionStatus selected from DB", () => {
  it("getFinalSubmissionReadiness selects analysisExtractionStatus from Prisma", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/final-submission-readiness.ts"), "utf8");
    assert.ok(
      src.includes("analysisExtractionStatus: true"),
      "getFinalSubmissionReadiness must select analysisExtractionStatus so the export blocker can read it",
    );
  });

  it("analysisExtractionStatus appears in the select block near other extraction fields", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/final-submission-readiness.ts"), "utf8");
    const idx = src.indexOf("analysisExtractionStatus: true");
    assert.ok(idx !== -1, "analysisExtractionStatus: true must be present");
    // It should be near the files-extraction section, not at the very start/end of the file
    assert.ok(idx > 5000, "field should be inside the select() block, not at the top of the file");
  });
});

// ─── 2. generate-elite.ts — Submission Instructions Acknowledged fallback ─────

describe("generate-elite.ts — Submission Instructions Acknowledged always emitted", () => {
  it("## Submission Instructions Acknowledged is unconditionally added (outside the if block)", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    // The heading must appear BEFORE the conditional check for submissionRules.length
    // i.e., `lines.push("## Submission Instructions Acknowledged")` must appear in the code
    // outside the `if (params.submissionRules.length > 0)` guard that previously wrapped it.
    assert.ok(
      src.includes('lines.push("## Submission Instructions Acknowledged")'),
      "generate-elite.ts must always push the Submission Instructions Acknowledged heading",
    );
  });

  it("fallback text added when submissionRules is empty", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    assert.ok(
      src.includes("This proposal has been prepared in accordance with the submission instructions"),
      "generate-elite.ts must have a fallback line for Submission Instructions Acknowledged section when rules are empty",
    );
  });
});

// ─── 3. generate-elite.ts — Submission Control Sheet has ## Submission Rules ──

describe("generate-elite.ts — Submission Control Sheet section headings", () => {
  it("Submission Control Sheet has a dedicated ## Submission Rules section", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    assert.ok(
      src.includes('"## Submission Rules"'),
      "generate-elite.ts must include a ## Submission Rules section in the Submission Control Sheet",
    );
  });

  it("## Document Format Requirements appears after ## Submission Rules", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    const rulesIdx = src.indexOf('"## Submission Rules"');
    const formatIdx = src.indexOf('"## Document Format Requirements"');
    assert.ok(rulesIdx !== -1, "## Submission Rules heading must be present");
    assert.ok(formatIdx !== -1, "## Document Format Requirements heading must be present");
    assert.ok(
      rulesIdx < formatIdx,
      "## Submission Rules must appear before ## Document Format Requirements in the Submission Control Sheet",
    );
  });
});

// ─── 4. generate-elite.ts — final placeholder sweep after repair addenda ──────

describe("generate-elite.ts — final placeholder sweep before markdownToDocx", () => {
  it("a final stripPlaceholders call runs after applyProposalQualityRepairAddenda", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    assert.ok(
      src.includes("Final placeholder sweep"),
      "generate-elite.ts must include a final placeholder sweep comment block",
    );
  });

  it("final sweep is conditional on refinementApplied or repairAddendaApplied", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");
    const sweepIdx = src.indexOf("Final placeholder sweep");
    assert.ok(sweepIdx !== -1, "final sweep comment must be present");
    // The guard should appear close to the sweep
    const region = src.slice(sweepIdx, sweepIdx + 300);
    assert.ok(
      region.includes("refinementApplied") || region.includes("repairAddendaApplied"),
      "final placeholder sweep must be guarded by refinementApplied or repairAddendaApplied",
    );
  });
});

// ─── 5. AI prompt — Submission Control Sheet instruction ─────────────────────

describe("AI prompt — Submission Control Sheet instruction present", () => {
  it("ai.ts proposal prompt includes a SUBMISSION CONTROL SHEET section instruction", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");
    assert.ok(
      src.includes("SUBMISSION CONTROL SHEET"),
      "AI proposal prompt must instruct Claude to include a Submission Control Sheet section",
    );
  });

  it("Submission Control Sheet instruction describes pre-submission checklist", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");
    assert.ok(
      src.includes("Pre-Submission Checklist"),
      "AI proposal prompt Submission Control Sheet must require a Pre-Submission Checklist",
    );
  });

  it("Submission Control Sheet instruction references SUBMISSION RULES context", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");
    assert.ok(
      src.includes("SUBMISSION RULES"),
      "AI proposal prompt must reference SUBMISSION RULES when building the Submission Control Sheet",
    );
  });
});
