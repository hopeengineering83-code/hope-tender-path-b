import test from "node:test";
import assert from "node:assert/strict";
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<ResolverJobInput> = {}): ResolverJobInput {
  return {
    id: "job-1",
    status: "SUCCEEDED",
    analysisInputHash: "hash-1",
    stagedMergedResult: null,
    promotedAt: null,
    supersededBy: null,
    startedAt: new Date(),
    finishedAt: new Date(),
    errorMessage: null,
    ...overrides,
  };
}

function chunk(status: string, provider: string | null = "Mistral", totalChunks = 2): ResolverChunkInput {
  return { status, provider, totalChunks };
}

function makeInput(overrides: Partial<DeriveAnalysisStateInput> = {}): DeriveAnalysisStateInput {
  return {
    latestJob: null,
    promotedJob: null,
    latestChunks: [],
    promotedChunks: [],
    legacyNotesAiAnalyzed: false,
    requirementsExtracted: 0,
    sourceReferencesCreated: false,
    metadataFieldsPersisted: false,
    ...overrides,
  };
}

// ─── Basic Gates ──────────────────────────────────────────────────────────

test("canExportWithAnalysisState gates correctly", () => {
  assert.equal(canExportWithAnalysisState("AI_SUCCEEDED"), true);
  assert.equal(canExportWithAnalysisState("HUMAN_APPROVED_FALLBACK"), true);
  assert.equal(canExportWithAnalysisState("NOT_STARTED"), false);
  assert.equal(canExportWithAnalysisState("FAILED"), false);
});

test("canResumeAnalysis gates correctly", () => {
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
  const job = makeJob({ status: "SUCCEEDED", promotedAt: new Date() });
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: job,
    promotedJob: job,
    latestChunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
    promotedChunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
  }));
  assert.equal(d.state, "AI_SUCCEEDED");
  assert.equal(d.analysisSource, "AI");
  assert.equal(d.completedChunks, 2);
  assert.equal(d.totalChunks, 2);
  assert.equal(d.canonicalJobId, "job-1");
  assert.equal(canExportWithAnalysisState(d.state), true);
});

test("derive: SUCCEEDED single-shot with zero chunks → AI_SUCCEEDED (0===0)", () => {
  const job = makeJob({ status: "SUCCEEDED", analysisInputHash: null });
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: job,
    latestChunks: [],
  }));
  assert.equal(d.state, "AI_SUCCEEDED");
});

test("derive: SUCCEEDED but a chunk still pending → PARTIAL_NEEDS_RESUME", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "SUCCEEDED" }),
    latestChunks: [chunk("SUCCEEDED"), chunk("QUEUED")],
  }));
  assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
  assert.equal(d.resumable, true);
  assert.equal(canExportWithAnalysisState(d.state), false);
});

// ─── Core derivation: running / queued ─────────────────────────────────────

test("derive: QUEUED job → QUEUED", () => {
  const d = deriveAnalysisStateDetail(makeInput({ latestJob: makeJob({ status: "QUEUED" }) }));
  assert.equal(d.state, "QUEUED");
});

test("derive: RUNNING job → RUNNING", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "RUNNING" }),
    latestChunks: [chunk("SUCCEEDED"), chunk("RUNNING")],
  }));
  assert.equal(d.state, "RUNNING");
  assert.equal(canResumeAnalysis(d.state), false);
});

// ─── Core derivation: fallback paths ───────────────────────────────────────

test("derive: FAILED + FALLBACK_DRAFT not promoted → REGEX_FALLBACK_UNAPPROVED", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
    }),
  }));
  assert.equal(d.state, "REGEX_FALLBACK_UNAPPROVED");
  assert.equal(d.analysisSource, "REGEX_FALLBACK");
  assert.equal(canExportWithAnalysisState(d.state), false);
  assert.equal(d.resumable, true);
});

test("derive: FAILED + FALLBACK_DRAFT promoted → HUMAN_APPROVED_FALLBACK", () => {
  const job = makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
      promotedAt: new Date(),
    });
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: job,
    promotedJob: job,
  }));
  assert.equal(d.state, "HUMAN_APPROVED_FALLBACK");
  assert.equal(d.analysisSource, "REGEX_FALLBACK");
  assert.equal(canExportWithAnalysisState(d.state), true);
});

test("derive: FAILED + PARTIAL_AI staged → PARTIAL_NEEDS_RESUME", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({
      status: "FAILED",
      stagedMergedResult: JSON.stringify({ analysisSource: "PARTIAL_AI" }),
    }),
  }));
  assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
});

test("derive: FAILED + no staged result → FAILED", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "FAILED" }),
  }));
  assert.equal(d.state, "FAILED");
  assert.equal(d.analysisSource, "NONE");
  assert.equal(d.resumable, true);
});

// ─── Success Preservation Logic ───────────────────────────────────────────

test("derive: latest failed job does NOT hide prior promoted success", () => {
  const promoted = makeJob({ id: "job-promoted", status: "SUCCEEDED", promotedAt: new Date() });
  const latest = makeJob({ id: "job-latest", status: "FAILED" });

  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: latest,
    promotedJob: promoted,
    latestChunks: [chunk("FAILED"), chunk("FAILED")],
    promotedChunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
  }));

  assert.equal(d.state, "AI_SUCCEEDED");
  assert.equal(d.analysisSource, "AI");
  assert.equal(d.canonicalJobId, "job-promoted");
  assert.equal(d.latestJobId, "job-latest");
  // It should show counts from the promoted job
  assert.equal(d.completedChunks, 2);
  assert.equal(d.totalChunks, 2);
  assert.ok(d.safeDiagnosticSummary.includes("Using prior successful analysis"));
});

test("derive: running job hides prior promoted success (RUNNING is higher precedence)", () => {
  const promoted = makeJob({ id: "job-promoted", status: "SUCCEEDED", promotedAt: new Date() });
  const latest = makeJob({ id: "job-latest", status: "RUNNING" });

  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: latest,
    promotedJob: promoted,
    latestChunks: [chunk("SUCCEEDED"), chunk("RUNNING")],
  }));

  assert.equal(d.state, "RUNNING");
  assert.equal(d.completedChunks, 1);
});

// ─── Core derivation: superseded ───────────────────────────────────────────

test("derive: supersededBy set → SUPERSEDED (even if SUCCEEDED)", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "SUCCEEDED", supersededBy: "job-2" }),
    latestChunks: [chunk("SUCCEEDED")],
  }));
  assert.equal(d.state, "SUPERSEDED");
  assert.equal(canExportWithAnalysisState(d.state), false);
});

// ─── Provider attempt aggregation ──────────────────────────────────────────

test("derive: provider with mixed outcomes aggregates successes+failures, SUCCESS overall", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "PARTIAL_SUCCESS" }),
    latestChunks: [
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

// ─── Safe diagnostics: no secret leakage ───────────────────────────────────

test("derive: error message with API key is redacted in diagnostics", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({
      status: "FAILED",
      errorMessage: "auth failed for sk-abc123XYZsecretkey and api_key=topsecret999",
    }),
  }));
  assert.ok(!d.safeDiagnosticSummary.includes("sk-abc123XYZsecretkey"), "raw sk- key must not leak");
  assert.ok(!d.safeDiagnosticSummary.includes("topsecret999"), "raw api_key value must not leak");
  assert.ok(d.safeDiagnosticSummary.includes("[KEY]"), "redaction marker present");
});

// ─── Artefact passthrough ──────────────────────────────────────────────────

test("derive: artefact counts pass through to detail", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "SUCCEEDED" }),
    latestChunks: [chunk("SUCCEEDED")],
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
    makeInput({ latestJob: makeJob({ status: "QUEUED" }) }),
    makeInput({ latestJob: makeJob({ status: "RUNNING" }), latestChunks: [chunk("RUNNING")] }),
    makeInput({ latestJob: makeJob({ status: "SUCCEEDED" }), latestChunks: [chunk("SUCCEEDED")] }),
    makeInput({ latestJob: makeJob({ status: "PARTIAL_SUCCESS" }), latestChunks: [chunk("SUCCEEDED"), chunk("FAILED")] }),
    makeInput({ latestJob: makeJob({ status: "FAILED" }) }),
    makeInput({ latestJob: makeJob({ status: "CANCELED" }) }),
  ];
  for (const s of scenarios) {
    const d = deriveAnalysisStateDetail(s);
    assert.ok(valid.includes(d.state), `unexpected state: ${d.state}`);
  }
});

// ─── Edge Cases ──────────────────────────────────────────────────────────

test("derive: zero chunks with RUNNING job → RUNNING", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "RUNNING", analysisInputHash: "h1" }),
    latestChunks: [],
  }));
  assert.equal(d.state, "RUNNING");
});

test("derive: malformed diagnostics (random string) does not crash", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "FAILED", errorMessage: "something broke !!! {{" }),
  }));
  assert.equal(d.state, "FAILED");
  assert.ok(d.safeDiagnosticSummary.includes("something broke"));
});

test("derive: very short API key-like string not redacted if below threshold", () => {
  const d = deriveAnalysisStateDetail(makeInput({
    latestJob: makeJob({ status: "FAILED", errorMessage: "short sk-abc" }),
  }));
  assert.ok(d.safeDiagnosticSummary.includes("sk-abc"));
});
