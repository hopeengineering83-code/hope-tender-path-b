import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("GET /api/company/review-summary durable verification contract", () => {
  const source = readFileSync("app/api/company/review-summary/route.ts", "utf8");

  it("counts records through the canonical runtime authority", () => {
    assert.match(source, /canUseVaultRecord\(record, "GENERATION"\)/);
    assert.doesNotMatch(source, /records\.filter\([^)]*trustLevel === "REVIEWED"/);
  });

  it("reports pending automatic verification rather than mandatory human review", () => {
    assert.match(source, /pendingVerification/);
    assert.match(source, /awaiting automatic source verification/);
    assert.doesNotMatch(source, /still require review/);
  });

  it("keeps legacy field names only as explicit compatibility aliases", () => {
    assert.match(source, /Compatibility alias for older clients/);
    assert.match(source, /pendingReview: pendingVerification/);
    assert.match(source, /reviewed: expertCounts\.verified/);
    assert.match(source, /reviewed: projectCounts\.verified/);
  });

  it("requires verified expert and project evidence for final generation readiness", () => {
    assert.match(source, /readyForFinalGeneration: expertCounts\.verified > 0 && projectCounts\.verified > 0/);
  });
});
