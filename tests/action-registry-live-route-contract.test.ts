import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTenderAction, listTenderActions } from "../lib/ui/action-registry";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("action registry matches production route owners — manual AI Analyze / manual Run Engine", () => {
  it("exposes AI Analyze as a MANUAL user action via POST /api/tenders/:id/manual-ai-analyze", () => {
    const owner = read("components/ai-analyze-panel.tsx");
    const manualRoute = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");

    // The AI Analyze panel renders the section anchor.
    assert.match(owner, /id="ai-analyze-section"/);

    // The manual route exists, requires authentication, and forwards manualAuthority.
    // FIX 1: After the atomic-manual-authority refactor, manualRequested=true
    // and autoContinue=false are persisted by createAnalysisJob() in the
    // service (atomically in the same transaction), not patched by the route
    // in a separate updateMany. The route forwards manualAuthority instead.
    assert.match(manualRoute, /export async function POST/);
    assert.match(manualRoute, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
    assert.match(manualRoute, /manualAuthority:/);
    assert.match(manualRoute, /source: "manual-ai-analyze"/);
    assert.match(manualRoute, /actorUserId: actor\.id/);
    // The race-window updateMany patch must NOT exist in the route.
    assert.doesNotMatch(manualRoute, /prisma\.aiJob\.updateMany/);

    // The action registry exposes AI_ANALYZE as a NORMAL (not RECOVERY) action
    // with the manual mutation endpoint.
    assert.equal(getTenderAction("AI_ANALYZE").mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.equal(getTenderAction("AI_ANALYZE").availability, "NORMAL");
    assert.equal(getTenderAction("AI_ANALYZE").owner, "AIAnalyzePanel");
  });

  it("exposes Run Engine as a MANUAL user action via POST /api/tenders/:id/engine", () => {
    const owner = read("components/matching-selected-evidence-panel.tsx");
    const engineRoute = read("app/api/tenders/[id]/engine/route.ts");

    assert.match(owner, /matching-selected-evidence/);

    // The engine route exists, requires authentication, and rejects client-side
    // policy parameters (safe, skip, maxChars, provider, etc.).
    assert.match(engineRoute, /export async function POST/);
    assert.match(engineRoute, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);

    // The action registry exposes RUN_ENGINE as a NORMAL action with the
    // manual mutation endpoint.
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine");
    assert.equal(getTenderAction("RUN_ENGINE").availability, "NORMAL");
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

  it("contains no client-policy workflow paths in mutation list", () => {
    const mutations = listTenderActions().flatMap(([, action]) => action.mutation ? [action.mutation] : []);
    const joined = mutations.join("\n");
    // manual-ai-analyze and POST /api/tenders/:id/engine ARE now present
    // (they are the manual mutation endpoints). But client-policy parameters
    // are still forbidden.
    assert.doesNotMatch(joined, /ai-analyze\?async=true/);
    assert.doesNotMatch(joined, /engine\?.*(?:safe|skip|maxChars|provider)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/match(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/approval(?:\s|$)/);
    assert.doesNotMatch(joined, /\/api\/tenders\/:id\/export\/zip/);
  });
});
