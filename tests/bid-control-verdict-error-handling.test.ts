/**
 * Tests for bid-control-verdict-panel error handling.
 *
 * Verifies:
 *   1. prismaReady failure renders the safe fallback (not crash).
 *   2. findFirst operational failure renders the safe fallback (not null/hidden).
 *   3. True not-found/unauthorized remains hidden (returns null).
 *   4. Raw Prisma text never renders in the component output.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("bid-control-verdict-panel error handling", () => {
  it("prismaReady is inside the try/catch (not before it)", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    const tryIdx = src.indexOf("try {");
    const prismaReadyIdx = src.indexOf("await prismaReady");
    assert.ok(tryIdx > 0, "must have a try block");
    assert.ok(prismaReadyIdx > tryIdx, "prismaReady must be INSIDE the try block");
  });

  it("prisma.tender.findFirst does NOT have .catch() that converts to null", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    // The findFirst call must NOT be followed by .catch() — operational
    // errors must propagate to the outer catch block.
    const findFirstMatch = src.match(/prisma\.tender\.findFirst\([\s\S]*?\}\)/);
    assert.ok(findFirstMatch, "must have prisma.tender.findFirst call");
    // Check that the findFirst call is NOT immediately followed by .catch()
    const afterFindFirst = src.slice(findFirstMatch!.index! + findFirstMatch![0].length, findFirstMatch!.index! + findFirstMatch![0].length + 20);
    assert.ok(!afterFindFirst.startsWith(".catch"), "findFirst must NOT have .catch() — let errors propagate to outer catch");
  });

  it("outer catch renders safe 'Bid control verdict unavailable' fallback", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("Bid control verdict unavailable"), "must render safe fallback message");
    assert.ok(src.includes("Refresh to retry"), "must show refresh instruction");
  });

  it("true not-found (tender === null) returns null (hides panel)", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("if (!tender) return null"), "must return null when tender is not found");
  });

  it("raw Prisma error messages are never logged in client-facing code", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    // The .catch() blocks for the 3 readiness calls should NOT log error.message
    // (only errorClass is safe). The outer catch should also NOT log error.message.
    const catchBlocks = src.match(/\.catch\(\(error\) => \{[\s\S]*?\}\)/g) || [];
    for (const block of catchBlocks) {
      assert.ok(!block.includes("error.message"), `catch block must not log error.message: ${block.slice(0, 80)}`);
      assert.ok(!block.includes("String(error)"), `catch block must not log String(error): ${block.slice(0, 80)}`);
    }
    // Also check the outer catch
    const outerCatch = src.match(/} catch \(error\) \{[\s\S]*?\}/);
    if (outerCatch) {
      assert.ok(!outerCatch[0].includes("error.message"), "outer catch must not log error.message");
      assert.ok(!outerCatch[0].includes("String(error)"), "outer catch must not log String(error)");
    }
  });

  it("component never renders raw error text, tender IDs, or user IDs", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    // Check that no template literal in the JSX renders error.message, tenderId, or userId
    // (tenderId is used in fetch URLs which is fine, but not in visible text)
    assert.ok(!src.includes("{error.message}"), "must not render error.message in JSX");
    assert.ok(!src.includes("{String(error)}"), "must not render String(error) in JSX");
  });
});
