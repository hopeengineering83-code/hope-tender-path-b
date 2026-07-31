import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Engine background-run availability", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");
  const panel = read("components/engine-action-panel.tsx");
  const worker = read("lib/ai-job-handlers.ts");

  it("always persists an ENGINE_RUN job and returns accepted status", () => {
    assert.match(route, /enqueueEngineJobForCurrentSources/);
    assert.match(route, /jobId: enqueueResult\.id/);
    assert.match(route, /persistedStatus: enqueueResult\.status/);
    assert.match(route, /statusEndpoint: `\/api\/ai-jobs\/\$\{enqueueResult\.id\}`/);
    assert.match(route, /\}, \{ status: 202 \}\)/);
    assert.doesNotMatch(route, /runTenderEngine\(/);
  });

  it("keeps compatibility callers on the same durable workflow", () => {
    assert.match(panel, /export async function executeEngineRun\(options: EngineRunOptions\)/);
    assert.match(panel, /await executeEngineRunAsync\(options\)/);
    assert.doesNotMatch(panel, /executeEngineRunSync/);
  });

  it("polls a persisted job independently of the enqueue request", () => {
    assert.match(panel, /fetch\(`\/api\/ai-jobs\/\$\{jobId\}`, \{ method: "GET" \}\)/);
    assert.match(panel, /MAX_POLL_DURATION_MS = 10 \* 60 \* 1000/);
    assert.match(panel, /TERMINAL_JOB_STATUSES/);
    assert.match(panel, /Closing this browser does not stop processing/);
    assert.match(panel, /durable worker continues/);
  });

  it("wakes the worker only after the durable row exists", () => {
    const enqueuePos = panel.indexOf("const jobId = enqueueData.jobId");
    const wakePos = panel.indexOf('fetch("/api/ai-jobs/run-next"');
    assert.ok(enqueuePos >= 0 && wakePos > enqueuePos);
    assert.match(panel, /persisted job is[\s\S]*already durable/);
  });

  it("registers the ENGINE_RUN worker and revalidates source authority", () => {
    assert.match(worker, /ENGINE_RUN/);
    assert.match(worker, /sourceRevision/);
    assert.match(worker, /ENGINE_SOURCE_REVISION_CHANGED/);
    assert.match(worker, /checkEnginePostconditions/);
  });
});
