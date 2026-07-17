import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("post-1162 UI truth and responsive contracts", () => {
  it("shows every AI readiness field in grouped mobile cards", () => {
    const page = source("app/dashboard/admin/ai-readiness/page.tsx");

    assert.match(page, /aria-label="Environment variables by scope"/);
    assert.match(page, /<dt[^>]*>Scope<\/dt>/);
    assert.match(page, /<dt[^>]*>Severity<\/dt>/);
    assert.match(page, /<dt[^>]*>Purpose<\/dt>/);
    assert.match(page, /md:hidden/);
    assert.match(page, /hidden overflow-x-auto[^\n]*md:block/);
  });

  it("does not label planned and empty document workspaces as generated", () => {
    const page = source("app/dashboard/documents/page.tsx");

    assert.doesNotMatch(page, />Generated Documents<\/h1>/);
    assert.match(page, />Proposal Documents<\/h1>/);
    assert.match(page, /No proposal document workspaces are available yet/);
  });

  it("labels root links as home navigation", () => {
    for (const path of ["app/not-found.tsx", "app/error.tsx"]) {
      const page = source(path);
      assert.match(page, /href="\/"/);
      assert.match(page, /Return home/);
      assert.doesNotMatch(page, /Return to dashboard/);
    }
  });
});
