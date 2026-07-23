// Workflow shortcut anchor contract test.
// Updated to remove references to deleted components.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const anchors: Array<{ anchor: string; file: string }> = [
  { anchor: "tender-files", file: "components/tender-source-files-panel.tsx" },
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
      const src = read(file);
      assert.ok(
        src.includes(`id="${anchor}"`),
        `${file} must contain id="${anchor}"`
      );
    });
  }
});
