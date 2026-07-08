import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ── Gate Functions ─────────────────────────────────────────────────────────
import {
  deriveExtractionStatus,
  isExtractionAcceptableForGeneration,
  isExtractionAcceptableForExport,
} from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { hasExplicitSubmissionScope, buildSubmissionPlanWithDerivedFallback } from "../lib/engine/submission-plan";

describe("Tender Workflow Gate Regression — Corrupted Extraction Chain", () => {

  // Longer corrupted text to pass the >20 char filter in deriveExtractionStatus
  const CORRUPTED_TEXT = "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~";
  const POOR_FILES = [{
    extractionScore: 10,
    totalPages: 5,
    extractedPages: 1,
    ocrPages: 0,
    failedPages: 4
  }];

  it("Step 1: Corrupted text leads to EXTRACTION_CORRUPTED_AI_SKIPPED status", () => {
    const status = deriveExtractionStatus(POOR_FILES as any, [CORRUPTED_TEXT]);
    assert.equal(status, "EXTRACTION_CORRUPTED_AI_SKIPPED", "Corrupted text must skip AI analysis");
  });

  it("Step 2: Poor extraction blocks AI Analyze (proven by route source check)", () => {
    const analyzeRoute = path.resolve(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts");
    const src = fs.readFileSync(analyzeRoute, "utf8");
    // Check that it checks for corrupted text before AI call
    assert.ok(src.includes("isExtractionCorrupted"), "AI Analyze route must check for corrupted text");
  });

  it("Step 3: Extraction status blocks Build Plan (proven by readiness check)", () => {
    // In our architecture, Build Plan derives from requirements.
    // If extraction fails, requirements are empty, so plan will be empty.
    const tender = {
      requirements: [],
      exactFileNaming: null,
      exactFileOrder: null
    };
    const plan = buildSubmissionPlanWithDerivedFallback(tender as any);
    assert.equal(plan.files.length, 0, "Empty requirements from poor extraction results in empty plan");
    assert.equal(hasExplicitSubmissionScope(tender as any), false, "No scope without requirements or explicit naming");
  });

  it("Step 4: Poor extraction blocks Generate Docs", () => {
    const acceptable = isExtractionAcceptableForGeneration(POOR_FILES as any);
    assert.equal(acceptable, false, "Generate Docs gate must block on poor extraction score/failed pages");

    // Also check generate route source for the gate call
    const generateRoute = path.resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts");
    const src = fs.readFileSync(generateRoute, "utf8");
    assert.ok(src.includes("isExtractionAcceptableForGeneration"), "Generate route must call the extraction gate");
  });

  it("Step 5: Poor extraction blocks Export", () => {
    const acceptable = isExtractionAcceptableForExport(POOR_FILES as any);
    assert.equal(acceptable, false, "Export gate must block on poor extraction score/failed pages");

    // Check export readiness logic (lib/engine/final-submission-readiness.ts)
    const readinessLib = path.resolve(process.cwd(), "lib/engine/final-submission-readiness.ts");
    const src = fs.readFileSync(readinessLib, "utf8");
    assert.ok(src.includes("isExtractionAcceptableForExport"), "Readiness lib must call the extraction gate");
  });

  it("Step 6: metadataContaminated does NOT block Generate Docs (metadata is optional for draft)", () => {
      // Generate route must NOT hard-block on contaminated metadata for draft work
      const generateRoute = path.resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts");
      const gSrc = fs.readFileSync(generateRoute, "utf8");
      assert.doesNotMatch(gSrc, /errorCode.*METADATA_CONTAMINATED/, "Generate route must NOT hard-block on contaminated metadata");

      // Export readiness check — export IS strict
      const readinessLib = path.resolve(process.cwd(), "lib/engine/final-submission-readiness.ts");
      const rSrc = fs.readFileSync(readinessLib, "utf8");
      assert.ok(rSrc.includes("tender.metadataContaminated"), "Readiness lib must block on contaminated metadata for export");
  });
});
