import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/tenders/[id]/export-readiness/route.ts", "utf8");

test("export readiness reports confirmed delivery candidates, not retained editable sources", () => {
  assert.match(route, /const deliveryReadyDocumentsTotal = finalPackage\.documents\.exportReady\.filter\([\s\S]*?document\.exportCandidate,[\s\S]*?\)\.length;/);
  assert.equal((route.match(/exportReadyDocumentsTotal: deliveryReadyDocumentsTotal/g) ?? []).length, 2);
  assert.doesNotMatch(route, /exportReadyDocumentsTotal: finalPackage\.documents\.exportReady\.length/);
});
