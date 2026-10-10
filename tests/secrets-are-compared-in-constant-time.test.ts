// A scheduler or admin secret is compared in constant time. Each route used
// `header === \`Bearer ${secret}\``, which returns at the first differing
// character, so response time leaks how much of a guess was right.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { secretMatches } from "../lib/secret-compare";

const ROUTES = [
  "app/api/ai-jobs/run-next/route.ts",
  "app/api/cron/ai-analyze-retry/route.ts",
  "app/api/cron/cleanup-old-records/route.ts",
  "app/api/cron/cleanup-tender-storage/route.ts",
  "app/api/cron/deadline-alerts/route.ts",
  "app/api/admin/db-stats/route.ts",
  "app/api/admin/provider-health/route.ts",
];

describe("secrets are compared in constant time", () => {
  it("matches only the exact secret; empty or missing never matches", () => {
    const secret = "s".repeat(32);
    assert.equal(secretMatches(`Bearer ${secret}`, `Bearer ${secret}`), true);
    assert.equal(secretMatches(`Bearer ${secret}x`, `Bearer ${secret}`), false);
    assert.equal(secretMatches(`Bearer ${secret.slice(1)}`, `Bearer ${secret}`), false);
    assert.equal(secretMatches("", ""), false);
    assert.equal(secretMatches(null, secret), false);
    assert.equal(secretMatches(secret, undefined), false);
  });

  it("no scheduler or admin route compares a secret with === or !==", () => {
    for (const route of ROUTES) {
      const src = readFileSync(route, "utf8");
      assert.match(src, /secretMatches\(/, route);
      assert.doesNotMatch(src, /[!=]==\s*`Bearer \$\{|[!=]==\s*(?:aiJobsSecret|workerSecret)\b/, `${route} compares a secret directly`);
    }
  });
});
