import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTenderFileSourceHeader,
  enrichRequirementsWithSourceLinkage,
  resolveRequirementSourceFile,
  tenderFileSourceToken,
} from "../lib/ai-source-linkage";

const files = [
  {
    id: "file-a",
    fileName: "stored-a.pdf",
    originalFileName: "Instructions.pdf",
    extractedText: "Submit the technical proposal by noon.",
    extractionMethod: "text",
    ocrPages: 0,
  },
  {
    id: "file-b",
    fileName: "stored-b.pdf",
    originalFileName: "Pricing.pdf",
    extractedText: "Submit the financial proposal separately.",
    extractionMethod: "ocr",
    ocrPages: 2,
  },
];

test("source header exposes a stable file token and original name", () => {
  assert.equal(tenderFileSourceToken("file-a"), "TFILE:file-a");
  assert.match(buildTenderFileSourceHeader(files[0]), /TOKEN=TFILE:file-a/);
  assert.match(buildTenderFileSourceHeader(files[0]), /ID=file-a/);
});

test("exact tokens resolve files independently when page numbers overlap", () => {
  const a = resolveRequirementSourceFile({ sourceTenderFileId: null, sourceFileToken: "TFILE:file-a", sourceFileName: null, sourceQuote: "Submit the technical proposal by noon.", sourcePage: 12 }, files);
  const b = resolveRequirementSourceFile({ sourceTenderFileId: null, sourceFileToken: "TFILE:file-b", sourceFileName: null, sourceQuote: "Submit the financial proposal separately.", sourcePage: 12 }, files);
  assert.equal(a.sourceTenderFileId, "file-a");
  assert.equal(b.sourceTenderFileId, "file-b");
  assert.equal(b.sourceExtractionMethod, "ocr");
});

test("ambiguous duplicate names never fabricate a file id", () => {
  const duplicateFiles = [...files, { id: "file-c", fileName: "copy.pdf", originalFileName: "Instructions.pdf", extractedText: "Different text", extractionMethod: "text", ocrPages: 0 }];
  const result = resolveRequirementSourceFile({ sourceTenderFileId: null, sourceFileToken: null, sourceFileName: "Instructions.pdf", sourceQuote: null, sourcePage: 2 }, duplicateFiles);
  assert.equal(result.sourceTenderFileId, null);
  assert.ok(result.sourceConfidence <= 0.2);
  assert.match(result.sourceLinkageWarning ?? "", /ambiguous/i);
});

test("unique source quote recovers linkage but missing quote remains unresolved", () => {
  const linked = resolveRequirementSourceFile({ sourceTenderFileId: null, sourceFileToken: null, sourceFileName: null, sourceQuote: "Submit the financial proposal separately.", sourcePage: 4 }, files);
  assert.equal(linked.sourceTenderFileId, "file-b");
  const missing = resolveRequirementSourceFile({ sourceTenderFileId: null, sourceFileToken: null, sourceFileName: null, sourceQuote: "This quote does not exist in any tender file.", sourcePage: 4 }, files);
  assert.equal(missing.sourceTenderFileId, null);
  assert.ok(missing.sourceConfidence <= 0.3);
});

test("enrichment persists file id, method, and confidence", () => {
  const enriched = enrichRequirementsWithSourceLinkage([{ title: "Separate financial proposal", description: "Financial offer must be separate.", requirementType: "FINANCIAL", priority: "MANDATORY", sourceFileToken: "TFILE:file-b", sourceFileName: "Pricing.pdf", sourcePage: 12, sourceQuote: "Submit the financial proposal separately." }], files);
  assert.equal(enriched[0].sourceTenderFileId, "file-b");
  assert.equal(enriched[0].sourceExtractionMethod, "ocr");
  assert.ok((enriched[0].sourceConfidence ?? 0) > 0.9);
});
