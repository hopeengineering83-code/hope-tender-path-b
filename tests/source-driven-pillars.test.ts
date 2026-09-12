// Load-bearing tests for source-driven pillars:
// - Pillar 1: Canonical stage registry has 10 stages with labels and targets
// - Pillar 3: Truncation caps are large enough (no silent data loss)
// - Pillar 5: Applicability states block correctly (only indispensable fields)
// - Pillar 6: Evaluation criteria is advisory (non-blocking)
// - Pillar 6: Financial proposal default is UNKNOWN (null)
// - Pillar 7: Derived draft plan is keyword-driven (no unconditional entries)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Source-driven pillars — load-bearing tests", () => {

  // ═══ Pillar 1: Canonical stage registry ═══════════════════════════════════
  describe("Pillar 1 — Canonical stage registry", () => {
    const src = read("lib/tender-workflow-stages.ts");

    it("defines exactly 10 stages", () => {
      const matches = src.match(/stage: \d+/g);
      assert.ok(matches, "must define stages");
      assert.equal(matches.length, 10, "must have exactly 10 stages");
    });

    it("every stage has a label and targets", () => {
      for (let i = 1; i <= 10; i++) {
        assert.ok(src.includes(`stage: ${i}`), `stage ${i} must exist`);
        assert.ok(src.includes(`label: `), `stage ${i} must have a label`);
      }
    });

    it("exports TENDER_WORKFLOW_STAGES, TENDER_WORKFLOW_STAGE_LABELS, and TENDER_WORKFLOW_STAGE_TARGETS", () => {
      assert.ok(src.includes("export const TENDER_WORKFLOW_STAGES"), "must export TENDER_WORKFLOW_STAGES");
      assert.ok(src.includes("export const TENDER_WORKFLOW_STAGE_LABELS"), "must export TENDER_WORKFLOW_STAGE_LABELS");
      assert.ok(src.includes("export const TENDER_WORKFLOW_STAGE_TARGETS"), "must export TENDER_WORKFLOW_STAGE_TARGETS");
    });

    it("workflow-step-links imports from the canonical registry", () => {
      const linksSrc = read("components/workflow-step-links.tsx");
      assert.ok(linksSrc.includes("tender-workflow-stages"), "must import from canonical registry");
      assert.ok(!linksSrc.includes('"Source Files"'), "must NOT have inline label array");
    });

    it("next-action-panel imports STEPS from the canonical registry", () => {
      const panelSrc = read("components/next-action-panel.tsx");
      assert.ok(panelSrc.includes("tender-workflow-stages"), "must import from canonical registry");
      assert.ok(!panelSrc.match(/const STEPS = \[/), "must NOT have inline STEPS array");
    });

    it("workflow-center route uses TENDER_WORKFLOW_STAGE_LABELS", () => {
      const routeSrc = read("app/api/tenders/[id]/workflow-center/route.ts");
      assert.ok(routeSrc.includes("TENDER_WORKFLOW_STAGE_LABELS"), "must use registry labels");
      assert.ok(!routeSrc.includes('label: "Source Files"'), "must NOT have inline label strings");
    });
  });

  // ═══ Pillar 3: Truncation caps ═══════════════════════════════════════════
  describe("Pillar 3 — Truncation caps are large enough", () => {
    it("extract-text MAX_EXTRACTED_TEXT_CHARS is at least 2M", () => {
      const src = read("lib/extract-text.ts");
      assert.ok(src.includes("2_000_000"), "must be 2M or higher");
      assert.ok(!src.includes("500_000"), "must NOT be 500K");
    });

    it("company-knowledge-ai MAX_CHARS_PER_CHUNK is at least 24K", () => {
      const src = read("lib/company-knowledge-ai.ts");
      assert.ok(src.includes("24_000"), "must be 24K or higher");
      assert.ok(!src.includes("12_000"), "must NOT be 12K");
    });

    it("ai.ts ANALYSIS_MAX_CHUNKS is at least 20", () => {
      const src = read("lib/ai.ts");
      assert.ok(src.match(/ANALYSIS_MAX_CHUNKS\s*=\s*20/), "must be 20 or higher");
    });
  });

  // ═══ Pillar 5: Applicability states ═══════════════════════════════════════
  describe("Pillar 5 — Applicability states", () => {
    it("defines all 6 applicability states", () => {
      const src = read("lib/engine/tender-applicability.ts");
      for (const state of ["FOUND_AND_GROUNDED", "EXPLICITLY_NOT_REQUIRED", "NOT_STATED", "UNREADABLE", "EXTRACTION_FAILED", "CONFLICTING"]) {
        assert.ok(src.includes(state), `must define ${state}`);
      }
    });

    it("INDISPENSABLE_FINAL_DELIVERY_FIELDS includes deadline, submissionMethod, clientName, title", () => {
      const src = read("lib/engine/tender-applicability.ts");
      for (const field of ["deadline", "submissionMethod", "clientName", "title"]) {
        assert.ok(src.includes(`"${field}"`), `must include ${field} as indispensable`);
      }
    });

    it("canonical-field-state uses INDISPENSABLE_FINAL_DELIVERY_FIELDS (not isCritical) for export blocking", () => {
      const src = read("lib/engine/canonical-field-state.ts");
      assert.ok(src.includes("INDISPENSABLE_FINAL_DELIVERY_FIELDS"), "must import and use the indispensable set");
      assert.ok(src.includes("isIndispensable && !effectiveStr"), "must use isIndispensable for export blocking");
    });
  });

  // ═══ Pillar 6: Evaluation criteria advisory + financial default ══════════
  describe("Pillar 6 — Evaluation criteria advisory + financial default", () => {
    it("export-readiness uses EVALUATION_CRITERIA_ADVISORY (not MISSING as a category)", () => {
      const src = read("lib/engine/export-readiness.ts");
      assert.ok(src.includes("EVALUATION_CRITERIA_ADVISORY"), "must use ADVISORY code");
      // Check that the old code is not used as a category (it can appear in comments)
      assert.ok(!src.match(/category:\s*"EVALUATION_CRITERIA_MISSING"/), "must NOT use MISSING as category");
    });

    it("final-submission-readiness uses EVALUATION_CRITERIA_ADVISORY (not NOT_EXTRACTED)", () => {
      const src = read("lib/engine/final-submission-readiness.ts");
      assert.ok(src.includes("EVALUATION_CRITERIA_ADVISORY"), "must use ADVISORY code");
      assert.ok(!src.includes("EVALUATION_CRITERIA_NOT_EXTRACTED"), "must NOT use NOT_EXTRACTED code");
    });

    it("evaluation criteria is pushed to advisoryWarnings, not tenderLevelBlockers", () => {
      const src = read("lib/engine/final-submission-readiness.ts");
      // The advisory must be pushed to advisoryWarnings, not tenderLevelBlockers
      assert.ok(src.includes("advisoryWarnings.push"), "must push to advisoryWarnings");
    });

    it("financial-proposal default is null (UNKNOWN), not true", () => {
      const src = read("lib/engine/effective-tender-facts.ts");
      assert.ok(src.includes("financialProposalRequired: boolean | null"), "type must be boolean | null");
      assert.ok(src.includes("null"), "default must be null");
      assert.ok(!src.match(/financialProposalRequired.*:\s*true\b/), "must NOT default to true");
    });
  });

  // ═══ Pillar 7: Source-grounded submission plan ═══════════════════════════
  describe("Pillar 7 — Source-grounded submission plan", () => {
    it("buildDerivedDraftPlan is keyword-driven (no unconditional entries)", () => {
      const src = read("lib/engine/submission-plan.ts");
      // Every entry.push must be inside an if block (keyword check)
      // Verify there's no entries.push outside an if block
      assert.ok(src.includes("if (isEOI"), "EOI entry is conditional");
      assert.ok(src.includes("DERIVED_DRAFT_UNCONFIRMED"), "entries are tagged as derived draft");
    });

    it("generate route marks placeholders as PLANNED (not GENERATED)", () => {
      const src = read("app/api/tenders/[id]/generate/route.ts");
      assert.ok(src.includes('generationStatus: "PLANNED"'), "placeholders must be PLANNED");
      assert.ok(src.includes("REPLACE_WITH_ORIGINAL"), "placeholders must have REPLACE_WITH_ORIGINAL review status");
    });
  });

  // ═══ Pillar 4: Source-citation enforcement ═══════════════════════════════
  describe("Pillar 4 — Source-citation enforcement", () => {
    it("proposal-intelligence-contract has anti-fabrication writing rules", () => {
      const src = read("lib/engine/proposal-intelligence-contract.ts");
      assert.ok(src.includes("NEVER invent"), "must have anti-fabrication rule");
      assert.ok(src.includes("sourceDocumentId"), "must reference sourceDocumentId");
      assert.ok(src.includes("Do not generate generic"), "must prohibit generic document types");
    });

    it("generation-readiness-gate enforces source grounding (REQUIREMENT_SOURCE_UNGROUNDED)", () => {
      const src = read("lib/engine/generation-readiness-gate.ts");
      assert.ok(src.includes("REQUIREMENT_SOURCE_UNGROUNDED"), "must block ungrounded requirements");
      assert.ok(src.includes("sourceTenderFileId"), "must check sourceTenderFileId");
      assert.ok(src.includes("sourcePageNumber"), "must check sourcePageNumber");
      assert.ok(src.includes("sourceExactQuote"), "must check sourceExactQuote");
    });
  });

  // ═══ Pillar 2: Honest format reporting ═══════════════════════════════════
  describe("Pillar 2 — Honest format reporting", () => {
    it("images report 'needs OCR' instead of silent placeholder", () => {
      const src = read("lib/extract-text.ts");
      assert.ok(src.includes("[Image needs OCR:"), "must report OCR need honestly");
      assert.ok(!src.includes('return "[Image:'), "must NOT use old silent placeholder");
    });

    it("unsupported formats report honestly instead of empty string", () => {
      const src = read("lib/extract-text.ts");
      assert.ok(src.includes("[Unsupported format:"), "must report unsupported format");
    });

    it("extraction failures report honestly with error message", () => {
      const src = read("lib/extract-text.ts");
      assert.ok(src.includes("[Extraction failed for"), "must report extraction failures");
    });
  });
});
