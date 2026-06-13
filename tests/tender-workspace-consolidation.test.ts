import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const PAGE_PATH = new URL("../app/dashboard/tenders/[id]/page.tsx", import.meta.url);
const SOURCE_PANEL_PATH = new URL("../components/tender-source-files-panel.tsx", import.meta.url);

describe("canonical tender workspace", () => {
  it("does not render or import the legacy tender action surface", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.doesNotMatch(page, /LegacyTenderActionHider/);
    assert.doesNotMatch(page, /<TenderDetail\b/);
    assert.doesNotMatch(page, /legacy-tender-detail-actions/);
    assert.doesNotMatch(page, /data-hidden-duplicate-action/);
    assert.doesNotMatch(page, /MutationObserver/);
  });

  it("renders each authoritative major action once", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.equal((page.match(/<EngineActionPanel\b/g) ?? []).length, 1);
    assert.equal((page.match(/<GenerationActionPanel\b/g) ?? []).length, 1);
    assert.equal((page.match(/<FinalSubmissionControlCenter\b/g) ?? []).length, 1);
    assert.equal((page.match(/<ExportReadinessPanel\b/g) ?? []).length, 1);
  });

  it("groups the workspace into five ordered workflow stages", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    for (const number of [1, 2, 3, 4, 5]) {
      assert.match(page, new RegExp(`<WorkflowStage number=\\{${number}\\}`));
    }
    assert.match(page, /Intake and extraction/);
    assert.match(page, /Analysis and engine/);
    assert.match(page, /Evidence and matching/);
    assert.match(page, /Generation and review/);
    assert.match(page, /Final package and submission/);
  });

  it("preserves source-file upload, download, and deletion", async () => {
    const panel = await readFile(SOURCE_PANEL_PATH, "utf8");
    assert.match(panel, /fetch\("\/api\/upload"/);
    assert.match(panel, /method: "DELETE"/);
    assert.match(panel, /\/api\/tenders\/\$\{tenderId\}\/files\/\$\{file\.id\}/);
    assert.match(panel, /Choose files/);
  });
});
