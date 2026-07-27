import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  buildReviewProvenance,
  buildSourceVerificationProvenance,
  canUseVaultRecord,
  effectiveReviewTrustLevel,
  expertReviewFields,
  isDurablyReviewed,
  isDurablySourceVerified,
  projectReviewFields,
  REVIEW_PROVENANCE_PREFIX,
  SOURCE_VERIFICATION_PROVENANCE_PREFIX,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../lib/vault-review-provenance";

const sourceText = [
  "[Page 1] Curriculum Vitae for Sample Person.",
  "Proposed position: Structural Engineer.",
  "Sample Person has 20 years of experience in Structural Engineering and Buildings.",
  "Professional certification PMP is confirmed by the source document.",
  "[Page 2] Project Alpha was delivered for Client One in Ethiopia in the Buildings sector.",
  "The service area was Structural Engineering and the contract value was 1000 ETB.",
].join(" ");
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
const sourceDocument = {
  id: "source-doc-1",
  companyId: "company-1",
  extractedText: sourceText,
  contentSha256: sourceHash,
  contentByteLength: Buffer.byteLength(sourceText),
  integrityStatus: "VERIFIED",
  metadata: JSON.stringify({ extractionRevision: 1 }),
};
const expert = {
  fullName: "Sample Person",
  title: "Structural Engineer",
  yearsExperience: 20,
  disciplines: JSON.stringify(["Structural Engineering"]),
  sectors: JSON.stringify(["Buildings"]),
  certifications: JSON.stringify(["PMP"]),
};

describe("durable vault provenance", () => {
  it("preserves exact source, page, quote, span, hashes, fields, and revision", () => {
    const reviewedAt = new Date("2026-07-15T19:00:00.000Z");
    const result = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields(expert),
      reviewerId: "reviewer-1",
      reviewedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const payload = JSON.parse(result.serialized.slice(REVIEW_PROVENANCE_PREFIX.length)) as {
      sourceDocumentId: string;
      sourceContentHash: string;
      sourceByteLength: number;
      sourceTextHash: string;
      sourceExtractionRevision: string;
      reviewerId: string;
      evidence: Array<{ field: string; quote: string; quoteHash: string; page: number | null; start: number; end: number }>;
    };
    assert.equal(payload.sourceDocumentId, sourceDocument.id);
    assert.equal(payload.sourceContentHash, sourceHash);
    assert.equal(payload.sourceByteLength, sourceDocument.contentByteLength);
    assert.equal(payload.sourceTextHash, sourceHash);
    assert.equal(payload.sourceExtractionRevision, "revision:1");
    assert.equal(payload.reviewerId, "reviewer-1");
    assert.ok(payload.evidence.some((item) => item.field === "fullName" && item.quote.includes("Sample Person") && item.page === 1));
    assert.ok(payload.evidence.every((item) => item.start >= 0 && item.end > item.start && item.quote.length > 0));

    const record = {
      ...expert,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt,
      reviewNotes: result.serialized,
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };
    assert.equal(isDurablyReviewed(record), true);
    assert.equal(effectiveReviewTrustLevel(record), "REVIEWED");
    assert.equal(canUseVaultRecord(record, "EXPORT"), true);
  });

  it("invalidates human review when any bound field, source byte, span, or revision changes", () => {
    const reviewedAt = new Date("2026-07-15T19:00:00.000Z");
    const result = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields(expert),
      reviewerId: "reviewer-1",
      reviewedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const record = {
      ...expert,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt,
      reviewNotes: result.serialized,
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };

    assert.equal(isDurablyReviewed({ ...record, certifications: JSON.stringify(["Changed"]) }), false);
    assert.equal(isDurablyReviewed({ ...record, sourceDocument: { ...sourceDocument, contentSha256: "0".repeat(64) } }), false);
    assert.equal(isDurablyReviewed({ ...record, sourceDocument: { ...sourceDocument, integrityStatus: "MISMATCH" } }), false);
    assert.equal(isDurablyReviewed({ ...record, sourceDocument: { ...sourceDocument, extractedText: `${sourceText} changed` } }), false);
    assert.equal(isDurablyReviewed({ ...record, sourceDocument: { ...sourceDocument, metadata: JSON.stringify({ extractionRevision: 2 }) } }), false);

    const payload = JSON.parse(result.serialized.slice(REVIEW_PROVENANCE_PREFIX.length)) as { evidence: Array<{ quoteHash: string }> };
    payload.evidence[0].quoteHash = "0".repeat(64);
    assert.equal(isDurablyReviewed({ ...record, reviewNotes: REVIEW_PROVENANCE_PREFIX + JSON.stringify(payload) }), false);
  });

  it("keeps machine SOURCE_VERIFIED separate from human REVIEWED", () => {
    const result = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields(expert),
      verificationMethod: "HYBRID",
      verifiedAt: new Date("2026-07-15T19:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.serialized, new RegExp(`^${SOURCE_VERIFICATION_PROVENANCE_PREFIX}`));

    const record = {
      ...expert,
      companyId: "company-1",
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: result.serialized,
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };
    assert.equal(isDurablySourceVerified(record), true);
    assert.equal(isDurablyReviewed(record), false);
    assert.equal(effectiveReviewTrustLevel(record), "SOURCE_VERIFIED");
    // canUseVaultRecord's EXPORT purpose accepts a durably SOURCE_VERIFIED
    // record too, same as MATCHING/GENERATION — the record's exact claimed
    // values were machine-verified against the company's own owned, byte-
    // verified source document; isDurablyReviewed staying false is still
    // correct and meaningful (no human has looked at it), it just no
    // longer gates export on top of genuine machine verification.
    assert.equal(canUseVaultRecord(record, "MATCHING"), true);
    assert.equal(canUseVaultRecord(record, "GENERATION"), true);
    assert.equal(canUseVaultRecord(record, "EXPORT"), true);
    assert.equal(isDurablySourceVerified({ ...record, reviewedBy: "SYSTEM_AUTO_VERIFIED" }), false);
    assert.equal(isDurablySourceVerified({ ...record, certifications: JSON.stringify(["Changed"]) }), false);
    assert.equal(isDurablySourceVerified({ ...record, sourceDocument: { ...sourceDocument, metadata: JSON.stringify({ extractionRevision: 2 }) } }), false);
  });

  it("fails closed when human review provenance is unsupported", () => {
    const unsupported = {
      ...expert,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt: new Date(),
      reviewNotes: "Human review without durable provenance",
      sourceDocumentId: null,
    };
    assert.equal(isDurablyReviewed(unsupported), false);
    assert.equal(effectiveReviewTrustLevel(unsupported), "PROVENANCE_REQUIRED");
  });

  it("uses complete expert and project evidence sets", () => {
    const project = {
      name: "Project Alpha",
      clientName: "Client One",
      country: "Ethiopia",
      sector: "Buildings",
      serviceAreas: JSON.stringify(["Structural Engineering"]),
      contractValue: 1000,
      currency: "ETB",
    };
    assert.deepEqual(expertReviewFields(expert).map((field) => field.field), [
      "fullName", "title", "yearsExperience", "disciplines[0]", "sectors[0]", "certifications[0]",
    ]);
    assert.deepEqual(projectReviewFields(project).map((field) => field.field), [
      "name", "clientName", "country", "sector", "serviceAreas[0]", "contractValue", "currency",
    ]);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.EXPERT.certifications, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.PROJECT.serviceAreas, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.PROJECT.contractValue, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.EXPERT.sourceDocument.select.metadata, true);
  });
});
