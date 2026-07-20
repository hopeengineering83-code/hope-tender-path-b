import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");

describe("UI gap analysis — AI Analyze button + broken anchors", () => {
  describe("Gap 1 — AIAnalyzePanel is rendered on the live tender detail page", () => {
    it("page.tsx imports AIAnalyzePanel", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.match(page, /import.*AIAnalyzePanel.*from.*ai-analyze-panel/);
    });
    it("page.tsx renders <AIAnalyzePanel> in Stage 2", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.match(page, /<AIAnalyzePanel\s+tenderId=.*aiEnabled=/);
    });
    it("page.tsx must NOT have id=ai-analyze-section (the panel already has it)", () => {
      const page = read("app/dashboard/tenders/[id]/page.tsx");
      assert.ok(!/id="ai-analyze-section"/.test(page), "page.tsx must NOT have id=ai-analyze-section (the panel already has it)");
    });
  });

  describe("Gap 2 — TenderWorkflowActionCenter anchors are valid", () => {
    // The targets map supports ordered fallbacks while keeping the first item
    // as the canonical owning panel for each workflow stage.
    it("stage 1 targets #tender-files (not #tender-source-files)", () => {
      const src = read("components/tender-workflow-action-center.tsx");
      assert.match(src, /1:\s*\["#tender-files"\]/);
      assert.ok(!src.includes("#tender-source-files"), "must not reference #tender-source-files");
    });
    it("stage 10 primarily targets #export-readiness and may fall back to the final manifest", () => {
      const src = read("components/tender-workflow-action-center.tsx");
      assert.match(src, /10:\s*\["#export-readiness"(?:,\s*"#final-package-manifest")?\]/);
      assert.ok(!src.includes("#export-section"), "must not reference #export-section");
    });
  });

  describe("Gap 3 — NextActionPanel anchors are valid", () => {
    // STEP_TARGETS moved to components/workflow-step-links.tsx (the client
    // component that renders the step links). NextActionPanel delegates to
    // WorkflowStepLinks, so the anchor strings live there now.
    it("step 6 targets #submission-plan (not #submission-plan-completeness)", () => {
      const src = read("components/workflow-step-links.tsx");
      assert.match(src, /"#submission-plan"/);
      assert.ok(!src.includes("#submission-plan-completeness"), "must not reference #submission-plan-completeness");
    });
    it("step 10 targets #export-readiness (not #export-package)", () => {
      const src = read("components/workflow-step-links.tsx");
      assert.match(src, /"#export-readiness"/);
      assert.ok(!src.includes("#export-package"), "must not reference #export-package");
    });
  });

  describe("Gap 4 — FinalSubmissionControlCenter anchor is valid", () => {
    it("href is #generated-documents (not #generate-docs-action)", () => {
      const src = read("components/final-submission-control-center.tsx");
      assert.match(src, /href:\s*"#generated-documents"/);
      assert.ok(!src.includes("#generate-docs-action"), "must not reference #generate-docs-action");
    });
  });

  describe("Gap 5 — Command Center links point to valid anchors", () => {
    const src = read("app/dashboard/tenders/[id]/command-center/page.tsx");
    it("documents link points to #generated-documents (not #documents)", () => {
      assert.match(src, /#generated-documents/);
      assert.ok(!src.includes('#documents"'), "must not reference bare #documents");
    });
    it("matching links point to #matching-quality (not #matching)", () => {
      assert.match(src, /#matching-quality/);
      assert.ok(!src.includes('#matching"'), "must not reference bare #matching");
    });
    it("generate link points to #generated-documents (not #generate)", () => {
      assert.match(src, /#generated-documents/);
      assert.ok(!src.includes('#generate"'), "must not reference bare #generate");
    });
    it("evaluator link points to #evaluator-objections", () => {
      assert.match(src, /#evaluator-objections/);
    });
  });

  describe("Gap 6 — Panels have the required id attributes", () => {
    it("RequirementCoveragePanel has id=requirement-coverage", () => { assert.match(read("components/requirement-coverage-panel.tsx"), /id="requirement-coverage"/); });
    it("FinalPackageManifestPanel has id=final-package-manifest", () => { assert.match(read("components/final-package-manifest-panel.tsx"), /id="final-package-manifest"/); });
    it("EvaluatorObjectionsPanel has id=evaluator-objections", () => { assert.match(read("components/evaluator-objections-panel.tsx"), /id="evaluator-objections"/); });
    it("SubmissionPlanTruthPanel has id=submission-plan", () => { assert.match(read("components/submission-plan-truth-panel.tsx"), /id="submission-plan"/); });
    it("MatchingQualityPanel has id=matching-quality", () => { assert.match(read("components/matching-quality-panel.tsx"), /id="matching-quality"/); });
    it("ExportReadinessPanel has id=export-readiness", () => { assert.match(read("components/export-readiness-panel.tsx"), /id="export-readiness"/); });
  });

  describe("Gap 7 — TenderWorkflowActionCenter's StatusBadge handles every canonical stage state", () => {
    // The canonical decision engine legitimately produces these states. The
    // control center must never collapse them into the generic Pending badge.
    const src = read("components/tender-workflow-action-center.tsx");

    it("WorkflowStageInfo['status'] type includes all canonical states", () => {
      assert.match(src, /"COMPLETE"/);
      assert.match(src, /"BLOCKED_BY_PRIOR_STEP"/);
      assert.match(src, /"WAITING_ON_PRIOR_STEP"/);
    });

    it("StatusBadge has an explicit case for COMPLETE", () => {
      assert.match(src, /case "COMPLETE":/);
    });

    it("StatusBadge has an explicit case for BLOCKED_BY_PRIOR_STEP", () => {
      assert.match(src, /case "BLOCKED_BY_PRIOR_STEP":/);
    });

    it("StatusBadge has an explicit case for WAITING_ON_PRIOR_STEP", () => {
      assert.match(src, /case "WAITING_ON_PRIOR_STEP":/);
    });

    it("each new case renders a label distinct from the generic Pending badge", () => {
      const caseBlock = (state: string) => {
        const match = src.match(new RegExp(`case "${state}":[\\s\\S]*?;`));
        assert.ok(match, `expected a case block for ${state}`);
        return match[0];
      };
      assert.ok(!caseBlock("COMPLETE").includes(">Pending<"));
      assert.ok(!caseBlock("BLOCKED_BY_PRIOR_STEP").includes(">Pending<"));
      assert.ok(!caseBlock("WAITING_ON_PRIOR_STEP").includes(">Pending<"));
    });
  });
});
