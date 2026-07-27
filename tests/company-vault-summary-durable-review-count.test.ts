// Real gap found via a live preview screenshot: the Company Vault page's
// "Knowledge vault" summary showed "Experts: 28 reviewed" and "Projects: 112
// reviewed" — the exact same numbers as the total Expert/Project counts —
// while the Engine's Safe Mode matching (lib/engine/matching-eligibility.ts,
// gated on isDurablyReviewed()) reported "No eligible expert match rows" and
// "No eligible project match rows" for the same company. The page computed
// its "reviewed" count from the raw `trustLevel === "REVIEWED"` column
// alone, which can be true for a record that was never actually bound to
// verified source-document bytes with a matching quote (missing
// sourceDocumentId/reviewedBy/reviewedAt, or a provenance mismatch) — the
// Engine correctly rejects such records via isDurablyReviewed(), but the
// summary panel had no way to know that and silently overstated readiness.
//
// Fixed by having the page fetch the canonical durable-review counts from
// GET /api/company/ingestion-readiness (lib/company-ingestion-readiness.ts,
// which computes humanReviewedExperts/humanReviewedProjects via the same
// isDurablyReviewed() the Engine uses) instead of recomputing its own
// looser check from the raw trustLevel field.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/company/page.tsx", "utf8");

describe("Company Vault summary panel's 'reviewed' count matches the Engine's durable-review authority", () => {
  it("fetches the canonical ingestion-readiness endpoint", () => {
    assert.match(page, /\/api\/company\/ingestion-readiness/);
  });

  it("does not compute the displayed 'reviewed' count from the raw trustLevel field", () => {
    assert.doesNotMatch(
      page,
      /allExperts\.filter\(e => e\.trustLevel === "REVIEWED"\)/,
      "must not reintroduce the naive trustLevel-only count that disagreed with the Engine's isDurablyReviewed() gate",
    );
    assert.doesNotMatch(
      page,
      /allProjects\.filter\(p => p\.trustLevel === "REVIEWED"\)/,
      "must not reintroduce the naive trustLevel-only count that disagreed with the Engine's isDurablyReviewed() gate",
    );
  });

  it("derives the reviewed counts from the fetched readiness totals", () => {
    assert.match(page, /reviewTotals\?\.humanReviewedExperts/);
    assert.match(page, /reviewTotals\?\.humanReviewedProjects/);
  });
});
