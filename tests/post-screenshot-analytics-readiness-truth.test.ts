import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const layout = readFileSync("app/dashboard/analytics/layout.tsx", "utf8");
const page = readFileSync("app/dashboard/analytics/page.tsx", "utf8");

describe("screenshot-driven analytics readiness truth", () => {
  it("states that legacy readiness percentages are not final-package authority", () => {
    assert.match(layout, /Readiness score interpretation/);
    assert.match(layout, /legacy workflow-completion scores/);
    assert.match(layout, /A score of 100% does not mean the final submission package is ready/);
    assert.match(layout, /canonical final-package status, blockers, and export-readiness checks/);
  });

  it("provides a direct path to the canonical tender workspaces", () => {
    assert.match(layout, /href="\/dashboard\/tenders"/);
    assert.match(layout, /Open tender workspaces/);
    assert.match(layout, /aria-label="Analytics score interpretation"/);
  });

  it("does not silently treat the stored readinessScore column as canonical final readiness", () => {
    assert.match(page, /readinessScore: true/);
    assert.match(page, /Avg Readiness Score/);
    assert.match(layout, /does not mean the final submission package is ready, approved, or exportable/);
  });
});
