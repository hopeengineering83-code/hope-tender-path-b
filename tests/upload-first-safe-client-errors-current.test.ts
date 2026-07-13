import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/tender-upload-first.ts", "utf8");

describe("upload-first public error safety", () => {
  it("does not expose raw storage or extraction exception messages", () => {
    assert.doesNotMatch(source, /storage failed — \$\{message\}/);
    assert.doesNotMatch(source, /text extraction failed — \$\{message\}/);
    assert.doesNotMatch(source, /const message = storageError instanceof Error \? storageError\.message/);
    assert.doesNotMatch(source, /const message = extractionError instanceof Error \? extractionError\.message/);
    assert.match(source, /secure storage is temporarily unavailable/);
    assert.match(source, /Run OCR or re-extraction/);
  });

  it("keeps exception detail only in server diagnostics", () => {
    assert.match(source, /logger\.error\("\[upload-first\] source storage failed"/);
    assert.match(source, /logger\.warn\("\[upload-first\] source extraction failed"/);
    assert.match(source, /errorClass: storageError instanceof Error/);
    assert.match(source, /errorClass: extractionError instanceof Error/);
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
