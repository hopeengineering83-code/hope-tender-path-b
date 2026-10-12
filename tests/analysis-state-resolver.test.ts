import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveAnalysisStateDetail,
  canExportWithAnalysisState,
  canResumeAnalysis,
  analysisStateLabel,
  type AnalysisState,
  type ResolverJobInput,
  type ResolverChunkInput,
  type DeriveAnalysisStateInput,
} from "../lib/engine/analysis-state-resolver";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<ResolverJobInput> = {}): ResolverJobInput {
  return {
    id: "job-1",
    status: "QUEUED",
    analysisInputHash: "hash-abc",
    stagedMergedResult: null,
    promotedAt: null,
    supersededBy: null,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function chunk(status: string, provider: string | null = "Mistral"): ResolverChunkInput {
  return { status, provider };
}

function makeInput(overrides: Partial<DeriveAnalysisStateInput> = {}): DeriveAnalysisStateInput {
  return {
    job: null,
    chunks: [],
    legacyNotesAiAnalyzed: false,
    requirementsExtracted: 0,
    sourceReferencesCreated: false,
    metadataFieldsPersisted: false,
    ...overrides,
  };
}

// ─── Helper-function tests ────────────────────────────────────────────────

test("AI_SUCCEEDED is the ONLY state that unblocks export; all others including HUMAN_APPROVED_FALLBACK block", () => {
  assert.equal(canExportWithAnalysisState("AI_SUCCEEDED"), true);
  // HUMAN_APPROVED_FALLBACK is now explicitly blocked — regex-fallback results
  // cannot authorize generation or export. Re-run AI Analyze to obtain AI_SUCCEEDED.
  const blocked: AnalysisState[] = [
    "HUMAN_APPROVED_FALLBACK",
    "NOT_STARTED", "QUEUED", "RUNNING", "PARTIAL_NEEDS_RESUME",
    "REGEX_FALLBACK_UNAPPROVED", "FAILED", "SUPERSEDED",
  ];
  for (const s of blocked) assert.equal(canExportWithAnalysisState(s), false, `${s} must block export`);
});

test("canResumeAnalysis only for partial/fallback-unapproved/failed", () => {
  assert.equal(canResumeAnalysis("PARTIAL_NEEDS_RESUME"), true);
  assert.equal(canResumeAnalysis("REGEX_FALLBACK_UNAPPROVED"), true);
  assert.equal(canResumeAnalysis("FAILED"), true);
  assert.equal(canResumeAnalysis("AI_SUCCEEDED"), false);
  assert.equal(canResumeAnalysis("RUNNING"), false);
  assert.equal(canResumeAnalysis("HUMAN_APPROVED_FALLBACK"), false);
});

test("analysisStateLabel returns a label for every state", () => {
  const allStates: AnalysisState[] = [
    "NOT_STARTED", "QUEUED", "RUNNING", "AI_SUCCEEDED", "PARTIAL_NEEDS_RESUME",
    "REGEX_FALLBACK_UNAPPROVED", "HUMAN_APPROVED_FALLBACK", "FAILED", "SUPERSEDED",
  ];
  for (const s of allStates) {
    const label = analysisStateLabel(s);
    assert.ok(label && label.length > 0, `${s} must have a label`);
  }
});

// ─── Core derivation: NOT_STARTED / legacy ─────────────────────────────────

test("derive: no job + no notes → NOT_STARTED", () => {
  const d = deriveAnalysisStateDetail(makeInput());
  assert.equal(d.state, "NOT_STARTED");
  assert.equal(d.analysisSource, "NONE");
  assert.equal(d.resumable, false);
  assert.equal(d.canonicalJobId, null);
});

test("derive: no job + legacy notes → AI_SUCCEEDED (LEGACY_NOTES)", () => {
  const d = deriveAnalysisStateDetail(makeInput({ legacyNotesAiAnalyzed: true, requirementsExtracted: 5 }));
  assert.equal(d.state, "AI_SUCCEEDED");
  assert.equal(d.analysisSource, "LEGACY_NOTES");
  assert.equal(d.requirementsExtracted, 5);
});

// ─── Core derivation: success paths ────────────────────────────────────────

test("derive: SUCCEEDED with all chunks succeeded → AI_SUCCEEDED", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", promotedAt: new Date() }),
    chunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
  }));
  assert.equal(d.state, "AI_SUCCEEDED");
  assert.equal(d.analysisSource, "AI");
  assert.equal(d.completedChunks, 2);
  assert.equal(d.totalChunks, 2);
  assert.equal(d.canonicalJobId, "job-1");
  assert.equal(canExportWithAnalysisState(d.state), true);
});

test("non-current analysis next actions require re-running AI Analyze while AI_SUCCEEDED directs Run Engine", () => {
  const succeeded = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", promotedAt: new Date() }),
    chunks: [chunk("SUCCEEDED")],
  }));
  const fallback = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
    }),
  }));
  const reviewedFallback = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
      promotedAt: new Date(),
    }),
  }));
  const failed = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "FAILED" }),
  }));
  const unstructured = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", promotedAt: new Date() }),
    chunks: [chunk("SUCCEEDED")],
    sectionsDetectedButNoRequirements: true,
    requirementsExtracted: 0,
  }));

  assert.equal(succeeded.state, "AI_SUCCEEDED");
  assert.match(succeeded.nextAction, /Run Engine/i);
  for (const result of [fallback, reviewedFallback]) {
    assert.match(result.nextAction, /Re-run AI Analyze/i);
    assert.doesNotMatch(result.nextAction, /Review and approve|Proceed with caution/i);
  }
  assert.match(reviewedFallback.nextAction, /audit only/i);
  assert.equal(failed.state, "FAILED");
  assert.match(failed.nextAction, /Re-run AI Analyze/i);
  assert.doesNotMatch(failed.nextAction, /manual entry/i);
  assert.equal(unstructured.state, "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED");
  assert.match(unstructured.nextAction, /Re-run AI Analyze/i);
  assert.doesNotMatch(unstructured.nextAction, /manually add requirements|manual requirement/i);
});

test("derive: SUCCEEDED single-shot with zero chunks → AI_SUCCEEDED only after promotion", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", analysisInputHash: null, promotedAt: new Date() }),
    chunks: [],
  }));
  assert.equal(d.state, "AI_SUCCEEDED");
});

test("derive: SUCCEEDED without promotedAt fails closed and blocks export", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", promotedAt: null }),
    chunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
  }));
  assert.equal(d.state, "FAILED");
  assert.equal(d.analysisSource, "NONE");
  assert.equal(d.canonicalJobId, null);
  assert.equal(canExportWithAnalysisState(d.state), false);
});

test("derive: SUCCEEDED but a chunk still pending → PARTIAL_NEEDS_RESUME", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", promotedAt: new Date() }),
    chunks: [chunk("SUCCEEDED"), chunk("QUEUED")],
  }));
  assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
  assert.equal(d.resumable, true);
  assert.equal(canExportWithAnalysisState(d.state), false);
});

// ─── Core derivation: running / queued ─────────────────────────────────────

test("derive: QUEUED job → QUEUED", () => {
  const d = deriveAnalysisStateDetail(makeInput({ job: makeJob({ status: "QUEUED" }) }));
  assert.equal(d.state, "QUEUED");
});

test("derive: RUNNING job → RUNNING", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "RUNNING" }),
    chunks: [chunk("SUCCEEDED"), chunk("RUNNING")],
  }));
  assert.equal(d.state, "RUNNING");
  assert.equal(canResumeAnalysis(d.state), false);
});

test("derive: QUEUED-status job with pending chunks still RUNNING when chunks active", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "RUNNING" }),
    chunks: [chunk("QUEUED")],
  }));
  assert.equal(d.state, "RUNNING");
});

// ─── Core derivation: fallback paths ───────────────────────────────────────

test("derive: FAILED + FALLBACK_DRAFT not promoted → REGEX_FALLBACK_UNAPPROVED", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
    }),
  }));
  assert.equal(d.state, "REGEX_FALLBACK_UNAPPROVED");
  assert.equal(d.analysisSource, "REGEX_FALLBACK");
  assert.equal(canExportWithAnalysisState(d.state), false);
  assert.equal(d.resumable, true);
});

test("derive: FAILED + FALLBACK_DRAFT promoted → HUMAN_APPROVED_FALLBACK (now blocked for export)", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
      promotedAt: new Date(),
    }),
  }));
  assert.equal(d.state, "HUMAN_APPROVED_FALLBACK");
  assert.equal(d.analysisSource, "REGEX_FALLBACK");
  // HUMAN_APPROVED_FALLBACK is now blocked — regex-fallback cannot authorize export.
  assert.equal(canExportWithAnalysisState(d.state), false);
});

test("derive: FAILED + PARTIAL_AI staged → PARTIAL_NEEDS_RESUME", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "PARTIAL_AI" }),
    }),
  }));
  assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
});

test("derive: FAILED + no staged result → FAILED", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "FAILED" }),
  }));
  assert.equal(d.state, "FAILED");
  assert.equal(d.analysisSource, "NONE");
  assert.equal(d.resumable, true);
});

test("derive: FAILED + malformed staged JSON → FAILED (no throw)", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "FAILED", stagedMergedResult: "{not valid json" }),
  }));
  assert.equal(d.state, "FAILED");
});

// ─── Core derivation: superseded ───────────────────────────────────────────

test("derive: supersededBy set → SUPERSEDED (even if SUCCEEDED)", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED", supersededBy: "job-2" }),
    chunks: [chunk("SUCCEEDED")],
  }));
  assert.equal(d.state, "SUPERSEDED");
  assert.equal(canExportWithAnalysisState(d.state), false);
});

// ─── Provider attempt aggregation (the bug Amazon Q flagged) ───────────────

test("derive: provider with mixed outcomes aggregates successes+failures, SUCCESS overall", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "PARTIAL_SUCCESS" }),
    chunks: [
      chunk("SUCCEEDED", "Mistral"),
      chunk("FAILED", "Mistral"),
      chunk("SUCCEEDED", "Mistral"),
    ],
  }));
  const mistral = d.providerAttempts.find((p) => p.provider === "Mistral");
  assert.ok(mistral);
  assert.equal(mistral.successes, 2);
  assert.equal(mistral.failures, 1);
  assert.equal(mistral.status, "SUCCESS");
});

test("derive: provider with only failures reports FAILED status", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "FAILED" }),
    chunks: [chunk("FAILED", "Groq"), chunk("FAILED", "Groq")],
  }));
  const groq = d.providerAttempts.find((p) => p.provider === "Groq");
  assert.ok(groq);
  assert.equal(groq.failures, 2);
  assert.equal(groq.status, "FAILED");
});

test("derive: multiple providers tracked independently", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "PARTIAL_SUCCESS" }),
    chunks: [
      chunk("FAILED", "Mistral"),
      chunk("SUCCEEDED", "Groq"),
    ],
  }));
  assert.equal(d.providerAttempts.length, 2);
  assert.equal(d.providerAttempts.find((p) => p.provider === "Mistral")?.status, "FAILED");
  assert.equal(d.providerAttempts.find((p) => p.provider === "Groq")?.status, "SUCCESS");
});

test("derive: null providers are ignored in attempts", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "RUNNING" }),
    chunks: [chunk("QUEUED", null), chunk("RUNNING", null)],
  }));
  assert.equal(d.providerAttempts.length, 0);
});

// ─── Safe diagnostics: no secret leakage ───────────────────────────────────

test("derive: error message with API key is redacted in diagnostics", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({
      status: "FAILED",
      errorMessage: "auth failed for sk-abc123XYZsecretkey and api_key=topsecret999",
    }),
  }));
  assert.ok(!d.safeDiagnosticSummary.includes("sk-abc123XYZsecretkey"), "raw sk- key must not leak");
  assert.ok(!d.safeDiagnosticSummary.includes("topsecret999"), "raw api_key value must not leak");
  // redactSecrets() produces [KEY_REDACTED] (consolidated helper in sanitize-error.ts).
  // The previous redactSafe() produced [KEY] — updated to match the canonical format.
  assert.ok(d.safeDiagnosticSummary.includes("[KEY_REDACTED]"), "redaction marker present");
});

test("derive: Bearer token redacted", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "FAILED", errorMessage: "rejected: Bearer abc.def.ghi" }),
  }));
  assert.ok(!d.safeDiagnosticSummary.includes("abc.def.ghi"));
});

// ─── Artefact passthrough ──────────────────────────────────────────────────

test("derive: artefact counts pass through to detail", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    job: makeJob({ status: "SUCCEEDED" }),
    chunks: [chunk("SUCCEEDED")],
    requirementsExtracted: 12,
    sourceReferencesCreated: true,
    metadataFieldsPersisted: true,
  }));
  assert.equal(d.requirementsExtracted, 12);
  assert.equal(d.sourceReferencesCreated, true);
  assert.equal(d.metadataFieldsPersisted, true);
});

// ─── Exactly one state guarantee ───────────────────────────────────────────

test("derive: every scenario returns exactly one valid AnalysisState", () => {
  const valid: AnalysisState[] = [
    "NOT_STARTED", "QUEUED", "RUNNING", "AI_SUCCEEDED", "PARTIAL_NEEDS_RESUME",
    "REGEX_FALLBACK_UNAPPROVED", "HUMAN_APPROVED_FALLBACK", "FAILED", "SUPERSEDED",
  ];
  const scenarios: DeriveAnalysisStateInput[] = [
    makeInput(),
    makeInput({ legacyNotesAiAnalyzed: true }),
    makeInput({ job: makeJob({ status: "QUEUED" }) }),
    makeInput({ job: makeJob({ status: "RUNNING" }), chunks: [chunk("RUNNING")] }),
    makeInput({ job: makeJob({ status: "SUCCEEDED" }), chunks: [chunk("SUCCEEDED")] }),
    makeInput({ job: makeJob({ status: "PARTIAL_SUCCESS" }), chunks: [chunk("SUCCEEDED"), chunk("FAILED")] }),
    makeInput({ job: makeJob({ status: "FAILED" }) }),
    makeInput({ job: makeJob({ status: "CANCELED" }) }),
  ];
  for (const s of scenarios) {
    const d = deriveAnalysisStateDetail(s);
    assert.ok(valid.includes(d.state), `unexpected state: ${d.state}`);
  }
});
