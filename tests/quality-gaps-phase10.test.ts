// Regression tests for quality gap fixes from phase 10.
//
// Phase 10 addresses:
//   generate-elite.ts: the Pre-Submission Checklist in fallbackProposalMarkdown
//   showed a generic "stated deadline" reminder even when tenderDeadline was
//   available in params. Bid teams had to look up the deadline themselves,
//   increasing the risk of late submission — the most common disqualification
//   cause.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");

describe("generate-elite — Pre-Submission Checklist deadline handling", () => {
  it("uses tenderDeadline when available (not always the generic reminder)", () => {
    // The code must branch on params.tenderDeadline
    assert.ok(
      src.includes("params.tenderDeadline"),
      "generate-elite must reference params.tenderDeadline in the Pre-Submission Checklist",
    );
  });

  it("formats tenderDeadline into a human-readable date string", () => {
    // Should use toLocaleDateString or similar formatting — not just String(date)
    assert.ok(
      src.includes("toLocaleDateString") || src.includes("toDateString") || src.includes("formatted"),
      "deadline must be formatted into a human-readable string",
    );
  });

  it("falls back to a generic reminder when tenderDeadline is absent", () => {
    // The else branch must still emit a checklist item
    const elseIdx = src.indexOf("} else {\n    lines.push(\"- [ ] Submission sent before the stated deadline");
    assert.ok(
      elseIdx !== -1 || src.includes("extract exact date/time"),
      "fallback checklist item must still be present when tenderDeadline is absent",
    );
  });

  it("includes a note to confirm time zone in both branches", () => {
    // The time-zone reminder must appear somewhere in the deadline checklist item
    const deadlineBlock = src.slice(
      src.indexOf("Pre-Submission Checklist"),
      src.indexOf("return lines.join", src.indexOf("Pre-Submission Checklist")),
    );
    assert.ok(
      deadlineBlock.includes("time zone") || deadlineBlock.includes("time-zone"),
      "deadline checklist item must mention time zone",
    );
  });
});
