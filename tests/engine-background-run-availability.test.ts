import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const engine = readFileSync("components/engine-action-panel.tsx", "utf8");
const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

describe("engine background-run availability", () => {
  it("keeps Safe Mode as the one primary engine action", () => {
    assert.match(engine, /Run Safe Mode — Recommended/);
    assert.match(engine, /safe: "true", skipAiRematch: "true"/);
  });

  it("keeps Full AI available as an advanced background refinement", () => {
    assert.match(engine, /Advanced AI refinement/);
    assert.match(engine, /Run Full AI in Background/);
    assert.match(engine, /onClick=\{\(\) => runEngineAsync\(false\)\}/);
  });

  it("renders only one always-visible workflow authority on the tender page", () => {
    assert.match(page, /<NextActionPanel tenderId=\{tender\.id\} \/>/);
    assert.doesNotMatch(page, /<TenderWorkflowActionCenter\b/);
    assert.doesNotMatch(page, /<TenderRecoveryCommandCenter\b/);
    assert.doesNotMatch(page, /<TenderReleaseStatePanel\b/);
    assert.doesNotMatch(page, /<FinalSubmissionControlCenter\b/);
  });

  it("keeps diagnostics separate from the operational workflow", () => {
    assert.match(page, /title="Diagnostics and audit"/);
    assert.match(page, /Open read-only Command Center/);
  });
});
