import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const legacyPage = readFileSync("app/dashboard/company/review-board/page.tsx", "utf8");
const reviewInbox = readFileSync("app/dashboard/company/review/page.tsx", "utf8");

describe("single Company Vault Review Inbox truth", () => {
  it("redirects legacy Review Board bookmarks to the canonical Review Inbox", () => {
    assert.match(legacyPage, /redirect\("\/dashboard\/company\/review"\)/);
    assert.match(legacyPage, /single Company Vault review authority/);
    assert.doesNotMatch(legacyPage, /fetch\(|useState|useEffect|PATCH|POST/);
  });

  it("presents human and machine trust as distinct states", () => {
    assert.match(reviewInbox, /Human reviewed/);
    assert.match(reviewInbox, /Source verified/);
    assert.match(reviewInbox, /SOURCE_VERIFIED and support matching or draft generation/);
    assert.match(reviewInbox, /Final approval and final-package export still require genuine human REVIEWED evidence/);
    assert.doesNotMatch(reviewInbox, /readyForFinalGeneration/);
  });

  it("exposes loading, error, and success state accessibly", () => {
    assert.match(reviewInbox, /role="alert"/);
    assert.match(reviewInbox, /role="status"/);
    assert.match(reviewInbox, /aria-label="Previous page"/);
    assert.match(reviewInbox, /aria-label="Next page"/);
    assert.match(reviewInbox, /aria-label=\{`Select \$\{expert\.fullName\} for review`\}/);
    assert.match(reviewInbox, /aria-label=\{`Select \$\{project\.name\} for review`\}/);
  });

  it("uses responsive wrapping and bounded source/record layouts", () => {
    assert.match(reviewInbox, /flex flex-wrap items-center justify-between gap-3/);
    assert.match(reviewInbox, /grid gap-4 sm:grid-cols-2 xl:grid-cols-4/);
    assert.match(reviewInbox, /grid gap-3 md:grid-cols-2/);
    assert.match(reviewInbox, /grid gap-3 lg:grid-cols-2/);
    assert.match(reviewInbox, /Only bounded, privacy-safe source labels are displayed/);
  });

  it("does not retain the obsolete readiness-presentation helper as a second authority", () => {
    assert.doesNotMatch(legacyPage, /getReviewBoardReadinessPresentation/);
    assert.doesNotMatch(reviewInbox, /readiness-presentation/);
  });
});
