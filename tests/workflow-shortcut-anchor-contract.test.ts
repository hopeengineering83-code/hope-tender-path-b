import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const anchors: Array<{ anchor: string; file: string }> = [
  { anchor: "tender-files", file: "components/tender-source-files-panel.tsx" },
  { anchor: "extraction-quality", file: "components/extraction-quality-dashboard.tsx" },
  { anchor: "ai-analyze-section", file: "components/ai-analyze-panel.tsx" },
  { anchor: "requirement-coverage", file: "components/requirement-coverage-panel.tsx" },
  { anchor: "tender-edit-form", file: "app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx" },
  { anchor: "submission-plan", file: "components/submission-plan-truth-panel.tsx" },
  { anchor: "match-evidence", file: "components/matching-quality-panel.tsx" },
  { anchor: "generated-documents", file: "components/generation-action-panel.tsx" },
  { anchor: "authority-review", file: "components/authority-review-panel.tsx" },
  { anchor: "export-readiness", file: "components/export-readiness-panel.tsx" },
  { anchor: "final-package-manifest", file: "components/final-package-manifest-panel.tsx" },
];

describe("workflow shortcut anchor contract", () => {
  for (const { anchor, file } of anchors) {
    it(`#${anchor} is attached by ${file}`, () => {
      const source = readFileSync(file, "utf8");
      assert.match(
        source,
        new RegExp(`id=["']${anchor}["']`),
        `Workflow Control Center targets #${anchor}, but ${file} does not render that id`,
      );
    });
  }

  it("matching keeps both the canonical Stage-7 and historical matching-quality anchors", () => {
    const source = readFileSync("components/matching-quality-panel.tsx", "utf8");
    assert.match(source, /id="match-evidence"/);
    assert.match(source, /id="matching-quality"/);
  });

  it("the Workflow Control Center references only contracted primary anchors", () => {
    // TenderWorkflowActionCenter resolves its per-stage anchors from the
    // canonical lib/tender-workflow-stage-targets.ts registry rather than an
    // inline copy — assert against that shared source instead.
    const source = readFileSync("lib/tender-workflow-stage-targets.ts", "utf8");
    for (const { anchor } of anchors) {
      assert.ok(source.includes(`#${anchor}`), `Workflow Control Center must link to #${anchor}`);
    }
  });
});
