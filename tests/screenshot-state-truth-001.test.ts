import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const dashboardSrc = readFileSync("app/dashboard/page.tsx", "utf8");
const complianceSrc = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");
const analysisSrc = readFileSync("app/dashboard/analysis/page.tsx", "utf8");
const commandCenterSrc = readFileSync("app/dashboard/tenders/[id]/command-center/page.tsx", "utf8");

describe("FINDING-SCREENSHOT-STATE-001 — State Truth and AI Runtime", () => {
  describe("dashboard critical-gaps counting includes extraction-blocked tenders", () => {
    it("counts tenders with corrupted/partial/fallback extraction as critical gaps", () => {
      assert.match(dashboardSrc, /EXTRACTION_BLOCKED_STATES/);
      assert.match(dashboardSrc, /OCR_REQUIRED/);
      assert.match(dashboardSrc, /EXTRACTION_CORRUPTED_ENGINE_SKIPPED/);
      assert.match(dashboardSrc, /PARTIAL_EXTRACTION_AI_ANALYZED/);
      assert.match(dashboardSrc, /extractionBlocked.*hasNoAnalysis/);
    });

    it("does not show AI enabled as analysis authority", () => {
      assert.match(dashboardSrc, /AI providers configured/);
      assert.doesNotMatch(dashboardSrc, /AI enabled(?!.*providers)/);
    });
  });

  describe("compliance dashboard does not treat missing rows as proof of compliance", () => {
    it("counts unanalyzed tenders and warns that missing gaps are not proof of compliance", () => {
      assert.match(complianceSrc, /unanalyzedCount/);
      assert.match(complianceSrc, /Missing gap rows are not proof of compliance/);
    });

    it("does not show 'No compliance gaps' without context when tenders are unanalyzed", () => {
      assert.match(complianceSrc, /have not been analyzed/);
    });
  });

  describe("analysis page blocks false Clear for corrupted/unanalysed tenders", () => {
    it("shows NOT ANALYZED for tenders with zero requirements", () => {
      assert.match(analysisSrc, /NOT ANALYZED/);
    });

    it("shows BLOCKED for tenders with corrupted/partial extraction status", () => {
      assert.match(analysisSrc, /BLOCKED/);
      assert.match(analysisSrc, /OCR_REQUIRED/);
      assert.match(analysisSrc, /EXTRACTION_CORRUPTED_ENGINE_SKIPPED/);
    });

    it("selects analysisExtractionStatus from the database", () => {
      assert.match(analysisSrc, /analysisExtractionStatus: true/);
    });
  });

  describe("command center queries jobs by tenderId only", () => {
    it("does not use OR with userId in the AiJob query", () => {
      assert.doesNotMatch(commandCenterSrc, /OR.*tenderId.*userId|OR.*userId.*tenderId/);
    });

    it("queries only by tenderId", () => {
      assert.match(commandCenterSrc, /where:\s*\{\s*tenderId:\s*id\s*\}/);
    });
  });
});
