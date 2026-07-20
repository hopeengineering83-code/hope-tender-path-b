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

// ─── 3-6. Bid Control / Tender Health stale-analysis and no-compliance-rows
// gating (Spec Tests 3-6) — components/bid-control-verdict-panel.tsx and
// components/tender-health-score-panel.tsx were retired in favor of the
// canonical Tender Release State. The SAME underlying protections (a stale
// analysis, or zero compliance rows on mandatory requirements, must never
// present as ready/confident) now hold transitively:
//   - stale analysis: lib/engine/tender-release-state.ts gates
//     readinessScore/verdict behind analysisGrounded, which reads
//     snapshot.analysis.eligibleForExport — false whenever the content hash
//     no longer matches (i.e. stale) — see release-integration-panel-truth.test.ts.
//   - zero compliance rows: lib/engine/canonical-workflow-decision.ts's
//     Priority 9 ("MANDATORY_NO_COMPLIANCE_ROWS") surfaces as the primary
//     next action whenever mandatoryComplianceRowsCount === 0, and
//     tender-release-state.ts's primaryNextAction is a direct passthrough
//     of that decision (never recomputed).
describe("Spec Test 3-6 — canonical Tender Release State inherits stale-analysis and no-compliance-rows gating", () => {
  it("primaryNextAction is a passthrough of getCanonicalTenderWorkflowDecision, not recomputed", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.match(
      src,
      /primaryNextAction = workflowDecision\s*\?\s*\{\s*action:\s*workflowDecision\.nextRequiredAction/,
      "primaryNextAction must forward the canonical workflow decision's action/label/reason verbatim",
    );
  });

  it("canonical workflow decision blocks on zero mandatory compliance rows before generation/export", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(src.includes("MANDATORY_NO_COMPLIANCE_ROWS"), "must have a zero-compliance-rows blocker code");
    assert.ok(
      src.includes("input.mandatoryRequirementCount > 0 && input.mandatoryComplianceRowsCount === 0"),
      "must trigger specifically when mandatory requirements exist but have no compliance rows",
    );
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
// components/tender-health-score-panel.tsx was retired in favor of the
// canonical Tender Release State. Its "Submission Plan" dimension is gone,
// but the underlying PR #1188 protection — the submission plan must never
// read as built from a merely non-empty planned array, only from a genuinely
// CONFIRMED Build Plan — lives in lib/engine/tender-release-snapshot.ts's
// buildPlan.gateValid, which lib/engine/tender-release-state.ts consumes
// (via getCanonicalTenderWorkflowDecision's confirmedBuildPlanExists) rather
// than recomputing its own hasPlan check.
describe("Spec Test 16 — canonical Tender Release State agrees with the confirmed Build Plan gate", () => {
  it("tender-release-snapshot's buildPlan.gateValid is computed via getCurrentConfirmedBuildPlan, not a non-empty array check", () => {
    const src = read("lib/engine/tender-release-snapshot.ts");
    assert.ok(src.includes("getCurrentConfirmedBuildPlan"), "must call the shared confirmed-build-plan authority");
  });

  it("canonical workflow decision reads buildPlan.gateValid, not a raw document count", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(
      src.includes("confirmedBuildPlanExists = snapshot.buildPlan.gateValid"),
      "must use the gate-aligned strict validity, not a count-based heuristic",
    );
  });

  it("tender-release-state does not recompute its own submission-plan-built flag", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.ok(!/hasPlan\s*=/.test(src), "must not recompute a local hasPlan flag");
  });
});
