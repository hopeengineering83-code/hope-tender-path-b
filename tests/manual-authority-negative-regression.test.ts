// Negative regression tests for manual AI Analyze authority.
//
// These tests prove that createAnalysisJob() — the only AI_ANALYZE job
// creation authority — refuses to mint a runnable AI_ANALYZE job when called
// without explicit manual-action provenance. This closes the race window
// described in FIX 1: previously, the manual route called createAnalysisJob()
// first and patched manualRequested=true in a separate updateMany, allowing
// any internal caller of createAnalysisJob() to mint a runnable job.
//
// These are SOURCE-TEXT CONTRACT tests — they assert that the source code
// contains (or refuses to contain) the patterns that establish the manual
// authority boundary. They do not execute the function (which would require a
// live database); instead they prove the contract is encoded in the source.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("FIX 1 — Manual AI Analyze authority (source-text contract)", () => {
  it("createAnalysisJob requires a manualAuthority parameter with source, actorUserId, and authorizedAt", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(source, /manualAuthority:/, "createAnalysisJob input type must include manualAuthority");
    assert.match(source, /source: "manual-ai-analyze"/, "manualAuthority.source must be the literal 'manual-ai-analyze'");
    assert.match(source, /actorUserId:/, "manualAuthority must include actorUserId");
    assert.match(source, /authorizedAt:/, "manualAuthority must include authorizedAt");
  });

  it("createAnalysisJob throws MANUAL_AUTHORITY_REQUIRED when manualAuthority is absent or invalid", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(source, /MANUAL_AUTHORITY_REQUIRED/, "createAnalysisJob must throw MANUAL_AUTHORITY_REQUIRED");
    assert.match(
      source,
      /if \(\s*!manualAuthority\s*\|\|\s*manualAuthority\.source !== "manual-ai-analyze"/,
      "createAnalysisJob must validate manualAuthority.source",
    );
  });

  it("createAnalysisJob persists manualRequested, source, actorUserId, authorizedAt in the SAME transaction as job creation", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    // The AiJob.create data block must include the manual authority fields
    // inline (not in a separate updateMany).
    const createBlockMatch = source.match(/tx\.aiJob\.create\(\{[\s\S]*?\}\)\s*;/);
    assert.ok(createBlockMatch, "createAnalysisJob must call tx.aiJob.create()");
    const createBlock = createBlockMatch![0];
    assert.match(createBlock, /manualRequested: true/, "AiJob.create must persist manualRequested: true inline");
    assert.match(createBlock, /source: "manual-ai-analyze"/, "AiJob.create must persist source inline");
    assert.match(createBlock, /actorUserId:/, "AiJob.create must persist actorUserId inline");
    assert.match(createBlock, /authorizedAt:/, "AiJob.create must persist authorizedAt inline");
  });

  it("the manual-ai-analyze route passes manualAuthority into createAnalysisJob (no post-creation updateMany patch)", () => {
    const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    assert.match(route, /manualAuthority:/, "manual-ai-analyze route must pass manualAuthority");
    assert.match(route, /source: "manual-ai-analyze"/, "manual-ai-analyze route must set source");
    assert.match(route, /actorUserId: actor\.id/, "manual-ai-analyze route must set actorUserId from authenticated actor");
    // The post-creation updateMany patch MUST be gone.
    assert.doesNotMatch(
      route,
      /prisma\.aiJob\.updateMany/,
      "manual-ai-analyze route must NOT patch manualRequested in a separate updateMany (race window)",
    );
  });

  it("the worker (runNextChunk) fails closed when an AI_ANALYZE job lacks manual authority", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    // runNextChunk must verify manualRequested/source/actorUserId BEFORE
    // processing the chunk, and mark the job FAILED if absent.
    assert.match(source, /MANUAL_AUTHORITY_MISSING/, "runNextChunk must fail closed with MANUAL_AUTHORITY_MISSING");
    assert.match(
      source,
      /parsedInput\.manualRequested !== true/,
      "runNextChunk must check parsedInput.manualRequested === true",
    );
    assert.match(
      source,
      /parsedInput\.source !== "manual-ai-analyze"/,
      "runNextChunk must check parsedInput.source === 'manual-ai-analyze'",
    );
  });

  it("no internal service other than the authenticated routes calls createAnalysisJob without manualAuthority", () => {
    // Allowed callers: manual-ai-analyze route, ai-analyze route (background
    // recovery — also authenticated), analysis-orchestrator (forwards manual
    // authority from the worker's existing job input), and tests.
    // Anything else in lib/ or app/api/ that imports createAnalysisJob must
    // pass manualAuthority.
    const allowedCallers = [
      "app/api/tenders/[id]/manual-ai-analyze/route.ts",
      "app/api/tenders/[id]/ai-analyze/route.ts",
      "lib/engine/analysis-orchestrator.ts",
    ];
    // Verify the orchestrator forwards manualAuthority.
    const orchestrator = read("lib/engine/analysis-orchestrator.ts");
    assert.match(
      orchestrator,
      /manualAuthority/,
      "analysis-orchestrator must accept and forward manualAuthority",
    );
    assert.match(
      orchestrator,
      /MANUAL_AUTHORITY_REQUIRED/,
      "analysis-orchestrator must throw if manualAuthority is absent",
    );
    // Verify the legacy handler reads manualAuthority from job input.
    const legacyHandler = read("lib/ai-job-handlers-legacy.ts");
    assert.match(
      legacyHandler,
      /manualAuthority/,
      "ai-job-handlers-legacy must forward manualAuthority from job input",
    );
  });
});

describe("FIX 4 — Dead automaticEngineJob continuation branch removed", () => {
  it("run-next/route.ts does NOT advance to nextJobType='ENGINE_RUN' from an AI_ANALYZE handler output", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    // The dead branch assigned nextJobId = automaticEngineJob.jobId and
    // nextJobType = "ENGINE_RUN" from result.output.automaticEngineJob.
    // After FIX 4, the worker must NOT execute that branch — it must call
    // continueSuccessfulAnalysis (which always returns MANUAL_ENGINE_REQUIRED)
    // and optionally log a contract violation if a handler maliciously
    // returns automaticEngineJob.
    assert.match(
      route,
      /continueSuccessfulAnalysis\(claimed\.id\)/,
      "run-next must call continueSuccessfulAnalysis after AI_ANALYZE",
    );
    // The specific dead-branch assignment pattern (reading jobId from
    // automaticEngineJob and assigning to nextJobId/nextJobType) must be gone.
    assert.doesNotMatch(
      route,
      /nextJobId = automaticEngineJob\.jobId/,
      "run-next must NOT assign nextJobId from automaticEngineJob.jobId",
    );
    assert.doesNotMatch(
      route,
      /continuationReused = automaticEngineJob\.reusedActiveJob/,
      "run-next must NOT assign continuationReused from automaticEngineJob.reusedActiveJob",
    );
    // Defence in depth: if a handler returns automaticEngineJob, log it.
    assert.match(
      route,
      /automaticEngineJob/,
      "run-next must defensively check automaticEngineJob (to log contract violations)",
    );
    assert.match(
      route,
      /contract violation/i,
      "run-next must log a contract-violation warning if automaticEngineJob is present",
    );
  });

  it("continueSuccessfulAnalysis always returns MANUAL_ENGINE_REQUIRED and never creates an Engine job", () => {
    const service = read("lib/ai-jobs/engine-continuation-service.ts");
    assert.match(
      service,
      /MANUAL_ENGINE_REQUIRED/,
      "continueSuccessfulAnalysis must return MANUAL_ENGINE_REQUIRED",
    );
    // The service must NOT contain any AiJob.create or upsertEngine or
    // rearmFailedEngine calls — those were the automatic Engine authority
    // paths that have been deleted.
    assert.doesNotMatch(
      service,
      /\bupsertEngine\b/,
      "engine-continuation-service must NOT contain upsertEngine (automatic Engine authority)",
    );
    assert.doesNotMatch(
      service,
      /\brearmFailedEngine\b/,
      "engine-continuation-service must NOT contain rearmFailedEngine (automatic Engine authority)",
    );
    assert.doesNotMatch(
      service,
      /aiJob\.create/,
      "engine-continuation-service must NOT create AiJob rows (no automatic Engine authority)",
    );
  });
});

describe("FIX 3 — INTERNAL_ARTIFACT_PREPARATION fallback removed", () => {
  it("enqueue-engine-job.ts does NOT infer manual authority from purpose === INTERNAL_ARTIFACT_PREPARATION", () => {
    const source = read("lib/engine/enqueue-engine-job.ts");
    // The fallback `?? input.purpose === "INTERNAL_ARTIFACT_PREPARATION"`
    // must be gone. Only the comment mentioning it (for historical context)
    // is allowed.
    assert.doesNotMatch(
      source,
      /const manualRequested = input\.manualRequested\s*\?\?\s*input\.purpose === "INTERNAL_ARTIFACT_PREPARATION"/,
      "enqueue-engine-job must NOT infer manual authority from purpose",
    );
    assert.match(
      source,
      /if \(!input\.manualRequested\)/,
      "enqueue-engine-job must require manualRequested as a hard condition",
    );
  });

  it("the manual engine route passes manualRequested: true (not purpose: INTERNAL_ARTIFACT_PREPARATION)", () => {
    const route = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(
      route,
      /manualRequested: true/,
      "engine route must pass manualRequested: true",
    );
    // The route may mention INTERNAL_ARTIFACT_PREPARATION in a comment
    // explaining what was removed — that's fine. But the enqueue call
    // itself must not pass it as the authority.
    const enqueueMatch = route.match(/enqueueEngineJobForCurrentSources\(prisma, \{[\s\S]*?\}\)/);
    assert.ok(enqueueMatch, "engine route must call enqueueEngineJobForCurrentSources");
    const enqueueCall = enqueueMatch![0];
    assert.doesNotMatch(
      enqueueCall,
      /purpose:\s*"INTERNAL_ARTIFACT_PREPARATION"/,
      "engine route enqueue call must NOT pass purpose='INTERNAL_ARTIFACT_PREPARATION' as authority",
    );
  });
});

describe("FIX 6 — Engine never re-analyzes the tender", () => {
  it("run-tender-engine.ts does NOT call analyzeWithAI when promoted analysis is absent", () => {
    const source = read("lib/engine/run-tender-engine.ts");
    // The Engine must NOT call analyzeWithAI directly. The only allowed AI
    // usage in the Engine is the bounded candidate reranking in
    // ai-multi-perspective-matcher.ts (which is matching, not analysis).
    assert.doesNotMatch(
      source,
      /await analyzeWithAI\(/,
      "run-tender-engine must NOT call analyzeWithAI directly",
    );
    // When promoted analysis is absent, the Engine must throw
    // CURRENT_ANALYSIS_REQUIRED.
    assert.match(
      source,
      /CURRENT_ANALYSIS_REQUIRED/,
      "run-tender-engine must throw CURRENT_ANALYSIS_REQUIRED when promoted analysis is absent",
    );
  });
});

describe("FIX 2 — Immutable canonical snapshot persisted at manual creation", () => {
  it("createAnalysisJob persists a CanonicalAnalysisSnapshot with file IDs, per-file hashes, and chunk hashes", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(source, /CanonicalAnalysisSnapshot/, "type CanonicalAnalysisSnapshot must be exported");
    assert.match(source, /canonicalFileIds/, "snapshot must include canonicalFileIds");
    assert.match(source, /fileContentHashes/, "snapshot must include fileContentHashes");
    assert.match(source, /chunkHashes/, "snapshot must include chunkHashes");
    assert.match(source, /snapshotVersion: 1/, "snapshot must include snapshotVersion");
  });

  it("runNextChunk consumes the immutable snapshot instead of rebuilding text from tender.files", () => {
    const source = read("lib/ai-jobs/analysis-job-service.ts");
    // The worker must verify the snapshot (verifyAnalysisSnapshot) and refuse
    // to process if superseded.
    assert.match(source, /verifyAnalysisSnapshot/, "runNextChunk must call verifyAnalysisSnapshot");
    assert.match(source, /SUPERSEDED/, "runNextChunk must mark superseded jobs as SUPERSEDED/FAILED");
    // The worker must reload canonicalFiles by ID from the snapshot, not by
    // querying all tender.files.
    assert.match(
      source,
      /where: \{ id: \{ in: snapshot\.canonicalFileIds \} \}/,
      "runNextChunk must reload files by snapshot.canonicalFileIds",
    );
    // The worker must verify each file's content hash matches the snapshot.
    assert.match(
      source,
      /FILE_CONTENT_DRIFT/,
      "runNextChunk must fail closed with FILE_CONTENT_DRIFT when a hash mismatches",
    );
  });
});
