import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/upload-first/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("upload-first route wrapper response boundary", () => {
  it("returns a stable correlated failure without exception-derived fields", () => {
    assert.match(source, /code: "TENDER_INTAKE_FAILED"/);
    assert.match(source, /Tender intake could not be completed/);
    assert.match(source, /requestId/);
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:/);
    assert.doesNotMatch(source, /stack/);
    assert.doesNotMatch(source, /error\.message/);
  });

  it("keeps only request ID and error class in server diagnostics", () => {
    assert.match(source, /logger\.error\("\[upload-first route\] wrapper failure"/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(source, /extractRequestId\(req\)/);
  });

  it("preserves delegation to the canonical upload-first handler", () => {
    assert.match(source, /import\("\.\.\/\.\.\/\.\.\/\.\.\/lib\/tender-upload-first"\)/);
    assert.match(source, /return await handleUploadFirstTender\(req\)/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
