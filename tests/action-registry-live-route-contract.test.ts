import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("action registry matches production route owners", () => {
  it("uses the explicit durable AI Analyze route and one UI owner", () => {
    const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    const owner = read("components/workflow-step-links.tsx");
    assert.match(route, /export async function POST/);
    assert.match(route, /createAnalysisJob/);
    assert.match(route, /manualRequested:\s*true/);
    assert.match(route, /autoContinue:\s*false/);
    assert.match(owner, /manual-ai-analyze/);
    assert.equal(getTenderAction("AI_ANALYZE").mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.equal(getTenderAction("AI_ANALYZE").availability, "NORMAL");
    assert.equal(getTenderAction("AI_ANALYZE").owner, "WorkflowStepLinks");
  });

  it("uses the one explicit durable Engine contract", () => {
    const route = read("app/api/tenders/[id]/engine/route.ts");
    const enqueue = read("lib/engine/enqueue-engine-job.ts");
    const owner = read("components/workflow-step-links.tsx");
    assert.match(route, /export async function POST/);
    assert.match(route, /enqueueEngineJobForCurrentSources/);
    assert.match(route, /CLIENT_POLICY_OVERRIDE_REJECTED/);
    assert.match(enqueue, /manualRequested:\s*true/);
    assert.match(enqueue, /autoContinue:\s*true/);
    assert.match(owner, /\/engine`/);
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine");
    assert.equal(getTenderAction("RUN_ENGINE").availability, "NORMAL");
    assert.equal(getTenderAction("RUN_ENGINE").owner, "WorkflowStepLinks");
  });

  it("keeps Build Plan status-only because Engine owns automatic verification", () => {
    const route = read("app/api/tenders/[id]/build-plan/route.ts");
    const status = read("components/build-submission-plan-button.tsx");
    assert.match(route, /export async function GET/);
    assert.match(status, /method:\s*"GET"/);
    assert.doesNotMatch(status, /method:\s*"POST"/);
    assert.doesNotMatch(status, /<button/);
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").mutation, null);
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").availability, "NAVIGATION");
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").owner, "BuildSubmissionPlanButton");
  });

  it("does not invent a POST matching endpoint", () => {
    const route = read("app/api/tenders/[id]/matches/route.ts");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function PUT/);
    assert.doesNotMatch(route, /export async function POST/);
    assert.equal(getTenderAction("MATCH_EVIDENCE").mutation, null);
  });

  it("keeps authority review as navigation because the route is read-only", () => {
    const route = read("app/api/tenders/[id]/authority-review/route.ts");
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function POST/);
    assert.equal(getTenderAction("FINAL_APPROVAL").mutation, null);
    assert.equal(getTenderAction("FINAL_APPROVAL").owner, "AuthorityReviewPanel");
  });

  it("points Final ZIP to the one gated download owner", () => {
    const route = read("app/api/tenders/[id]/download/route.ts");
    const panel = read("components/export-readiness-panel.tsx");
    assert.match(route, /export async function GET/);
    assert.match(route, /type=zip/);
    assert.match(panel, /download\?type=zip/);
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").mutation, "GET /api/tenders/:id/download?type=zip");
    assert.equal(getTenderAction("DOWNLOAD_FINAL_ZIP").owner, "ExportReadinessPanel");
  });

  it("contains no nonexistent or client-policy workflow paths", () => {
    const mutations = listTenderActions().flatMap(([, action]) => action.mutation ? [action.mutation] : []);
    const joined = mutations.join("\n");
    assert.doesNotMatch(joined, /ai-analyze\?async=true/);
    assert.doesNotMatch(joined, /engine\?.*(?:safe|skip|maxChars|provider)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/match(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/approval(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/export\/zip/);
  });
});
