import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const tenderRoute = readFileSync("app/api/tenders/route.ts", "utf8");
const uploadFirst = readFileSync("lib/tender-upload-first.ts", "utf8");
const reportPage = readFileSync("app/dashboard/tenders/[id]/report/page.tsx", "utf8");

describe("tender currency does not default to USD", () => {
  it("manual tender creation persists unresolved currency as null", () => {
    assert.doesNotMatch(tenderRoute, /currency: body\.currency \|\| "USD"/);
    assert.match(tenderRoute, /currency: body\.currency \|\| null/);
  });

  it("upload-first tender creation persists unresolved extracted currency as null", () => {
    assert.doesNotMatch(uploadFirst, /currency: metadata\.currency \|\| "USD"/);
    assert.match(uploadFirst, /currency: metadata\.currency \?\? null/);
  });

  it("report page treats missing currency as unresolved instead of displaying USD", () => {
    assert.match(reportPage, /const isCurrencyAbsent = !tender\.currency/);
    assert.match(reportPage, /\? "Not extracted"/);
    assert.doesNotMatch(reportPage, /tender\.currency \|\| "USD"/);
  });
});
