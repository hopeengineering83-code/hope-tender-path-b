import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("action registry matches production route owners", () => {
  it("keeps AI Analyze automatic and exposes status/recovery navigation only", () => {
    const pipeline = read("lib/ai-jobs/automatic-tender-pipeline.ts");
    const owner = read("components/ai-analyze-panel.tsx");
    const workflow = read("components/workflow-step-links.tsx");

    assert.match(pipeline, /autoContinue:\s*true/);
    assert.match(pipeline, /manualRequested:\s*false/);
    assert.doesNotMatch(pipeline, /status:\s*"CANCELED"/);
    assert.match(owner, /id="ai-analyze-section"/);
    assert.doesNotMatch(workflow, /manual-ai-analyze/);
    assert.equal(getTenderAction("AI_ANALYZE").mutation, null);
    assert.equal(getTenderAction("AI_ANALYZE").availability, "RECOVERY");
    assert.equal(getTenderAction("AI_ANALYZE").owner, "AIAnalyzePanel");
  });

  it("keeps Engine worker-owned and exposes matching status/recovery navigation only", () => {
    const worker = read("app/api/ai-jobs/run-next/route.ts");
    const owner = read("components/matching-selected-evidence-panel.tsx");
    const workflow = read("components/workflow-step-links.tsx");

    assert.match(worker, /claimed\.jobType === "AI_ANALYZE"/);
    assert.match(worker, /nextJobType = "ENGINE_RUN"/);
    assert.match(owner, /matching-selected-evidence/);
    assert.doesNotMatch(workflow, /method:\s*"POST"/);
    assert.equal(getTenderAction("RUN_ENGINE").mutation, null);
    assert.equal(getTenderAction("RUN_ENGINE").availability, "RECOVERY");
    assert.equal(getTenderAction("RUN_ENGINE").owner, "MatchingSelectedEvidencePanel");
  });

  it("keeps Build Plan status-only because Engine owns automatic verification", () => {
    const route = read("app/api/tenders/[id]/build-plan/route.ts");
    const status = read("components/build-submission-plan-button.tsx");
    const panel = read("components/submission-plan-completeness-panel.tsx");
    assert.match(route, /export async function GET/);
    assert.match(status, /method:\s*"GET"/);
    assert.doesNotMatch(status, /method:\s*"POST"/);
    assert.doesNotMatch(status, /<button/);
    assert.equal((panel.match(/<BuildSubmissionPlanButton/g) ?? []).length, 1);
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").mutation, null);
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").availability, "NAVIGATION");
    assert.equal(getTenderAction("BUILD_SUBMISSION_PLAN").owner, "SubmissionPlanCompletenessPanel");
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
    assert.doesNotMatch(joined, /manual-ai-analyze/);
    assert.doesNotMatch(joined, /POST \/api\/tenders\/:id\/engine/);
    assert.doesNotMatch(joined, /ai-analyze\?async=true/);
    assert.doesNotMatch(joined, /engine\?.*(?:safe|skip|maxChars|provider)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/match(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/approval(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/export\/zip/);
  });
});
