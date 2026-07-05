import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

describe("Next.js route export safety — ai-proposal route", () => {
  it("does not export non-route helper functions from route.ts", async () => {
    const src = await readFile("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    assert.equal(/export function fallbackProposal\b/.test(src), false);
    assert.equal(/export function selectReviewedEvidenceForAIDraft\b/.test(src), false);
  });

  it("only exports allowed Next.js route symbols", async () => {
    const src = await readFile("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    const exportLines = src
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("export "));

    const allowed = [
      "export const maxDuration",
      "export const dynamic",
      "export async function POST",
    ];

    for (const line of exportLines) {
      assert.ok(
        allowed.some((prefix) => line.startsWith(prefix)),
        `Unexpected export in route.ts: ${line}`,
      );
    }
  });
});

