// The six findings of the Codex review of 2b7bee18 on PR #1175, each pinned by
// behaviour. Finding 2 (provider slots) has its own file:
// tests/a-provider-is-configured-for-the-use-case-it-serves.test.ts. The
// route-level halves of findings 4, 5 and 6 run on PostgreSQL in
// tests/the-six-latest-review-findings-db.test.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { estimateTenderPrice, statedBudget, type PricingEvidenceInput } from "../lib/engine/pricing-intelligence";
import { classifyStageRetry, reportedRetryable } from "../lib/engine/stage-retry-policy";
import { activeShares, createdShareAfterRevoke, shareLinkFor, type ShareListEntry } from "../lib/ui/share-links";

const base = (tenderText: string, country = "Nigeria"): PricingEvidenceInput => ({
  tender: { id: "t", title: "Water supply design", country, category: null, currency: null, budget: null },
  tenderText,
  experts: [{ id: "e1", name: "A", title: "Team Leader", yearsExperience: 15 }],
  historicalProjects: [],
  priorRates: [],
  companyDefaultCurrency: null,
  now: new Date("2026-10-07T00:00:00Z"),
});

describe("1. a budget is read in any currency the shared reference knows", () => {
  it("NGN, GHS and ₦ budgets are read; ETB and US$ still are", () => {
    assert.deepEqual(statedBudget("Budget: NGN 5,000,000.")?.currency, "NGN");
    assert.equal(statedBudget("Budget: NGN 5,000,000.")?.amount, 5_000_000);
    assert.deepEqual(statedBudget("The maximum budget for this assignment is GHS 500,000 exclusive of VAT."), { amount: 500_000, currency: "GHS", quote: "The maximum budget for this assignment is GHS 500,000 exclusive of VAT.", inclusiveOfVat: false });
    assert.equal(statedBudget("The ceiling is ₦ 40 million.")?.amount, 40_000_000);
    assert.equal(statedBudget("The available budget for this assignment is ETB 2,000,000.")?.currency, "ETB");
    assert.equal(statedBudget("The total budget shall not exceed US$ 250,000.")?.currency, "USD");
  });
  it("a qualification threshold is still not a budget, and prose is not a currency", () => {
    assert.equal(statedBudget("Bidders shall have completed two similar contracts, each with an estimated contract value of NGN 100,000,000."), null);
    assert.equal(statedBudget("Budget for all 3 phases is to be proposed by the bidder."), null);
  });
  it("the stated NGN budget caps the estimate", () => {
    const est = estimateTenderPrice(base("The assignment shall be completed within four (4) months. The Consultant shall submit a financial proposal; prices shall be quoted in NGN. The maximum budget for this assignment is NGN 5,000,000."));
    assert.equal(est.budget?.amount, 5_000_000);
    assert.equal(est.budget?.currency, "NGN");
    assert.equal(est.currency, "NGN");
  });
});

describe("3. the financial proposal promises the offer's validity, not the security's", () => {
  const validity = (text: string) => estimateTenderPrice(base(text, "Kenya"));
  it("a bid security valid for 120 days before proposals valid for 90: 90", () => {
    const est = validity("The bid security shall be valid for 120 days. Proposals shall remain valid for 90 days after the submission deadline.");
    assert.equal(est.validityDays, 90);
    assert.match(est.validityBasis, /Proposals shall remain valid for 90 days/);
  });
  it("both in one sentence, either order", () => {
    assert.equal(validity("Bids shall remain valid for 90 days and shall be accompanied by a bid security valid for 120 days.").validityDays, 90);
    assert.equal(validity("The bid security, valid for 120 days beyond the bid validity period of 75 days, shall be submitted.").validityDays, 75);
  });
  it("only a security's validity stated: the offer's is not stated, so it is assumed and said so", () => {
    const est = validity("Validity of the bid security: 120 days. The performance guarantee shall be valid for 28 days after completion.");
    assert.equal(est.validityDays, 90);
    assert.match(est.validityBasis, /states no validity period; 90 days assumed/);
  });
  it("the offer's own validity is still read, including a figure in brackets", () => {
    assert.equal(validity("Proposal validity: 60 days.").validityDays, 60);
    assert.equal(validity("The offer shall be valid for one hundred and twenty (120) days.").validityDays, 120);
  });
});

describe("4. the worker reports the classifier's retry decision", () => {
  it("terminal failures are not retryable; a scheduled retry is", () => {
    const authority = classifyStageRetry("AUTHORITY_REQUIRED: manual AI Analyze authority missing", 0);
    assert.equal(reportedRetryable(authority, false), false, "a terminal authority failure needs intervention");
    const transient = classifyStageRetry("Provider TIMEOUT", 0);
    assert.equal(reportedRetryable(transient, true), true, "a queued retry is retryable");
    assert.equal(reportedRetryable(transient, false), true, "transient, even if re-arming lost a race");
    assert.equal(reportedRetryable(classifyStageRetry("Provider TIMEOUT", 99), false), false, "the retry budget is spent");
    assert.equal(reportedRetryable(null, false), true, "an unclassified job type keeps its previous answer");
  });
  it("the route uses it, and a superseded stage is named so the drain workflow does not page anyone", () => {
    const route = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.match(route, /retryable: reportedRetryable\(decision, retryScheduled\)/);
    assert.doesNotMatch(route, /retryable: !retryScheduled/);
    assert.match(route, /"ENGINE_SOURCE_SUPERSEDED" \? "ENGINE_SOURCE_SUPERSEDED"/);
    const workflow = readFileSync(".github/workflows/drain-ai-job-queue.yml", "utf8");
    const superseded = workflow.indexOf('"$result_code" = "ENGINE_SOURCE_SUPERSEDED"');
    const terminal = workflow.indexOf('[ "$retryable" = "false" ]');
    assert.ok(superseded > -1 && superseded < terminal, "a supersede exits as a non-failure before the terminal check");
  });
});

describe("5. a hash-only share never shows as /share/null", () => {
  const origin = "https://app.example";
  const hashOnly: ShareListEntry = { id: "s-new", token: null, label: null, createdAt: "2026-10-12T00:00:00Z", expiresAt: null, revokedAt: null };
  const legacy: ShareListEntry = { id: "s-old", token: "legacy-token", label: null, createdAt: "2026-01-01T00:00:00Z", expiresAt: null, revokedAt: null };
  it("a hash-only share has no URL after a reload; the one created now shows its one-time URL; a legacy share its own", () => {
    assert.equal(shareLinkFor(hashOnly, null, origin), null);
    assert.equal(shareLinkFor(hashOnly, { id: "s-new", url: `${origin}/share/raw` }, origin), `${origin}/share/raw`);
    assert.equal(shareLinkFor(hashOnly, { id: "other", url: `${origin}/share/raw` }, origin), null, "another share's URL is never shown against this one");
    assert.equal(shareLinkFor(legacy, null, origin), `${origin}/share/legacy-token`);
  });
  it("revoking the share whose URL is on screen removes that URL; a revoked share is not listed as active", () => {
    assert.equal(createdShareAfterRevoke({ id: "s-new", url: "u" }, "s-new"), null);
    assert.deepEqual(createdShareAfterRevoke({ id: "s-new", url: "u" }, "s-old"), { id: "s-new", url: "u" });
    assert.deepEqual(activeShares([hashOnly, { ...legacy, revokedAt: "2026-10-12T01:00:00Z" }]).map((s) => s.id), ["s-new"]);
  });
  it("the panel builds no URL from share.token itself", () => {
    const panel = readFileSync("components/tender-share-panel.tsx", "utf8");
    assert.doesNotMatch(panel, /\/share\/\{share\.token\}|share\/\$\{share\.token\}|includes\(match\.token\)/);
    assert.match(panel, /shareLinkFor\(share, created, window\.location\.origin\)/);
    assert.match(panel, /setCreated\(\{ id: data\.share\.id, url: fullUrl \}\)/);
  });
});

describe("6. a deactivated user is not listed as active", () => {
  it("the user list selects active users only", () => {
    assert.match(readFileSync("app/api/users/route.ts", "utf8"), /findMany\(\{\s*where: \{ deletedAt: null \}/);
  });
});
