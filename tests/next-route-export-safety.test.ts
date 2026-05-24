import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

describe("Next.js route export safety — ai-proposal route", () => {
  it("does not export non-route helper functions from route.ts", async () => {
    const src = await readFile("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    assert.equal(/export function fallbackProposal\b/.test(src), false);
    assert.equal(/export function selectReviewedEvidenceForAIDraft\b/.test(src), false);
  });
});

