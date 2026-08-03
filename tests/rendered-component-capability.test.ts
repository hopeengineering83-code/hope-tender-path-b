// Rendered-component tests for the canonical server-controlled Engine panel.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  React,
  renderWithRouter,
  installFetchMock,
  buttonLabels,
  findButton,
  fireEvent,
  waitFor,
  cleanup,
  type FetchCall,
} from "./helpers/rtl-env";
import {
  EngineActionPanel,
  executeEngineRun,
  executeEngineRunAsync,
  ENGINE_MUTATION_BLOCKED_RESULT,
  type EngineRunCallbacks,
} from "../components/engine-action-panel";
import { canMutateTender } from "../lib/recovery-command-actions";

const h = React.createElement;
const MUTATION_LABELS = [
  "Start or resume Engine",
  "Repair source evidence",
  "Retry durable Engine",
];

function assertNoMutationControls(labels: string[], where: string) {
  for (const label of MUTATION_LABELS) {
    assert.ok(
      !labels.some((value) => value.includes(label)),
      `read-only render must NOT contain "${label}" (${where}); rendered buttons: ${JSON.stringify(labels)}`,
    );
  }
}

let calls: FetchCall[];
beforeEach(() => {
  calls = installFetchMock([
    { match: "/engine", method: "POST", json: { error: "No job returned in component dispatch fixture." } },
    { match: "/api/ai-jobs/run-next", method: "POST", json: { ok: true } },
    { match: "/api/ai-jobs/", method: "GET", json: { job: { status: "RUNNING", steps: [] } } },
  ]);
});
afterEach(() => cleanup());

const reviewerCanMutate = canMutateTender("REVIEWER");
const adminCanMutate = canMutateTender("ADMIN");
const pmCanMutate = canMutateTender("PROPOSAL_MANAGER");

describe("EngineActionPanel — text-based status (Gap 2: buttons removed)", () => {
  it("role mapping fails closed", () => {
    assert.equal(reviewerCanMutate, false);
    assert.equal(adminCanMutate, true);
    assert.equal(pmCanMutate, true);
    assert.equal(canMutateTender("VIEWER"), false);
    assert.equal(canMutateTender(null), false);
    assert.equal(canMutateTender(undefined), false);
  });

  it("renders text-based status with no buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1" }));
    assertNoMutationControls(buttonLabels(container), "no canMutate");
    assert.match(container.textContent ?? "", /Closing this browser does not stop processing/);
  });

  it("REVIEWER sees truthful durable-processing text", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assertNoMutationControls(buttonLabels(container), "inventory state");
    assert.match(container.textContent ?? "", /Closing this browser does not stop processing/);
    assert.match(container.textContent ?? "", /40 expert\(s\), 10 project\(s\)/);
  });

  it("renders text-based status for all roles (no buttons)", () => {
    const adminPanel = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: adminCanMutate }));
    assertNoMutationControls(buttonLabels(adminPanel.container), "ADMIN");
    cleanup();

    const pmPanel = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: pmCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assertNoMutationControls(buttonLabels(pmPanel.container), "PROPOSAL_MANAGER");
  });

  it("failure state shows text diagnostics without retry buttons", () => {
    const failed = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: adminCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed." },
    }));
    assertNoMutationControls(buttonLabels(failed.container), "failure state");
    assert.match(failed.container.textContent ?? "", /Engine needs attention/);
  });
});

describe("EngineActionPanel dispatch guards", () => {
  function collectCallbacks() {
    const results: unknown[] = [];
    const callbacks: EngineRunCallbacks = {
      setRunning: () => {},
      setResult: (result) => results.push(result),
      setAsyncStatus: () => {},
      onSuccess: () => {},
    };
    return { results, callbacks };
  }

  it("executeEngineRun with canMutate=false sends no request", async () => {
    const { results, callbacks } = collectCallbacks();
    await executeEngineRun({ tenderId: "t1", canMutate: false, callbacks });
    assert.equal(calls.length, 0);
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRunAsync with canMutate=false sends no request", async () => {
    const { results, callbacks } = collectCallbacks();
    await executeEngineRunAsync({ tenderId: "t1", canMutate: false, callbacks });
    assert.equal(calls.length, 0);
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRun with canMutate=true dispatches one policy-neutral POST", async () => {
    const { callbacks } = collectCallbacks();
    await executeEngineRun({ tenderId: "t1", canMutate: true, callbacks });
    const engineCalls = calls.filter((call) => call.method === "POST" && call.url.includes("/api/tenders/t1/engine"));
    assert.equal(engineCalls.length, 1);
    assert.equal(engineCalls[0]?.url.endsWith("/api/tenders/t1/engine"), true);
  });
});
