import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { TENDER_WORKFLOW_STAGES } from "../lib/tender-workflow-stages";

const read = (path: string) => readFileSync(path, "utf8");

describe("UI gap analysis — canonical actions and disclosure-aware anchors", () => {
  it("renders AIAnalyzePanel once in Stage 2", () => {
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /import.*AIAnalyzePanel.*from.*ai-analyze-panel/);
    assert.equal((page.match(/<AIAnalyzePanel\b/g) ?? []).length, 1);
    assert.ok(!/id="ai-analyze-section"/.test(page));
  });

  it("defines ten ordered stages with stable five-stage fallbacks", () => {
    assert.equal(TENDER_WORKFLOW_STAGES.length, 10);
    assert.deepEqual(TENDER_WORKFLOW_STAGES.map((stage) => stage.stage), [1,2,3,4,5,6,7,8,9,10]);
    for (const stage of TENDER_WORKFLOW_STAGES) {
      assert.ok(stage.targets.length >= 2, `stage ${stage.stage} needs a primary target and fallback`);
      assert.ok(stage.targets.some((target) => /^#workflow-stage-[1-5]$/.test(target)), `stage ${stage.stage} needs a stable workflow-stage fallback`);
    }
  });

  it("keeps the critical primary anchors correct", () => {
    assert.equal(TENDER_WORKFLOW_STAGES[0].targets[0], "#tender-files");
    assert.equal(TENDER_WORKFLOW_STAGES[5].targets[0], "#submission-plan-reconciliation");
    assert.equal(TENDER_WORKFLOW_STAGES[6].targets[0], "#match-evidence");
    assert.equal(TENDER_WORKFLOW_STAGES[9].targets[0], "#export-readiness");
    assert.ok(TENDER_WORKFLOW_STAGES[9].targets.includes("#final-package-manifest"));
  });

  it("WorkflowStepLinks uses the canonical registry and opens closed disclosures", () => {
    const source = read("components/workflow-step-links.tsx");
    assert.match(source, /TENDER_WORKFLOW_STAGES/);
    assert.match(source, /tender-workflow-stages/);
    assert.match(source, /openParentDetailsAndScroll/);
    assert.match(source, /document\.querySelector\(selector\)/);
    assert.match(source, /View full workflow/);
  });

  it("Command Center links point to valid owning anchors", () => {
    const source = read("app/dashboard/tenders/[id]/command-center/page.tsx");
    for (const anchor of ["#generated-documents", "#matching-quality", "#evaluator-objections"]) {
      assert.ok(source.includes(anchor), `missing ${anchor}`);
    }
    assert.ok(!source.includes('#documents"'));
    assert.ok(!source.includes('#matching"'));
    assert.ok(!source.includes('#generate"'));
  });

  it("owning panels expose the required stable ids", () => {
    const checks: Array<[string, RegExp]> = [
      ["components/requirement-coverage-panel.tsx", /id="requirement-coverage"/],
      ["components/final-package-manifest-panel.tsx", /id="final-package-manifest"/],
      ["components/evaluator-objections-panel.tsx", /id="evaluator-objections"/],
      ["components/submission-plan-truth-panel.tsx", /id="submission-plan"/],
      ["components/matching-quality-panel.tsx", /id="matching-quality"/],
      ["components/export-readiness-panel.tsx", /id="export-readiness"/],
    ];
    for (const [file, pattern] of checks) assert.match(read(file), pattern);
  });

  // "retired workflow center still understands every canonical state" test
  // removed -- tender-workflow-action-center.tsx itself was deleted as
  // unrendered dead code (nothing imports or renders it).
});
