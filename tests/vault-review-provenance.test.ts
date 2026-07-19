import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  buildReviewProvenance,
  effectiveReviewTrustLevel,
  expertReviewFields,
  isDurablyReviewed,
  projectReviewFields,
  redactVaultText,
  REVIEW_PROVENANCE_PREFIX,
  safeVaultFileLabel,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../lib/vault-review-provenance";

describe("vault privacy redaction", () => {
  it("redacts sensitive personal and storage details before presentation", () => {
    const raw = [
      "DOB: January 1, 1990;",
      "Nationality: Ethiopian;",
      "Email personal.person@example.com",
      "Phone +251 911 123 456",
      "License No: ABC-1234",
      "/storage/uploads/private/expert-cv.pdf",
      "x".repeat(400),
    ].join(" ");
    const redacted = redactVaultText(raw, 180);

    assert.doesNotMatch(redacted, /January 1, 1990/i);
    assert.doesNotMatch(redacted, /Ethiopian/i);
    assert.doesNotMatch(redacted, /personal\.person@example\.com/i);
    assert.doesNotMatch(redacted, /251 911 123 456/i);
    assert.doesNotMatch(redacted, /ABC-1234/i);
    assert.doesNotMatch(redacted, /storage\/uploads/i);
    assert.ok(redacted.length <= 180);
    assert.match(redacted, /…$/);
  });

  it("uses non-sensitive document labels instead of raw filenames", () => {
    const label = safeVaultFileLabel("EXPERT_CV", 0);
    assert.equal(label, "Expert Cv document 1");
    assert.doesNotMatch(label, /\.pdf|\.docx|\/|\\/i);
  });
});

describe("durable per-field vault review provenance", () => {
  const sourceText = [
    "Curriculum Vitae for Hana Example.",
    "Proposed position: Structural Engineer.",
    "Hana Example has 20 years of experience in Structural Engineering and Buildings.",
    "Professional certification PMP is confirmed by the source document.",
    "Project Alpha was delivered for Client One in Ethiopia in the Buildings sector.",
    "The service area was Structural Engineering and the contract value was 1000 ETB.",
    "This paragraph makes the extracted source safely longer than one hundred characters.",
  ].join(" ");
  const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const sourceDocument = {
    id: "source-doc-1",
    companyId: "company-1",
    extractedText: sourceText,
    contentSha256: sourceHash,
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const expert = {
    fullName: "Hana Example",
    title: "Structural Engineer",
    yearsExperience: 20,
    disciplines: JSON.stringify(["Structural Engineering"]),
    sectors: JSON.stringify(["Buildings"]),
    certifications: JSON.stringify(["PMP"]),
  };

  it("stores hashes and offsets, not the raw source quote", () => {
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

    assert.doesNotMatch(result.serialized, /Hana Example|Structural Engineer|PMP/);
    assert.match(result.serialized, /source-doc-1/);
    assert.ok(result.evidenceFields.includes("fullName"));
    assert.ok(result.evidenceFields.includes("title"));

    const record = {
      ...expert,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt,
      reviewNotes: result.serialized,
      sourceDocumentId: "source-doc-1",
      sourceDocument,
    };
    assert.equal(isDurablyReviewed(record), true);
    assert.equal(effectiveReviewTrustLevel(record), "REVIEWED");

    for (const fieldMutation of [
      { fullName: "Changed Name" },
      { title: "Changed Title" },
      { yearsExperience: 21 },
      { disciplines: JSON.stringify(["Changed Discipline"]) },
      { sectors: JSON.stringify(["Changed Sector"]) },
      { certifications: JSON.stringify(["Changed Certification"]) },
    ]) {
      assert.equal(isDurablyReviewed({ ...record, ...fieldMutation }), false);
    }

    assert.equal(isDurablyReviewed({
      ...record,
      sourceDocument: { ...sourceDocument, companyId: "company-2" },
    }), false);
    for (const sourceDocumentMutation of [
      { contentSha256: "0".repeat(64) },
      { contentByteLength: sourceDocument.contentByteLength + 1 },
      { integrityStatus: "MISMATCH" },
    ]) {
      assert.equal(isDurablyReviewed({
        ...record,
        sourceDocument: { ...sourceDocument, ...sourceDocumentMutation },
      }), false);
    }

    const changedSource = {
      ...record,
      sourceDocument: { ...sourceDocument, extractedText: sourceText + " changed" },
    };
    assert.equal(isDurablyReviewed(changedSource), false);

    const tamperedPayload = JSON.parse(
      result.serialized.slice(REVIEW_PROVENANCE_PREFIX.length),
    ) as { evidence: Array<{ quoteHash: string }> };
    tamperedPayload.evidence[0].quoteHash = "0".repeat(64);
    const tamperedQuote = {
      ...record,
      reviewNotes: REVIEW_PROVENANCE_PREFIX + JSON.stringify(tamperedPayload),
    };
    assert.equal(isDurablyReviewed(tamperedQuote), false);
  });

  it("fails closed when reviewer, timestamp, source, or provenance is missing", () => {
    const unsupported = {
      ...expert,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt: new Date(),
      reviewNotes: "Batch approved by an authorized reviewer.",
      sourceDocumentId: null,
    };
    assert.equal(isDurablyReviewed(unsupported), false);
    assert.equal(effectiveReviewTrustLevel(unsupported), "PROVENANCE_REQUIRED");
  });

  it("exports record-type-aware consumer query shapes", () => {
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.EXPERT.fullName, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.EXPERT.yearsExperience, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.EXPERT.certifications, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.PROJECT.name, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.PROJECT.contractValue, true);
    assert.equal(VAULT_REVIEW_CONSUMER_SELECT.PROJECT.serviceAreas, true);
    for (const select of Object.values(VAULT_REVIEW_CONSUMER_SELECT)) {
      assert.equal(select.companyId, true);
      assert.equal(select.reviewNotes, true);
      assert.equal(select.sourceDocument.select.contentSha256, true);
      assert.equal(select.sourceDocument.select.contentByteLength, true);
      assert.equal(select.sourceDocument.select.integrityStatus, true);
    }
  });

  it("rejects every mutated project field after review", () => {
    const project = {
      name: "Project Alpha",
      clientName: "Client One",
      country: "Ethiopia",
      sector: "Buildings",
      serviceAreas: JSON.stringify(["Structural Engineering"]),
      contractValue: 1000,
      currency: "ETB",
    };
    const reviewedAt = new Date("2026-07-15T19:00:00.000Z");
    const result = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument,
      fields: projectReviewFields(project),
      reviewerId: "reviewer-1",
      reviewedAt,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const record = {
      ...project,
      companyId: "company-1",
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt,
      reviewNotes: result.serialized,
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };
    assert.equal(isDurablyReviewed(record), true);
    for (const fieldMutation of [
      { name: "Changed Project" },
      { clientName: "Changed Client" },
      { country: "Changed Country" },
      { sector: "Changed Sector" },
      { serviceAreas: JSON.stringify(["Changed Service"]) },
      { contractValue: 2000 },
      { currency: "USD" },
    ]) {
      assert.equal(isDurablyReviewed({ ...record, ...fieldMutation }), false);
    }
  });

  it("rejects extracted text when verified source-byte integrity is missing", () => {
    for (const source of [
      { ...sourceDocument, contentSha256: null },
      { ...sourceDocument, contentByteLength: null },
      { ...sourceDocument, integrityStatus: "UNKNOWN" },
    ]) {
      const result = buildReviewProvenance({
        recordType: "EXPERT",
        sourceDocument: source,
        fields: expertReviewFields(expert),
        reviewerId: "reviewer-1",
        reviewedAt: new Date(),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "PROVENANCE_REQUIRED");
    }
  });

  it("rejects a review when any represented field lacks source evidence", () => {
    const result = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: [...expertReviewFields(expert), { field: "licenseNumber", value: "MISSING-123" }],
      reviewerId: "reviewer-1",
      reviewedAt: new Date(),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FIELD_EVIDENCE_REQUIRED");
    assert.deepEqual(result.missingFields, ["licenseNumber"]);
  });
});
