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
  buildCanonicalBuildPlanHashInput,
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
    // Metadata evidence — the ONE CANONICAL resolved effective-metadata result.
    // Raw metadata fields (submissionMethod, submissionAddress, submissionEmails,
    // deadline, title) are NOT on the input — they exist ONLY inside
    // metadataEvidence as effectiveValue + source grounding.
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
  it("produces the same hash as baseInput with metadataEvidence stripped", () => {
    // buildPlanHashInputFromTender sets ONLY plan-driving fields (no raw
    // metadata, no metadataEvidence). Compare against baseInput with
    // metadataEvidence stripped for apples-to-apples.
    const tender = {
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      files: baseInput().activeFiles,
      requirements: baseInput().requirements,
    };
    const { metadataEvidence, ...baseWithoutMeta } = baseInput();
    void metadataEvidence;
    assert.equal(computeBuildPlanHash(buildPlanHashInputFromTender(tender)), computeBuildPlanHash(baseWithoutMeta));
  });
});

// ─── REGRESSION: buildCanonicalBuildPlanHashInput uses EFFECTIVE submissionMethod ──
// This test directly verifies that buildCanonicalBuildPlanHashInput derives the
// applicable endpoint from resolveCanonicalFieldState's EFFECTIVE submissionMethod
// (which includes USER_EDITED overrides), NOT from raw tender.submissionMethod.
//
// Without this fix, a USER_EDITED override on submissionMethod would NOT change
// which endpoint evidence is included in metadataEvidence — the hash builder
// would read raw tender.submissionMethod and include the wrong endpoint.

describe("buildCanonicalBuildPlanHashInput — effective submissionMethod drives endpoint evidence", () => {
  const baseTender = {
    exactFileNaming: "[]",
    exactFileOrder: "[]",
    submissionMethod: "email submission required",
    submissionAddress: "123 Test Street",
    submissionEmails: "submit@example.com",
    submissionEmailSubject: "Subject",
    deadline: new Date("2026-12-31"),
    title: "Test Tender",
    clientName: "Test Client",
    procuringEntityName: null,
    reference: "REF-1",
    country: null,
    currency: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "client name quote",
    clientNameSourceFileId: "f1",
    submissionMethodSourcePage: 1,
    submissionMethodSourceQuote: "method quote",
    submissionMethodSourceFileId: "f1",
    submissionAddressSourcePage: 1,
    submissionAddressSourceQuote: "address quote",
    submissionAddressSourceFileId: "f1",
    submissionEmailSourcePage: 1,
    submissionEmailSourceQuote: "email quote",
    submissionEmailSourceFileId: "f1",
    titleSourceFileId: "f1",
    titleSourcePage: 1,
    titleSourceQuote: "title quote",
    deadlineSourceFileId: "f1",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "deadline quote",
    contactDetailsSourceJson: null,
    files: [
      { id: "f1", fileName: "Tender.pdf", extractedText: "title quote client name quote method quote email quote address quote deadline quote", deletionStatus: "ACTIVE" },
    ],
    requirements: [],
  };

  it("includes submissionEmails evidence (NOT submissionAddress) when effective method is email", () => {
    const input = buildCanonicalBuildPlanHashInput(baseTender as any, []);
    const fieldKeys = (input.metadataEvidence ?? []).map((m) => m.fieldKey);
    assert.ok(fieldKeys.includes("submissionEmails"), "submissionEmails MUST be in evidence for email method");
    assert.ok(!fieldKeys.includes("submissionAddress"), "submissionAddress must NOT be in evidence for email method");
  });

  it("switches to submissionAddress evidence when USER_EDITED override changes method to physical", () => {
    // Override submissionMethod from "email submission required" to "sealed envelope delivery"
    const tenderWithOverride = {
      ...baseTender,
      metadataOverrides: [
        { field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "sealed envelope delivery" },
      ],
    };
    const input = buildCanonicalBuildPlanHashInput(tenderWithOverride as any, []);
    const fieldKeys = (input.metadataEvidence ?? []).map((m) => m.fieldKey);
    assert.ok(fieldKeys.includes("submissionAddress"), "submissionAddress MUST be in evidence when override changes method to physical");
    assert.ok(!fieldKeys.includes("submissionEmails"), "submissionEmails must NOT be in evidence when override changes method to physical");
  });

  it("includes BOTH endpoints when USER_EDITED override changes method to portal", () => {
    const tenderWithOverride = {
      ...baseTender,
      metadataOverrides: [
        { field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "online portal submission" },
      ],
    };
    const input = buildCanonicalBuildPlanHashInput(tenderWithOverride as any, []);
    const fieldKeys = (input.metadataEvidence ?? []).map((m) => m.fieldKey);
    assert.ok(fieldKeys.includes("submissionEmails"), "submissionEmails MUST be in evidence for portal method");
    assert.ok(fieldKeys.includes("submissionAddress"), "submissionAddress MUST be in evidence for portal method");
  });

  it("produces DIFFERENT hashes for email vs physical override (endpoint evidence switches)", () => {
    const emailHash = computeBuildPlanHash(buildCanonicalBuildPlanHashInput(baseTender as any, []));
    const physicalTender = {
      ...baseTender,
      metadataOverrides: [
        { field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "sealed envelope delivery" },
      ],
    };
    const physicalHash = computeBuildPlanHash(buildCanonicalBuildPlanHashInput(physicalTender as any, []));
    assert.notEqual(emailHash, physicalHash, "Hashes MUST differ — endpoint evidence switched from submissionEmails to submissionAddress");
  });

  it("produces DIFFERENT hashes for email vs portal override (endpoint evidence set grows)", () => {
    const emailHash = computeBuildPlanHash(buildCanonicalBuildPlanHashInput(baseTender as any, []));
    const portalTender = {
      ...baseTender,
      metadataOverrides: [
        { field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "online portal submission" },
      ],
    };
    const portalHash = computeBuildPlanHash(buildCanonicalBuildPlanHashInput(portalTender as any, []));
    assert.notEqual(emailHash, portalHash, "Hashes MUST differ — portal includes both endpoints, email includes only submissionEmails");
  });
});
