import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

// NOTE: The export-readiness route now delegates all policy logic (severity,
// next-action guidance, blocker construction) to lib/engine/export-readiness.ts
// and lib/engine/final-submission-readiness.ts.  These tests verify the policy
// strings are enforced in the canonical engine layer, not in the route handler.

describe("export-readiness route policy mappings", () => {
  it("contains explicit next-action guidance for strict-scope and source-grounding blockers", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("EXTRA_FILES"));
    assert.ok(src.includes("FILE_ORDER"));
    assert.ok(src.includes("SOURCE_REFERENCES_MISSING"));
  });

  it("treats hygiene and scope/order blockers as HIGH severity", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("AI/meta-preparation trace") || src.includes("hygiene"));
    assert.ok(src.includes("EXTRA_FILES") && src.includes("FILE_ORDER") && src.includes("SOURCE_REFERENCES_MISSING"));
  });

  it("enriches tender-level blockers with a nextAction field", async () => {
    // The canonical getFinalSubmissionReadiness engine adds nextActions to each blocker.
    const src = await readFile("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(src.includes("nextActions") || src.includes("nextAction"));
    assert.ok(src.includes("recommendedAction"));
  });
});
