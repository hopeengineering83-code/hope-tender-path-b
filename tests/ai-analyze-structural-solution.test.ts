import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

describe("AI Analyze Structural Solution — Types and Prompts", () => {
  const aiSource = readFileSync("lib/ai.ts", "utf8");
  const typesSource = readFileSync("lib/engine/types.ts", "utf8");

  it("AIRequirement type in lib/ai.ts includes sourceSectionHeading", () => {
    assert.match(aiSource, /sourceSectionHeading\?:\s*string\s*\|\s*null/);
  });

  it("AIAnalysisResult type in lib/ai.ts includes tenderTitle", () => {
    assert.match(aiSource, /tenderTitle\?:\s*string\s*\|\s*null/);
  });

  it("RequirementDraft type in lib/engine/types.ts includes sourceSectionHeading", () => {
    assert.match(typesSource, /sourceSectionHeading\?:\s*string\s*\|\s*null/);
  });

  it("AI Analyze prompt includes sourceSectionHeading in requirements", () => {
    assert.match(aiSource, /"sourceSectionHeading":\s*"copy the exact section heading/);
  });

  it("AI Analyze prompt includes tenderTitle at root", () => {
    assert.match(aiSource, /"tenderTitle":\s*"The full official title/);
  });

  it("AI Analyze sanitization handles sourceSectionHeading", () => {
    assert.match(aiSource, /sourceSectionHeading:\s*typeof\s*r\.sourceSectionHeading\s*===\s*"string"/);
  });

  it("AI Analyze sanitization handles tenderTitle", () => {
    assert.match(aiSource, /tenderTitle:\s*typeof\s*parsed\.tenderTitle\s*===\s*"string"/);
  });
});

describe("AI Analyze Structural Solution — Merging Logic", () => {
  const aiSource = readFileSync("lib/ai.ts", "utf8");

  it("mergeAnalysisResults picks tenderTitle using firstDefined", () => {
    assert.match(aiSource, /const\s+tenderTitle\s*=\s*firstDefined\(\(p\)\s*=>\s*p\.tenderTitle\s*\?\?\s*undefined\)/);
  });

  it("mergeAnalysisResults includes sourceSectionHeading in requirement source check", () => {
    assert.match(aiSource, /candidateHasSource\s*=\s*Boolean\(.*req\.sourceSectionHeading\)/);
  });

  it("mergeAnalysisResults returns tenderTitle in result object", () => {
    assert.match(aiSource, /tenderTitle:\s*tenderTitle\s*\?\?\s*null/);
  });
});

describe("AI Analyze Structural Solution — Route Integration", () => {
  const routeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("route updates tender record with tenderTitle", () => {
    assert.match(routeSource, /title:\s*aiResult\.tenderTitle\s*\|\|\s*tenderRecord\.title/);
  });

  it("route persists sourceSectionHeading to requirements", () => {
    assert.match(routeSource, /sourceSectionHeading:\s*req\.sourceSectionHeading\s*\|\|\s*req\.sectionReference\s*\|\|\s*null/);
  });

  it("route includes textSamples in deriveExtractionStatus call", () => {
    assert.match(routeSource, /const\s+textSamples\s*=\s*tenderRecord\.files\.map\(f\s*=>\s*f\.extractedText\)/);
    assert.match(routeSource, /deriveExtractionStatus\(fileQualitySnapshots,\s*textSamples\)/);
  });

  it("route has pre-check for extraction corruption", () => {
    assert.match(routeSource, /const\s+extractionCorrupted\s*=\s*tenderRecord\.files\.some\(f\s*=>\s*f\.extractedText\s*&&\s*isExtractionCorrupted\(f\.extractedText\)\)/);
    assert.match(routeSource, /analysisExtractionStatus:\s*"EXTRACTION_CORRUPTED_AI_SKIPPED"/);
  });
});
