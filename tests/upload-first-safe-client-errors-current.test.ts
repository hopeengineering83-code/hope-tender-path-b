import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/tender-upload-first.ts", "utf8");

describe("upload-first public error safety", () => {
  it("does not expose raw storage exception messages and performs no request-time extraction", () => {
    assert.doesNotMatch(source, /storage failed — \$\{message\}/);
    assert.doesNotMatch(source, /text extraction failed — \$\{message\}/);
    assert.doesNotMatch(source, /const message = storageError instanceof Error \? storageError\.message/);
    assert.doesNotMatch(source, /const message = extractionError instanceof Error \? extractionError\.message/);
    assert.match(source, /secure storage is temporarily unavailable/);
    assert.doesNotMatch(source, /extractTextFromBuffer|extractionError/);
    assert.match(source, /WAIT_FOR_SOURCE_EXTRACTION/);
  });

  it("keeps exception detail only in server diagnostics", () => {
    assert.match(source, /logger\.error\("\[upload-first\] source storage failed"/);
    assert.match(source, /errorClass: storageError instanceof Error/);
    assert.doesNotMatch(source, /source extraction failed|extractionError/);
  });

  it("returns a stable final error with request ID and no raw detail field", () => {
    const catchStart = source.lastIndexOf("  } catch (error) {");
    const catchRegion = source.slice(catchStart);
    assert.match(catchRegion, /code: "TENDER_INTAKE_FAILED"/);
    assert.match(catchRegion, /requestId/);
    assert.match(catchRegion, /contact support with the request ID/);
    assert.doesNotMatch(catchRegion, /detail: message/);
    assert.doesNotMatch(catchRegion, /sanitizeError\(error\)/);
    assert.doesNotMatch(catchRegion, /error\.message/);
  });
});
