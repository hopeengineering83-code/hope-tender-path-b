// Real rendered-component tests for EngineActionPanel role protection and
// mutation dispatch. The component is mounted into happy-dom; effects, clicks,
// and fetch calls are real within the test environment.

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
  "Run Safe Mode",
  "Run Full AI in Background",
  "Force run once",
  "Retry background run",
  "Retry from start",
  "Skip AI Rematch",
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
    { match: "/engine", method: "POST", json: { success: true, tender: {} } },
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
    assert.match(container.textContent ?? "", /Read-only — engine actions require ADMIN or PROPOSAL_MANAGER role/);
  });

  it("REVIEWER normal state renders no mutation buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: reviewerCanMutate }));
    assertNoMutationControls(buttonLabels(container), "normal state");
  });

  it("REVIEWER large-vault state hides recommendation and mutation controls", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assertNoMutationControls(buttonLabels(container), "large-vault state");
    assert.ok(!(container.textContent ?? "").includes("Large reviewed vault"));
  });

  it("REVIEWER extraction-blocked state has no force action", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "EXTRACTION_NOT_READY", error: "Extraction not ready." },
    }));
    assertNoMutationControls(buttonLabels(container), "extraction-blocked state");
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
  it("ADMIN sees one primary Safe Mode and one advanced Full AI action", async () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: adminCanMutate }));
    const labels = buttonLabels(container);
    assert.equal(labels.filter((label) => label.includes("Run Safe Mode")).length, 1);
    assert.equal(labels.filter((label) => label.includes("Run Full AI in Background")).length, 1);
    assert.match(container.textContent ?? "", /Advanced AI refinement/);

    const runButton = findButton(container, "Run Safe Mode — Recommended");
    assert.ok(runButton);
    fireEvent.click(runButton!);
    await waitFor(() => {
      assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("/api/tenders/t1/engine")));
    });
  });

  it("PROPOSAL_MANAGER sees the large-vault recommendation without duplicate actions", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: pmCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assert.ok((container.textContent ?? "").includes("Large reviewed vault"));
    const labels = buttonLabels(container);
    assert.equal(labels.filter((label) => label.includes("Run Safe Mode")).length, 1);
    assert.equal(labels.filter((label) => label.includes("Run Full AI in Background")).length, 1);
  });

  it("ADMIN failure state retains recovery actions", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: adminCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed." },
    }));
    assert.ok(findButton(container, "Retry from start"));
    assert.ok(findButton(container, "Skip AI Rematch"));
    assert.equal(buttonLabels(container).filter((label) => label.includes("Run Safe Mode")).length, 2);
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
    await executeEngineRun({ tenderId: "t1", canMutate: false, force: true, callbacks });
    assert.equal(calls.length, 0);
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRunAsync with canMutate=false sends no request", async () => {
    const { results, callbacks } = collectCallbacks();
    await executeEngineRunAsync({ tenderId: "t1", canMutate: false, extraParams: { safe: "true" }, callbacks });
    assert.equal(calls.length, 0);
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRun with canMutate=true dispatches the POST", async () => {
    const { callbacks } = collectCallbacks();
    await executeEngineRun({ tenderId: "t1", canMutate: true, callbacks });
    assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("/api/tenders/t1/engine")));
  });
});
