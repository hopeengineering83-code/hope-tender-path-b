// Canonical Readiness counts and blockers regression tests.
//
// Tests the fix for the "0/0 required docs" contradiction:
// - When 10 required docs are PLANNED but not generated, the widget must
//   show 0/10 export ready, not 0/0.
// - requiredDocumentsTotal must include ungenerated PLANNED docs.
// - primaryBlockerReason must say "Generate required documents."
// - Final export must remain blocked when required docs are planned but not generated.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Root cause: requiredDocumentsTotal includes PLANNED docs ────────────

describe("Canonical Readiness — requiredDocumentsTotal includes PLANNED docs", () => {
  it("final-submission-readiness computes requiredDocumentsTotal from max(planCount, plannedDocs)", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("requiredDocumentsTotal:"),
      "must compute requiredDocumentsTotal in the summary",
    );
    // The formula must use Math.max(requiredPlanCount, ungeneratedPlannedRequired)
    // so that PLANNED docs count even when there's no confirmed plan.
    assert.ok(
      src.includes("Math.max(requiredPlanCount"),
      "requiredDocumentsTotal must be max(planCount, plannedDocs) — never 0 when PLANNED docs exist",
    );
    assert.ok(
      src.includes('generationStatus') && src.includes("PLANNED"),
      "must count PLANNED docs in the requiredDocumentsTotal computation",
    );
  });

  it("exportReadyDocumentsTotal counts only READY_FOR_EXPORT/APPROVED docs", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("exportReadyDocumentsTotal:"),
      "must compute exportReadyDocumentsTotal in the summary",
    );
    // Must filter for READY_FOR_EXPORT or APPROVED — not just any generated doc
    assert.ok(
      /exportReadyDocumentsTotal.*READY_FOR_EXPORT.*APPROVED/s.test(src),
      "exportReadyDocumentsTotal must only count READY_FOR_EXPORT/APPROVED docs",
    );
  });
});

// ─── 2. API exposes the new fields ──────────────────────────────────────────

describe("Readiness-score API — exposes canonical required-doc model", () => {
  it("readiness-score route returns requiredDocumentsTotal", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("requiredDocumentsTotal:"),
      "API must return requiredDocumentsTotal",
    );
  });

  it("readiness-score route returns exportReadyDocumentsTotal", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("exportReadyDocumentsTotal:"),
      "API must return exportReadyDocumentsTotal",
    );
  });

  it("readiness-score route returns plannedRequiredDocuments", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("plannedRequiredDocuments:"),
      "API must return plannedRequiredDocuments",
    );
  });

  it("readiness-score route returns primaryBlockerReason", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("primaryBlockerReason:"),
      "API must return primaryBlockerReason",
    );
  });

  it("readiness-score route returns primaryFixAction", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("primaryFixAction:"),
      "API must return primaryFixAction",
    );
  });

  it("readiness-score route returns totalBlockers", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      src.includes("totalBlockers:"),
      "API must return totalBlockers",
    );
  });
});

// ─── 3. Widget display rules ────────────────────────────────────────────────
//
// components/canonical-readiness-score-widget.tsx was retired in favor of
// the canonical Tender Release State panel. The required-docs X/Y fraction
// display (denominator formula, "No required docs" / "0/10 export ready"
// text) was specific to that widget's layout and is NOT replicated in the
// new panel — that concern remains covered by the unchanged
// components/export-readiness-panel.tsx and
// components/final-package-manifest-panel.tsx. The new panel instead shows
// a reconciled blocker list + total, and one primaryNextAction sourced from
// the canonical workflow decision (see tests/release-snapshot-panel-truth.test.ts).

describe("Canonical Tender Release State panel — display rules", () => {
  it("shows the reconciled blocker total and critical/high sub-count", () => {
    const src = read("components/tender-release-state-panel.tsx");
    assert.ok(src.includes("blockerTotal"), "panel must display blockerTotal");
    assert.ok(src.includes("criticalBlockerTotal"), "panel must display criticalBlockerTotal");
  });

  it("shows one primary next action, not a list of independently computed actions", () => {
    const src = read("components/tender-release-state-panel.tsx");
    assert.ok(src.includes("primaryNextAction"), "panel must display primaryNextAction");
    assert.ok(src.includes("Next required action"), "panel must label the single next action");
  });
});

// ─── 4. Primary blocker priority ───────────────────────────────────────────

describe("Primary blocker — priority order", () => {
  it("planned-not-generated is highest priority", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      /primaryBlockerReason.*ungenerated.*planned.*not.*generated/s.test(src),
      "planned-not-generated must be the first priority in primaryBlockerReason",
    );
    assert.ok(
      /primaryFixAction.*Generate required documents/s.test(src),
      "fix action for planned-not-generated must be 'Generate required documents.'",
    );
  });

  it("no-export-ready is second priority", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("No export-ready documents"),
      "must surface 'No export-ready documents' when no docs are generated",
    );
  });

  it("validation/approval incomplete is third priority", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("No documents are validated and approved for export"),
      "must surface validation/approval as a blocker reason",
    );
  });
});

// ─── 5. No user-facing metadata in readiness payload ───────────────────────

describe("No user-facing metadata in readiness widget", () => {
  it("panel does not display 'metadata' label to users", () => {
    const src = read("components/tender-release-state-panel.tsx");
    // Check for user-facing metadata strings (not internal field names)
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src) || !/label.*[Mm]etadata/i.test(src),
      "panel must not show 'metadata' as a user-facing label",
    );
  });
});

// ─── 6. Screenshot regression fixture ──────────────────────────────────────
//
// The 0/0-vs-0/10 required-docs display regression was specific to
// canonical-readiness-score-widget.tsx's now-retired denominator formula
// (see the "display rules" note above) — the underlying data-correctness
// fix (requiredDocumentsTotal = max(planCount, plannedDocs)) is unchanged
// and still verified against lib/engine/final-submission-readiness.ts in
// section 1 above.

describe("Screenshot regression — 10 planned required docs scenario", () => {
  it("primary blocker says 'Generate required documents' when 10 planned", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(
      src.includes("Generate required documents."),
      "primaryFixAction must say 'Generate required documents.'",
    );
    assert.ok(
      /primaryBlockerReason.*planned but not generated/s.test(src),
      "primaryBlockerReason must mention 'planned but not generated'",
    );
  });
});
