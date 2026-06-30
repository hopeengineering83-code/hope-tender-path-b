/**
 * Enforcement-level regression tests proving the wiring actually changes
 * behavior (not just scaffolding):
 *
 * 1. resolveCanonicalFieldState with activeTenderFileIds: a USER_CONFIRMED/
 *    USER_EDITED critical field only unblocks when its evidence points to an
 *    ACTIVE tender file (page + quote + valid active fileId).
 * 2. evaluateGenerationReadiness: a persisted Build Plan is MANDATORY —
 *    MISSING and STALE both block generation/export; VALID allows.
 * 3. attributeMetadataSourceFileId: metadata is bound to the ACTUAL source file
 *    (the active file whose text contains the quote), incl. multi-file; a
 *    deleted/wrong/absent source leaves it ungrounded.
 * 4. Build Plan -> Generate -> Export composition succeeds with a valid plan.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";
import { attributeMetadataSourceFileId } from "../lib/engine/metadata-source-attribution";
import { computeBuildPlanHash, isBuildPlanValid } from "../lib/engine/build-plan-hash";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1", title: "Test Tender", reference: "REF-001",
    clientName: "Pharo Ventures", procuringEntityName: null,
    deadline: new Date("2026-12-11"), currency: "USD", country: "Ethiopia",
    submissionMethod: "Email", submissionAddress: "test@example.com", submissionEmails: "test@example.com",
    submissionEmailSubject: null, clientContactName: null, clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1, clientNameSourceQuote: "Pharo Ventures is the procuring entity", clientNameSourceFileId: null,
    submissionMethodSourcePage: 2, submissionMethodSourceQuote: "Submit by email", submissionMethodSourceFileId: null,
    submissionAddressSourcePage: 2, submissionAddressSourceQuote: "Submit to this address", submissionAddressSourceFileId: null,
    submissionEmailSourcePage: 2, submissionEmailSourceFileId: null,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function findField(result: ReturnType<typeof resolveCanonicalFieldState>, key: string) {
  const f = result.fields.find((x) => x.fieldKey === key);
  assert.ok(f, `Field ${key} not found`);
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
    recordedBuildPlanState: "VALID",
    exportReadyDocumentCount: 3,
    // BuildPlan enforcement is fail-closed: default to true so the "good"
    // base case passes; tests that exercise the BuildPlan blocker override.
    hasCurrentConfirmedBuildPlan: true,
    confirmedPlanDocumentsOk: true,
    ...overrides,
  };
}

// ─── 1. Resolver: activeTenderFileIds enforcement ───────────────────────────

describe("Grounding enforcement — activeTenderFileIds", () => {
  it("USER_CONFIRMED critical field on an ACTIVE file → EXTRACTED_AND_GROUNDED", () => {
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

  it("USER_CONFIRMED critical field whose evidence file is DELETED/not active → blocked", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: "file-deleted" }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    const field = findField(result, "clientName");
    assert.equal(field.status, "MANUAL_CONFIRMED", `got ${field.status}`);
    assert.ok(field.blockerReason);
    assert.equal(result.hasGenerationBlocker, true);
  });

  it("USER_CONFIRMED critical field with NULL evidence fileId → blocked when enforced", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: null }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
      activeTenderFileIds: new Set(["file-active"]),
    });
    assert.equal(findField(result, "clientName").status, "MANUAL_CONFIRMED");
  });

  it("backward-compatible: without activeTenderFileIds, page+quote alone still grounds", () => {
    const result = resolveCanonicalFieldState({
      tender: makeTender({ clientName: "Pharo Ventures", clientNameSourceFileId: null }),
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED", overrideValue: "Pharo Ventures", reason: "ok", overriddenBy: "u1", createdAt: new Date() }],
      hasExtractedRequirements: true,
    });
    assert.equal(findField(result, "clientName").status, "EXTRACTED_AND_GROUNDED");
  });
});

// ─── 2. Gate: persisted Build Plan mandatory ────────────────────────────────

describe("Generation gate — persisted Build Plan is mandatory", () => {
  it("blocks generation with BUILD_PLAN_MISSING when no plan is recorded", () => {
    const r = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanState: "MISSING" }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_MISSING");
  });

  it("blocks export with BUILD_PLAN_MISSING when no plan is recorded", () => {
    const r = evaluateGenerationReadiness(passingGateInput({ purpose: "export", recordedBuildPlanState: "MISSING" }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_MISSING");
  });

  it("blocks with BUILD_PLAN_STALE when recorded plan no longer matches", () => {
    const r = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanState: "STALE" }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_STALE");
  });

  it("allows generation when the recorded plan is VALID", () => {
    const r = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanState: "VALID" }));
    assert.equal(r.ok, true, `expected ok, got ${r.blockerCode}`);
  });
});

// ─── 3. Metadata attribution to the ACTUAL source file ──────────────────────

describe("Metadata source attribution — actual file, not earliest", () => {
  const files = [
    { id: "fileA", extractedText: "Cover page. General introduction.", deletionStatus: "ACTIVE" },
    { id: "fileB", extractedText: "The procuring entity is Pharo Ventures, Addis Ababa.", deletionStatus: "ACTIVE" },
  ];

  it("multi-file: attributes a quote to the file that actually contains it (not the earliest)", () => {
    const id = attributeMetadataSourceFileId("The procuring entity is Pharo Ventures", files);
    assert.equal(id, "fileB");
  });

  it("returns null when no active file contains the quote (wrong/absent source)", () => {
    assert.equal(attributeMetadataSourceFileId("Some unrelated text not present anywhere", files), null);
  });

  it("ignores deleted files even if they contain the quote", () => {
    const withDeleted = [
      { id: "fileA", extractedText: "nothing here", deletionStatus: "ACTIVE" },
      { id: "fileDel", extractedText: "The procuring entity is Pharo Ventures", deletionStatus: "DELETED" },
    ];
    assert.equal(attributeMetadataSourceFileId("The procuring entity is Pharo Ventures", withDeleted), null);
  });

  it("returns null for missing/too-short quote (stays ungrounded)", () => {
    assert.equal(attributeMetadataSourceFileId(null, files), null);
    assert.equal(attributeMetadataSourceFileId("abc", files), null);
  });
});

// ─── 4. Build Plan -> Generate -> Export composition ────────────────────────

describe("Build Plan -> Generate -> Export succeeds with a valid plan", () => {
  const planInput = {
    activeFiles: [{ id: "f1", fileName: "RFQ.pdf", extractedText: "Submit by email", deletionStatus: "ACTIVE" }],
    requirements: [{ id: "r1", title: "Tech", requirementType: "DOCUMENT", priority: "MANDATORY", exactFileName: "Tech.docx", exactOrder: 1 }],
    exactFileNaming: "[]", exactFileOrder: "[]",
    submissionMethod: "Email", submissionAddress: "x@y.com", submissionEmails: "x@y.com",
  };

  it("a recorded plan matching current state is VALID and generation+export pass", () => {
    const recordedHash = computeBuildPlanHash(planInput); // as the build route stores
    const state: "MISSING" | "STALE" | "VALID" = isBuildPlanValid(recordedHash, planInput) ? "VALID" : "STALE";
    assert.equal(state, "VALID");

    const gen = evaluateGenerationReadiness(passingGateInput({ purpose: "generate", recordedBuildPlanState: state }));
    assert.equal(gen.ok, true, `generate blocked: ${gen.blockerCode}`);

    const exp = evaluateGenerationReadiness(passingGateInput({ purpose: "export", recordedBuildPlanState: state }));
    assert.equal(exp.ok, true, `export blocked: ${exp.blockerCode}`);
  });

  it("after files change, the recorded plan is STALE and generation is blocked", () => {
    const recordedHash = computeBuildPlanHash(planInput);
    const changed = { ...planInput, activeFiles: [...planInput.activeFiles, { id: "f2", fileName: "New.pdf", extractedText: "new", deletionStatus: "ACTIVE" }] };
    const state: "MISSING" | "STALE" | "VALID" = isBuildPlanValid(recordedHash, changed) ? "VALID" : "STALE";
    assert.equal(state, "STALE");
    const gen = evaluateGenerationReadiness(passingGateInput({ recordedBuildPlanState: state }));
    assert.equal(gen.ok, false);
    assert.equal(gen.blockerCode, "BUILD_PLAN_STALE");
  });
});
