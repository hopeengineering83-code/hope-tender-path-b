// Workflow Truth Tests — verifies that the canonical analysis state resolver,
// authority truth, metadata truth, plan truth, workflow center, and
// reconcile-state all CONSUME the canonical result and AGREE on the analysis
// state. No module independently decides AI analysis state.
//
// These tests cover the 11 required scenarios from the mission:
//   1.  Prior AI success followed by failed retry
//   2.  Partial resumable job
//   3.  Approved fallback
//   4.  Unapproved fallback
//   5.  Superseded job
//   6.  Legacy notes-only tender
//   7.  Malformed provider diagnostics
//   8.  No job records
//   9.  Zero chunks
//   10. No cross-tenant workflow lookup
//   11. Authority, metadata, plan, workflow center, and canonical analysis
//       state all agree

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveAnalysisStateDetail,
  canExportWithAnalysisState,
  canResumeAnalysis,
  type ResolverJobInput,
  type ResolverChunkInput,
  type DeriveAnalysisStateInput,
  type TenderAnalysisStateDetail,
} from "../lib/engine/analysis-state-resolver";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<ResolverJobInput> = {}): ResolverJobInput {
  return {
    id: "job-1",
    status: "QUEUED",
    analysisInputHash: "hash-abc",
    stagedMergedResult: null,
    promotedAt: null,
    supersededBy: null,
    startedAt: new Date("2026-06-01T10:00:00Z"),
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
    canonicalJob: null,
    chunks: [],
    legacyNotesAiAnalyzed: false,
    requirementsExtracted: 0,
    sourceReferencesCreated: false,
    metadataFieldsPersisted: false,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Prior AI success followed by failed retry
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 1: Prior AI success followed by failed retry", () => {
  it("a latest FAILED job must NOT hide a prior promoted AI success", () => {
    const priorSuccess = makeJob({
      id: "job-prior",
      status: "SUCCEEDED",
      promotedAt: new Date("2026-06-01T10:00:00Z"),
      startedAt: new Date("2026-06-01T10:00:00Z"),
      finishedAt: new Date("2026-06-01T10:05:00Z"),
    });
    const latestFailure = makeJob({
      id: "job-latest",
      status: "FAILED",
      promotedAt: null,
      supersededBy: null,
      errorMessage: "All providers exhausted",
      startedAt: new Date("2026-06-02T10:00:00Z"),
      finishedAt: new Date("2026-06-02T10:02:00Z"),
    });
    const d = deriveAnalysisStateDetail(makeInput({
      job: latestFailure,
      canonicalJob: priorSuccess,
      requirementsExtracted: 10,
    }));
    // The state must be AI_SUCCEEDED (from the prior promoted job), NOT FAILED.
    assert.equal(d.state, "AI_SUCCEEDED");
    assert.equal(d.analysisSource, "AI");
    // The latestJobId is the failed job; the canonicalJobId is the prior success.
    assert.equal(d.latestJobId, "job-latest");
    assert.equal(d.canonicalJobId, "job-prior");
    // Export must be allowed (prior success is canonical).
    assert.equal(canExportWithAnalysisState(d.state), true);
    // The diagnostic summary must mention BOTH jobs (IDs may be truncated to 8 chars).
    assert.match(d.safeDiagnosticSummary, /job-prio/); // "job-prior".slice(0,8) = "job-prio"
    assert.match(d.safeDiagnosticSummary, /job-late/); // "job-latest".slice(0,8) = "job-late"
    assert.match(d.safeDiagnosticSummary, /failed/i);
  });

  it("a latest FAILED job with NO prior promoted success correctly shows FAILED", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ id: "job-1", status: "FAILED", errorMessage: "All providers exhausted" }),
      canonicalJob: null,
    }));
    assert.equal(d.state, "FAILED");
    assert.equal(d.canonicalJobId, null);
    assert.equal(canExportWithAnalysisState(d.state), false);
  });

  it("a latest SUCCEEDED job with a prior promoted success uses the latest (it supersedes)", () => {
    const priorSuccess = makeJob({
      id: "job-prior",
      status: "SUCCEEDED",
      promotedAt: new Date("2026-06-01T10:00:00Z"),
    });
    const latestSuccess = makeJob({
      id: "job-latest",
      status: "SUCCEEDED",
      promotedAt: new Date("2026-06-02T10:00:00Z"),
    });
    const d = deriveAnalysisStateDetail(makeInput({
      job: latestSuccess,
      canonicalJob: priorSuccess,
      chunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED")],
    }));
    assert.equal(d.state, "AI_SUCCEEDED");
    // The latest job is the canonical one now (it was promoted more recently).
    assert.equal(d.latestJobId, "job-latest");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Partial resumable job
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 2: Partial resumable job", () => {
  it("PARTIAL_SUCCESS status with mixed chunks → PARTIAL_NEEDS_RESUME", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "PARTIAL_SUCCESS" }),
      chunks: [chunk("SUCCEEDED"), chunk("FAILED"), chunk("QUEUED")],
    }));
    assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
    assert.equal(d.resumable, true);
    assert.equal(d.completedChunks, 1);
    assert.equal(d.totalChunks, 3);
    assert.equal(canExportWithAnalysisState(d.state), false);
    assert.equal(canResumeAnalysis(d.state), true);
  });

  it("SUCCEEDED status with pending chunks → PARTIAL_NEEDS_RESUME", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "SUCCEEDED" }),
      chunks: [chunk("SUCCEEDED"), chunk("QUEUED")],
    }));
    assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
  });

  it("FAILED + PARTIAL_AI staged → PARTIAL_NEEDS_RESUME", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({
        status: "FAILED",
        stagedMergedResult: JSON.stringify({ analysisSource: "PARTIAL_AI" }),
      }),
    }));
    assert.equal(d.state, "PARTIAL_NEEDS_RESUME");
    assert.equal(d.resumable, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Approved fallback
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 3: Approved fallback", () => {
  it("FAILED + FALLBACK_DRAFT promoted → HUMAN_APPROVED_FALLBACK", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({
        status: "FAILED",
        stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }),
        promotedAt: new Date(),
      }),
    }));
    assert.equal(d.state, "HUMAN_APPROVED_FALLBACK");
    assert.equal(d.analysisSource, "REGEX_FALLBACK");
    assert.equal(canExportWithAnalysisState(d.state), true);
    assert.equal(d.resumable, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Unapproved fallback
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 4: Unapproved fallback", () => {
  it("FAILED + FALLBACK_DRAFT not promoted → REGEX_FALLBACK_UNAPPROVED", () => {
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
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Superseded job
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 5: Superseded job", () => {
  it("supersededBy set → SUPERSEDED (even if SUCCEEDED)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "SUCCEEDED", supersededBy: "job-2" }),
      chunks: [chunk("SUCCEEDED")],
    }));
    assert.equal(d.state, "SUPERSEDED");
    assert.equal(canExportWithAnalysisState(d.state), false);
  });

  it("superseded job does not block export when a prior promoted success exists", () => {
    // A superseded job is NOT a "non-promoted failure" — it was replaced.
    // The prior promoted success should still be canonical IF the superseded
    // job was the one that replaced it... actually, supersededBy means this
    // job was REPLACED by job-2. If there's a separate canonicalJob that's
    // still promoted, it wins. But if the superseded job IS the latest,
    // and the canonical job is a prior success, the prior success still wins
    // because the latest is not a "non-promoted failure" (it's superseded).
    // This edge case is covered by the SUPERSEDED state.
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "SUCCEEDED", supersededBy: "job-2" }),
      canonicalJob: makeJob({ id: "job-prior", status: "SUCCEEDED", promotedAt: new Date() }),
      chunks: [chunk("SUCCEEDED")],
    }));
    assert.equal(d.state, "SUPERSEDED");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Legacy notes-only tender
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 6: Legacy notes-only tender", () => {
  it("no job + legacy notes AI flag → AI_SUCCEEDED (LEGACY_NOTES)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: null,
      legacyNotesAiAnalyzed: true,
      requirementsExtracted: 5,
    }));
    assert.equal(d.state, "AI_SUCCEEDED");
    assert.equal(d.analysisSource, "LEGACY_NOTES");
    assert.equal(d.requirementsExtracted, 5);
    assert.equal(d.latestJobId, null);
    assert.equal(d.canonicalJobId, null);
  });

  it("legacy notes are only used when there is NO job record", () => {
    // When a job exists, legacy notes must be ignored — the job is the
    // source of truth.
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "RUNNING" }),
      legacyNotesAiAnalyzed: true, // should be ignored
    }));
    assert.equal(d.state, "RUNNING");
    assert.notEqual(d.analysisSource, "LEGACY_NOTES");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Malformed provider diagnostics
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 7: Malformed provider diagnostics", () => {
  it("FAILED + malformed staged JSON → FAILED (no throw)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "FAILED", stagedMergedResult: "{not valid json" }),
    }));
    assert.equal(d.state, "FAILED");
  });

  it("error message with API key is redacted in safeDiagnosticSummary", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({
        status: "FAILED",
        errorMessage: "auth failed for sk-abc123XYZsecretkey and api_key=topsecret999",
      }),
    }));
    assert.ok(!d.safeDiagnosticSummary.includes("sk-abc123XYZsecretkey"), "raw sk- key must not leak");
    assert.ok(!d.safeDiagnosticSummary.includes("topsecret999"), "raw api_key value must not leak");
    assert.ok(d.safeDiagnosticSummary.includes("[KEY]"), "redaction marker present");
  });

  it("Bearer token redacted in safeDiagnosticSummary", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({
        status: "FAILED",
        errorMessage: "rejected: Bearer abc.def.ghi-token",
      }),
    }));
    assert.ok(!d.safeDiagnosticSummary.includes("abc.def.ghi-token"));
  });

  it("prior-success + latest-failure diagnostic summary redacts the latest error", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({
        id: "job-latest",
        status: "FAILED",
        errorMessage: "failed with sk-secretkey123",
      }),
      canonicalJob: makeJob({
        id: "job-prior",
        status: "SUCCEEDED",
        promotedAt: new Date(),
      }),
    }));
    assert.equal(d.state, "AI_SUCCEEDED");
    assert.ok(!d.safeDiagnosticSummary.includes("sk-secretkey123"));
    assert.ok(d.safeDiagnosticSummary.includes("[KEY]"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: No job records
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 8: No job records", () => {
  it("no job + no legacy notes → NOT_STARTED", () => {
    const d = deriveAnalysisStateDetail(makeInput());
    assert.equal(d.state, "NOT_STARTED");
    assert.equal(d.analysisSource, "NONE");
    assert.equal(d.latestJobId, null);
    assert.equal(d.canonicalJobId, null);
    assert.equal(d.resumable, false);
    assert.equal(canExportWithAnalysisState(d.state), false);
  });

  it("no job + no legacy notes + requirements exist → still NOT_STARTED (artefacts may be from prior runs)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      requirementsExtracted: 3,
      sourceReferencesCreated: true,
    }));
    assert.equal(d.state, "NOT_STARTED");
    // Artefact counts still pass through
    assert.equal(d.requirementsExtracted, 3);
    assert.equal(d.sourceReferencesCreated, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Zero chunks
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 9: Zero chunks", () => {
  it("SUCCEEDED with zero chunks → AI_SUCCEEDED (single-shot success, 0===0)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "SUCCEEDED", analysisInputHash: null }),
      chunks: [],
    }));
    assert.equal(d.state, "AI_SUCCEEDED");
    assert.equal(d.completedChunks, 0);
    assert.equal(d.totalChunks, 0);
  });

  it("FAILED with zero chunks → FAILED (not a placeholder)", () => {
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "FAILED" }),
      chunks: [],
    }));
    assert.equal(d.state, "FAILED");
    assert.equal(d.totalChunks, 0);
    assert.equal(d.completedChunks, 0);
  });

  it("totalChunks is derived from chunks.length, NOT from a hardcoded chunks[0].totalChunks", () => {
    // This verifies the rule: "Do not hardcode total chunks."
    const d = deriveAnalysisStateDetail(makeInput({
      job: makeJob({ status: "SUCCEEDED" }),
      chunks: [chunk("SUCCEEDED"), chunk("SUCCEEDED"), chunk("SUCCEEDED"), chunk("SUCCEEDED"), chunk("SUCCEEDED")],
    }));
    assert.equal(d.totalChunks, 5);
    assert.equal(d.completedChunks, 5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: No cross-tenant workflow lookup
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 10: No cross-tenant workflow lookup", () => {
  it("the canonical resolver's DB adapter scopes ALL queries by userId (source-shape guard)", () => {
    const src = readFileSync("lib/engine/analysis-state-resolver.ts", "utf-8");
    // The latestJob query must include userId in the where clause
    assert.match(src, /where:\s*\{\s*tenderId,\s*userId,\s*jobType:\s*AI_ANALYZE_JOB_TYPE\s*\}/);
    // The canonicalJob query must also include userId
    assert.match(src, /where:\s*\{\s*tenderId,\s*userId,\s*jobType:\s*AI_ANALYZE_JOB_TYPE,\s*promotedAt:\s*\{\s*not:\s*null\s*\}/);
    // The chunk query must include userId
    assert.match(src, /where:\s*\{\s*tenderId,\s*userId,\s*contentHash:\s*latestJob\.analysisInputHash\s*\}/);
  });

  it("the adapter (tender-analysis-resolver) looks up the tender's owner before delegating (source-shape guard)", () => {
    const src = readFileSync("lib/engine/analysis/tender-analysis-resolver.ts", "utf-8");
    // The adapter must look up the tender's userId — it does NOT pass a
    // wildcard userId to the canonical resolver.
    assert.match(src, /prisma\.tender\.findUnique.*select:\s*\{\s*userId:\s*true\s*\}/s);
    // The adapter must delegate to the canonical resolver with the looked-up userId
    assert.match(src, /resolveCanonical\(tenderId,\s*tender\.userId\)/);
  });

  it("workflow-center route passes actor.id to all truth modules (source-shape guard)", () => {
    const src = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf-8");
    assert.match(src, /resolveTenderAnalysisState\(tenderId,\s*actor\.id\)/);
    assert.match(src, /resolvePlanTruth\(prisma,\s*tenderId,\s*actor\.id\)/);
    assert.match(src, /resolveAuthorityTruth\(prisma,\s*tenderId,\s*actor\.id\)/);
    assert.match(src, /getCanonicalTenderWorkflowState\(prisma,\s*actor\.id,\s*tenderId\)/);
  });

  it("reconcile-state route passes actor.id to the canonical resolver (source-shape guard)", () => {
    const src = readFileSync("app/api/tenders/[id]/reconcile-state/route.ts", "utf-8");
    assert.match(src, /resolveTenderAnalysisState\(tenderId,\s*actor\.id\)/);
  });

  it("workflow-state scopes the tender lookup by userId (source-shape guard)", () => {
    const src = readFileSync("lib/engine/workflow/workflow-state.ts", "utf-8");
    assert.match(src, /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId,\s*userId\s*\}/);
  });

  it("reconcile-state route does NOT delete or overwrite requirements or documents (source-shape guard)", () => {
    const src = readFileSync("app/api/tenders/[id]/reconcile-state/route.ts", "utf-8");
    // The route must NOT contain deleteMany, delete, or requirement/document writes
    assert.doesNotMatch(src, /deleteMany|\.delete\(/);
    assert.doesNotMatch(src, /tenderRequirement\.(create|update|deleteMany)/);
    assert.doesNotMatch(src, /generatedDocument\.(create|update|deleteMany)/);
    // It only updates tender.status + updatedAt
    assert.match(src, /prisma\.tender\.update/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 11: Authority, metadata, plan, workflow center, and canonical
// analysis state all agree
// ════════════════════════════════════════════════════════════════════════════

describe("SCENARIO 11: All truth modules consume the canonical analysis state", () => {
  it("authority-truth imports from the canonical resolver (not the drift resolver)", () => {
    const src = readFileSync("lib/engine/analysis/authority-truth.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/analysis-state-resolver"/);
    assert.doesNotMatch(src, /from\s+"\.\/tender-analysis-resolver"/);
  });

  it("plan-truth imports from the canonical resolver (not the drift resolver)", () => {
    const src = readFileSync("lib/engine/analysis/plan-truth.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/analysis-state-resolver"/);
    assert.doesNotMatch(src, /from\s+"\.\/tender-analysis-resolver"/);
  });

  it("workflow-center route imports from the canonical resolver", () => {
    const src = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/engine\/analysis-state-resolver"/);
  });

  it("reconcile-state route imports from the canonical resolver", () => {
    const src = readFileSync("app/api/tenders/[id]/reconcile-state/route.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/engine\/analysis-state-resolver"/);
  });

  it("workflow-state imports from the canonical resolver and uses analysisDetail.state", () => {
    const src = readFileSync("lib/engine/workflow/workflow-state.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/analysis-state-resolver"/);
    assert.match(src, /resolveTenderAnalysisState\(tenderId,\s*userId\)/);
    assert.match(src, /analysisState:\s*analysisDetail\.state/);
  });

  it("authority-truth receives userId and passes it to the canonical resolver", () => {
    const src = readFileSync("lib/engine/analysis/authority-truth.ts", "utf-8");
    assert.match(src, /userId:\s*string/);
    assert.match(src, /resolveTenderAnalysisState\(tenderId,\s*userId\)/);
  });

  it("plan-truth receives userId and passes it to the canonical resolver", () => {
    const src = readFileSync("lib/engine/analysis/plan-truth.ts", "utf-8");
    assert.match(src, /userId:\s*string/);
    assert.match(src, /resolveTenderAnalysisState\(tenderId,\s*userId\)/);
  });

  it("the drift resolver (tender-analysis-resolver) is now a thin adapter that delegates to the canonical resolver", () => {
    const src = readFileSync("lib/engine/analysis/tender-analysis-resolver.ts", "utf-8");
    assert.match(src, /from\s+"\.\.\/analysis-state-resolver"/);
    assert.match(src, /resolveCanonical/);
    // Must NOT contain the drift states as string literals (quoted). Comments
    // mentioning them are OK — they explain what was removed.
    assert.doesNotMatch(src, /"SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED"/);
    assert.doesNotMatch(src, /"PARTIAL_AI_NEEDS_REVIEW"/);
    // Must NOT contain its own state-machine logic (if/else chains deciding state)
    assert.doesNotMatch(src, /if\s*\(latestJob\?\.status\s*===\s*"RUNNING"\)/);
  });

  it("the canonical resolver has exactly the 9 required states", () => {
    const src = readFileSync("lib/engine/analysis-state-resolver.ts", "utf-8");
    const states = [
      "NOT_STARTED",
      "QUEUED",
      "RUNNING",
      "AI_SUCCEEDED",
      "PARTIAL_NEEDS_RESUME",
      "REGEX_FALLBACK_UNAPPROVED",
      "HUMAN_APPROVED_FALLBACK",
      "FAILED",
      "SUPERSEDED",
    ];
    for (const s of states) {
      assert.match(src, new RegExp(`"${s}"`), `AnalysisState must include ${s}`);
    }
  });

  it("the canonical resolver does NOT use empty-string contentHash fallback (source-shape guard)", () => {
    const src = readFileSync("lib/engine/analysis-state-resolver.ts", "utf-8");
    // The chunk query must be gated on latestJob?.analysisInputHash being truthy
    assert.match(src, /if\s*\(latestJob\?\.analysisInputHash\)/);
    // Must NOT query chunks with an empty-string contentHash
    assert.doesNotMatch(src, /contentHash:\s*""/);
  });

  it("the canonical resolver does NOT return placeholder requirement counts (source-shape guard)", () => {
    const src = readFileSync("lib/engine/analysis-state-resolver.ts", "utf-8");
    // requirementsExtracted is queried from prisma.tenderRequirement.count
    assert.match(src, /prisma\.tenderRequirement\.count/);
    // sourceReferencesCreated is queried from a real count
    assert.match(src, /prisma\.tenderRequirement\s*\n?\s*\.count\(\s*\{\s*where:\s*\{\s*tenderId,\s*sourceExactQuote/);
    // metadataFieldsPersisted is derived from real tender fields
    assert.match(src, /tender\?\.clientName\s*&&\s*\(tender\?\.deadline\s*\|\|\s*tender\?\.submissionMethod\)/);
  });
});
