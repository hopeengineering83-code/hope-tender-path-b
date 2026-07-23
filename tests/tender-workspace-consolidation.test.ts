import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

const PAGE_PATH = new URL("../app/dashboard/tenders/[id]/page.tsx", import.meta.url);
const SOURCE_PANEL_PATH = new URL("../components/tender-source-files-panel.tsx", import.meta.url);

describe("canonical tender workspace", () => {
  it("does not render or import legacy or competing tender action surfaces", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.doesNotMatch(page, /LegacyTenderActionHider/);
    assert.doesNotMatch(page, /<TenderDetail\b/);
    assert.doesNotMatch(page, /legacy-tender-detail-actions/);
    assert.doesNotMatch(page, /data-hidden-duplicate-action/);
    assert.doesNotMatch(page, /MutationObserver/);
    assert.doesNotMatch(page, /TenderWorkflowActionCenter/);
    assert.doesNotMatch(page, /TenderRecoveryCommandCenter/);
    assert.doesNotMatch(page, /TenderReleaseStatePanel/);
    assert.doesNotMatch(page, /FinalSubmissionControlCenter/);
    assert.doesNotMatch(page, /ProposalEvidenceReadinessPanel/);
  });

  it("renders each authoritative mutation or export action once", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.equal((page.match(/<EngineActionPanel\b/g) ?? []).length, 1);
    assert.equal((page.match(/<GenerationActionPanel\b/g) ?? []).length, 1);
    assert.equal((page.match(/<ExportReadinessPanel\b/g) ?? []).length, 1);
    assert.equal((page.match(/<NextActionPanel\b/g) ?? []).length, 1);
  });

  it("groups the workspace into five ordered, anchorable workflow stages", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    for (const number of [1, 2, 3, 4, 5]) {
      assert.match(page, new RegExp(`<WorkflowStage number=\\{${number}\\}`));
    }
    assert.match(page, /id=\{`workflow-stage-\$\{number\}`\}/);
    assert.match(page, /Intake and extraction/);
    assert.match(page, /Analysis and engine/);
    assert.match(page, /Evidence and matching/);
    assert.match(page, /Generation and review/);
    assert.match(page, /Final package and submission/);
  });

  it("keeps secondary tools collapsed instead of presenting competing authorities", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.match(page, /title="Extraction diagnostics"/);
    assert.match(page, /title="AI diagnostics and assistance"/);
    assert.match(page, /title="Generation and review diagnostics"/);
    assert.match(page, /title="Submission audit trail"/);
  });

  it("keeps diagnostics separate and read-only", async () => {
    const page = await readFile(PAGE_PATH, "utf8");
    assert.match(page, /title="Diagnostics and audit"/);
    assert.match(page, /Open read-only Command Center/);
    assert.match(page, /\/dashboard\/tenders\/\$\{tender\.id\}\/command-center/);
  });

  it("preserves source-file upload, download, and deletion", async () => {
    const panel = await readFile(SOURCE_PANEL_PATH, "utf8");
    assert.match(panel, /fetch\("\/api\/upload"/);
    assert.match(panel, /method: "DELETE"/);
    assert.match(panel, /\/api\/tenders\/\$\{tenderId\}\/files\/\$\{file\.id\}/);
    assert.match(panel, /Choose files/);
  });
});
