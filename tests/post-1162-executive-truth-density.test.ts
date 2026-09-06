import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const workspace = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

describe("post-1162 tender workspace density", () => {
  it("places the one canonical next action before every workflow stage", () => {
    const nextAction = workspace.indexOf("<NextActionPanel");
    const firstStage = workspace.indexOf("<WorkflowStage number={1}");
    assert.ok(nextAction > -1);
    assert.ok(firstStage > nextAction);
  });

  it("removes the three competing control-center surfaces from the normal workspace", () => {
    assert.doesNotMatch(workspace, /<TenderWorkflowActionCenter\b/);
    assert.doesNotMatch(workspace, /<TenderRecoveryCommandCenter\b/);
    assert.doesNotMatch(workspace, /<TenderReleaseStatePanel\b/);
    assert.doesNotMatch(workspace, /<FinalSubmissionControlCenter\b/);
  });

  it("collapses secondary diagnostics inside the owning workflow stage", () => {
    assert.match(workspace, /title="Extraction quality"/);
    assert.match(workspace, /title="AI diagnostics and assistance"/);
    assert.match(workspace, /title="Generation and review diagnostics"/);
    assert.match(workspace, /title="Submission audit trail"/);
    assert.match(workspace, /title="Diagnostics and audit"/);
    assert.doesNotMatch(workspace, /defaultOpen=\{true\}/);
  });

  it("does not make unsupported uniqueness claims in user-facing guidance", () => {
    assert.doesNotMatch(workspace, /Each major action appears once/);
  });
});