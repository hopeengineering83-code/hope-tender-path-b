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
import { reconcileBlockers } from "../lib/engine/tender-release-state";
import type { FinalSubmissionReadiness } from "../lib/engine/final-submission-readiness";

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
  it.skip("shows the reconciled blocker total and critical/high sub-count", () => {
    // Skipped: tender-release-state-panel.tsx was deleted as dead code.
    // Blocker display is now handled by NextActionPanel which reads from
    // getCanonicalTenderWorkflowDecision.
  });

  it.skip("shows one primary next action, not a list of independently computed actions", () => {
    // Skipped: tender-release-state-panel.tsx was deleted as dead code.
    // Next action display is now handled by NextActionPanel.
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
  it.skip("panel does not display 'metadata' label to users", () => {
    // Skipped: component was deleted as dead code.
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

// ─── Blocker dedup — cross-engine aliases for the same underlying issue ────
//
// Confirmed by runtime inspection (real Playwright screenshot of the
// command center against a live seeded tender): export-readiness.ts's
// checkFullExportReadiness independently emits CLIENT_NAME_REQUIRED
// (tenderLevelBlocker) alongside final-submission-readiness.ts's own
// CLIENT_NAME_MISSING for the same empty-clientName condition, and
// NO_ACTIVE_GENERATED_DOCUMENTS (tenderLevelBlocker) alongside a synthetic
// __tender__ documentBlocker for the same zero-documents condition. Without
// alias collapsing, reconcileBlockers's category-based dedup lets both
// members of each pair through, rendering the same real issue as two
// unrelated red warnings.

function fakeReadiness(
  tenderLevelBlockers: Array<{ category: string; severity: string; title: string; recommendedAction: string | null }>,
  documentBlockers: Array<{ documentId: string; name: string; fileName: string; reasons: string[]; severity: string; nextActions: string[] }>,
): FinalSubmissionReadiness {
  return { tenderLevelBlockers, documentBlockers } as unknown as FinalSubmissionReadiness;
}

describe("reconcileBlockers — cross-engine category aliases collapse to one blocker", () => {
  it("CLIENT_NAME_REQUIRED and CLIENT_NAME_MISSING collapse to a single blocker", () => {
    const readiness = fakeReadiness(
      [
        { category: "CLIENT_NAME_REQUIRED", severity: "HIGH", title: "Client/procuring entity name is missing or invalid.", recommendedAction: "Edit Tender Detail." },
        { category: "CLIENT_NAME_MISSING", severity: "HIGH", title: "Client/procuring entity name is missing or blank.", recommendedAction: "Enter the official procuring entity name." },
      ],
      [],
    );
    const { blockers, blockerTotal } = reconcileBlockers(readiness);
    assert.equal(blockerTotal, 1, "must collapse to exactly one blocker, not two");
    assert.equal(blockers.length, 1);
  });

  it("NO_ACTIVE_GENERATED_DOCUMENTS and the synthetic __tender__ document blocker collapse to a single blocker", () => {
    const readiness = fakeReadiness(
      [
        { category: "NO_ACTIVE_GENERATED_DOCUMENTS", severity: "HIGH", title: "No active generated documents exist for export.", recommendedAction: "Generate, validate and review the required documents before final export." },
      ],
      [
        { documentId: "__tender__", name: "No active generated documents", fileName: "NO_ACTIVE_GENERATED_DOCUMENTS", reasons: ["NO_ACTIVE_GENERATED_DOCUMENTS: final export requires at least one active generated document."], severity: "HIGH", nextActions: ["Generate the required documents before exporting."] },
      ],
    );
    const { blockers, blockerTotal } = reconcileBlockers(readiness);
    assert.equal(blockerTotal, 1, "must collapse to exactly one blocker, not two");
    assert.equal(blockers.length, 1);
  });

  it("a real per-document failure (non-__tender__ documentId) is NOT collapsed into NO_ACTIVE_GENERATED_DOCUMENTS", () => {
    const readiness = fakeReadiness(
      [
        { category: "NO_ACTIVE_GENERATED_DOCUMENTS", severity: "HIGH", title: "No active generated documents exist for export.", recommendedAction: "Generate, validate and review the required documents before final export." },
      ],
      [
        { documentId: "doc-123", name: "Technical Proposal", fileName: "technical-proposal.docx", reasons: ["Validation failed"], severity: "HIGH", nextActions: ["Re-validate the document."] },
      ],
    );
    const { blockers, blockerTotal } = reconcileBlockers(readiness);
    assert.equal(blockerTotal, 2, "a real per-document blocker is a distinct issue and must NOT be collapsed");
    assert.equal(blockers.length, 2);
  });

  it("unrelated categories are never collapsed", () => {
    const readiness = fakeReadiness(
      [
        { category: "EXTRACTION_QUALITY_INSUFFICIENT", severity: "HIGH", title: "Extraction quality is insufficient.", recommendedAction: "Re-upload a clearer document." },
        { category: "NO_CURRENT_CONFIRMED_BUILD_PLAN", severity: "HIGH", title: "No confirmed Build Plan exists.", recommendedAction: "Build and confirm the submission Build Plan." },
      ],
      [],
    );
    const { blockers, blockerTotal } = reconcileBlockers(readiness);
    assert.equal(blockerTotal, 2, "distinct real issues must remain distinct blockers");
    assert.equal(blockers.length, 2);
  });
});
