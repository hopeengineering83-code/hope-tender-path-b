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

describe("EngineActionPanel — read-only render states", () => {
  it("role mapping fails closed", () => {
    assert.equal(reviewerCanMutate, false);
    assert.equal(adminCanMutate, true);
    assert.equal(pmCanMutate, true);
    assert.equal(canMutateTender("VIEWER"), false);
    assert.equal(canMutateTender(null), false);
    assert.equal(canMutateTender(undefined), false);
  });

  it("omitted canMutate renders no mutation buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1" }));
    assertNoMutationControls(buttonLabels(container), "omitted canMutate");
    assert.match(container.textContent ?? "", /Read-only — Engine recovery actions require ADMIN or PROPOSAL_MANAGER role/);
  });

  it("REVIEWER normal state renders no mutation buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: reviewerCanMutate }));
    assertNoMutationControls(buttonLabels(container), "normal state");
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

  it("REVIEWER poll-timeout keeps the GET-only status check", async () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "ASYNC_POLL_TIMEOUT", jobId: "job-9", error: "Still running." },
    }));
    assertNoMutationControls(buttonLabels(container), "poll-timeout state");
    const checkButton = findButton(container, "Check status now");
    assert.ok(checkButton);
    fireEvent.click(checkButton!);
    await waitFor(() => assert.ok(calls.length > 0));
    assert.ok(calls.every((call) => call.method === "GET"));
    assert.ok(calls.some((call) => call.url.includes("/api/ai-jobs/job-9")));
  });

  it("REVIEWER failure and network states hide retries", () => {
    const failed = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed.", failedStage: "matching" },
    }));
    assertNoMutationControls(buttonLabels(failed.container), "failure state");
    assert.match(failed.container.textContent ?? "", /Read-only — retry actions require ADMIN or PROPOSAL_MANAGER role/);
    cleanup();

    const network = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "NETWORK_OR_RUNTIME_ERROR", nextAction: "RETRY_BACKGROUND_JOB", error: "Connection failed." },
    }));
    assertNoMutationControls(buttonLabels(network.container), "network state");
  });
});

describe("EngineActionPanel — mutating roles", () => {
  it("ADMIN sees one canonical Engine action and no client-policy choices", async () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: adminCanMutate }));
    const labels = buttonLabels(container);
    assert.equal(labels.filter((label) => label.includes("Start or resume Engine")).length, 1);
    assert.ok(!labels.some((label) => /Safe Mode|Full AI|Skip AI|Force run/i.test(label)));

    const runButton = findButton(container, "Start or resume Engine");
    assert.ok(runButton);
    fireEvent.click(runButton!);
    await waitFor(() => {
      assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/tenders/t1/engine")));
    });
    assert.ok(calls.every((call) => !/[?&](safe|skipAiRematch|force|maxChars)=/.test(call.url)));
  });

  it("PROPOSAL_MANAGER sees the same single canonical action", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: pmCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    const labels = buttonLabels(container);
    assert.equal(labels.filter((label) => label.includes("Start or resume Engine")).length, 1);
    assert.ok(!labels.some((label) => /Safe Mode|Full AI|Skip AI|Force run/i.test(label)));
  });

  it("ADMIN failure state exposes one policy-neutral retry", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: adminCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed." },
    }));
    assert.ok(findButton(container, "Retry durable Engine"));
    assert.ok(!buttonLabels(container).some((label) => /Safe Mode|Skip AI Rematch|Full AI/i.test(label)));
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
