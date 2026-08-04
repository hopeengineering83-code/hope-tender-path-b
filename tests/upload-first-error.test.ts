import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/upload-first/route.ts"), "utf8");

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

  it("preserves canonical delegation and adds only the automatic extraction wake", () => {
    assert.match(source, /import\("\.\.\/\.\.\/\.\.\/\.\.\/lib\/tender-upload-first"\)/);
    assert.match(source, /const response = await handleUploadFirstTender\(req\)/);
    assert.match(source, /pipelineStage === "EXTRACT_TEXT_QUEUED"/);
    assert.match(source, /scheduleRequestScopedWorkerWake\(req, "EXTRACT_TEXT", payload\.queuedExtractionFiles \?\? 1\)/);
    assert.match(source, /return response/);
    assert.doesNotMatch(source, /AI_ANALYZE|ENGINE_RUN/);
  });
});
