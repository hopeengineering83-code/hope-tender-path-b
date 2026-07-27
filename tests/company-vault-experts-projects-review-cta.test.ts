// Real gap found via a live preview screenshot: the Company Vault's Experts
// and Projects tables (app/dashboard/company/page.tsx) only have Edit/Delete
// on each row — there is no review-status indicator and no path from that
// page to the actual review/approve action, which lives on a separate page
// (app/dashboard/company/review/page.tsx — the single review authority; see
// app/dashboard/company/review-board/page.tsx's redirect comment explaining
// why a second approval surface was deliberately not added here instead). A
// user looking only at the Experts/Projects tab had no visible signal that
// any records still needed human review, or where to go to review them.
//
// Fixed by adding a banner (using the same durable review-count fix from
// this pass) that appears whenever unreviewed experts/projects exist and
// links directly to the review page — without duplicating its approval
// mutation logic here.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/company/page.tsx", "utf8");

describe("Company Vault Experts/Projects tabs surface a path to human review", () => {
  it("links to the single review authority page from both tabs", () => {
    const matches = page.match(/href="\/dashboard\/company\/review"/g) ?? [];
    assert.ok(matches.length >= 2, "expected a review link in both the Experts and Projects tabs");
  });

  it("derives the awaiting-review count from the durable review totals, not the raw trustLevel field", () => {
    assert.match(page, /awaitingReview = totalExperts - \(reviewTotals\?\.humanReviewedExperts/);
    assert.match(page, /awaitingReview = totalProjects - \(reviewTotals\?\.humanReviewedProjects/);
  });
});
