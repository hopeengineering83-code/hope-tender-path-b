import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deriveAutomaticSourceVerification } from "../lib/company-auto-verification";
import {
  expertReviewFields,
  isDurablyReviewed,
  isDurablySourceVerified,
} from "../lib/vault-review-provenance";

const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

describe("company knowledge auto-review safety contract", () => {
  it("routes automatic work through source verification, never human review", () => {
    assert.match(ingestion, /autoVerifyCompanyKnowledge\(companyId\)/);
    assert.match(verification, /buildSourceVerificationProvenance/);
    assert.match(verification, /trustLevel: "SOURCE_VERIFIED"/);
    assert.match(verification, /reviewedBy: null/);
    assert.match(verification, /reviewedAt: null/);
  });

  it("does not use confidence-based promotion to REVIEWED", () => {
    for (const source of [ingestion, verification]) {
      assert.doesNotMatch(source, /AUTO_REVIEW_MIN_CONFIDENCE/);
      assert.doesNotMatch(source, /autoReviewedTrust/);
      assert.doesNotMatch(source, /confidence.*>=.*0\.\d+.*\?.*"REVIEWED"/s);
      assert.doesNotMatch(source, /data:\s*\{[^}]*trustLevel:\s*"REVIEWED"/s);
    }
  });

  it("repairs legacy fabricated system review into SOURCE_VERIFIED without preserving reviewer identity", () => {
    assert.match(verification, /trustLevel: "REVIEWED", reviewedBy: "SYSTEM_AUTO_VERIFIED"/);
    assert.match(verification, /trustLevel: "SOURCE_VERIFIED"/);
    assert.match(verification, /reviewedBy: null/);
    assert.match(verification, /reviewedAt: null/);
  });

  it("machine verification produces durable SOURCE_VERIFIED evidence that is not human-reviewed", () => {
    const companyId = "company-automatic-source-verification";
    const sourceText = [
      "CURRICULUM VITAE",
      "Name: Hana Source",
      "Title: Senior Water Engineer",
      "Experience: 12 years",
      "Disciplines: Water Engineering",
      "Sectors: Water Supply",
    ].join("\n");
    const sourceDocument = {
      id: "document-automatic-source-verification",
      companyId,
      extractedText: sourceText,
      contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
      contentByteLength: Buffer.byteLength(sourceText),
      integrityStatus: "VERIFIED",
    };
    const expert = {
      companyId,
      fullName: "Hana Source",
      title: "Senior Water Engineer",
      yearsExperience: 12,
      disciplines: JSON.stringify(["Water Engineering"]),
      sectors: JSON.stringify(["Water Supply"]),
      certifications: JSON.stringify([]),
      trustLevel: "AI_DRAFT",
      sourceDocumentId: sourceDocument.id,
      sourceDocument,
    };

    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields(expert),
      priorTrustLevel: expert.trustLevel,
    });

    assert.equal(decision.ok, true);
    assert.deepEqual(decision.reviewState, {
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: decision.provenance.serialized,
    });

    const verifiedRecord = { ...expert, ...decision.reviewState };
    assert.equal(isDurablySourceVerified(verifiedRecord), true);
    assert.equal(isDurablyReviewed(verifiedRecord), false);
  });
});
