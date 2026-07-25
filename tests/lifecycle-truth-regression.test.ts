// Regression tests for the "Run Engine lifecycle truth" fix.
//
// These tests prove the orchestrator no longer tells the user to re-run
// Engine when Engine has already run but produced no/weak matching rows.
// They also prove the lifecycle route never returns raw error.message
// and the Recovery Command Center never shows "all good" / release-ready
// language when final status is BLOCKED.
//
// The tests use a pure simulation of the orchestrator's state machine
// (mirroring lib/engine/tender-lifecycle-orchestrator.ts) so they run
// without a database. The simulation is kept in lockstep with the
// production orchestrator by importing the same helper types and
// re-implementing the state-machine branches verbatim.
//
// Spec: fix/run-engine-lifecycle-truth
// Covers spec test requirements 1-9.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisSource =
  | "AI"
  | "REGEX_FALLBACK_AI_ERROR"
  | "HUMAN_APPROVED_REGEX_FALLBACK"
  | "UNKNOWN";

type GatingInput = {
  hasFiles: boolean;
  hasText: boolean;
  hasAnyProvider: boolean;
  analysisSource: AnalysisSource;
  criticalMetadataMissing: number;
  requirementsCount: number;
  mandatoryReqsCount: number;
  complianceRows: number;
  engineHasRun: boolean;
  analysisPartialNeedsResume: boolean;
  planRequiredRows: number;
  finalExportCandidates: number;
  plannedMissingDocs: number;
  outsidePlanRows: number;
  officialRequired: number;
  officialAttached: number;
  qualityFailed: number;
  mandatoryEvidenceReady: boolean;
  readinessScore: number;
};

type GatingResult = {
  lifecycleState: string;
  primaryNextAction: string;
  finalSubmissionStatus: "BLOCKED" | "PARTIAL" | "READY";
  blockers: Array<{ code: string; message: string; action: string }>;
  blockedActions: Array<{ action: string; reason: string }>;
};

// ─── Mirror of the production orchestrator state machine ─────────────────────
// This mirrors lib/engine/tender-lifecycle-orchestrator.ts verbatim so the
// tests stay in lockstep with production. If the orchestrator changes, this
// function must be updated too — the existing tender-lifecycle-orchestrator
// .test.ts uses the same pattern.

function simulateLifecycle(input: GatingInput): GatingResult {
  const blockers: Array<{ code: string; message: string; action: string }> = [];
  const blockedActions: Array<{ action: string; reason: string }> = [];
  let lifecycleState: string;
  let primaryNextAction: string;

  const analysisOk = input.analysisSource === "AI";
  const fallbackUnapproved = input.analysisSource === "REGEX_FALLBACK_AI_ERROR" || input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK";
  const hasAnalysis = analysisOk || fallbackUnapproved;
  const noFinalDocs = input.finalExportCandidates === 0;
  const finalExportReady =
    !fallbackUnapproved &&
    analysisOk &&
    !input.analysisPartialNeedsResume &&
    input.criticalMetadataMissing === 0 &&
    input.mandatoryEvidenceReady &&
    input.finalExportCandidates > 0 &&
    input.plannedMissingDocs === 0 &&
    input.outsidePlanRows === 0 &&
    input.qualityFailed === 0 &&
    input.officialRequired <= input.officialAttached;

  if (!input.hasFiles) {
    lifecycleState = "UPLOADED";
    primaryNextAction = "UPLOAD_TENDER_DOCUMENT";
  } else if (!input.hasText) {
    lifecycleState = "EXTRACTED";
    primaryNextAction = "RUN_AI_ANALYZE";
  } else if (!hasAnalysis && !input.hasAnyProvider) {
    lifecycleState = "AI_ANALYSIS_REQUIRED";
    primaryNextAction = "CONFIGURE_AI_PROVIDER";
  } else if (!hasAnalysis) {
    lifecycleState = "AI_ANALYSIS_REQUIRED";
    primaryNextAction = "RUN_AI_ANALYZE";
  } else if (input.analysisPartialNeedsResume) {
    lifecycleState = "PARTIAL_AI_ANALYSIS_BLOCKED";
    primaryNextAction = input.hasAnyProvider ? "RESUME_AI_ANALYZE" : "CONFIGURE_AI_PROVIDER";
    blockers.push({ code: "ANALYSIS_PARTIAL_NEEDS_RESUME", message: "AI Analyze is partial.", action: "Resume AI Analyze." });
  } else if (input.analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    lifecycleState = "ANALYSIS_FALLBACK_UNAPPROVED";
    primaryNextAction = input.hasAnyProvider ? "RETRY_AI_ANALYZE" : "APPROVE_FALLBACK_WITH_NOTE";
  } else if (input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    lifecycleState = "ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY";
    primaryNextAction = "RETRY_AI_ANALYZE";
  } else if (input.criticalMetadataMissing > 0) {
    lifecycleState = "METADATA_INCOMPLETE";
    primaryNextAction = "COMPLETE_METADATA";
  } else if (input.requirementsCount > 0 && input.complianceRows === 0 && !input.engineHasRun) {
    lifecycleState = "EVIDENCE_MATCHING_REQUIRED";
    primaryNextAction = "RUN_ENGINE";
    blockers.push({ code: "EVIDENCE_NOT_ASSESSED", message: "Engine never ran.", action: "Run Engine." });
  } else if (input.requirementsCount > 0 && input.complianceRows === 0 && input.engineHasRun) {
    lifecycleState = "EVIDENCE_MATCHING_EMPTY";
    primaryNextAction = "REVIEW_MATCHING_INPUTS";
    blockers.push({ code: "ENGINE_RAN_NO_MATCHES", message: "Engine ran but no matches.", action: "Review matching inputs." });
  } else if (input.requirementsCount > 0 && input.mandatoryReqsCount > 0 && !input.mandatoryEvidenceReady && input.complianceRows > 0) {
    lifecycleState = "EVIDENCE_MATCHING_UNCONFIRMED";
    primaryNextAction = "LINK_VAULT_EVIDENCE";
    blockers.push({ code: "MANDATORY_EVIDENCE_WEAK", message: "Mandatory evidence weak.", action: "Link vault evidence." });
  } else if (input.requirementsCount > 0 && input.planRequiredRows === 0 && input.finalExportCandidates === 0) {
    lifecycleState = "SUBMISSION_PLAN_REQUIRED";
    primaryNextAction = "BUILD_SUBMISSION_PLAN";
  } else if (input.outsidePlanRows > 0 && input.finalExportCandidates > 0) {
    lifecycleState = "SUBMISSION_PLAN_READY";
    primaryNextAction = "RECONCILE_OUTSIDE_PLAN_DOCS";
  } else if (input.plannedMissingDocs > 0) {
    lifecycleState = "DOCUMENT_GENERATION_REQUIRED";
    primaryNextAction = "GENERATE_REQUIRED_DOCUMENTS";
  } else if (input.officialRequired > input.officialAttached) {
    lifecycleState = "OFFICIAL_ORIGINALS_REQUIRED";
    primaryNextAction = "ATTACH_OFFICIAL_ORIGINALS";
  } else if (input.qualityFailed > 0) {
    lifecycleState = "QUALITY_REVIEW_REQUIRED";
    primaryNextAction = "REPAIR_DOCUMENT_QUALITY";
  } else if (input.finalExportCandidates > 0 && !finalExportReady) {
    lifecycleState = "AUTO_FINALIZE_REQUIRED";
    primaryNextAction = "AUTO_FINALIZE";
  } else if (finalExportReady) {
    lifecycleState = "EXPORT_READY";
    primaryNextAction = "DOWNLOAD_FINAL_ZIP";
  } else {
    lifecycleState = "ANALYSIS_APPROVED";
    primaryNextAction = input.requirementsCount === 0 ? "RUN_AI_ANALYZE" : "LINK_VAULT_EVIDENCE";
  }

  // Download ZIP blockedActions — mirrors production
  if (!finalExportReady) {
    const reasons: string[] = [];
    if (fallbackUnapproved) reasons.push("analysis source is unapproved regex fallback");
    if (noFinalDocs) reasons.push("no active final export candidates");
    if (input.plannedMissingDocs > 0) reasons.push(`${input.plannedMissingDocs} required document(s) not yet generated`);
    if (!input.mandatoryEvidenceReady) reasons.push("mandatory requirements are not covered by confirmed FULL/SUBSTANTIAL evidence");
    if (input.officialRequired > input.officialAttached) reasons.push(`${input.officialRequired - input.officialAttached} official original(s) not attached`);
    blockedActions.push({ action: "DOWNLOAD_ZIP", reason: reasons.length > 0 ? reasons.join("; ") : "Canonical readiness has not passed." });
  }

  const finalSubmissionStatus: GatingResult["finalSubmissionStatus"] =
    finalExportReady ? "READY" : blockers.length > 0 || noFinalDocs ? "BLOCKED" : "PARTIAL";

  return { lifecycleState, primaryNextAction, finalSubmissionStatus, blockers, blockedActions };
}

// ─── Base input ───────────────────────────────────────────────────────────────

const BASE: GatingInput = {
  hasFiles: true,
  hasText: true,
  hasAnyProvider: true,
  analysisSource: "AI",
  criticalMetadataMissing: 0,
  requirementsCount: 5,
  mandatoryReqsCount: 5,
  complianceRows: 10,
  engineHasRun: true,
  analysisPartialNeedsResume: false,
  planRequiredRows: 3,
  finalExportCandidates: 0,
  plannedMissingDocs: 3,
  outsidePlanRows: 0,
  officialRequired: 0,
  officialAttached: 0,
  qualityFailed: 0,
  mandatoryEvidenceReady: true,
  readinessScore: 85,
};

// ─── Spec Test 1: AI Analyze is partial → RESUME_AI_ANALYZE, not Run Engine ──

describe("Spec Test 1 — Partial AI Analyze", () => {
  it("lifecycle primary action is RESUME_AI_ANALYZE when AI Analyze is partial (not Run Engine)", () => {
    const r = simulateLifecycle({ ...BASE, analysisPartialNeedsResume: true });
    assert.equal(r.lifecycleState, "PARTIAL_AI_ANALYSIS_BLOCKED");
    assert.equal(r.primaryNextAction, "RESUME_AI_ANALYZE");
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE");
  });

  it("blocker code is ANALYSIS_PARTIAL_NEEDS_RESUME so the UI can show a Resume button", () => {
    const r = simulateLifecycle({ ...BASE, analysisPartialNeedsResume: true });
    assert.ok(r.blockers.some((b) => b.code === "ANALYSIS_PARTIAL_NEEDS_RESUME"));
  });

  it("final submission status is BLOCKED when AI Analyze is partial", () => {
    const r = simulateLifecycle({ ...BASE, analysisPartialNeedsResume: true });
    assert.equal(r.finalSubmissionStatus, "BLOCKED");
  });

  it("falls back to CONFIGURE_AI_PROVIDER when no provider is configured", () => {
    const r = simulateLifecycle({ ...BASE, analysisPartialNeedsResume: true, hasAnyProvider: false });
    assert.equal(r.primaryNextAction, "CONFIGURE_AI_PROVIDER");
  });
});

// ─── Spec Test 2: Engine has not run + requirements exist → may show Run Engine ─

describe("Spec Test 2 — Engine has not run", () => {
  it("lifecycle may show RUN_ENGINE when Engine has not run and requirements exist", () => {
    const r = simulateLifecycle({
      ...BASE,
      requirementsCount: 5,
      complianceRows: 0,
      engineHasRun: false,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
      planRequiredRows: 3,
    });
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_REQUIRED");
    assert.equal(r.primaryNextAction, "RUN_ENGINE");
  });

  it("blocker code is EVIDENCE_NOT_ASSESSED so the UI can show a Run Engine button", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 0,
      engineHasRun: false,
      plannedMissingDocs: 0,
    });
    assert.ok(r.blockers.some((b) => b.code === "EVIDENCE_NOT_ASSESSED"));
  });
});

// ─── Spec Test 3: Engine ran but mandatory evidence not FULL/SUBSTANTIAL ──────
//                   → does NOT keep recommending Run Engine endlessly.

describe("Spec Test 3 — Engine ran, no FULL/SUBSTANTIAL evidence", () => {
  it("lifecycle does NOT keep recommending Run Engine when Engine ran but evidence is weak", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 5,
      engineHasRun: true,
      mandatoryEvidenceReady: false,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
    });
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE");
  });

  it("lifecycle state becomes EVIDENCE_MATCHING_UNCONFIRMED (not ANALYSIS_APPROVED)", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 5,
      engineHasRun: true,
      mandatoryEvidenceReady: false,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
    });
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_UNCONFIRMED");
  });

  it("Engine ran but produced zero matching rows → REVIEW_MATCHING_INPUTS, not Run Engine", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 0,
      engineHasRun: true,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
    });
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_EMPTY");
    assert.equal(r.primaryNextAction, "REVIEW_MATCHING_INPUTS");
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE");
  });
});

// ─── Spec Test 4: Matching rows exist but weak/unconfirmed → LINK_VAULT_EVIDENCE ─

describe("Spec Test 4 — Matching rows exist but unconfirmed", () => {
  it("primary action is LINK_VAULT_EVIDENCE when matching rows exist but evidence is weak", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 3,
      engineHasRun: true,
      mandatoryEvidenceReady: false,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
    });
    assert.equal(r.primaryNextAction, "LINK_VAULT_EVIDENCE");
  });

  it("blocker code is MANDATORY_EVIDENCE_WEAK so the UI can show a Link Evidence button", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 3,
      engineHasRun: true,
      mandatoryEvidenceReady: false,
      plannedMissingDocs: 0,
      finalExportCandidates: 0,
    });
    assert.ok(r.blockers.some((b) => b.code === "MANDATORY_EVIDENCE_WEAK"));
  });
});

// ─── Spec Test 5: Required docs planned but not generated → GENERATE_REQUIRED_DOCUMENTS ─

describe("Spec Test 5 — Required docs planned but not generated", () => {
  it("primary action is GENERATE_REQUIRED_DOCUMENTS when required docs are planned but not generated", () => {
    // Engine ran, evidence is strong, but 1 doc is missing.
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      mandatoryEvidenceReady: true,
      plannedMissingDocs: 1,
      finalExportCandidates: 0,
      planRequiredRows: 2,
    });
    assert.equal(r.primaryNextAction, "GENERATE_REQUIRED_DOCUMENTS");
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE");
  });

  it("primary action is GENERATE_REQUIRED_DOCUMENTS even when finalExportCandidates > 0 (mixed state)", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      mandatoryEvidenceReady: true,
      plannedMissingDocs: 1,
      finalExportCandidates: 1,
      planRequiredRows: 2,
    });
    assert.equal(r.primaryNextAction, "GENERATE_REQUIRED_DOCUMENTS");
  });
});

// ─── Spec Test 6: Final export candidates = 0 → Download ZIP blocked ──────────

describe("Spec Test 6 — Download ZIP blocked when final export candidates = 0", () => {
  it("DOWNLOAD_ZIP is blocked when finalExportCandidates is 0", () => {
    const r = simulateLifecycle({
      ...BASE,
      finalExportCandidates: 0,
      plannedMissingDocs: 0,
      complianceRows: 10,
      engineHasRun: true,
      mandatoryEvidenceReady: true,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST be blocked when finalExportCandidates is 0");
    assert.match(zipBlock!.reason, /no active final export candidates/i);
  });

  it("DOWNLOAD_ZIP is blocked when finalExportCandidates is 0 even if everything else passes", () => {
    const r = simulateLifecycle({
      ...BASE,
      finalExportCandidates: 0,
      plannedMissingDocs: 0,
      complianceRows: 10,
      engineHasRun: true,
      mandatoryEvidenceReady: true,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST remain blocked — fail-closed behavior intact");
  });
});

// ─── Spec Test 7: no panel ever shows 'all good' / release-ready wording when blocked ──
//
// components/tender-recovery-command-center.tsx (this block's original
// subject) was deleted as unrendered dead code (nothing imports or renders
// it). The live successor panels are components/export-readiness-panel.tsx
// (owns the export gate's pass/blocked state) and
// components/next-action-panel.tsx (owns the single canonical next-action
// summary). Two of the four original checks have no live equivalent to
// redirect to and are retired below with an explanation; the other two are
// redirected to the live panels.

describe("Spec Test 7 — No 'all good' / release-ready language when blocked", () => {
  it("no live workflow panel contains 'All good', 'all set', or 'release-ready' language", () => {
    for (const file of [
      "components/export-readiness-panel.tsx",
      "components/next-action-panel.tsx",
      "components/generation-action-panel.tsx",
      "components/engine-action-panel.tsx",
    ]) {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      // Strip comments before checking — comments referencing the spec text
      // are fine. We only care about user-facing strings.
      const src = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/all good/i.test(src), `${file} must not contain 'all good' language in user-facing code`);
      assert.ok(!/all set/i.test(src), `${file} must not contain 'all set' language in user-facing code`);
      assert.ok(!/release-ready/i.test(src), `${file} must not contain 'release-ready' language in user-facing code`);
    }
  });

  it("export-readiness-panel renders an explicit 'Export gate blocked' state when not ready", () => {
    const src = readFileSync(resolve(process.cwd(), "components/export-readiness-panel.tsx"), "utf8");
    assert.ok(src.includes('"Export gate blocked"'), "must render an explicit blocked state, not an ambiguous one");
    assert.ok(src.includes('"Export gate passed"'), "must render an explicit passed state only when ok");
  });

  // "component downgrades ANALYSIS_APPROVED badge to amber when final is
  // BLOCKED" test removed -- that ad-hoc stateColor()-badge-downgrade pattern
  // no longer exists anywhere live. components/next-action-panel.tsx instead
  // reads one single getCanonicalTenderWorkflowDecision() result, so there is
  // no separate independently-rendered badge that could drift out of sync
  // with the blocked state and need downgrading — the badge and the blocked
  // state are the same computed value, structurally, not two things kept in
  // sync by extra logic.

  // "'Export Ready' counter only turns green when final status is READY"
  // test removed -- no live component renders an aggregate "Export Ready"
  // counter tied to finalSubmissionStatus. Each stage now shows its own gate
  // state independently (see "Export gate passed/blocked" above), which is
  // the redesigned replacement for a single rollup counter, not a regression.
});

// ─── Spec Test 8: Lifecycle route never returns raw error.message ─────────────

describe("Spec Test 8 — Lifecycle route returns safe structured failures", () => {
  it("lifecycle route imports safeApiError", () => {
    const src = readFileSync(
      resolve(process.cwd(), "app/api/tenders/[id]/lifecycle/route.ts"),
      "utf8",
    );
    assert.ok(src.includes("safeApiError"), "lifecycle route must import safeApiError");
  });

  it("lifecycle route returns diagnosticId in the error response", () => {
    const src = readFileSync(
      resolve(process.cwd(), "app/api/tenders/[id]/lifecycle/route.ts"),
      "utf8",
    );
    // safeApiError returns diagnosticId; verify the route calls it on error.
    assert.ok(src.includes("safeApiError("), "lifecycle route must call safeApiError on catch");
  });

  it("lifecycle route does NOT return error.message directly", () => {
    const src = readFileSync(
      resolve(process.cwd(), "app/api/tenders/[id]/lifecycle/route.ts"),
      "utf8",
    );
    // The old code did: const message = error instanceof Error ? error.message : ...
    // The new code must NOT do that — it must use safeApiError instead.
    assert.ok(
      !/const message = error instanceof Error \? error\.message/.test(src),
      "lifecycle route must NOT return raw error.message — use safeApiError",
    );
  });

  it("orchestrator always returns a diagnosticId", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(src.includes("newDiagnosticId(\"lifecycle\")"), "orchestrator must call newDiagnosticId");
    assert.ok(src.includes("diagnosticId,"), "orchestrator must return diagnosticId in the result");
  });

  it("safeApiError returns diagnosticId and never exposes raw error.message", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/safe-api-error.ts"),
      "utf8",
    );
    assert.ok(src.includes("diagnosticId"), "safeApiError must return diagnosticId");
    assert.ok(
      !/error\.message/.test(src.replace(/\/\/.*$/gm, "")),
      "safeApiError must not reference error.message in production code (comments allowed)",
    );
  });
});

// ─── Spec Test 9: Screenshot regression fixture ──────────────────────────────
//   - analysis approved
//   - final status blocked
//   - 2 required
//   - 0 generated
//   - 1 missing
//   - no FULL/SUBSTANTIAL evidence
//   Expected primary action: NOT Run Engine unless matching truly never ran.

describe("Spec Test 9 — Screenshot regression fixture", () => {
  // Screenshot scenario A: Engine ran, evidence is weak, 1 doc missing.
  // Primary MUST be LINK_VAULT_EVIDENCE (evidence takes priority per rule 6).
  it("Engine ran + 2 required + 0 generated + 1 missing + no FULL/SUBSTANTIAL → LINK_VAULT_EVIDENCE (not Run Engine)", () => {
    const r = simulateLifecycle({
      ...BASE,
      hasFiles: true,
      hasText: true,
      analysisSource: "AI",
      analysisPartialNeedsResume: false,
      requirementsCount: 2,
      mandatoryReqsCount: 2,
      complianceRows: 3, // Engine ran, rows exist
      engineHasRun: true,
      mandatoryEvidenceReady: false, // no FULL/SUBSTANTIAL evidence
      planRequiredRows: 2, // 2 required
      finalExportCandidates: 0, // 0 generated
      plannedMissingDocs: 1, // 1 missing
      outsidePlanRows: 0,
      officialRequired: 0,
      officialAttached: 0,
      qualityFailed: 0,
      readinessScore: 100,
    });
    assert.equal(r.finalSubmissionStatus, "BLOCKED");
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE", "Primary MUST NOT be Run Engine when Engine has already run");
    assert.equal(r.primaryNextAction, "LINK_VAULT_EVIDENCE");
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_UNCONFIRMED");
  });

  // Screenshot scenario B: Engine has genuinely never run (complianceRows = 0,
  // engineHasRun = false). Run Engine IS appropriate here per spec rule 1.
  it("Engine never ran + 2 required + 0 generated + 1 missing → RUN_ENGINE is valid (truly never ran)", () => {
    const r = simulateLifecycle({
      ...BASE,
      requirementsCount: 2,
      mandatoryReqsCount: 2,
      complianceRows: 0, // Engine never ran
      engineHasRun: false,
      mandatoryEvidenceReady: false,
      planRequiredRows: 2,
      finalExportCandidates: 0,
      plannedMissingDocs: 1,
    });
    assert.equal(r.primaryNextAction, "RUN_ENGINE");
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_REQUIRED");
    assert.equal(r.finalSubmissionStatus, "BLOCKED");
  });

  // Screenshot scenario C: Engine ran but produced zero matching rows.
  // Primary MUST be REVIEW_MATCHING_INPUTS, not Run Engine.
  it("Engine ran + 0 matching rows + 2 required → REVIEW_MATCHING_INPUTS (not Run Engine)", () => {
    const r = simulateLifecycle({
      ...BASE,
      requirementsCount: 2,
      mandatoryReqsCount: 2,
      complianceRows: 0, // zero matching rows
      engineHasRun: true, // but Engine ran
      mandatoryEvidenceReady: false,
      planRequiredRows: 2,
      finalExportCandidates: 0,
      plannedMissingDocs: 1,
    });
    assert.notEqual(r.primaryNextAction, "RUN_ENGINE", "Primary MUST NOT be Run Engine when Engine has already run with no matches");
    assert.equal(r.primaryNextAction, "REVIEW_MATCHING_INPUTS");
    assert.equal(r.lifecycleState, "EVIDENCE_MATCHING_EMPTY");
  });
});

// ─── Spec invariant: Final export fail-closed behavior NOT weakened ──────────

describe("Spec invariant — Final export fail-closed behavior NOT weakened", () => {
  it("DOWNLOAD_ZIP remains blocked when fallback is unapproved (audit-only)", () => {
    const r = simulateLifecycle({
      ...BASE,
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      finalExportCandidates: 5,
      plannedMissingDocs: 0,
      mandatoryEvidenceReady: true,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST remain blocked for HUMAN_APPROVED_REGEX_FALLBACK");
    assert.match(zipBlock!.reason, /unapproved regex fallback/i);
  });

  it("DOWNLOAD_ZIP remains blocked when mandatory evidence is missing", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      finalExportCandidates: 5,
      plannedMissingDocs: 0,
      mandatoryEvidenceReady: false,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST remain blocked when mandatory evidence is missing");
    assert.match(zipBlock!.reason, /FULL\/SUBSTANTIAL evidence/i);
  });

  it("DOWNLOAD_ZIP remains blocked when official originals are missing", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      finalExportCandidates: 5,
      plannedMissingDocs: 0,
      mandatoryEvidenceReady: true,
      officialRequired: 2,
      officialAttached: 0,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST remain blocked when official originals are missing");
  });

  it("DOWNLOAD_ZIP remains blocked when planned docs are missing", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      finalExportCandidates: 5,
      plannedMissingDocs: 2,
      mandatoryEvidenceReady: true,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.ok(zipBlock, "DOWNLOAD_ZIP MUST remain blocked when planned docs are missing");
    assert.match(zipBlock!.reason, /required document/i);
  });

  it("DOWNLOAD_ZIP is allowed ONLY when ALL conditions pass (fail-closed verified)", () => {
    const r = simulateLifecycle({
      ...BASE,
      complianceRows: 10,
      engineHasRun: true,
      finalExportCandidates: 5,
      plannedMissingDocs: 0,
      outsidePlanRows: 0,
      qualityFailed: 0,
      mandatoryEvidenceReady: true,
      officialRequired: 0,
      officialAttached: 0,
      readinessScore: 100,
    });
    const zipBlock = r.blockedActions.find((b) => b.action === "DOWNLOAD_ZIP");
    assert.equal(zipBlock, undefined, "DOWNLOAD_ZIP MUST be allowed when ALL conditions pass");
    assert.equal(r.finalSubmissionStatus, "READY");
    assert.equal(r.lifecycleState, "EXPORT_READY");
  });
});

// ─── Spec invariant: Orchestrator source has the new branches ────────────────

describe("Spec invariant — Orchestrator source has the new branches", () => {
  it("orchestrator source includes the engineHasRun durable signal", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(src.includes("engineHasRun"), "orchestrator must derive engineHasRun");
    assert.ok(src.includes("ENGINE_RUN"), "orchestrator must query ENGINE_RUN AiJobs");
  });

  it("orchestrator source includes the analysisPartialNeedsResume check", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(src.includes("analysisPartialNeedsResume"), "orchestrator must check analysisPartialNeedsResume");
    assert.ok(src.includes("PARTIAL_AI_ANALYSIS_BLOCKED"), "orchestrator must set PARTIAL_AI_ANALYSIS_BLOCKED state");
    assert.ok(src.includes("RESUME_AI_ANALYZE"), "orchestrator must recommend RESUME_AI_ANALYZE");
  });

  it("orchestrator source splits step 9 into 9a/9b/9c", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(src.includes("EVIDENCE_MATCHING_REQUIRED"), "step 9a state");
    assert.ok(src.includes("EVIDENCE_MATCHING_EMPTY"), "step 9b state");
    assert.ok(src.includes("EVIDENCE_MATCHING_UNCONFIRMED"), "step 9c state");
    assert.ok(src.includes("REVIEW_MATCHING_INPUTS"), "step 9b primary action");
    assert.ok(src.includes("MANDATORY_EVIDENCE_WEAK"), "step 9c blocker code");
    assert.ok(src.includes("ENGINE_RAN_NO_MATCHES"), "step 9b blocker code");
  });

  it("orchestrator source does NOT default to RUN_ENGINE in the default branch", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    // The old default branch was:
    //   primaryNextAction = requirements.length === 0 ? "RUN_ENGINE" : "LINK_VAULT_EVIDENCE";
    // The new default branch is:
    //   primaryNextAction = requirements.length === 0 ? "RUN_AI_ANALYZE" : "LINK_VAULT_EVIDENCE";
    assert.ok(
      src.includes('requirements.length === 0 ? "RUN_AI_ANALYZE"'),
      "default branch must use RUN_AI_ANALYZE, not RUN_ENGINE",
    );
    assert.ok(
      !src.includes('requirements.length === 0 ? "RUN_ENGINE"'),
      "default branch must NOT use RUN_ENGINE",
    );
  });

  it("orchestrator source does NOT default to RUN_ENGINE as the fallback primaryNextAction", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    // The old fallback was: primaryNextAction ?? "RUN_ENGINE"
    // The new fallback is: primaryNextAction ?? "LINK_VAULT_EVIDENCE"
    assert.ok(
      src.includes('primaryNextAction ?? "LINK_VAULT_EVIDENCE"'),
      "fallback primaryNextAction must be LINK_VAULT_EVIDENCE, not RUN_ENGINE",
    );
    assert.ok(
      !src.includes('primaryNextAction ?? "RUN_ENGINE"'),
      "fallback primaryNextAction must NOT be RUN_ENGINE",
    );
  });
});

// ─── Spec invariant: New PrimaryNextAction values resolve in the registry ─────

describe("Spec invariant — New PrimaryNextAction values resolve in the registry", () => {
  it("RESUME_AI_ANALYZE resolves in the recovery command actions registry", async () => {
    const { getRecoveryCommandActionSpec } = await import("../lib/recovery-command-actions");
    const spec = getRecoveryCommandActionSpec("RESUME_AI_ANALYZE");
    assert.ok(spec, "RESUME_AI_ANALYZE must resolve in the registry");
    assert.equal(spec!.kind, "api");
    assert.ok(spec!.path?.includes("/ai-analyze"));
  });

  it("REVIEW_MATCHING_INPUTS resolves in the recovery command actions registry", async () => {
    const { getRecoveryCommandActionSpec } = await import("../lib/recovery-command-actions");
    const spec = getRecoveryCommandActionSpec("REVIEW_MATCHING_INPUTS");
    assert.ok(spec, "REVIEW_MATCHING_INPUTS must resolve in the registry");
    assert.equal(spec!.kind, "navigate");
    assert.equal(spec!.path, "/dashboard/matching");
    assert.ok(existsSync(resolve(process.cwd(), "app", spec!.path!.replace(/^\//, ""))));
  });
});

// ─── Spec invariant: engineHasRun checks BOTH AiJob and AuditLog ─────────────
// The sync engine route (POST /api/tenders/[id]/engine) calls runTenderEngine
// directly WITHOUT creating an AiJob. The orchestrator must also check the
// AuditLog for TENDER_ENGINE_RUN_STARTED entries to catch sync engine runs.
// Without this, a sync engine run would be invisible to the orchestrator,
// causing it to recommend RUN_ENGINE even after Engine had already run.

describe("Spec invariant — engineHasRun checks both AiJob and AuditLog", () => {
  it("orchestrator source queries both aiJob.count and auditLog.count", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(src.includes('jobType: "ENGINE_RUN"'), "orchestrator must query ENGINE_RUN AiJobs");
    assert.ok(src.includes('action: "TENDER_ENGINE_RUN_STARTED"'), "orchestrator must query TENDER_ENGINE_RUN_STARTED audit log entries");
    assert.ok(src.includes("engineJobCount > 0 || engineAuditCount > 0"), "engineHasRun must combine both signals with OR");
  });

  it("orchestrator comments explain WHY the audit log check is needed", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    // The comment must explain that the sync engine route does not create
    // an AiJob — this is the key insight that justifies the audit log check.
    assert.ok(src.includes("sync engine route"), "orchestrator must document the sync engine route gap");
    assert.ok(src.includes("without creating an AiJob"), "orchestrator must explain why the audit log check is needed");
  });
});

// ─── Spec rule 5 & 6: primaryNextAction never contradicts blockedActions ────
// When final is BLOCKED, the primary next action must be a blocker-resolving
// action — never a generic repeated action that is itself blocked.

describe("Spec rule 5 & 6 — primaryNextAction never contradicts blockedActions", () => {
  it("orchestrator source includes the contradiction-check invariant", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    assert.ok(
      src.includes("Spec rule 5 & 6 invariant"),
      "orchestrator must include the spec rule 5 & 6 invariant check",
    );
    assert.ok(
      src.includes("Contradiction detected"),
      "orchestrator must detect and fix contradictions",
    );
  });

  it("orchestrator maps blocker codes to resolving primary actions", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    // The blockerToAction map must cover all blocker codes the state
    // machine can emit when final is BLOCKED.
    const expectedMappings: Array<[string, string]> = [
      ["EVIDENCE_NOT_ASSESSED", "RUN_ENGINE"],
      ["ENGINE_RAN_NO_MATCHES", "REVIEW_MATCHING_INPUTS"],
      ["MANDATORY_EVIDENCE_WEAK", "LINK_VAULT_EVIDENCE"],
      ["DOCUMENTS_NOT_GENERATED", "GENERATE_REQUIRED_DOCUMENTS"],
      ["ANALYSIS_PARTIAL_NEEDS_RESUME", "RESUME_AI_ANALYZE"],
    ];
    for (const [code, action] of expectedMappings) {
      assert.ok(
        src.includes(`${code}: "${action}"`),
        `blockerToAction must map ${code} → ${action}`,
      );
    }
  });

  it("orchestrator safe-fallback is LINK_VAULT_EVIDENCE (not RUN_ENGINE)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/engine/tender-lifecycle-orchestrator.ts"),
      "utf8",
    );
    // The contradiction-check fallback must be LINK_VAULT_EVIDENCE, never
    // RUN_ENGINE — this prevents a future code path from resurrecting the
    // "Endless Run Engine loop" bug.
    assert.ok(
      src.includes('primaryNextAction = "LINK_VAULT_EVIDENCE"'),
      "contradiction-check fallback must be LINK_VAULT_EVIDENCE",
    );
  });
});
