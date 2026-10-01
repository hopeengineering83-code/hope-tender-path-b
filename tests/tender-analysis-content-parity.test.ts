// Prove every analysis authority builds identical content and a full SHA-256
// source revision from the same shared builder.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
  computePersistedTenderAnalysisHash,
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

  it("produces identical content regardless of input file order", () => {
    const a = file({ id: "a", createdAt: new Date("2026-01-01T00:00:00Z") });
    const b = file({ id: "b", createdAt: new Date("2026-02-01T00:00:00Z") });
    const c1 = buildTenderAnalysisContent({ title: "T", files: [a, b] });
    const c2 = buildTenderAnalysisContent({ title: "T", files: [b, a] });
    assert.equal(c1, c2, "file order must not change the built content");
    assert.equal(computeAnalysisContentHash(c1), computeAnalysisContentHash(c2));
  });

  it("changes the revision when Company Vault content changes", () => {
    const tender = { title: "T", files: [file()] };
    const h0 = computeAnalysisContentHash(buildTenderAnalysisContent(tender));
    const hWithDocs = computeAnalysisContentHash(buildTenderAnalysisContent(tender, {
      documents: [{ originalFileName: "cv.pdf", category: "CV", extractedText: "expert profile" }],
    }));
    assert.notEqual(h0, hWithDocs);
  });

  it("keeps the persisted currentness binding tender-source-only", async () => {
    let companyRead = false;
    const tender = { title: "T", description: null, intakeSummary: null, files: [file()] };
    const store = {
      tender: { findFirst: async () => tender },
      company: { findUnique: async () => { companyRead = true; return { documents: [] }; } },
    };
    const hash = await computePersistedTenderAnalysisHash(store, "tender-1", "user-1");
    assert.equal(hash, computeAnalysisContentHash(buildTenderAnalysisContent(tender)));
    assert.equal(companyRead, false, "Run Engine Vault verification must not stale tender analysis");
  });

  it("uses a collision-resistant full SHA-256 revision", () => {
    const hash = computeAnalysisContentHash("abc");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, computeAnalysisContentHash("abc"));
    assert.notEqual(hash, computeAnalysisContentHash("abcd"));
  });

  it("caps content at MAX_TOTAL_AI_CHARS", () => {
    const huge = "x".repeat(MAX_TOTAL_AI_CHARS + 50_000);
    const content = buildTenderAnalysisContent({ title: "T", files: [file({ extractedText: huge })] });
    assert.ok(content.length <= MAX_TOTAL_AI_CHARS);
  });
});

describe("every analysis authority wires the shared builder", () => {
  it("the AI Analyze route uses the canonical builder and hash", () => {
    const route = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    const builds = (route.match(/buildTenderAnalysisContent\(\s*\{ \.\.\.tenderRecord, files:[\s\S]*?company,\s*\)/g) ?? []).length;
    assert.ok(builds >= 2, `both route paths must use active files plus Company Vault content (found ${builds})`);
    assert.match(route, /computeAnalysisContentHash\(tenderContent\)/);
    assert.doesNotMatch(route, /crypto\.createHash\("sha256"\)\.update\(tenderContent\)/);
  });

  it("the durable job service uses the canonical builder and hash", () => {
    const service = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(service, /buildTenderAnalysisContent\(\s*\{ \.\.\.tender, files:[\s\S]*?company,\s*\)/);
    assert.match(service, /computeAnalysisContentHash\(tenderText\)/);
    assert.doesNotMatch(service, /createHash\("sha256"\)\.update\(normalizedText\)/);
    assert.doesNotMatch(service, /originalFileName: true, extractedText: true \}, take:/);
  });

  it("release readiness recomputes the same canonical revision", () => {
    const snapshot = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");
    assert.match(snapshot, /buildTenderAnalysisContent/);
    assert.match(snapshot, /computeAnalysisContentHash/);
  });
});
