// End-to-end authority proof for the owner's operating model:
// uploaded company documents are verified automatically, without fabricating
// human approval, and current source-backed records can reach final export.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  buildSourceVerificationProvenance,
  canUseVaultRecord,
  expertReviewFields,
  isDurablyReviewed,
  isDurablySourceVerified,
} from "../lib/vault-review-provenance";

const sourceText = [
  "CURRICULUM VITAE",
  "Name of Key Expert: Sample Person",
  "Proposed position: Structural Engineer.",
  "Sample Person has 20 years of experience in Structural Engineering and Buildings.",
  "Professional certification PMP is confirmed by the source document.",
].join("\n");

const sourceDocument = {
  id: "doc-upload-only",
  companyId: "company-upload-only",
  extractedText: sourceText,
  contentSha256: createHash("sha256").update(sourceText).digest("hex"),
  contentByteLength: Buffer.byteLength(sourceText),
  integrityStatus: "VERIFIED",
  metadata: JSON.stringify({ extractionRevision: 1 }),
};

const expertFields = {
  fullName: "Sample Person",
  title: "Structural Engineer",
  yearsExperience: 20,
  disciplines: JSON.stringify(["Structural Engineering"]),
  sectors: JSON.stringify(["Buildings"]),
  certifications: JSON.stringify(["PMP"]),
};

function autoVerifiedRecordFromUpload() {
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(expertFields),
    verificationMethod: "HYBRID",
  });
  assert.equal(provenance.ok, true, "fixture must build real source-verification provenance");
  if (!provenance.ok) throw new Error("unreachable");
  return {
    ...expertFields,
    companyId: "company-upload-only",
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
  };
}

describe("uploaded documents carry verified evidence to export without human approval", () => {
  it("auto-verification is honest: no human review is claimed", () => {
    const record = autoVerifiedRecordFromUpload();
    assert.equal(record.reviewedBy, null, "no human reviewer may be invented");
    assert.equal(record.reviewedAt, null, "no human review timestamp may be invented");
    assert.equal(isDurablyReviewed(record), false, "this is machine verification, not human review");
    assert.equal(isDurablySourceVerified(record), true, "the record is durably bound to owned source bytes");
  });

  it("is usable for matching, generation, and final export without a human click", () => {
    const record = autoVerifiedRecordFromUpload();
    assert.equal(canUseVaultRecord(record, "MATCHING"), true);
    assert.equal(canUseVaultRecord(record, "GENERATION"), true);
    assert.equal(canUseVaultRecord(record, "EXPORT"), true);
  });

  it("fails closed when source bytes or extraction text change", () => {
    const record = autoVerifiedRecordFromUpload();
    const tamperedText = `${sourceText} (edited after verification)`;
    const tampered = {
      ...record,
      sourceDocument: {
        ...sourceDocument,
        extractedText: tamperedText,
        contentSha256: createHash("sha256").update(tamperedText).digest("hex"),
        contentByteLength: Buffer.byteLength(tamperedText),
      },
    };
    assert.equal(isDurablySourceVerified(tampered), false);
    for (const purpose of ["MATCHING", "GENERATION", "EXPORT"] as const) {
      assert.equal(canUseVaultRecord(tampered, purpose), false, `${purpose} must reject changed source evidence`);
    }
  });

  it("fails closed when a claimed field no longer matches the verified record", () => {
    const record = autoVerifiedRecordFromUpload();
    const overclaimed = { ...record, certifications: JSON.stringify(["PMP", "Chartered Engineer"]) };
    assert.equal(isDurablySourceVerified(overclaimed), false);
    assert.equal(canUseVaultRecord(overclaimed, "EXPORT"), false);
  });

  it("fails closed when no durable source verification exists", () => {
    const bare = {
      ...expertFields,
      companyId: "company-upload-only",
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      sourceDocumentId: null,
    };
    assert.equal(isDurablySourceVerified(bare), false);
    for (const purpose of ["MATCHING", "GENERATION", "EXPORT"] as const) {
      assert.equal(canUseVaultRecord(bare as never, purpose), false);
    }
  });
});
