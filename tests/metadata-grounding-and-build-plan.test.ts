/**
 * Tests for:
 * 1. Metadata grounding stricter contract: TenderFile ID validation.
 * 2. Shared deterministic Build Plan hash: covers ACTIVE files + requirements +
 *    exact naming/order + submission instructions; changing any of them
 *    invalidates the plan; database query order does not affect the hash.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isGroundedEvidence, isGroundedEvidenceWithFileCheck } from "../lib/engine/evidence-grounding";
import {
  computeBuildPlanHash,
  isBuildPlanValid,
  buildPlanHashInputFromTender,
  type BuildPlanHashInput,
} from "../lib/engine/build-plan-hash";

// ─── Gap 1: grounding with TenderFile ID ────────────────────────────────────

describe("Gap 1: Metadata Grounding Stricter Contract", () => {
  it("requires page, quote, AND a valid active fileId for full grounding", () => {
    assert.equal(isGroundedEvidence(5, "This is a meaningful quote"), true);
    const active = new Set(["file-1", "file-2"]);
    assert.equal(isGroundedEvidenceWithFileCheck(5, "This is a meaningful quote", "file-1", active), true);
  });

  it("rejects null / inactive / empty fileId", () => {
    const active = new Set(["file-1"]);
    assert.equal(isGroundedEvidenceWithFileCheck(5, "This is a meaningful quote", null, active), false);
    assert.equal(isGroundedEvidenceWithFileCheck(5, "This is a meaningful quote", "file-x", active), false);
    assert.equal(isGroundedEvidenceWithFileCheck(5, "This is a meaningful quote", "", active), false);
  });

  it("rejects short quote / zero page even with a valid fileId", () => {
    const active = new Set(["file-1"]);
    assert.equal(isGroundedEvidenceWithFileCheck(5, "short", "file-1", active), false);
    assert.equal(isGroundedEvidenceWithFileCheck(0, "This is a meaningful quote", "file-1", active), false);
  });
});

// ─── Gap 2: shared deterministic Build Plan hash ────────────────────────────

function baseInput(overrides: Partial<BuildPlanHashInput> = {}): BuildPlanHashInput {
  return {
    activeFiles: [
      { id: "f1", fileName: "RFQ.pdf", extractedText: "Submit by email to client@x.com", deletionStatus: "ACTIVE" },
      { id: "f2", fileName: "Scope.pdf", extractedText: "Scope of works", deletionStatus: "ACTIVE" },
    ],
    requirements: [
      { id: "r1", title: "Tech proposal", requirementType: "DOCUMENT", priority: "MANDATORY", exactFileName: "Tech.docx", exactOrder: 1 },
    ],
    exactFileNaming: "[]",
    exactFileOrder: "[]",
    submissionMethod: "Email",
    submissionAddress: "client@x.com",
    submissionEmails: "client@x.com",
    // Metadata evidence — the CANONICAL source of metadata in the hash.
    // Raw metadata fields (submissionMethod, etc.) are NOT hashed separately.
    metadataEvidence: [
      { fieldKey: "title", effectiveValue: "Test Tender", sourceTenderFileId: "f1", sourcePage: 1, sourceQuote: "Test Tender Title", evidenceState: "GROUNDED" },
      { fieldKey: "clientName", effectiveValue: "Test Client", sourceTenderFileId: "f1", sourcePage: 1, sourceQuote: "Test Client Name", evidenceState: "GROUNDED" },
      { fieldKey: "deadline", effectiveValue: "2026-12-31T00:00:00.000Z", sourceTenderFileId: "f1", sourcePage: 1, sourceQuote: "Submit by Dec 31", evidenceState: "GROUNDED" },
      { fieldKey: "submissionMethod", effectiveValue: "Email", sourceTenderFileId: "f1", sourcePage: 1, sourceQuote: "Submit by email", evidenceState: "GROUNDED" },
      { fieldKey: "submissionEmails", effectiveValue: "client@x.com", sourceTenderFileId: "f1", sourcePage: 1, sourceQuote: "client@x.com", evidenceState: "GROUNDED" },
    ],
    ...overrides,
  };
}

describe("Gap 2: Build Plan hash — deterministic", () => {
  it("is stable for the same inputs and independent of file/requirement order", () => {
    const a = computeBuildPlanHash(baseInput());
    const reordered = baseInput({
      activeFiles: [
        { id: "f2", fileName: "Scope.pdf", extractedText: "Scope of works", deletionStatus: "ACTIVE" },
        { id: "f1", fileName: "RFQ.pdf", extractedText: "Submit by email to client@x.com", deletionStatus: "ACTIVE" },
      ],
    });
    assert.equal(a, computeBuildPlanHash(reordered), "query/order must not change the hash");
    assert.equal(a.length, 64);
  });

  it("excludes non-ACTIVE files from the hash", () => {
    const withDeleted = baseInput({
      activeFiles: [
        { id: "f1", fileName: "RFQ.pdf", extractedText: "Submit by email to client@x.com", deletionStatus: "ACTIVE" },
        { id: "f2", fileName: "Scope.pdf", extractedText: "Scope of works", deletionStatus: "ACTIVE" },
        { id: "f3", fileName: "Old.pdf", extractedText: "old", deletionStatus: "DELETED" },
      ],
    });
    assert.equal(computeBuildPlanHash(baseInput()), computeBuildPlanHash(withDeleted));
  });
});

describe("Gap 2: Build Plan hash — change detection (invalidation)", () => {
  const original = computeBuildPlanHash(baseInput());

  it("changes when a file is added", () => {
    const next = baseInput({
      activeFiles: [...baseInput().activeFiles, { id: "f3", fileName: "Extra.pdf", extractedText: "extra", deletionStatus: "ACTIVE" }],
    });
    assert.notEqual(original, computeBuildPlanHash(next));
  });

  it("changes when a file is removed", () => {
    const next = baseInput({ activeFiles: [baseInput().activeFiles[0]] });
    assert.notEqual(original, computeBuildPlanHash(next));
  });

  it("changes when a file is renamed", () => {
    const files = baseInput().activeFiles.map((f) => (f.id === "f1" ? { ...f, fileName: "Tender.pdf" } : f));
    assert.notEqual(original, computeBuildPlanHash(baseInput({ activeFiles: files })));
  });

  it("changes when extracted content changes", () => {
    const files = baseInput().activeFiles.map((f) => (f.id === "f1" ? { ...f, extractedText: "totally different" } : f));
    assert.notEqual(original, computeBuildPlanHash(baseInput({ activeFiles: files })));
  });

  it("changes when a requirement changes", () => {
    const next = baseInput({
      requirements: [{ id: "r1", title: "Tech proposal", requirementType: "DOCUMENT", priority: "MANDATORY", exactFileName: "Tech.docx", exactOrder: 2 }],
    });
    assert.notEqual(original, computeBuildPlanHash(next));
  });

  it("changes when exact file naming/order changes", () => {
    assert.notEqual(original, computeBuildPlanHash(baseInput({ exactFileNaming: '["Tech.docx"]' })));
    assert.notEqual(original, computeBuildPlanHash(baseInput({ exactFileOrder: '["Tech.docx"]' })));
  });

  it("changes when metadata evidence changes (submission method/value)", () => {
    // Metadata is hashed via metadataEvidence — changing the effective value
    // or source grounding must stale the hash.
    const changedMethod = baseInput({
      metadataEvidence: baseInput().metadataEvidence!.map((m) =>
        m.fieldKey === "submissionMethod" ? { ...m, effectiveValue: "Portal" } : m
      ),
    });
    assert.notEqual(original, computeBuildPlanHash(changedMethod));
    const changedEmail = baseInput({
      metadataEvidence: baseInput().metadataEvidence!.map((m) =>
        m.fieldKey === "submissionEmails" ? { ...m, effectiveValue: "other@x.com" } : m
      ),
    });
    assert.notEqual(original, computeBuildPlanHash(changedEmail));
  });

  it("changes when metadata override is added", () => {
    // Overrides MUST stale the plan — previously overrides were loaded but
    // never hashed, so override changes went undetected.
    const withOverride = baseInput({
      metadataOverrides: [{ field: "deadline", fieldState: "USER_EDITED", overrideValue: "2027-01-15" }],
    });
    assert.notEqual(original, computeBuildPlanHash(withOverride));
  });

  it("changes when source grounding is lost (evidenceState GROUNDED -> UNGROUNDED)", () => {
    const ungrounded = baseInput({
      metadataEvidence: baseInput().metadataEvidence!.map((m) =>
        m.fieldKey === "title" ? { ...m, evidenceState: "UNGROUNDED", sourceTenderFileId: null } : m
      ),
    });
    assert.notEqual(original, computeBuildPlanHash(ungrounded));
  });

  it("isBuildPlanValid returns true only for the matching state", () => {
    const recorded = computeBuildPlanHash(baseInput());
    assert.equal(isBuildPlanValid(recorded, baseInput()), true);
    // Changing metadata evidence must invalidate
    const changed = baseInput({
      metadataEvidence: baseInput().metadataEvidence!.map((m) =>
        m.fieldKey === "submissionMethod" ? { ...m, effectiveValue: "Portal" } : m
      ),
    });
    assert.equal(isBuildPlanValid(recorded, changed), false);
  });
});

describe("buildPlanHashInputFromTender", () => {
  it("produces the same hash the gate/route would from a tender shape", () => {
    const tender = {
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      submissionMethod: "Email",
      submissionAddress: "client@x.com",
      submissionEmails: "client@x.com",
      files: baseInput().activeFiles,
      requirements: baseInput().requirements,
    };
    // buildPlanHashInputFromTender does NOT set metadataEvidence (it's the
    // legacy helper). Compare against baseInput with metadataEvidence stripped
    // so the comparison is apples-to-apples.
    const { metadataEvidence, ...baseWithoutMeta } = baseInput();
    void metadataEvidence;
    assert.equal(computeBuildPlanHash(buildPlanHashInputFromTender(tender)), computeBuildPlanHash(baseWithoutMeta));
  });
});
