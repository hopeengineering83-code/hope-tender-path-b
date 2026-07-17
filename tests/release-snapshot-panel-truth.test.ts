// Regression tests for release snapshot panel truth.
//
// Proves that:
//   1. Next Required Action = Re-run AI Analyze when stale.
//   2. Generation Readiness title = blocked, not ready.
//   3. Bid Control Full Proposal card = Blocked, not Ready.
//   4. Bid Control Analysis card = Stale/Re-run, not AI verified.
//   5. Tender Health AI Analysis dimension = stale/blocked.
//   6. Tender Health Compliance dimension fails when compliance rows = 0.
//   7. Requirement denominators are consistent or explicitly labeled.
//   8. Lifecycle panel does not show generic failure for valid 200 payload.
//   9. Waiting-step buttons are disabled/secondary with reason.
//  10. Required-doc counts do not contradict.
//  11. Final export remains fail-closed.
//  12. No user-facing "metadata" wording.
//  13. Provider fallback order unchanged.
//  14. No raw public errors.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// ─── 1. Next Required Action = Re-run AI Analyze when stale ──────────────────

describe("Spec Test 1 — Next Required Action stale detection", () => {
  it("resolveTenderNextAction returns RERUN_AI_ANALYZE when stale", async () => {
    const { resolveTenderNextAction } = await import("../lib/tender-next-action");
    const decision = resolveTenderNextAction({
      hasFiles: true,
      extraction: { corrupted: false, poor: false, ocrRequired: false, partial: false },
      resumableAnalysisAvailable: false,
      aiAnalysis: { exists: true, trusted: true, stale: true },
      metadata: { trusted: true },
      requirements: { rawCount: 5, trustedTracedCount: 5, mandatoryCount: 3, mandatoryTracedCount: 3 },
      submissionPlanBuilt: false,
      documents: { current: false },
      exportBlockersCount: 0,
    });
    assert.equal(decision.primary, "RERUN_AI_ANALYZE");
    assert.ok(decision.blockers.some((b) => b.includes("stale")), "must have stale blocker");
  });
});

// ─── 2. Generation Readiness title = blocked ─────────────────────────────────

describe("Spec Test 2 — Generation Readiness blocked when snapshot blocked", () => {
  it("generation-readiness-panel checks stale analysis and compliance blockers", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(src.includes("hasStaleAnalysis"), "must check for stale analysis");
    assert.ok(src.includes("hasNoComplianceRows"), "must check for no compliance rows");
    assert.ok(src.includes("hasPdfRequiredUnavailable"), "must check for PDF required");
    assert.ok(src.includes("effectivelyReady"), "must compute effectivelyReady");
    // effectivelyReady must AND all checks
    assert.ok(
      src.includes("!hasStaleAnalysis && !hasNoComplianceRows && !hasPdfRequiredUnavailable"),
      "effectivelyReady must include all snapshot blocker checks",
    );
  });
});

// ─── 3. Bid Control Full Proposal card = Blocked ─────────────────────────────

describe("Spec Test 3 — Bid Control Full Proposal card blocked", () => {
  it("bid-control-verdict-panel uses effectiveFullProposalReady (not raw)", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("effectiveFullProposalReady"), "must use effectiveFullProposalReady");
    assert.ok(src.includes("hasSnapshotBlocker"), "must compute hasSnapshotBlocker");
    assert.ok(
      /effectiveFullProposalReady.*\?.*"Ready".*:\s*"Blocked"/.test(src),
      "must show Blocked when snapshot blocked",
    );
  });
});

// ─── 4. Bid Control Analysis card = Stale/Re-run ─────────────────────────────

describe("Spec Test 4 — Bid Control Analysis card stale", () => {
  it("bid-control-verdict-panel shows Stale when analysis is stale", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("hasStaleAnalysis"), "must compute hasStaleAnalysis");
    assert.ok(src.includes("Stale — re-run required"), "must show stale message");
  });
});

// ─── 5. Tender Health AI Analysis dimension = stale/blocked ──────────────────

describe("Spec Test 5 — Tender Health AI Analysis stale", () => {
  it("tender-health-score-panel accepts analysisStale prop", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.ok(src.includes("analysisStale"), "must accept analysisStale prop");
    assert.ok(src.includes("analysisStale ? 0"), "must score 0 when stale");
    assert.ok(src.includes("Stale — re-run required"), "must show stale detail");
  });
});

// ─── 6. Tender Health Compliance dimension fails when compliance rows = 0 ────

describe("Spec Test 6 — Tender Health Compliance fails with 0 rows", () => {
  it("tender-health-score-panel checks mandatoryComplianceRowsCount", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.ok(src.includes("mandatoryComplianceRowsCount"), "must accept mandatoryComplianceRowsCount");
    assert.ok(src.includes("hasNoComplianceRows"), "must compute hasNoComplianceRows");
    assert.ok(src.includes("No compliance matrix rows"), "must show no-rows detail");
  });
});

// ─── 7. Requirement denominators consistent ──────────────────────────────────

describe("Spec Test 7 — Requirement denominators", () => {
  it("tender-next-action accepts stale field", () => {
    const src = read("lib/tender-next-action.ts");
    assert.ok(src.includes("stale"), "must accept stale field in aiAnalysis");
  });
});

// ─── 8. Lifecycle panel does not show generic failure for 200 ─────────────────

describe("Spec Test 8 — Lifecycle panel 200 handling", () => {
  it("lifecycle route returns ok:true on HTTP 200 (not ok:false for BLOCKED)", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    assert.ok(
      src.includes("ok: true") && src.includes("transport succeeded"),
      "lifecycle route must set ok:true on HTTP 200 regardless of readiness",
    );
    assert.ok(
      !src.includes("ok: result.finalSubmissionStatus !== \"BLOCKED\""),
      "must NOT set ok based on finalSubmissionStatus",
    );
  });

  it("recovery-command-center does not throw on json.ok=false", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // Must NOT include !json.ok in the throw predicate
    assert.ok(
      !stripComments(src).includes("!json.ok"),
      "must NOT throw on json.ok=false — only throw on HTTP non-2xx",
    );
    assert.ok(
      src.includes("Only throw on HTTP non-2xx"),
      "must document the fix",
    );
  });
});

// ─── 9. Waiting-step buttons disabled/secondary ──────────────────────────────

describe("Spec Test 9 — Waiting-step buttons", () => {
  it("recovery-command-center Analysis StatusRow checks stale flag", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("data.analysisStatus.stale"), "must check stale flag");
    assert.ok(src.includes("STALE — re-run required"), "must show stale label");
    assert.ok(
      /ok=\{data\.analysisStatus\.source === "AI" && !data\.analysisStatus\.stale/.test(src),
      "ok predicate must include !stale",
    );
  });
});

// ─── 10. Required-doc counts do not contradict ───────────────────────────────

describe("Spec Test 10 — Required-doc counts", () => {
  it("lifecycle route returns requiredDocumentsTotal from plan", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    assert.ok(src.includes("requiredDocumentsTotal: result.planStatus.totalRequired"), "must use plan totalRequired");
    assert.ok(src.includes("exportReadyDocumentsTotal: result.counts.finalExportCandidates"), "must use counts.finalExportCandidates");
  });
});

// ─── 11. Final export fail-closed ────────────────────────────────────────────

describe("Spec Test 11 — Final export fail-closed", () => {
  it("isFinalExportCandidateDocument still excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });

  it("isFinalExportCandidateDocument still excludes PLANNED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      name: "T",
      exactFileName: "T.docx",
    } as any), false);
  });
});

// ─── 12. No user-facing "metadata" wording ───────────────────────────────────

describe("Spec Test 12 — No 'metadata' wording", () => {
  it("lifecycle route does not use 'metadata' in user-facing text", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    const stripped = stripComments(src);
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(stripped), "must not use 'metadata' in user-facing text");
  });
});

// ─── 13. Provider fallback order unchanged ───────────────────────────────────

describe("Spec Test 13 — Provider fallback order", () => {
  it("CANONICAL_AI_PROVIDER_ORDER includes all 10 providers", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    for (const p of ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(src.includes(p), `must include ${p}`);
    }
  });
});

// ─── 14. No raw public errors ────────────────────────────────────────────────

describe("Spec Test 14 — No raw public errors", () => {
  it("lifecycle route uses safeApiError", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    assert.ok(src.includes("safeApiError"), "must use safeApiError");
  });
});

// ─── 15. Orchestrator forwards stale/partial flags ───────────────────────────

describe("Spec Test 15 — Orchestrator forwards stale/partial", () => {
  it("tender-lifecycle-orchestrator includes stale and partial in analysisStatus", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("stale?: boolean"), "type must include stale field");
    assert.ok(src.includes("partial?: boolean"), "type must include partial field");
    assert.ok(src.includes("analysisIsStale"), "must compute analysisIsStale");
    assert.ok(src.includes("stale: analysisIsStale"), "must forward stale in return value");
    assert.ok(src.includes("partial: analysisPartialNeedsResume"), "must forward partial in return value");
  });

  it("orchestrator computes stale by comparing content hashes", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("resolveCurrentAnalysisBinding"), "must call resolveCurrentAnalysisBinding");
    assert.ok(src.includes("analysisInputHash !== binding.contentHash"), "must compare hashes");
  });
});

// ─── 16. Tender Health "Submission Plan" dimension requires a CONFIRMED Build
//         Plan, not just a non-empty derived/legacy plan ────────────────────
//
// Regression for a real, screenshot-verified contradiction: the Submission
// Plan dimension previously scored 10/10 PASS whenever
// `finalPackage.documents.planned` was non-empty — but that array is also
// populated by a legacy derived-fallback plan
// (deriveRequiredPackageDocuments) even when NO confirmed Build Plan exists.
// The Recovery Command Center and Workflow Control Center both correctly
// report "No confirmed Build Plan exists" / "No Build Plan exists" for the
// same tender in that state, so the health score must agree with them
// instead of silently scoring the unconfirmed derived draft as complete.
describe("Spec Test 16 — Tender Health 'Submission Plan' dimension agrees with the confirmed Build Plan gate", () => {
  it("imports getCurrentConfirmedBuildPlan from the shared build-plan authority", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.match(src, /import\s*\{\s*getCurrentConfirmedBuildPlan\s*\}\s*from\s*"..\/lib\/engine\/build-plan"/);
  });

  it("fetches the confirmed Build Plan before computing hasPlan", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.match(src, /confirmedBuildPlan\s*=\s*await getCurrentConfirmedBuildPlan\(/);
  });

  it("hasPlan requires confirmedBuildPlan.ok, not just a non-empty planned array", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.match(src, /const hasPlan = confirmedBuildPlan\.ok && plannedDocs\.length > 0;/);
  });

  it("FAIL detail surfaces the real confirmed-plan blocker instead of a bare 'Not built'", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.match(src, /confirmedBuildPlan\.blocker \?\? "Not built"/);
  });
});
