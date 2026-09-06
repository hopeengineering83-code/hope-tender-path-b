import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterCurrentAutomaticEvidenceRows,
  inferAutomaticEvidenceKinds,
  parseAutomaticRequirementEvidence,
  selectAutomaticEvidenceForRequirement,
  serializeAutomaticRequirementEvidence,
  type AutomaticEvidenceCandidate,
  type AutomaticRequirementEvidenceMetadata,
} from "../lib/engine/automatic-requirement-coverage";
import {
  extractSourceGroundingKeyPhrases,
  findBestSourceGroundingQuote,
} from "../lib/engine/repair-source-grounding";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function candidate(overrides: Partial<AutomaticEvidenceCandidate> = {}): AutomaticEvidenceCandidate {
  return {
    recordType: "LEGAL",
    recordId: "legal-1",
    label: "Current Grade 1 Trade Licence",
    searchableText: "legal eligibility trade licence registration grade certificate consulting firm",
    evidenceKinds: ["LEGAL_REGISTRATION"],
    evidenceKey: `LEGAL:legal-1:${HASH_A}`,
    sourceDocumentId: "company-doc-1",
    sourceContentHash: HASH_A,
    sourceByteLength: 4096,
    selected: false,
    generatedReady: false,
    exactFileName: null,
    ...overrides,
  };
}

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    title: "Legal eligibility, registration and licensing evidence",
    description: "Submit a valid consulting trade licence and registration certificate.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
    restrictions: null,
    requiredQuantity: 1,
    exactFileName: null,
    sourceTenderFileId: "tender-file-1",
    sourcePageNumber: 1,
    sourceExactQuote: "Bidders shall submit a valid consulting trade licence and registration certificate.",
    complianceMatrixRows: [],
    ...overrides,
  };
}

describe("automatic requirement coverage behavior", () => {
  it("classifies common tender requirements into evidence families", () => {
    assert.deepEqual(
      inferAutomaticEvidenceKinds(requirement()),
      ["LEGAL_REGISTRATION"],
    );
    assert.ok(inferAutomaticEvidenceKinds(requirement({
      title: "Audited financial statements and annual turnover",
      description: "Provide audited accounts for the last three years.",
      requirementType: "FINANCIAL",
    })).includes("FINANCIAL_STATEMENT"));
    assert.ok(inferAutomaticEvidenceKinds(requirement({
      title: "Key personnel CVs",
      description: "Provide qualified experts for all required disciplines.",
      requirementType: "EXPERT",
      requiredQuantity: 3,
    })).includes("EXPERT_CV"));
  });

  it("links relevant source-verified evidence and rejects unrelated evidence", () => {
    const unrelated = candidate({
      recordType: "EXPERT",
      recordId: "expert-1",
      label: "Structural Engineer",
      searchableText: "structural engineering concrete design",
      evidenceKinds: ["EXPERT_CV"],
      evidenceKey: `EXPERT:expert-1:${HASH_B}`,
      sourceContentHash: HASH_B,
    });
    const selected = selectAutomaticEvidenceForRequirement(requirement(), [unrelated, candidate()]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].candidate.recordId, "legal-1");
    assert.ok(selected[0].score >= 70);
    assert.equal(selected[0].supportLevel, "FULL", "current verified legal bytes satisfy every explicit structured constraint");
  });

  it("grants FULL only to a current validated generated artifact with exact filename fit", () => {
    const outputRequirement = requirement({
      title: "Required output file: technical proposal.pdf",
      description: "The technical proposal shall be submitted as technical proposal.pdf.",
      requirementType: "FORM",
      exactFileName: "technical proposal.pdf",
    });
    const generated = candidate({
      recordType: "GENERATED_DOCUMENT",
      recordId: "generated-1",
      label: "technical proposal.pdf",
      searchableText: "technical proposal pdf validated output",
      evidenceKinds: ["OUTPUT_ARTIFACT", "FORM_TEMPLATE"],
      evidenceKey: `GENERATED_DOCUMENT:generated-1:${HASH_B}`,
      sourceDocumentId: "generated-1",
      sourceContentHash: HASH_B,
      selected: true,
      generatedReady: true,
      exactFileName: "technical proposal.pdf",
    });
    const selected = selectAutomaticEvidenceForRequirement(outputRequirement, [generated]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].supportLevel, "FULL");
  });

  it("keeps a planned output PARTIAL until real validated bytes exist", () => {
    const planned = candidate({
      recordType: "BUILD_PLAN_ITEM",
      recordId: "plan-1:0:technical proposal.pdf",
      label: "technical proposal.pdf",
      searchableText: "technical proposal pdf",
      evidenceKinds: ["OUTPUT_ARTIFACT", "FORM_TEMPLATE"],
      evidenceKey: `BUILD_PLAN_ITEM:plan-1:${HASH_B}`,
      sourceDocumentId: "plan-1",
      sourceContentHash: HASH_B,
      selected: true,
      generatedReady: false,
      exactFileName: "technical proposal.pdf",
    });
    const selected = selectAutomaticEvidenceForRequirement(requirement({
      title: "Required output file: technical proposal.pdf",
      description: "Submit technical proposal.pdf.",
      requirementType: "FORM",
      exactFileName: "technical proposal.pdf",
    }), [planned]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].supportLevel, "PARTIAL");
  });

  it("round-trips provenance metadata and rejects malformed metadata", () => {
    const metadata: AutomaticRequirementEvidenceMetadata = {
      version: 1,
      evidenceKey: `LEGAL:legal-1:${HASH_A}`,
      recordType: "LEGAL",
      recordId: "legal-1",
      label: "Current Grade 1 Trade Licence",
      requirementId: "req-1",
      requirementSourceFileId: "tender-file-1",
      requirementSourceQuoteHash: HASH_B,
      sourceDocumentId: "company-doc-1",
      sourceContentHash: HASH_A,
      sourceByteLength: 4096,
      sourceFileName: "trade-licence.pdf",
      sourceSection: "Legal registration",
      sourceQuote: "Current Grade 1 Trade Licence",
      matchedFacets: ["verifiedBytes"],
      sourceRevision: HASH_B,
      evidenceRevision: HASH_A,
      linkageScore: 88,
      linkageReasons: ["direct evidence family: LEGAL_REGISTRATION"],
      state: "ACTIVE",
    };
    const serialized = serializeAutomaticRequirementEvidence(metadata);
    assert.deepEqual(parseAutomaticRequirementEvidence(serialized), metadata);
    assert.equal(parseAutomaticRequirementEvidence("automatic-requirement-evidence:v1:{}"), null);
    assert.equal(parseAutomaticRequirementEvidence("manual review note"), null);
  });

  it("filters automatic links when source quote, active file, or evidence hash becomes stale", () => {
    const sourceQuote = "Bidders shall submit a valid consulting trade licence and registration certificate.";
    const quoteHash = "c".repeat(64);
    const metadata: AutomaticRequirementEvidenceMetadata = {
      version: 1,
      evidenceKey: `LEGAL:legal-1:${HASH_A}`,
      recordType: "LEGAL",
      recordId: "legal-1",
      label: "Current Grade 1 Trade Licence",
      requirementId: "req-1",
      requirementSourceFileId: "tender-file-1",
      requirementSourceQuoteHash: quoteHash,
      sourceDocumentId: "company-doc-1",
      sourceContentHash: HASH_A,
      sourceByteLength: 4096,
      sourceFileName: "trade-licence.pdf",
      sourceSection: "Legal registration",
      sourceQuote: "Current Grade 1 Trade Licence",
      matchedFacets: ["verifiedBytes"],
      sourceRevision: HASH_B,
      evidenceRevision: HASH_A,
      linkageScore: 88,
      linkageReasons: ["direct evidence family: LEGAL_REGISTRATION"],
      state: "ACTIVE",
    };
    // Use the real serializer, then replace the quote hash with the hash emitted
    // by the service by deriving a valid row through a first filtering pass.
    const notes = serializeAutomaticRequirementEvidence(metadata);
    const row = { id: "matrix-1", notes };
    const activeFiles = [{ id: "tender-file-1", extractedText: `Section 2\n${sourceQuote}`, totalPages: 1 }];

    const wrongQuoteHash = filterCurrentAutomaticEvidenceRows([
      requirement({ sourceExactQuote: sourceQuote, complianceMatrixRows: [row] }),
    ], new Set([metadata.evidenceKey]), activeFiles);
    assert.equal(wrongQuoteHash[0].complianceMatrixRows?.length, 0);

    const noCurrentEvidence = filterCurrentAutomaticEvidenceRows([
      requirement({ sourceExactQuote: sourceQuote, complianceMatrixRows: [row] }),
    ], new Set(), activeFiles);
    assert.equal(noCurrentEvidence[0].complianceMatrixRows?.length, 0);

    const missingActiveFile = filterCurrentAutomaticEvidenceRows([
      requirement({ sourceExactQuote: sourceQuote, complianceMatrixRows: [row] }),
    ], new Set([metadata.evidenceKey]), []);
    assert.equal(missingActiveFile[0].complianceMatrixRows?.length, 0);
  });

  it("finds a grounded quote only when several meaningful requirement terms occur together", () => {
    const title = "Legal eligibility registration licensing evidence";
    const phrases = extractSourceGroundingKeyPhrases(title);
    const source = [
      "SECTION 1 GENERAL INFORMATION",
      "The bidder shall provide legal eligibility evidence including a valid registration certificate and current consulting licence.",
      "Other instructions follow after this paragraph.",
    ].join("\n");
    const match = findBestSourceGroundingQuote(phrases, source);
    assert.ok(match);
    assert.ok(match.confidence >= 0.35);
    assert.match(match.quote, /legal eligibility evidence/i);

    const unrelated = findBestSourceGroundingQuote(phrases, "This document describes only the project schedule and communication protocol.");
    assert.equal(unrelated, null);
  });
});
