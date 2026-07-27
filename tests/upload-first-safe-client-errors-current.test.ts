import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/background-tender-upload.ts", "utf8");
const compatibilityEntrypoint = readFileSync("lib/tender-upload-first.ts", "utf8");

describe("upload-first public error safety and request-bounded work", () => {
  it("keeps extraction and OCR out of the upload request", () => {
    assert.doesNotMatch(source, /extractTextFromBuffer/);
    assert.doesNotMatch(source, /assessExtractionQuality/);
    assert.match(source, /enqueueTenderFileExtractionJob/);
    assert.match(source, /SOURCE_EXTRACTION_QUEUED/);
  });

  it("does not expose raw storage or worker exception messages", () => {
    assert.match(source, /secure storage is temporarily unavailable/);
    assert.doesNotMatch(source, /storageError\.message/);
    assert.doesNotMatch(source, /error\.message/);
    assert.doesNotMatch(source, /sanitizeError\(error\)/);
  });

  it("keeps exception detail only in correlated server diagnostics", () => {
    assert.match(source, /logger\.error\("\[upload-first\] source storage failed"/);
    assert.match(source, /errorClass: storageError instanceof Error/);
    assert.match(source, /requestId/);
  });

  it("returns one stable final error with request ID", () => {
    const catchStart = source.lastIndexOf("  } catch (error) {");
    const catchRegion = source.slice(catchStart);
    assert.match(catchRegion, /code: "TENDER_INTAKE_FAILED"/);
    assert.match(catchRegion, /requestId/);
    assert.match(catchRegion, /contact support with the request ID/);
    assert.doesNotMatch(catchRegion, /detail:/);
  });

  it("keeps the historical module as a compatibility entrypoint only", () => {
    assert.match(compatibilityEntrypoint, /export \{ handleUploadFirstTender \} from "\.\/background-tender-upload"/);
    assert.doesNotMatch(compatibilityEntrypoint, /extractTextFromBuffer/);
  });
});
