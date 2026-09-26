import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const anchors: Array<{ anchor: string; file: string }> = [
  { anchor: "tender-files", file: "components/tender-source-files-panel.tsx" },
  // The id lives on the wrapping div in page.tsx, not inside the panel — the
  // deleted extraction-quality-dashboard.tsx used to own its own id="extraction-quality"
  // section, but the live extraction-quality-panel.tsx does not.
  { anchor: "extraction-quality", file: "app/dashboard/tenders/[id]/page.tsx" },
  { anchor: "ai-analyze-section", file: "components/ai-analyze-panel.tsx" },
  { anchor: "requirement-coverage", file: "components/requirement-coverage-panel.tsx" },
  { anchor: "tender-edit-form", file: "app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx" },
  { anchor: "submission-plan", file: "components/submission-plan-truth-panel.tsx" },
  { anchor: "matching-selected-evidence", file: "components/matching-selected-evidence-panel.tsx" },
  { anchor: "generated-documents", file: "components/generation-action-panel.tsx" },
  { anchor: "authority-review", file: "components/authority-review-panel.tsx" },
  { anchor: "export-readiness", file: "components/export-readiness-panel.tsx" },
  { anchor: "final-package-manifest", file: "components/final-package-manifest-panel.tsx" },
];

describe("workflow shortcut anchor contract", () => {
  for (const { anchor, file } of anchors) {
    it(`#${anchor} is attached by ${file}`, () => {
      const source = readFileSync(file, "utf8");
      const ownsLiteralId = new RegExp(`id=["']${anchor}["']`).test(source);
      const ownsDefaultSectionId = new RegExp(`sectionId\\s*=\\s*["']${anchor}["']`).test(source)
        && /id=\{sectionId\}/.test(source);
      assert.ok(ownsLiteralId || ownsDefaultSectionId, `Workflow Control Center targets #${anchor}, but ${file} does not render that id`);
    });
  }

  it("the authenticated browser contract uses the same canonical matching anchor", () => {
    const source = readFileSync("e2e/workflow-control-center-action-buttons.spec.ts", "utf8");
    assert.match(source, /\[7, "Match Evidence", "#matching-selected-evidence"\]/);
    assert.doesNotMatch(source, /#match-evidence|#matching-quality/);
  });

  // "Workflow Control Center references only contracted primary anchors" test
  // removed -- tender-workflow-action-center.tsx and its dedicated
  // lib/tender-workflow-stage-targets.ts registry were both deleted as
  // unrendered dead code. The live equivalent anchor-fallback mechanism
  // (lib/tender-workflow-stages.ts, consumed by WorkflowStepLinks via
  // NextActionPanel) is covered by the "workflow anchor targets" test in
  // tests/final-overlap-consolidation.test.ts.
});
