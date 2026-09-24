// Proposal sections are paced, not fired all at once.
//
// Observed on the owner's runs: all four sections were sent at the same
// moment, the free-tier providers the chain reaches (Z.ai, Groq) answered 429
// to the burst, each 429 cooled the provider for every section, and the whole
// proposal fell back to the deterministic draft. The sections now run through a
// bounded pool that shares one deadline.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mapInOrderWithConcurrency, resolveProposalSectionConcurrency } from "../lib/ai";

describe("mapInOrderWithConcurrency", () => {
  it("never has more than `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapInOrderWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      inFlight -= 1;
      return n;
    });
    assert.equal(peak, 2);
  });

  it("returns results in the original order even when started in another order", async () => {
    const started: number[] = [];
    const out = await mapInOrderWithConcurrency(
      [10, 30, 20],
      1,
      async (n) => { started.push(n); return n * 2; },
      (a, b) => b - a,
    );
    assert.deepEqual(started, [30, 20, 10], "largest first");
    assert.deepEqual(out, [20, 60, 40], "results stay in item order");
  });

  it("handles an empty list", async () => {
    assert.deepEqual(await mapInOrderWithConcurrency([], 2, async (n: number) => n), []);
  });
});

describe("resolveProposalSectionConcurrency", () => {
  it("defaults to 2", () => {
    assert.equal(resolveProposalSectionConcurrency(undefined), 2);
    assert.equal(resolveProposalSectionConcurrency(""), 2);
    assert.equal(resolveProposalSectionConcurrency("nonsense"), 2);
    assert.equal(resolveProposalSectionConcurrency("0"), 2);
  });

  it("honours an override, capped at 8", () => {
    assert.equal(resolveProposalSectionConcurrency("1"), 1);
    assert.equal(resolveProposalSectionConcurrency("4"), 4);
    assert.equal(resolveProposalSectionConcurrency("50"), 8);
  });
});

describe("the section writer uses the pool", () => {
  const src = readFileSync("lib/ai.ts", "utf8");
  const start = src.indexOf("export async function generateProposalSectionsParallel");
  const body = src.slice(start, start + 6000);

  it("does not fire every section at once", () => {
    assert.ok(start > 0);
    assert.doesNotMatch(body, /Promise\.all\(filteredSpecs\.map\(generateOneSection\)\)/);
    assert.match(body, /mapInOrderWithConcurrency\(/);
  });

  it("bounds every queued section by one shared deadline", () => {
    assert.match(body, /withProviderDeadline\(poolDeadlineAt/);
    assert.match(body, /PROPOSAL_SECTION_STITCH_RESERVE_MS/);
  });
});
