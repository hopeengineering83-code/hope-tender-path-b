import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/reconcile-state/route.ts", "utf8");

describe("reconcile-state preserves independent extraction-quality truth", () => {
  it("may reconcile workflow status but never promotes extraction quality to FULL", () => {
    assert.match(source, /analysisInfo\.state\s*===\s*"AI_SUCCEEDED"/);
    assert.match(source, /status\s*=\s*analysisInfo\.state/);
    assert.equal(source.includes('analysisExtractionStatus = "FULL_EXTRACTION_AI_ANALYZED"'), false);
    assert.equal(source.includes('analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED"'), false);
  });
});
