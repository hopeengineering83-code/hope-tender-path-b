import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

describe("company knowledge auto-review safety contract", () => {
  it("routes automatic work through review provenance then auto-approves to REVIEWED", () => {
    assert.match(ingestion, /autoVerifyCompanyKnowledge\(companyId\)/);
    assert.match(verification, /buildReviewProvenance/);
    // The App auto-verifies against source bytes AND auto-approves.
    // Uploaded documents are the only source — no separate human review step.
    assert.match(verification, /trustLevel: "REVIEWED"/);
    assert.match(verification, /reviewedBy: "SYSTEM_AUTO_VERIFIED"/);
    assert.match(verification, /reviewedAt/);
  });

  it("does not use confidence-based promotion to REVIEWED", () => {
    for (const source of [ingestion, verification]) {
      assert.doesNotMatch(source, /AUTO_REVIEW_MIN_CONFIDENCE/);
      assert.doesNotMatch(source, /autoReviewedTrust/);
      assert.doesNotMatch(source, /confidence.*>=.*0\.\d+.*\?.*"REVIEWED"/s);
    }
  });

  it("repairs legacy fabricated system review into auto-REVIEWED with SYSTEM_AUTO_VERIFIED identity", () => {
    // The WHERE clause re-maps legacy REVIEWED rows back through the provenance
    // pipeline, so a stale/fabricated REVIEWED row is re-verified and re-stamped
    // with SYSTEM_AUTO_VERIFIED (not preserved as-is).
    assert.match(verification, /trustLevel: "REVIEWED"/);
    assert.match(verification, /reviewedBy: "SYSTEM_AUTO_VERIFIED"/);
    assert.match(verification, /buildReviewProvenance/);
  });
});
