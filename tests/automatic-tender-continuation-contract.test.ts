import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const extraction = readFileSync("lib/ai-jobs/tender-extraction-service.ts", "utf8");
const autoPipeline = readFileSync("lib/ui/auto-pipeline.ts", "utf8");
const worker = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const manualRoute = readFileSync("app/api/tenders/[id]/manual-ai-analyze/route.ts", "utf8");
const engineRoute = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
const ownerContract = readFileSync("OWNER_AUTOMATION_CONTRACT.md", "utf8");

describe("MANUAL tender continuation contract — AI Analyze and Run Engine are manual user actions", () => {
  it("extraction does NOT queue AI_ANALYZE automatically", () => {
    // Strip comments before checking — the word "queueAutomaticTenderPipeline"
    // appears in comments explaining that it was INTENTIONALLY REMOVED.
    const codeOnly = extraction
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // The actual code must NOT call queueAutomaticTenderPipeline.
    assert.doesNotMatch(codeOnly, /queueAutomaticTenderPipeline/);
    // Instead, it returns EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED.
    assert.match(codeOnly, /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/);
    // The import of queueAutomaticTenderPipeline is removed.
    assert.doesNotMatch(codeOnly, /import.*queueAutomaticTenderPipeline/);
  });

  it("the browser auto-pipeline nudges ONLY EXTRACT_TEXT — never AI_ANALYZE", () => {
    assert.match(autoPipeline, /EXTRACT_TEXT_WORKER_ENDPOINT/);
    // AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported.
    assert.doesNotMatch(autoPipeline, /export const AI_ANALYZE_WORKER_ENDPOINT/);
    assert.match(autoPipeline, /AI_ANALYZE_WORKER_ENDPOINT is intentionally NOT exported/i);
    // The message tells the user to click "Run AI Analyze".
    assert.match(autoPipeline, /Run AI Analyze/i);
  });

  it("manual AI Analyze route sets autoContinue=false and manualRequested=true", () => {
    // FIX 1: After the atomic-manual-authority refactor, the route forwards
    // a `manualAuthority` parameter (source, actorUserId, authorizedAt) into
    // createAnalysisJob(), which persists manualRequested=true and
    // autoContinue=false atomically in the same transaction. The route no
    // longer patches these in a separate updateMany.
    const service = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(manualRoute, /manualAuthority:/);
    assert.match(manualRoute, /source: "manual-ai-analyze"/);
    assert.match(manualRoute, /actorUserId: actor\.id/);
    assert.match(manualRoute, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
    // The atomic write of manualRequested=true and autoContinue=false happens
    // in the service.
    assert.match(service, /manualRequested: true/);
    assert.match(service, /autoContinue: false/);
    // The race-window updateMany patch must NOT exist in the route.
    assert.doesNotMatch(manualRoute, /prisma\.aiJob\.updateMany/);
  });

  it("manual Run Engine route exists and requires authentication", () => {
    assert.match(engineRoute, /export async function POST/);
    assert.match(engineRoute, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
  });

  it("after manual Run Engine succeeds, downstream stages continue automatically", () => {
    // The worker chain: ENGINE_RUN → PROPOSAL_GENERATION → AUTO_FINALIZE
    assert.match(worker, /claimed\.jobType === "ENGINE_RUN"/);
    assert.match(worker, /nextJobType = "PROPOSAL_GENERATION"/);
    assert.match(worker, /claimed\.jobType === "PROPOSAL_GENERATION"/);
    assert.match(worker, /nextJobType = "AUTO_FINALIZE"/);
  });

  it("OWNER_AUTOMATION_CONTRACT documents manual AI Analyze and manual Run Engine", () => {
    assert.match(ownerContract, /Run AI Analyze/i);
    assert.match(ownerContract, /Run Engine/i);
    assert.match(ownerContract, /manual/i);
  });
});
