import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("Virtual Plan Safety — Route Check", () => {
  it("Generate route planOnly mode does not create GeneratedDocument rows", async () => {
    const routeContent = fs.readFileSync('app/api/tenders/[id]/generate/route.ts', 'utf8');

    // Check if the ensurePlannedGeneratedDocumentRecords was removed or bypassed
    assert.strictEqual(routeContent.includes('await ensurePlannedGeneratedDocumentRecords(id, plannedFiles)'), false,
      "Generate route must not call ensurePlannedGeneratedDocumentRecords in planOnly mode");

    assert.ok(routeContent.includes('status: "PLAN_APPROVED"'),
      "Generate route must update tender status to PLAN_APPROVED in planOnly mode");
  });
});
