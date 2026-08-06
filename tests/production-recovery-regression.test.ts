import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assessCanonicalTenderSourceReadiness,
  selectCanonicalTenderFiles,
} from "../lib/tender/canonical-source-files";
import {
  extractRequirementSources,
  splitIntoParagraphs,
} from "../lib/engine/requirement-source-extractor";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("pending duplicate representation does not block the verified canonical source", () => {
  const files = [
    {
      id: "docx-good",
      originalFileName: "Pharo Tender Document.docx",
      deletionStatus: "ACTIVE",
      contentSha256: "a".repeat(64),
      integrityStatus: "VERIFIED",
      extractionScore: 90,
      extractionMethod: "docx",
      totalPages: 7,
      extractedPages: 7,
      failedPages: 0,
      extractedText: "verified tender text ".repeat(80),
      createdAt: new Date("2026-08-05T00:00:00Z"),
    },
    {
      id: "pdf-weak",
      originalFileName: "Pharo Tender Document.pdf",
      deletionStatus: "ACTIVE",
      contentSha256: "b".repeat(64),
      integrityStatus: "VERIFIED",
      extractionScore: 25,
      extractionMethod: "pdf",
      totalPages: 7,
      extractedPages: 7,
      failedPages: 0,
      extractedText: "weak duplicate text ".repeat(80),
      createdAt: new Date("2026-08-05T01:00:00Z"),
    },
    {
      id: "docx-pending",
      originalFileName: "Pharo Tender Document (copy).docx",
      deletionStatus: "ACTIVE",
      contentSha256: "c".repeat(64),
      integrityStatus: "VERIFIED",
      extractionScore: null,
      extractionMethod: null,
      totalPages: null,
      extractedPages: null,
      failedPages: null,
      extractedText: null,
      createdAt: new Date("2026-08-05T02:00:00Z"),
    },
  ];

  const canonical = selectCanonicalTenderFiles(files);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].id, "docx-good");
  const readiness = assessCanonicalTenderSourceReadiness(files);
  assert.equal(readiness.duplicateFileCount, 2);
  assert.equal(readiness.byteIntegrityValid, true);
  assert.equal(readiness.extractionComplete, true);
  assert.equal(readiness.extractionQualityValid, true);
  assert.equal(readiness.analysisReady, true);
});

test("byte integrity and extraction quality remain separate gates", () => {
  const readiness = assessCanonicalTenderSourceReadiness([{
    id: "weak",
    originalFileName: "Tender.pdf",
    deletionStatus: "ACTIVE",
    contentSha256: "d".repeat(64),
    integrityStatus: "VERIFIED",
    extractionScore: 25,
    extractionMethod: "pdf",
    totalPages: 7,
    extractedPages: 7,
    failedPages: 0,
    extractedText: "readable but poor extraction ".repeat(60),
  }]);
  assert.equal(readiness.byteIntegrityValid, true);
  assert.equal(readiness.extractionQualityValid, false);
  assert.equal(readiness.analysisReady, false);
});

test("embedded page markers and long text produce a verbatim grounded requirement", () => {
  const text = [
    "[page 1]",
    "REQUEST FOR PROPOSAL",
    "General introduction and background information.",
    "[page 2]",
    "4.2 KEY EXPERT REQUIREMENTS",
    "The consultant shall submit the curriculum vitae of the Team Leader with at least ten years of relevant professional experience and a signed availability declaration.",
    "[page 3]",
    "Other submission information.",
  ].join("\n");

  const paragraphs = splitIntoParagraphs(text);
  assert.ok(paragraphs.some((paragraph) => paragraph.pageNumber === 2));

  const [result] = extractRequirementSources({
    tenderFileId: "file-1",
    tenderFileText: text,
    requirements: [{
      id: "req-1",
      title: "Team Leader CV and experience",
      description: "Submit the Team Leader curriculum vitae with at least ten years of experience.",
    }],
  });

  assert.equal(result.sourceTenderFileId, "file-1");
  assert.equal(result.sourcePageNumber, 2);
  assert.match(result.sourceExactQuote ?? "", /curriculum vitae/i);
  assert.ok(result.sourceConfidence >= 0.18);
});

test("manual AI Analyze uses canonical readiness and stops after deletion", () => {
  const panel = source("components/ai-analyze-panel.tsx");
  assert.match(panel, /source-readiness/);
  assert.match(panel, /tender-deletion-started/);
  assert.match(panel, /manual-ai-analyze/);
  assert.doesNotMatch(panel, /automatically starts AI Analyze/i);
});

test("successful AI Analyze terminates at the manual Run Engine boundary", () => {
  const registry = source("lib/ai-job-handlers.ts");
  assert.match(registry, /stepName: "manual-engine-required"/);
  assert.match(registry, /nextAction: "RUN_ENGINE"/);
  assert.match(registry, /automaticEngineStarted: false/);
  assert.doesNotMatch(registry, /AUTOMATIC_POST_ANALYSIS_CONTINUATION/);
  assert.doesNotMatch(registry, /engine\.auto-enqueue/);
});

test("Run Engine is gated by current canonical analysis", () => {
  const route = source("app/api/tenders/[id]/engine/route.ts");
  assert.match(route, /selectCanonicalTenderFiles/);
  assert.match(route, /contentHashMatch/);
  assert.match(route, /CURRENT_ANALYSIS_REQUIRED/);
  assert.match(route, /integrityStatus !== "VERIFIED"/);
});

test("Engine reuses promoted manual analysis instead of repeating extraction", () => {
  const engine = source("lib/engine/run-tender-engine.ts");
  assert.match(engine, /canReusePromotedAnalysis/);
  assert.match(engine, /no duplicate AI extraction call was made/);
  assert.match(engine, /requirementsNeedingSourceExtraction/);
  assert.match(engine, /hasAuthoritativeDeterministicSelection/);
});

test("matcher requests are bounded and advance through remaining providers", () => {
  const matcher = source("lib/engine/ai-multi-perspective-matcher.ts");
  assert.match(matcher, /MAX_CANDIDATES_PER_MATCHER_BATCH = 8/);
  assert.match(matcher, /MAX_REQUIREMENT_CHARS = 4_000/);
  assert.match(matcher, /MAX_FALLBACK_PASSES = 3/);
  assert.match(matcher, /providers attempted in pass one/);
});

test("stale analysis cannot display a usable 100 score", () => {
  const panel = source("components/analysis-quality-panel.tsx");
  assert.match(panel, /contentHashMatch/);
  assert.match(panel, /Math\.min\(quality\.score, 69\)/);
  assert.match(panel, /Previous analysis does not match the current canonical source revision/);
});

test("post-deletion workflow polling is terminal 404 instead of 500", () => {
  const route = source("app/api/tenders/[id]/workflow-center/route.ts");
  assert.match(route, /terminal: true/);
  assert.match(route, /code: "TENDER_NOT_FOUND"/);
  assert.ok(route.indexOf("ownedTender") < route.indexOf("Promise.all"));
});

test("permanent deletion controls are present on list/history and detail routes", () => {
  assert.match(source("app/dashboard/history/duplicate-button.tsx"), /DeleteTenderButton/);
  assert.match(source("app/dashboard/layout.tsx"), /TenderDetailDeleteControl/);
  assert.match(source("components/delete-tender-button.tsx"), /Type DELETE to continue/);
});

test("Plan B finalization reconciles verified source files and deduplicates records", () => {
  const finalizer = source("app/api/company/plan-b-import/finalize/route.ts");
  assert.match(finalizer, /reconcilePlanBSourcesByUniqueStem/);
  assert.match(finalizer, /deduplicateCompanyVaultRecords/);
  assert.match(finalizer, /usableCounts/);

  const dedupe = source("lib/plan-b-deduplicate.ts");
  assert.match(dedupe, /tenderExpertMatch/);
  assert.match(dedupe, /tenderProjectMatch/);
  assert.match(dedupe, /hasConflictingExpertIdentifiers/);
});

test("PDF runtime installs geometry globals before extraction", () => {
  const instrumentation = source("instrumentation.ts");
  assert.match(instrumentation, /installPdfGeometryGlobals/);
  assert.match(instrumentation, /DOMMatrix/);
  assert.match(instrumentation, /ImageData/);
  assert.match(instrumentation, /Path2D/);
});
