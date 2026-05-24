import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

describe("export-readiness route policy mappings", () => {
  it("contains explicit next-action guidance for strict-scope and source-grounding blockers", async () => {
    const src = await readFile("app/api/tenders/[id]/export-readiness/route.ts", "utf8");
    assert.ok(src.includes("EXTRA_FILES"));
    assert.ok(src.includes("FILE_ORDER"));
    assert.ok(src.includes("SOURCE_REFERENCES_MISSING"));
  });

  it("treats hygiene and scope/order blockers as HIGH severity", async () => {
    const src = await readFile("app/api/tenders/[id]/export-readiness/route.ts", "utf8");
    assert.ok(/AI\\\/meta-preparation trace/.test(src));
    assert.ok(/Placeholder\|pricing language/.test(src));
    assert.ok(/EXTRA_FILES\|FILE_ORDER\|SOURCE_REFERENCES_MISSING/.test(src));
  });

  it("enriches tender-level blockers with a nextAction field", async () => {
    const src = await readFile("app/api/tenders/[id]/export-readiness/route.ts", "utf8");
    assert.ok(src.includes("nextAction: blocker.recommendedAction"));
  });
});
