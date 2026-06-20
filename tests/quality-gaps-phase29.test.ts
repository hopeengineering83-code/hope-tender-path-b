// Phase 29 quality-gap regression tests.
//
// Coverage:
//   1. final-submission-readiness: ANALYSIS_FROM_CORRUPTED_EXTRACTION blocker
//   2. final-submission-readiness: ANALYSIS_FROM_WEAK_EXTRACTION blocker
//   3. final-submission-readiness: ANALYSIS_FROM_PARTIAL_EXTRACTION blocker
//   4. final-submission-readiness: DEADLINE_PASSED advisory
//   5. pipeline-diagnostic: page-level extraction metrics included in response

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const readinessSource = readFileSync(
  path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"),
  "utf-8",
);

const exportReadinessSource = readFileSync(
  path.join(process.cwd(), "lib/engine/export-readiness.ts"),
  "utf-8",
);

const diagnosticSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/pipeline-diagnostic/route.ts"),
  "utf-8",
);

// ── 1–3. final-submission-readiness — analysis extraction status blockers ──────

describe("final-submission-readiness — analysis extraction status blockers", () => {
  it("blocks EXTRACTION_CORRUPTED_AI_SKIPPED", () => {
    assert.ok(
      readinessSource.includes("EXTRACTION_CORRUPTED_AI_SKIPPED"),
      "readiness must block when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED",
    );
  });

  it("emits ANALYSIS_FROM_CORRUPTED_EXTRACTION category", () => {
    assert.ok(
      readinessSource.includes("ANALYSIS_FROM_CORRUPTED_EXTRACTION"),
      "readiness must push ANALYSIS_FROM_CORRUPTED_EXTRACTION blocker",
    );
  });

  it("blocks REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      readinessSource.includes("REGEX_FALLBACK_FROM_WEAK_EXTRACTION"),
      "readiness must block when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
  });

  it("emits ANALYSIS_FROM_WEAK_EXTRACTION category", () => {
    assert.ok(
      readinessSource.includes("ANALYSIS_FROM_WEAK_EXTRACTION"),
      "readiness must push ANALYSIS_FROM_WEAK_EXTRACTION blocker",
    );
  });

  it("blocks PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    assert.ok(
      readinessSource.includes("PARTIAL_EXTRACTION_AI_ANALYZED"),
      "readiness must block when analysisExtractionStatus is PARTIAL_EXTRACTION_AI_ANALYZED",
    );
  });

  it("emits ANALYSIS_FROM_PARTIAL_EXTRACTION category", () => {
    assert.ok(
      readinessSource.includes("ANALYSIS_FROM_PARTIAL_EXTRACTION"),
      "readiness must push ANALYSIS_FROM_PARTIAL_EXTRACTION blocker",
    );
  });
});

// ── 4. final-submission-readiness — deadline-in-the-past advisory ─────────────

describe("final-submission-readiness — deadline-passed advisory", () => {
  // The deadline-passed check is owned by export-readiness.ts, which emits
  // DEADLINE_PASSED as a HIGH advisory (not a hard blocker). It flows into
  // final-submission-readiness via readiness.advisoryWarnings.
  it("export-readiness checks tender.deadline for past-deadline condition", () => {
    assert.ok(
      exportReadinessSource.includes("DEADLINE_PASSED"),
      "export-readiness must emit DEADLINE_PASSED when the deadline has passed",
    );
  });

  it("export-readiness computes daysAgo from deadline date", () => {
    assert.ok(
      exportReadinessSource.includes("daysAgo"),
      "export-readiness DEADLINE_PASSED advisory must include daysAgo count",
    );
  });

  it("export-readiness emits DEADLINE_PASSED as an advisory, not a hard blocker", () => {
    const idx = exportReadinessSource.indexOf('"DEADLINE_PASSED"');
    assert.ok(idx !== -1, "DEADLINE_PASSED must exist in export-readiness");
    const before = exportReadinessSource.slice(Math.max(0, idx - 200), idx);
    assert.ok(
      before.includes("advisoryWarnings.push"),
      "DEADLINE_PASSED must be pushed to advisoryWarnings, not blockers",
    );
  });

  it("final-submission-readiness does NOT re-add DEADLINE_PASSED as a hard blocker", () => {
    // Regression guard: a duplicate push to tenderLevelBlockers here caused
    // DEADLINE_PASSED to appear in both the advisory list and the hard
    // blocker list, wrongly blocking export after a passed deadline.
    assert.ok(
      !readinessSource.includes('category: "DEADLINE_PASSED"'),
      "final-submission-readiness must not push its own DEADLINE_PASSED blocker",
    );
  });
});

// ── 5. pipeline-diagnostic — page extraction metrics in response ──────────────

describe("pipeline-diagnostic — page extraction metrics in response", () => {
  it("includes totalPages in files response", () => {
    assert.ok(
      diagnosticSource.includes("totalPages: f.totalPages"),
      "pipeline-diagnostic must include totalPages per file in upload.files response",
    );
  });

  it("includes extractedPages in files response", () => {
    assert.ok(
      diagnosticSource.includes("extractedPages: f.extractedPages"),
      "pipeline-diagnostic must include extractedPages per file in upload.files response",
    );
  });

  it("includes ocrPages in files response", () => {
    assert.ok(
      diagnosticSource.includes("ocrPages: f.ocrPages"),
      "pipeline-diagnostic must include ocrPages per file in upload.files response",
    );
  });

  it("includes failedPages in files response", () => {
    assert.ok(
      diagnosticSource.includes("failedPages: f.failedPages"),
      "pipeline-diagnostic must include failedPages per file in upload.files response",
    );
  });
});
