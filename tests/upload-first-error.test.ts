import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/upload-first/route.ts", "utf8");

describe("upload-first route wrapper fail-closed errors", () => {
  it("returns one stable correlated error contract", () => {
    assert.match(source, /code: "TENDER_INTAKE_FAILED"/);
    assert.match(source, /Tender intake could not be completed/);
    assert.match(source, /requestId/);
    assert.match(source, /status: 500/);
  });

  it("does not return exception-derived diagnostic fields", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /\bdetail\s*:/);
    assert.doesNotMatch(source, /\bhint\s*:/);
    assert.doesNotMatch(source, /\bstack\s*:/);
    assert.doesNotMatch(source, /body\.stack/);
    assert.doesNotMatch(source, /error\.message/);
    assert.doesNotMatch(source, /String\(error\)/);
  });

  it("keeps diagnostics server-side and correlated", () => {
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /logger\.error\("\[upload-first route\] wrapper failure"/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("preserves delegation to the canonical upload-first handler", () => {
    assert.match(source, /import\("\.\.\/\.\.\/\.\.\/\.\.\/lib\/tender-upload-first"\)/);
    assert.match(source, /return await handleUploadFirstTender\(req\)/);
  });
});
