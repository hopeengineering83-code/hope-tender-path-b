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
// Fixed by having the page fetch the canonical counts from
// GET /api/company/ingestion-readiness (lib/company-ingestion-readiness.ts,
// the same resolver the Engine's gate uses) instead of recomputing its own
// looser check from the raw trustLevel field.
//
// The counts the page displays have since moved from humanReviewedExperts to
// reviewedExperts — human review is no longer a separate step, so what a user
// needs to see is how much evidence is usable, not how much a person signed
// off. This file still guards the original defect: the count must never again
// be recomputed locally from the trustLevel column. What the page does with
// the fetched totals now lives in
// tests/company-vault-usable-evidence-count.test.ts.

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

  it("derives the displayed counts from the fetched readiness totals, never from local state alone", () => {
    assert.match(page, /readiness\.totals\.reviewedExperts/);
    assert.match(page, /readiness\.totals\.reviewedProjects/);
  });
});
