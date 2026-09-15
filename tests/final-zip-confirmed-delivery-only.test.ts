import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");

test("final ZIP candidates are exact confirmed deliveries, not retained conversion sources", () => {
  assert.match(route, /const plannedDeliveryNames = new Set\([\s\S]*?finalBuildPlan\.items\.map/);
  assert.match(route, /const isConfirmedDelivery = \(doc: any\)/);
  assert.match(route, /filterFinalExportCandidateDocuments\(tender\.generatedDocuments as any\[\]\)[\s\S]*?isConfirmedDelivery\(d\)/);
});
