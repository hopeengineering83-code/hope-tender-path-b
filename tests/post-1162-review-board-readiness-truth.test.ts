import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const legacyPage = readFileSync("app/dashboard/company/review-board/page.tsx", "utf8");
const routePage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const verificationPage = readFileSync("components/company-vault-verification-page.tsx", "utf8");

describe("single Company Vault Automatic Verification truth", () => {
  it("redirects legacy Review Board bookmarks to Automatic Verification", () => {
    assert.match(legacyPage, /redirect\("\/dashboard\/company\/review"\)/);
    assert.match(legacyPage, /Automatic Verification is the single Company Vault source-authority view/);
    assert.doesNotMatch(legacyPage, /fetch\(|useState|useEffect|PATCH|POST/);
    assert.match(routePage, /company-vault-verification-page/);
  });

  it("presents human audit and machine source verification as equally valid durable states", () => {
    assert.match(verificationPage, /SOURCE_VERIFIED/);
    assert.match(verificationPage, /REVIEWED/);
    assert.match(verificationPage, /equally eligible for matching, generation, export, and Final ZIP/);
    assert.doesNotMatch(verificationPage, /human approval.*required/i);
  });

  it("exposes loading, error, and success state accessibly", () => {
    assert.match(verificationPage, /role="alert"/);
    assert.match(verificationPage, /role="status"/);
    assert.match(verificationPage, /Loading automatic verification status/);
  });

  it("uses responsive wrapping and bounded diagnostic layouts", () => {
    assert.match(verificationPage, /flex flex-wrap gap-2/);
    assert.match(verificationPage, /grid gap-4 sm:grid-cols-2 xl:grid-cols-4/);
    assert.doesNotMatch(verificationPage, /originalFileName|storagePath|sourceSnippet|extractedText/);
  });

  it("does not retain the obsolete review-board readiness helper as a second authority", () => {
    assert.doesNotMatch(legacyPage, /getReviewBoardReadinessPresentation/);
    assert.doesNotMatch(routePage, /readiness-presentation/);
    assert.doesNotMatch(verificationPage, /Review & approve|Click review to approve/i);
  });
});
