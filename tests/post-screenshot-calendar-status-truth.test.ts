import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/dashboard/calendar/calendar-client.tsx", "utf8");

describe("screenshot-driven deadline calendar status truth", () => {
  it("uses the shared canonical tender status formatter", () => {
    assert.match(source, /import \{ formatTenderStatus \} from "\.\.\/\.\.\/\.\.\/lib\/tender-workflow"/);
    assert.match(source, /\{formatTenderStatus\(tender\.status\)\}/);
    assert.doesNotMatch(source, />\{tender\.status\}<\/span>/);
  });

  it("covers canonical analysis, matching, review, and no-bid states", () => {
    for (const status of [
      "ANALYZED",
      "AI_ANALYZED",
      "AI_ANALYSIS_PARTIAL",
      "FALLBACK_DRAFT_CREATED",
      "ANALYSIS_REQUIRES_REVIEW",
      "MATCHED",
      "COMPLIANCE_REVIEW",
      "READY_FOR_GENERATION",
      "IN_REVIEW",
      "NO_BID",
    ]) {
      assert.ok(source.includes(`${status}:`), `missing calendar style for ${status}`);
    }
  });

  it("does not retain obsolete pseudo-status keys", () => {
    assert.doesNotMatch(source, /\n\s+ANALYSIS:/);
    assert.doesNotMatch(source, /\n\s+MATCHING:/);
    assert.doesNotMatch(source, /\n\s+REVIEW:/);
  });

  it("keeps mobile calendar navigation and horizontal inspection discoverable", () => {
    assert.match(source, /aria-label="Calendar month navigation"/);
    assert.match(source, /aria-label="Previous month"/);
    assert.match(source, /aria-label="Next month"/);
    assert.match(source, /Swipe the calendar horizontally to inspect every day/);
    assert.match(source, /overflow-x-auto/);
  });
});
