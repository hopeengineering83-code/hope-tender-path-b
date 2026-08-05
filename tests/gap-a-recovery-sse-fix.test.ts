import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getTenderAction } from "../lib/ui/action-registry";

const read = (path: string) => readFileSync(path, "utf8");

describe("AI Analyze is a MANUAL user action via POST /api/tenders/:id/manual-ai-analyze", () => {
  it("the canonical registry exposes AI_ANALYZE as a NORMAL action with a manual mutation", () => {
    const action = getTenderAction("AI_ANALYZE");
    assert.equal(action.mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.equal(action.owner, "AIAnalyzePanel");
    assert.equal(action.availability, "NORMAL");
  });

  it("the normal workflow owner never posts or streams AI analysis via SSE", () => {
    const owner = read("components/workflow-step-links.tsx");
    // workflow-step-links is navigation-only — no fetch, no SSE, no manual-ai-analyze call.
    // The actual AI Analyze button lives in the AIAnalyzePanel component, not in workflow-step-links.
    assert.doesNotMatch(owner, /method:\s*"POST"/);
    assert.doesNotMatch(owner, /run-next\?jobType/);
    assert.doesNotMatch(owner, /text\/event-stream|getReader\(\)/);
  });

  it("the manual AI Analyze route is durable and idempotent", () => {
    const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    assert.match(route, /export async function POST/);
    assert.match(route, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
    assert.match(route, /createAnalysisJob/);
    assert.match(route, /manualRequested:\s*true/);
    assert.match(route, /autoContinue:\s*false/);
  });
});
