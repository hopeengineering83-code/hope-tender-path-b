import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const tenderRoute = readFileSync("app/api/tenders/route.ts", "utf8");
const uploadFirst = readFileSync("lib/tender-upload-first.ts", "utf8");
const reportPage = readFileSync("app/dashboard/tenders/[id]/report/page.tsx", "utf8");
const matchingEngine = readFileSync("lib/engine/matching.ts", "utf8");
const companyPage = readFileSync("app/dashboard/company/page.tsx", "utf8");
const financialRecordsRoute = readFileSync("app/api/company/financial-records/route.ts", "utf8");

describe("tender currency does not default to USD", () => {
  it("manual tender creation persists unresolved currency as null", () => {
    assert.doesNotMatch(tenderRoute, /currency: body\.currency \|\| "USD"/);
    assert.match(tenderRoute, /currency: body\.currency \|\| null/);
  });

  it("upload-first tender creation persists unresolved extracted currency as null", () => {
    assert.doesNotMatch(uploadFirst, /currency: metadata\.currency \|\| "USD"/);
    assert.match(uploadFirst, /currency: metadata\.currency \?\? null/);
  });

  it("matching rationale does not default project contract currency to USD", () => {
    assert.doesNotMatch(matchingEngine, /project\.currency \?\? "USD"/);
    assert.match(matchingEngine, /project\.currency\?\.trim\(\) \? project\.currency : "Currency unresolved"/);
  });


  it("company project and financial forms preserve unresolved currency instead of defaulting to USD", () => {
    assert.doesNotMatch(companyPage, /currency:\"USD\"/);
    assert.doesNotMatch(companyPage, /currency:p\.currency\?\?\"USD\"/);
    assert.match(companyPage, /<option value=\"\">Currency unresolved<\/option>/);
    assert.doesNotMatch(financialRecordsRoute, /currency: body\.currency \? str\(body\.currency, 10\) : \"USD\"/);
    assert.match(financialRecordsRoute, /currency: body\.currency \? str\(body\.currency, 10\) : null/);
  });

  it("report page treats missing currency as unresolved instead of displaying USD", () => {
    assert.match(reportPage, /const isCurrencyAbsent = !tender\.currency/);
    assert.match(reportPage, /\? "Not extracted"/);
    assert.doesNotMatch(reportPage, /tender\.currency \|\| "USD"/);
  });
});
