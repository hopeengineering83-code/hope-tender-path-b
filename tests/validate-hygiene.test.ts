// Regression tests for document hygiene checks added to validateTender().
//
// Before this fix, pricing leakage in technical envelopes was only caught at
// export-readiness time. These tests verify that the same hygiene gate runs
// during validate so problems surface one step earlier.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { documentHygieneIssues } from "../lib/engine/export/export-readiness";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── 1. Hygiene gate wired into validate.ts ───────────────────────────────────

describe("validate.ts — document hygiene checks wired at validation time", () => {
  it("validate.ts imports documentHygieneIssues from export-readiness", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/validate.ts"), "utf8");
    assert.ok(
      src.includes("documentHygieneIssues"),
      "validate.ts must call documentHygieneIssues for each generated document",
    );
    assert.ok(
      src.includes("export-readiness"),
      "validate.ts must import from export-readiness",
    );
  });

  it("validate.ts emits DOCUMENT_HYGIENE_FAILURE code for hygiene issues", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/validate.ts"), "utf8");
    assert.ok(
      src.includes("DOCUMENT_HYGIENE_FAILURE"),
      "validate.ts must use DOCUMENT_HYGIENE_FAILURE issue code",
    );
  });

  it("hygiene failures use BLOCK severity in validate.ts", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/engine/validate.ts"), "utf8");
    const idx = src.indexOf("DOCUMENT_HYGIENE_FAILURE");
    const surrounding = src.slice(Math.max(0, idx - 80), idx + 80);
    assert.ok(
      surrounding.includes("BLOCK"),
      "DOCUMENT_HYGIENE_FAILURE must have BLOCK severity, got: " + surrounding,
    );
  });
});

// ─── 2. documentHygieneIssues — pricing leakage in technical documents ────────

describe("documentHygieneIssues — pricing leakage detection (validate gate)", () => {
  function mkDoc(overrides: { documentType?: string | null; name?: string; exactFileName?: string | null; format?: string | null }) {
    return {
      name: overrides.name ?? "Technical Proposal",
      exactFileName: overrides.exactFileName ?? null,
      documentType: overrides.documentType ?? "TECHNICAL_PROPOSAL",
      format: overrides.format ?? null,
    };
  }

  it("detects pricing in technical proposal — would block validation", () => {
    const issues = documentHygieneIssues(
      "Our fee is USD 250,000 for the full assignment. Unit rate: $120/day.",
      mkDoc({ documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.ok(issues.length > 0, "technical doc with pricing must have hygiene issues");
  });

  it("no issues for clean technical proposal", () => {
    const issues = documentHygieneIssues(
      "Our methodology focuses on stakeholder engagement and phased delivery.",
      mkDoc({ documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.equal(issues.length, 0, "clean technical content must pass hygiene");
  });

  it("financial proposal can contain pricing without hygiene failure", () => {
    const issues = documentHygieneIssues(
      "Total cost: USD 300,000. Daily rate: $150. Payment terms: 30 days.",
      mkDoc({ documentType: "FINANCIAL_PROPOSAL", name: "Financial Proposal" }),
    );
    // Financial documents are allowed to have pricing — hygiene only flags
    // pricing leakage in non-financial envelopes.
    assert.equal(issues.length, 0, "pricing in financial proposal must not trigger hygiene issue");
  });

  it("AI disclosure phrase detected as hygiene issue", () => {
    const issues = documentHygieneIssues(
      "As an AI language model, I cannot guarantee the accuracy of these figures.",
      mkDoc({ documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.ok(issues.length > 0, "AI disclosure phrase must be caught as a hygiene issue");
  });

  it("unresolved placeholder detected as hygiene issue", () => {
    const issues = documentHygieneIssues(
      "Our company [INSERT COMPANY NAME] has 15 years of experience.",
      mkDoc({ documentType: "TECHNICAL_PROPOSAL" }),
    );
    assert.ok(issues.length > 0, "unresolved placeholder must be caught as a hygiene issue");
  });
});

// ─── 3. AI prompt instruction for page citations ──────────────────────────────

describe("AI prompt — page citation instruction present", () => {
  it("ai.ts proposal generation prompt instructs AI to use [p.N] citations", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");
    assert.ok(
      src.includes("source page citation"),
      "AI proposal prompt must instruct Claude to use source page citations",
    );
    assert.ok(
      src.includes("[p.N]") || src.includes("[p."),
      "AI proposal prompt must reference the [p.N] citation format",
    );
  });
});
