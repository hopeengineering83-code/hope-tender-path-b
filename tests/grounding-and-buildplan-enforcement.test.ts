/**
 * Enforcement-level regression tests proving the #919 wiring actually changes
 * behavior (not just scaffolding):
 *
 * 1. resolveCanonicalFieldState with activeTenderFileIds enforces that a
 *    USER_CONFIRMED/USER_EDITED critical field only unblocks when its evidence
 *    points to an ACTIVE tender file (page + quote + valid active fileId).
 * 2. evaluateGenerationReadiness blocks with BUILD_PLAN_STALE when a recorded
 *    Build Plan no longer matches the tender's current files.
 * 3. buildCanonicalAnalysisTenderUpdate binds metadata source evidence to the
 *    primary active file (populates sourceFileId).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Pharo Ventures",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Ethiopia",
    submissionMethod: "Email",
    submissionAddress: "test@example.com",
    submissionEmails: "test@example.com",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Pharo Ventures is the procuring entity",
    clientNameSourceFileId: null,
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email",
    submissionMethodSourceFileId: null,
    submissionAddressSourcePage: 2,
    submissionAddressSourceQuote: "Submit to this address",
    submissionAddressSourceFileId: null,
    submissionEmailSourcePage: 2,
    submissionEmailSourceFileId: null,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function findField(result: ReturnType<typeof resolveCanonicalFieldState>, fieldKey: string) {
  const f = result.fields.find((f) => f.fieldKey === fieldKey);
  assert.ok(f, `Field ${fieldKey} not found`);
  return f;
}

function passingGateInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-abc",
    currentContentHash: "hash-abc",
    fallbackApprovalBound: false,
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
    requirementCount: 5,
    requirements: [
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true },
    ],
    criticalMetadataOk: true,
    hasValidVirtualSubmissionPlan: true,
    exportReadyDocumentCount: 3,
    ...overrides,
  };
}

// ─── 1. Resolver: activeTenderFileIds enforcement ───────────────────────────

describe("Grounding enforcement — activeTenderFileIds", () => {
  it("USER_CONFIRMED critical field with evidence on an ACTIVE file → EXTRACTED_AND_GROUNDED", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: "file-active" }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const field = findField(result, "clientName");
    assert.equal(field.status, "EXTRACTED_AND_GROUNDED", `got ${field.status}`);
    assert.equal(field.blockerReason, null);
  });

  it("USER_CONFIRMED critical field whose evidence file is NOT active → blocked (MANUAL_CONFIRMED)", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: "file-deleted" }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      // file-deleted is NOT in the active set (deleted/superseded)
      activeTenderFileIds: new Set(["file-active"]),
    });
    const field = findField(result, "clientName");
    assert.equal(field.status, "MANUAL_CONFIRMED", `got ${field.status}`);
    assert.ok(field.blockerReason, "critical field with stale-file evidence must carry a blocker");
    assert.equal(result.hasGenerationBlocker, true);
  });

  it("USER_CONFIRMED critical field with NULL evidence fileId → blocked when activeTenderFileIds enforced", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: null }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const field = findField(result, "clientName");
    assert.equal(field.status, "MANUAL_CONFIRMED", `got ${field.status}`);
    assert.ok(field.blockerReason);
  });

  it("backward-compatible: without activeTenderFileIds, page+quote alone still grounds (no regression)", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: null }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      // activeTenderFileIds omitted → basic page+quote check
    });
    const field = findField(result, "clientName");
    assert.equal(field.status, "EXTRACTED_AND_GROUNDED", `got ${field.status}`);
  });
});

// ─── 2. Pure gate: BUILD_PLAN_STALE ─────────────────────────────────────────

describe("Generation gate — recorded Build Plan staleness", () => {
  it("blocks generation with BUILD_PLAN_STALE when recorded plan is stale", () => {
    const result = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanStale: true }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "BUILD_PLAN_STALE");
  });

  it("blocks export with BUILD_PLAN_STALE when recorded plan is stale", () => {
    const result = evaluateGenerationReadiness(passingGateInput({ purpose: "export", recordedBuildPlanStale: true }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "BUILD_PLAN_STALE");
  });

  it("allows generation when recorded plan is valid (not stale)", () => {
    const result = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanStale: false }));
    assert.equal(result.ok, true, `expected ok, got blocker ${result.blockerCode}`);
  });

  it("allows generation when no recorded plan exists (undefined)", () => {
    const result = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanStale: undefined }));
    assert.equal(result.ok, true, `expected ok, got blocker ${result.blockerCode}`);
  });
});

// ─── 3. Extraction binds sourceFileId ───────────────────────────────────────

describe("Extraction — binds metadata evidence to primary active file", () => {
  it("populates sourceFileId columns when a primary active file and a source page exist", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      {
        summary: "s",
        requirements: [],
        exactFileNaming: [],
        exactFileOrder: [],
        clientNameSourcePage: 3,
        clientNameSourceQuote: "client name appears here",
        submissionMethodSourcePage: 4,
        submissionMethodSourceQuote: "submit by email",
      } as any,
      { primarySourceFileId: "file-active" },
    );
    assert.equal(data.clientNameSourceFileId, "file-active");
    assert.equal(data.submissionMethodSourceFileId, "file-active");
  });

  it("does NOT set sourceFileId when no primary active file is provided", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      {
        summary: "s",
        requirements: [],
        exactFileNaming: [],
        exactFileOrder: [],
        clientNameSourcePage: 3,
        clientNameSourceQuote: "client name appears here",
      } as any,
      {},
    );
    assert.equal(data.clientNameSourceFileId, undefined);
  });

  it("does NOT set sourceFileId when there is no real source page (null/0)", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      {
        summary: "s",
        requirements: [],
        exactFileNaming: [],
        exactFileOrder: [],
        clientNameSourcePage: null,
        clientNameSourceQuote: null,
      } as any,
      { primarySourceFileId: "file-active" },
    );
    assert.equal(data.clientNameSourceFileId, undefined);
  });
});
