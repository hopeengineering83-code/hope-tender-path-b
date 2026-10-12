// Main-app gap regression tests. Source assertions in this file are
// supplemental only; executable behavior is covered by the owning service and
// route tests.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// ─── 1. Dead planned-document helper branch removed ─────────────────────────

describe("dead planned-document branch removed", () => {
  it("the orchestrator no longer carries a nested impossible empty-requirements branch", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(
      !src.includes("if (requirements.length === 0) {\n      if (requirements.length === 0)"),
      "nested duplicate empty-requirements branch must stay removed",
    );
  });
});

// ─── 2. Dead zipAuthorityNeedsReview state removed from download route ───────

describe("dead zipAuthorityNeedsReview state removed", () => {
  it("the live Final ZIP route has no dead authority-review flag or header", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.doesNotMatch(src, /\bzipAuthorityNeedsReview\b/);
    assert.doesNotMatch(src, /X-Authority-Review-Status/);
    assert.match(src, /runAuthorityReview/);
    assert.match(src, /AUTHORITY_REVIEW_(?:BLOCKED|NEEDS_REVIEW)/);
  });
});

// ─── 3. export-format-policy collectExactFilenames plain-text fallback ───────

describe("collectExactFilenames handles plain-text fallback", () => {
  it("parses a JSON array correctly", async () => {
    const { detectTenderFormatPolicy } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf", "Financial Proposal.xlsx"]),
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf, "must detect PDF requirement from JSON array");
    assert.ok(policy.requiresXlsx, "must detect XLSX requirement from JSON array");
    assert.equal(policy.perFile.length, 2, "must collect 2 files from JSON array");
  });

  it("parses a plain-text newline-separated string", async () => {
    const { detectTenderFormatPolicy } = await import("../lib/engine/export-format-policy");
    const policy = detectTenderFormatPolicy({
      exactFileNaming: "Technical Proposal.pdf\nFinancial Proposal.xlsx",
      exactFileOrder: null,
    });
    assert.ok(policy.requiresPdf);
    assert.ok(policy.requiresXlsx);
    assert.equal(policy.perFile.length, 2);
  });
});
