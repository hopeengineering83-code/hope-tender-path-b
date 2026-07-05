import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { formatTenderFileAnalysisMarker, resolveRequirementSource } from "../lib/engine/requirement-source-linkage";

const files = [
  {
    id: "file-a",
    tenderId: "tender-1",
    originalFileName: "Instructions.pdf",
    fileName: "stored-a.pdf",
    extractedText: "Page 12. The technical proposal must be submitted in one original and two copies.",
    extractionMethod: "text",
  },
  {
    id: "file-b",
    tenderId: "tender-1",
    originalFileName: "Annexes.pdf",
    fileName: "stored-b.pdf",
    extractedText: "Page 12. The financial proposal must be enclosed in a separate sealed envelope.",
    extractionMethod: "ocr",
  },
];

describe("resolveRequirementSource", () => {
  it("resolves the correct file when two files use the same page number", () => {
    const result = resolveRequirementSource({
      tenderId: "tender-1",
      sourcePageNumber: 12,
      sourceExactQuote: "The financial proposal must be enclosed in a separate sealed envelope.",
    }, files);
    assert.equal(result.status, "RESOLVED");
    assert.equal(result.sourceTenderFileId, "file-b");
    assert.equal(result.sourceExtractionMethod, "ocr");
    assert.equal(result.sourceConfidence, 0.95);
  });

  it("resolves a unique normalized source filename", () => {
    const result = resolveRequirementSource({
      tenderId: "tender-1",
      sourceFileName: "ANNEXES.PDF",
      sourcePageNumber: 12,
    }, files);
    assert.equal(result.sourceTenderFileId, "file-b");
  });

  it("does not fabricate a file id for duplicate filenames", () => {
    const result = resolveRequirementSource({
      tenderId: "tender-1",
      sourceFileName: "Instructions.pdf",
      sourcePageNumber: 12,
      sourceConfidence: 0.9,
    }, [...files, { ...files[0], id: "file-c" }]);
    assert.equal(result.status, "AMBIGUOUS");
    assert.equal(result.sourceTenderFileId, null);
    assert.ok(result.sourceConfidence <= 0.45);
  });

  it("rejects an explicit file id from another tender", () => {
    const result = resolveRequirementSource({
      tenderId: "tender-1",
      sourceTenderFileId: "foreign-file",
      sourceExactQuote: "The financial proposal must be enclosed in a separate sealed envelope.",
    }, [...files, { ...files[0], id: "foreign-file", tenderId: "tender-2" }]);
    assert.equal(result.status, "INVALID_EXPLICIT_ID");
    assert.equal(result.sourceTenderFileId, null);
  });

  it("keeps missing provenance low-confidence", () => {
    const result = resolveRequirementSource({
      tenderId: "tender-1",
      sourcePageNumber: 99,
      sourceExactQuote: "This wording is not present in any uploaded tender file.",
      sourceConfidence: 0.8,
    }, files);
    assert.equal(result.status, "MISSING");
    assert.equal(result.sourceTenderFileId, null);
    assert.ok(result.sourceConfidence <= 0.45);
  });
});

describe("formatTenderFileAnalysisMarker", () => {
  it("includes a stable database id and original filename", () => {
    assert.equal(
      formatTenderFileAnalysisMarker(files[0]),
      "[FILE_ID:file-a|FILE_NAME:Instructions.pdf]",
    );
  });
});
