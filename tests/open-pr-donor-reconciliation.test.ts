import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("open-PR donor UI reconciliation", () => {
  it("keeps Review Inbox blockers explanatory and actionable", () => {
    const source = read("app/dashboard/company/review/page.tsx");
    assert.match(source, /No experts on this page are eligible for review/);
    assert.match(source, /No projects on this page are eligible for review/);
    assert.match(source, /No source-verified experts on this page are eligible/);
    assert.match(source, /No source-verified projects on this page are eligible/);
    assert.match(source, /disabled:cursor-not-allowed/);
  });

  it("prevents compliance controls and tables from widening mobile pages", () => {
    const source = read("app/dashboard/compliance/compliance-dashboard.tsx");
    assert.match(source, /max-w-full min-w-0 rounded-lg border/);
    assert.match(source, /max-w-\[60ch\] truncate/);
    const tables = (source.match(/<table/g) ?? []).length;
    const wrappers = (source.match(/overflow-x-auto/g) ?? []).length;
    assert.ok(wrappers >= tables, `Expected at least ${tables} overflow wrappers, got ${wrappers}`);
  });

  it("uses an SVG component for NOT_APPLICABLE", () => {
    const source = read("lib/engine/canonical-readiness-state.ts");
    assert.match(source, /NOT_APPLICABLE:[\s\S]*createElement\(DashIcon\)/);
    assert.doesNotMatch(source, /NOT_APPLICABLE:[^\n]*icon:\s*"—"/);
  });
});

describe("open-PR donor asset reconciliation", () => {
  it("provides valid PNG signatures for both required PWA icons", () => {
    for (const path of ["public/icon-192.png", "public/icon-512.png"]) {
      const bytes = readFileSync(path);
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });
});
