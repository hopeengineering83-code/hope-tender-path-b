import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readApp(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("automatic Build Plan authority", () => {
  const service = readApp("lib/engine/automatic-build-plan.ts");
  const buildRoute = readApp("app/api/tenders/[id]/build-plan/route.ts");
  const compatibilityRoute = readApp("app/api/tenders/[id]/build-plan/confirm/route.ts");
  const jobHandlers = readApp("lib/ai-job-handlers.ts");
  const engineRoute = readApp("app/api/tenders/[id]/engine/route.ts");
  const button = readApp("components/build-submission-plan-button.tsx");
  const truthPanel = readApp("components/submission-plan-truth-panel.tsx");
  const submissionPlanRoute = readApp("app/api/tenders/[id]/submission-plan/route.ts");

  it("machine verification preserves serializable fail-closed authority", () => {
    assert.match(service, /isolationLevel: "Serializable"/);
    assert.match(service, /validateBuildPlanForConfirmation/);
    assert.match(service, /computeTenderBuildPlanHash/);
    assert.match(service, /status: "CONFIRMED"/);
    assert.match(service, /confirmedRevision: candidateRevision/);
    assert.match(service, /confirmedContentHash: currentHash/);
    assert.match(service, /confirmedBy: AUTOMATIC_BUILD_PLAN_ACTOR/);
    assert.match(service, /confirmedById: null/);
    assert.match(service, /where:\s*\{[\s\S]*?status: "DRAFT"[\s\S]*?revision: candidateRevision[\s\S]*?contentHash: candidateHash/);
  });

  it("normal and compatibility Build Plan routes call automatic verification", () => {
    assert.match(buildRoute, /buildAndVerifyBuildPlan/);
    assert.match(buildRoute, /authorizesGeneration: true/);
    assert.match(buildRoute, /AUTOMATIC_SOURCE_GROUNDED|confirmationMode/);
    assert.match(compatibilityRoute, /buildAndVerifyBuildPlan/);
    assert.doesNotMatch(compatibilityRoute, /confirmedById: actor\.id/);
    assert.doesNotMatch(compatibilityRoute, /Build Plan confirmed after source-grounded validation/);
  });

  it("background and direct Engine paths finish automatic plan verification", () => {
    const legacyCall = jobHandlers.indexOf("const result = await legacyHandler(ctx)");
    const automaticCall = jobHandlers.indexOf("buildAndVerifyBuildPlan", legacyCall);
    assert.ok(legacyCall >= 0 && automaticCall > legacyCall, "automatic Build Plan must run after Engine persistence");
    assert.match(jobHandlers, /build-plan\.complete/);
    assert.match(engineRoute, /postconditions\.ok[\s\S]*?buildAndVerifyBuildPlan/);
    assert.match(engineRoute, /automaticBuildPlan/);
  });

  it("removes the human review checkbox and confirmation action", () => {
    assert.doesNotMatch(button, /setReviewed|\[reviewed,/);
    assert.doesNotMatch(button, /Confirm reviewed Build Plan/);
    assert.doesNotMatch(button, /I reviewed the complete file list/);
    assert.doesNotMatch(button, /\/build-plan\/confirm/);
    assert.match(button, /Build and verify plan/);
    assert.match(button, /No manual confirmation is required/);
  });

  it("public status describes automatic recovery instead of user confirmation", () => {
    assert.doesNotMatch(truthPanel, /Review and confirm Build Plan/);
    assert.doesNotMatch(truthPanel, /requiresUserConfirmation/);
    assert.match(truthPanel, /Automatic Build Plan pending/);
    assert.match(submissionPlanRoute, /requiresUserConfirmation: false/);
    assert.match(submissionPlanRoute, /automaticPlanPending/);
  });
});
