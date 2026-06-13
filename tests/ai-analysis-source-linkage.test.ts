import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTenderFileSourceBlock, resolveRequirementSourceLinkage } from "../lib/ai-analysis-source-linkage";
import type { AIRequirement } from "../lib/ai";

const files = [
  { id: "file-a", fileName: "a.pdf", originalFileName: "Volume A.pdf", extractionMethod: "text" },
  { id: "file-b", fileName: "b.pdf", originalFileName: "Volume B.pdf", extractionMethod: "ocr", ocrPages: 2 },
];

function req(extra: Partial<AIRequirement> & Record<string, unknown>): AIRequirement {
  return {
    title: "Submission deadline",
    description: "Deadline must be followed",
    requirementType: "SUBMISSION",
    priority: "HIGH",
    ...extra,
  } as AIRequirement;
}

describe("AI analysis source linkage", () => {
  it("links an explicit sourceTenderFileId", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourceTenderFileId: "file-a", sourcePage: 12, sourceQuote: "Submit by 2:00 PM" }), files);
    assert.equal(linked.sourceTenderFileId, "file-a");
    assert.equal(linked.sourceExtractionMethod, "text");
    assert.equal(linked.warnings.length, 0);
    assert.ok(linked.sourceConfidence >= 0.85);
  });

  it("links a FILE_ID token", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourceFileToken: "[FILE_ID:file-b|FILE_NAME:Volume B.pdf]", sourcePage: 12 }), files);
    assert.equal(linked.sourceTenderFileId, "file-b");
    assert.equal(linked.sourceExtractionMethod, "ocr");
  });

  it("uses file name fallback when the name is unambiguous", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourceFileName: "Volume A.pdf", sourcePage: 3 }), files);
    assert.equal(linked.sourceTenderFileId, "file-a");
  });

  it("does not fabricate a link for ambiguous names", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourceFileName: "Volume A.pdf" }), [
      files[0],
      { id: "file-c", fileName: "copy.pdf", originalFileName: "Volume A.pdf" },
    ]);
    assert.equal(linked.sourceTenderFileId, null);
    assert.ok(linked.warnings.some((warning) => /ambiguous/i.test(warning)));
    assert.ok(linked.sourceConfidence < 0.5);
  });

  it("does not fabricate a link for missing source file references", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourcePage: 4 }), files);
    assert.equal(linked.sourceTenderFileId, null);
    assert.ok(linked.warnings.some((warning) => /missing/i.test(warning)));
  });

  it("does not fabricate a link for unresolved ids", () => {
    const linked = resolveRequirementSourceLinkage(req({ sourceFileId: "missing-file", sourcePage: 4 }), files);
    assert.equal(linked.sourceTenderFileId, null);
    assert.ok(linked.warnings.some((warning) => /unresolved/i.test(warning)));
  });

  it("builds stable FILE_ID tokens for prompts", () => {
    assert.equal(
      buildTenderFileSourceBlock(files),
      "[FILE_ID:file-a|FILE_NAME:Volume A.pdf]\n[FILE_ID:file-b|FILE_NAME:Volume B.pdf]",
    );
  });
});
