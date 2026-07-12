import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/final-package-readiness/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("final-package readiness fail-closed response boundary", () => {
  it("resolves tender ownership explicitly before building the readiness model", () => {
    const ownerPos = source.indexOf("prisma.tender.findFirst");
    const modelPos = source.indexOf("getFinalPackageReadinessModel(");
    assert.ok(ownerPos >= 0 && modelPos > ownerPos);
    assert.match(source, /where: \{ id, userId: actor\.id \}/);
    assert.match(source, /TENDER_NOT_FOUND/);
    assert.match(source, /status: 404/);
  });

  it("does not derive status or public error text from exception messages", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /\/not found\/i\.test/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message)/);
    assert.match(source, /FINAL_PACKAGE_READINESS_FAILED/);
    assert.match(source, /Final package readiness could not be evaluated/);
    assert.match(source, /requestId/);
  });

  it("keeps correlated diagnostics server-side", () => {
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /final-package-readiness GET failed/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("preserves no-store readiness responses and contradiction reporting", () => {
    assert.match(source, /Cache-Control": "no-store/);
    assert.match(source, /Required docs count differs between plan and final package model/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
