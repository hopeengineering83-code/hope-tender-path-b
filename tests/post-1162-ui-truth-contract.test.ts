import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-1162 UI truth contracts", () => {
  it("keeps every AI readiness field visible on mobile and table layouts scroll-safe", () => {
    const source = read("app/dashboard/admin/ai-readiness/page.tsx");

    assert.match(source, /className="space-y-4 md:hidden"/);
    assert.match(source, /className="hidden overflow-x-auto[^\"]*md:block"/);
    assert.match(source, /min-w-\[760px\]/);
    assert.match(source, />Severity<\/dt>/);
    assert.match(source, />Purpose<\/dt>/);
    assert.doesNotMatch(source, /<section className="overflow-hidden rounded-2xl border bg-white shadow-sm">/);
  });

  it("explains why runtime can be ready while recommended or optional variables are missing", () => {
    const source = read("app/dashboard/admin/ai-readiness/page.tsx");

    assert.match(source, /Ready means no critical runtime blocker is active/);
    assert.match(source, /Recommended or optional variables may still be missing/);
    assert.match(source, /Environment variable is missing/);
  });

  it("keeps the 404 action label aligned with its root destination", () => {
    const source = read("app/not-found.tsx");

    assert.match(source, /href="\/"/);
    assert.match(source, />\s*Return home\s*</);
    assert.doesNotMatch(source, /Return to dashboard/);
  });
});
