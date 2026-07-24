import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

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
});
