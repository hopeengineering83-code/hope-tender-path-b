// Stage 1 of execution-path unification: prove the synchronous AI Analyze route
// and the durable job service now build IDENTICAL analysis content + hash from
// the same shared builder, so their AiAnalyzeChunk rows share one identity.
//
// The earlier consolidation attempt was reverted because the route hashed a
// sophisticated 16-char content hash while the job service hashed a full
// sha256 of raw extractedText — producing disjoint chunk rows. These tests lock
// the shared builder's determinism and the single-source wiring.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
  MAX_TOTAL_AI_CHARS,
} from "../lib/engine/tender-analysis-content";

const file = (over: Partial<{ id: string; originalFileName: string; extractedText: string | null; classification: string | null; createdAt: Date }> = {}) => ({
  id: over.id ?? "f1",
  originalFileName: over.originalFileName ?? "tender.pdf",
  extractedText: over.extractedText ?? "Submission deadline 2026-12-31. Evaluation criteria: technical 70%.",
  classification: over.classification ?? null,
  createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00Z"),
});

describe("buildTenderAnalysisContent — deterministic + canonical", () => {
  it("includes FILE_ID markers and the tender title", () => {
    const content = buildTenderAnalysisContent({ title: "Alpha Bridge", files: [file()] });
    assert.match(content, /TENDER: Alpha Bridge/);
    assert.match(content, /\[FILE_ID:f1\|FILE_NAME:tender\.pdf\]/);
  });

  it("produces identical content regardless of input file order (canonical sort)", () => {
    const a = file({ id: "a", createdAt: new Date("2026-01-01T00:00:00Z") });
    const b = file({ id: "b", createdAt: new Date("2026-02-01T00:00:00Z") });
    const c1 = buildTenderAnalysisContent({ title: "T", files: [a, b] });
    const c2 = buildTenderAnalysisContent({ title: "T", files: [b, a] });
    assert.equal(c1, c2, "file order must not change the built content");
    assert.equal(computeAnalysisContentHash(c1), computeAnalysisContentHash(c2));
  });

  it("the company-document digest changes the hash when vault content changes", () => {
    const tender = { title: "T", files: [file()] };
    const h0 = computeAnalysisContentHash(buildTenderAnalysisContent(tender));
    const hWithDocs = computeAnalysisContentHash(buildTenderAnalysisContent(tender, {
      documents: [{ originalFileName: "cv.pdf", category: "CV", extractedText: "expert profile" }],
    }));
    assert.notEqual(h0, hWithDocs);
  });

  it("content hash is the 16-char truncated sha256 scheme", () => {
    const h = computeAnalysisContentHash("abc");
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  it("caps content at MAX_TOTAL_AI_CHARS", () => {
    const huge = "x".repeat(MAX_TOTAL_AI_CHARS + 50_000);
    const content = buildTenderAnalysisContent({ title: "T", files: [file({ extractedText: huge })] });
    assert.ok(content.length <= MAX_TOTAL_AI_CHARS);
  });
});

describe("both execution paths wire the shared builder (single source of truth)", () => {
  it("the AI Analyze route uses buildTenderAnalysisContent + computeAnalysisContentHash", () => {
    const route = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    // Both paths build from the tender record's ACTIVE files + the company vault,
    // matching the input set the snapshot/gate recompute the hash from.
    const builds = (route.match(/buildTenderAnalysisContent\(\s*\{ \.\.\.tenderRecord, files:[\s\S]*?company,\s*\)/g) ?? []).length;
    assert.ok(builds >= 2, `both route paths must use the shared builder with ACTIVE files + company (found ${builds})`);
    assert.match(route, /computeAnalysisContentHash\(tenderContent\)/);
    // The old inline builders/hashing must be gone.
    assert.doesNotMatch(route, /crypto\.createHash\("sha256"\)\.update\(tenderContent\)/);
  });

  it("the durable job service uses the shared builder + hash", () => {
    const svc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(svc, /buildTenderAnalysisContent\(tender, company\)/);
    assert.match(svc, /computeAnalysisContentHash\(tenderText\)/);
    // The old raw-text full-sha256 scheme must be gone.
    assert.doesNotMatch(svc, /createHash\("sha256"\)\.update\(normalizedText\)/);
  });
});
