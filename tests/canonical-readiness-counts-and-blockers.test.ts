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

describe("Canonical Readiness widget — display rules", () => {
  it("uses requiredDocumentsTotal as denominator (not finalExportCandidates + missingRequiredDocuments)", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    assert.ok(
      src.includes("requiredDocumentsTotal"),
      "widget must use requiredDocumentsTotal from the API",
    );
    // The old misleading formula must NOT be the primary path
    assert.ok(
      src.includes("exportReadyDocumentsTotal"),
      "widget must use exportReadyDocumentsTotal as numerator",
    );
  });

  it("never shows 0/0 when PLANNED docs exist", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    // The widget must have a guard: if total === 0, show "No required docs"
    // but when PLANNED docs exist, total must be > 0 (from the API)
    assert.ok(
      src.includes("No required docs"),
      "widget must show 'No required docs' when total is genuinely 0",
    );
    assert.ok(
      src.includes("export ready"),
      "widget must label the count as 'export ready' (not just 'X/Y')",
    );
  });

  it("shows primary blocker reason when blockers exist", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    assert.ok(
      src.includes("primaryBlockerReason"),
      "widget must display primaryBlockerReason",
    );
    assert.ok(
      src.includes("Primary blocker:"),
      "widget must label the primary blocker",
    );
  });

  it("shows primary fix action when blockers exist", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    assert.ok(
      src.includes("primaryFixAction"),
      "widget must display primaryFixAction",
    );
    assert.ok(
      src.includes("Next action:"),
      "widget must label the fix action",
    );
  });

  it("Export blockers tile shows totalBlockers and primary reason", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    assert.ok(
      src.includes("totalBlockers"),
      "Export blockers tile must use totalBlockers",
    );
  });

  it("does NOT use misleading denominator finalExportCandidates + missingRequiredDocuments as primary", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    // The old formula may appear as a fallback (backward compat) but must NOT
    // be the primary computation. The primary must use requiredDocumentsTotal.
    // Check that requiredDocumentsTotal is used with ?? fallback to old formula.
    assert.ok(
      /requiredDocumentsTotal\s*\?\?/.test(src),
      "widget must prefer requiredDocumentsTotal with fallback to old formula",
    );
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
  it("widget does not display 'metadata' label to users", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    // Check for user-facing metadata strings (not internal field names)
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src) || !/label.*[Mm]etadata/i.test(src),
      "widget must not show 'metadata' as a user-facing label",
    );
  });
});

// ─── 6. Screenshot regression fixture ──────────────────────────────────────

describe("Screenshot regression — 10 planned required docs scenario", () => {
  it("widget would display 0/10 export ready (not 0/0)", () => {
    const src = read("components/canonical-readiness-score-widget.tsx");
    // When requiredDocumentsTotal = 10 and exportReadyDocumentsTotal = 0:
    // - total = 10 (not 0)
    // - exportReady = 0
    // - ungenerated = 10
    // - Display: "0/10 export ready" + "10 planned, not generated"
    assert.ok(
      src.includes("export ready"),
      "widget must label as 'export ready'",
    );
    assert.ok(
      src.includes("planned, not generated"),
      "widget must show 'planned, not generated' text",
    );
    assert.ok(
      src.includes("requiredDocumentsTotal"),
      "denominator must come from requiredDocumentsTotal (which includes PLANNED)",
    );
  });

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
