import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildReviewProvenance,
  canUseVaultRecord,
  effectiveReviewTrustLevel,
  expertReviewFields,
  isDurablyReviewed,
  redactVaultText,
  safeVaultFileLabel,
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
    "This paragraph makes the extracted source safely longer than one hundred characters.",
  ].join(" ");
  const sourceDocument = {
    id: "source-doc-1",
    extractedText: sourceText,
    contentSha256: null,
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
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt,
      reviewNotes: result.serialized,
      sourceDocumentId: "source-doc-1",
      sourceDocument,
    };
    assert.equal(isDurablyReviewed(record), true);
    assert.equal(effectiveReviewTrustLevel(record), "REVIEWED");
    assert.equal(canUseVaultRecord(record, "MATCHING"), true);
    assert.equal(canUseVaultRecord(record, "GENERATION"), true);
    assert.equal(canUseVaultRecord(record, "EXPORT"), true);

    const changedSource = {
      ...record,
      sourceDocument: { ...sourceDocument, extractedText: sourceText + " changed" },
    };
    assert.equal(isDurablyReviewed(changedSource), false);
    assert.equal(canUseVaultRecord(changedSource, "EXPORT"), false);
  });

  it("fails closed when reviewer, timestamp, source, or provenance is missing", () => {
    const unsupported = {
      trustLevel: "REVIEWED",
      reviewedBy: "reviewer-1",
      reviewedAt: new Date(),
      reviewNotes: "Batch approved by an authorized reviewer.",
      sourceDocumentId: null,
    };
    assert.equal(isDurablyReviewed(unsupported), false);
    assert.equal(effectiveReviewTrustLevel(unsupported), "PROVENANCE_REQUIRED");
    assert.equal(canUseVaultRecord(unsupported, "MATCHING"), false);
    assert.equal(canUseVaultRecord(unsupported, "GENERATION"), false);
    assert.equal(canUseVaultRecord(unsupported, "EXPORT"), false);
  });

  it("rejects a review when any represented field lacks source evidence", () => {
    const result = buildReviewProvenance({
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
