/**
 * Panels removed from the workspace during the overlap consolidation were left
 * behind as files. Nothing imported or rendered them, so they were invisible
 * dead weight that still shipped in the repo and still invited "just re-add
 * the panel" changes that would re-introduce the competing-status-panel bug.
 *
 * This test keeps the three that were deleted deleted, and asserts the general
 * rule: a component file under components/ must be reachable from somewhere.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Panels deleted because nothing rendered them. Re-adding needs a real consumer. */
const DELETED_UNRENDERED_PANELS = [
  "components/collapsible-panel.tsx",
  "components/proposal-evidence-readiness-panel.tsx",
  "components/tender-download-actions-panel.tsx",
];

describe("deleted unrendered panels stay deleted", () => {
  for (const path of DELETED_UNRENDERED_PANELS) {
    it(`${path} is not reintroduced without a consumer`, () => {
      assert.equal(
        existsSync(path),
        false,
        `${path} was deleted as unrendered dead code. If it is genuinely needed again, ` +
          `add it back together with the component that renders it and remove this entry.`,
      );
    });
  }
});

describe("every component file is reachable", () => {
  it("has no component that nothing imports", () => {
    const files = readdirSync("components").filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    const unreferenced: string[] = [];

    for (const file of files) {
      const stem = file.replace(/\.(tsx|ts)$/, "");
      // Match static imports and dynamic import() with or without a .js suffix.
      const pattern = `from "[^"]*/${stem}"|from "\\./${stem}"|import\\("[^"]*${stem}(\\.js)?"\\)`;
      let hits = "";
      try {
        hits = execSync(
          `grep -rEl '${pattern}' --include=*.ts --include=*.tsx app components lib tests e2e 2>/dev/null || true`,
        ).toString();
      } catch {
        hits = "";
      }
      const referencedBy = hits.split("\n").filter((l) => l && l !== `components/${file}`);
      if (referencedBy.length === 0) unreferenced.push(`components/${file}`);
    }

    // Components that are read as source by tests (rather than imported) are
    // still reachable evidence; treat a test that names the path as a consumer.
    const stillDead = unreferenced.filter((path) => {
      let named = "";
      try {
        named = execSync(`grep -rl '${path}' tests e2e scripts 2>/dev/null || true`).toString();
      } catch {
        named = "";
      }
      return named.trim().length === 0;
    });

    assert.deepEqual(
      stillDead,
      [],
      `these components are imported by nothing and named by no test — delete them or wire them up:\n` +
        stillDead.map((p) => `  - ${p}`).join("\n"),
    );
  });
});

describe("the workspace still refuses the removed competing panels", () => {
  it("does not render them on the tender page", () => {
    const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
    for (const name of ["ProposalEvidenceReadinessPanel", "TenderDownloadActionsPanel", "CollapsiblePanel"]) {
      assert.ok(!page.includes(name), `${name} must not return to the tender workspace`);
    }
  });
});
