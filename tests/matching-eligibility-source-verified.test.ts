// A durably SOURCE_VERIFIED record is eligible for matching without a human
// approval click. A record merely carrying the label, or whose source/evidence
// changed after verification, remains fail-closed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
} from "../lib/vault-review-provenance";
import {
  isEligibleForMatching,
  checkMatchingEligibility,
  enforceMatchingEligibility,
} from "../lib/engine/matching-eligibility";

function durableSourceVerifiedExpert() {
  const companyId = "company-source-verified";
  const sourceText = "CURRICULUM VITAE\nName of Key Expert: Abel Verified\nAbel Verified is a Water Engineer with 9 years of experience in Water and Sanitation. Proposed position: Water Supply Engineer for the design supervision team.";
  const sourceDocument = {
    id: "doc-source-verified",
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: "expert-source-verified",
    companyId,
    fullName: "Abel Verified",
    title: "Water Engineer",
    yearsExperience: 9,
    disciplines: JSON.stringify(["Water Engineer"]),
    sectors: JSON.stringify(["Water and Sanitation"]),
    certifications: JSON.stringify([]),
    trustLevel: "SOURCE_VERIFIED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: null,
    reviewedAt: null,
    sourceDocument,
  };
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    verificationMethod: "DETERMINISTIC",
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

function durableSourceVerifiedProject() {
  const companyId = "company-source-verified";
  const sourceText = "PROJECT REFERENCE SHEET\nProject Name: Legacy Import Water Project Test\nClient: Ministry of Water. Country: Ethiopia. Scope of services: design supervision for rural water supply infrastructure.";
  const sourceDocument = {
    id: "doc-source-verified-project",
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: "project-source-verified",
    companyId,
    name: "Legacy Import Water Project Test",
    clientName: null,
    country: null,
    sector: null,
    serviceAreas: JSON.stringify([]),
    contractValue: null,
    currency: null,
    trustLevel: "SOURCE_VERIFIED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: null,
    reviewedAt: null,
    sourceDocument,
  };
  const provenance = buildSourceVerificationProvenance({
    recordType: "PROJECT",
    sourceDocument,
    fields: projectReviewFields(record),
    verificationMethod: "DETERMINISTIC",
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

describe("matching accepts durable SOURCE_VERIFIED evidence without human approval", () => {
  it("accepts a durably SOURCE_VERIFIED expert", () => {
    assert.equal(isEligibleForMatching(durableSourceVerifiedExpert()), true);
  });

  it("accepts a durably SOURCE_VERIFIED project", () => {
    assert.equal(isEligibleForMatching(durableSourceVerifiedProject()), true);
  });

  it("preserves the score for durable source-backed evidence", () => {
    assert.equal(enforceMatchingEligibility(0.82, durableSourceVerifiedExpert()), 0.82);
  });

  it("does not misclassify durable machine verification as missing human review", () => {
    assert.deepEqual(checkMatchingEligibility(durableSourceVerifiedExpert()), { eligible: true });
  });

  it("rejects a SOURCE_VERIFIED label without durable provenance", () => {
    const record = { ...durableSourceVerifiedExpert(), reviewNotes: null };
    assert.equal(isEligibleForMatching(record), false);
    assert.equal(enforceMatchingEligibility(0.82, record), 0);
  });

  it("rejects stale provenance after a claimed field changes", () => {
    const record = {
      ...durableSourceVerifiedExpert(),
      certifications: JSON.stringify(["PMP"]),
    };
    assert.equal(isEligibleForMatching(record), false);
  });

  it("rejects source verification carrying fabricated human review metadata", () => {
    const record = {
      ...durableSourceVerifiedExpert(),
      reviewedBy: "SYSTEM_AUTO_VERIFIED",
    };
    assert.equal(isEligibleForMatching(record), false);
  });
});
