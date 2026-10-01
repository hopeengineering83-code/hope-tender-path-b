import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("real Preview panels expose one canonical action", () => {
  it("makes Pipeline Diagnostic consume the canonical workflow decision", () => {
    const source = read("app/api/tenders/[id]/pipeline-diagnostic/route.ts");
    assert.match(source, /getCanonicalTenderWorkflowDecision/);
    assert.match(source, /presentTwoActionWorkflowDecision/);
    assert.match(source, /canonicalDecision:\s*workflowDecision/);
    assert.match(source, /blockers:\s*workflowDecision\.blockerDetails/);
    assert.doesNotMatch(source, /label:\s*"Generate proposal documents"|label:\s*"Validate and review generated documents"|label:\s*"Open exceptional Build Plan recovery"/);
  });

  it("does not return invented manual finalization or export re-check actions", () => {
    const autoFinalize = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.doesNotMatch(autoFinalize, /nextAction:[^\n]*RECHECK_EXPORT_READINESS/);
    assert.match(autoFinalize, /nextAction:\s*readiness\.ok\s*\?\s*"EXPORT_READY"\s*:\s*"AUTOMATIC_PROCESSING"/);
  });

  it("keeps derived-plan recovery at the one manual Run Engine gate", () => {
    const readiness = read("lib/tender-generation-readiness.ts");
    const derivedPlan = readiness.slice(readiness.indexOf("FULL_PROPOSAL_DERIVED_PLAN_UNCONFIRMED"), readiness.indexOf("FULL_PROPOSAL_DERIVED_PLAN_UNCONFIRMED") + 700);
    assert.match(derivedPlan, /nextAction:\s*"RUN_ENGINE"/);
    assert.doesNotMatch(derivedPlan, /CONFIRM_SUBMISSION_PLAN|confirm before generating/i);
  });

  it("never claims Run Engine starts automatically", () => {
    const actions = read("lib/recovery-command-actions.ts");
    const compatibility = actions.slice(actions.indexOf("RUN_ENGINE_OR_APPROVE_ANALYSIS:"), actions.indexOf("OPEN_DASHBOARD:"));
    assert.match(compatibility, /start Run Engine manually/);
    assert.doesNotMatch(compatibility, /Engine starts automatically/i);
  });
});
