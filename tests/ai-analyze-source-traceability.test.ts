import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// Verifies the source-traceability code extracted from PR #796 (verbatim
// tender title + per-requirement section heading) is wired through the
// AI types, prompt, sanitization, merge logic, and persistence route.
// These directly support CLAUDE.md's source-traceability requirement
// (file → page → section heading → quote for every requirement).

describe("AI Analyze source traceability — types & prompt (lib/ai.ts)", () => {
  const aiSource = readFileSync("lib/ai.ts", "utf8");

  it("AIRequirement includes sourceSectionHeading", () => {
    assert.match(aiSource, /sourceSectionHeading\?:\s*string\s*\|\s*null/);
  });

  it("AIAnalysisResult includes tenderTitle", () => {
    assert.match(aiSource, /tenderTitle\?:\s*string\s*\|\s*null/);
  });

  it("prompt asks for verbatim tenderTitle at root", () => {
    assert.match(aiSource, /"tenderTitle":\s*"The full official title/);
  });

  it("prompt asks for sourceSectionHeading per requirement", () => {
    assert.match(aiSource, /"sourceSectionHeading":\s*"copy the exact section heading/);
  });

  it("sanitization handles tenderTitle (string, trimmed, capped)", () => {
    assert.match(aiSource, /tenderTitle:\s*typeof\s*parsed\.tenderTitle\s*===\s*"string"/);
  });

  it("sanitization handles sourceSectionHeading (string, trimmed, capped)", () => {
    assert.match(aiSource, /sourceSectionHeading:\s*typeof\s*r\.sourceSectionHeading\s*===\s*"string"/);
  });
});

describe("AI Analyze source traceability — merge logic (lib/ai.ts)", () => {
  const aiSource = readFileSync("lib/ai.ts", "utf8");

  it("mergeAnalysisResults selects tenderTitle via firstDefined", () => {
    assert.match(aiSource, /const\s+tenderTitle\s*=\s*firstDefined\(\(p\)\s*=>\s*p\.tenderTitle\s*\?\?\s*undefined\)/);
  });

  it("merge source-presence check counts sourceSectionHeading", () => {
    assert.match(aiSource, /candidateHasSource\s*=\s*Boolean\([^)]*req\.sourceSectionHeading\)/);
  });

  it("mergeAnalysisResults returns tenderTitle in result", () => {
    assert.match(aiSource, /tenderTitle:\s*tenderTitle\s*\?\?\s*null/);
  });
});

describe("AI Analyze source traceability — persistence route", () => {
  const routeSource = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
  const builderSource = readFileSync("lib/engine/canonical-analysis-update.ts", "utf8");

  it("persists verbatim tenderTitle to the tender (placeholder-guarded, in the shared builder)", () => {
    // The tenderTitle persistence now lives in the shared canonical builder used
    // by all analysis paths, not inline per-route.
    assert.match(builderSource, /aiResult\.tenderTitle\s*&&\s*!containsMetadataPlaceholder\(aiResult\.tenderTitle\)\s*\?\s*\{\s*title:\s*aiResult\.tenderTitle\s*\}/);
  });

  it("persists tenderTitle in BOTH the streaming and non-streaming paths (parity via shared builder)", () => {
    // Regression: the non-streaming AI Analyze path used to silently drop
    // aiResult.tenderTitle. Both promotion paths now route through the single
    // shared builder (which always writes the title), so the invariant holds
    // as long as both paths call buildCanonicalAnalysisTenderUpdate. The builder
    // writes the title exactly once; both route paths must invoke it.
    const builderTitleWrites = builderSource.match(
      /aiResult\.tenderTitle\s*&&\s*!containsMetadataPlaceholder\(aiResult\.tenderTitle\)\s*\?\s*\{\s*title:\s*aiResult\.tenderTitle\s*\}/g,
    );
    assert.ok(builderTitleWrites && builderTitleWrites.length >= 1, "shared builder must persist tenderTitle");
    const builderCalls = routeSource.match(/buildCanonicalAnalysisTenderUpdate\(/g) ?? [];
    assert.ok(
      builderCalls.length >= 2,
      `both AI Analyze paths must promote via the shared builder (which persists tenderTitle), found ${builderCalls.length} call(s)`,
    );
  });

  it("persists sourceSectionHeading preferring AI heading over section reference", () => {
    assert.match(routeSource, /sourceSectionHeading:\s*req\.sourceSectionHeading\s*\|\|\s*req\.sectionReference\s*\|\|\s*null/);
  });

  it("passes text samples to deriveExtractionStatus for corruption detection", () => {
    assert.match(routeSource, /const\s+textSamples\s*=\s*tenderRecord\.files\.map\(\(f\)\s*=>\s*f\.extractedText\)/);
    assert.match(routeSource, /deriveExtractionStatus\(fileQualitySnapshots,\s*textSamples\)/);
  });

  it("emits real per-chunk progress (no estimated timer)", () => {
    assert.match(routeSource, /Starting analysis of chunk/);
    assert.match(routeSource, /Completed chunk/);
    // The fake estimated-progress timer must be gone.
    assert.doesNotMatch(routeSource, /estimatedChunksDone/);
  });
});
