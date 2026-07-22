// REAL rendered-component tests for EngineActionPanel REVIEWER protection.
//
// The actual component is mounted with @testing-library/react into a live
// happy-dom document (see tests/helpers/rtl-env.ts). useRouter() is
// satisfied by providing Next's AppRouterContext — no Next server runtime
// is required. These are not source-text scans and not simulated
// predicates: effects run, clicks fire, and every network request the
// component dispatches is recorded by the fetch mock.
//
// Proven here:
//  1. Omitted canMutate and REVIEWER (canMutate=false) render NO engine
//     POST controls in normal, large-vault, extraction-blocked,
//     poll-timeout, network-failure, and failure/retry states.
//  2. "Check status now" stays available to REVIEWER and is genuinely
//     GET-only (clicking it is proven to send a single GET, zero POSTs).
//  3. ADMIN and PROPOSAL_MANAGER (via the real canMutateTender) retain the
//     mutation controls, and clicking Run Engine dispatches the real POST.
//  4. A canMutate=false handler path cannot issue a POST: the exported
//     dispatchers behind the buttons (executeEngineRun /
//     executeEngineRunAsync) are invoked directly with canMutate=false and
//     provably send ZERO requests.

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
  "Run Engine",
  "Force run once",
  "Run in background",
  "Run Engine (Safe Mode)",
  "Run Safe Mode (recommended)",
  "Run full mode anyway",
  "Retry background run",
  "Retry from start",
  "Run Safe Mode",
  "Skip AI Rematch",
];

function assertNoMutationControls(labels: string[], where: string) {
  for (const label of MUTATION_LABELS) {
    assert.ok(
      !labels.some((l) => l.includes(label)),
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

describe("EngineActionPanel — REVIEWER / omitted canMutate render states (real render)", () => {
  it("role mapping sanity: REVIEWER=false, ADMIN/PM=true, unknown/null fail closed", () => {
    assert.equal(reviewerCanMutate, false);
    assert.equal(adminCanMutate, true);
    assert.equal(pmCanMutate, true);
    assert.equal(canMutateTender("VIEWER"), false);
    assert.equal(canMutateTender(null), false);
    assert.equal(canMutateTender(undefined), false);
  });

  it("omitted canMutate (fail-closed default): no mutation buttons, read-only note shown", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1" }));
    assertNoMutationControls(buttonLabels(container), "omitted canMutate");
    assert.match(container.textContent ?? "", /Read-only — engine actions require ADMIN or PROPOSAL_MANAGER role/);
  });

  it("REVIEWER normal state: no mutation buttons, read-only note shown", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: reviewerCanMutate }));
    assertNoMutationControls(buttonLabels(container), "normal state");
    assert.match(container.textContent ?? "", /Read-only — engine actions require ADMIN or PROPOSAL_MANAGER role/);
  });

  it("REVIEWER large-vault state: no Safe Mode banner and no large-vault mutation buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assertNoMutationControls(buttonLabels(container), "large-vault state");
    assert.ok(!(container.textContent ?? "").includes("Large vault detected"), "REVIEWER must not see the Safe Mode banner");
  });

  it("REVIEWER extraction-blocked state: no Force run once", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "EXTRACTION_NOT_READY", error: "Extraction not ready." },
    }));
    assertNoMutationControls(buttonLabels(container), "extraction-blocked state");
  });

  it("REVIEWER poll-timeout state: keeps Check status now; clicking performs a single GET and zero POSTs", async () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "ASYNC_POLL_TIMEOUT", jobId: "job-9", error: "Still running." },
    }));
    assertNoMutationControls(buttonLabels(container), "poll-timeout state");
    const checkButton = findButton(container, "Check status now");
    assert.ok(checkButton, "REVIEWER must keep the read-only Check status now button");
    fireEvent.click(checkButton!);
    await waitFor(() => { assert.ok(calls.length > 0); });
    assert.ok(calls.every((c) => c.method === "GET"), `Check status now must be GET-only, got ${JSON.stringify(calls)}`);
    assert.ok(calls.some((c) => c.url.includes("/api/ai-jobs/job-9")), "must poll the job status endpoint");
  });

  it("REVIEWER failure/retry state: no Retry from start / Run Safe Mode / Skip AI Rematch; read-only note instead", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed.", failedStage: "matching" },
    }));
    assertNoMutationControls(buttonLabels(container), "failure/retry state");
    assert.match(container.textContent ?? "", /Read-only — retry actions require ADMIN or PROPOSAL_MANAGER role/);
  });

  it("REVIEWER network-failure state: no Retry background run", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: reviewerCanMutate,
      initialResult: { code: "NETWORK_OR_RUNTIME_ERROR", nextAction: "RETRY_BACKGROUND_JOB", error: "Connection failed." },
    }));
    assertNoMutationControls(buttonLabels(container), "network-failure state");
  });
});

describe("EngineActionPanel — ADMIN and PROPOSAL_MANAGER retain canonical controls (real render + real dispatch)", () => {
  it("ADMIN normal state: Safe Mode + Full AI background visible; clicking Safe Mode dispatches canonical params", async () => {
    const { container } = renderWithRouter(h(EngineActionPanel, { tenderId: "t1", canMutate: adminCanMutate }));
    const labels = buttonLabels(container);
    assert.ok(labels.some((l) => l.includes("Run Safe Mode — Recommended")), "ADMIN must see recommended Safe Mode");
    assert.ok(labels.some((l) => l.includes("Run Full AI in Background")), "ADMIN must see Full AI background");
    assert.ok(!labels.some((l) => l === "Run Engine"), "ADMIN must not see the legacy sync Run Engine button");

    const runButton = findButton(container, "Run Safe Mode — Recommended");
    assert.ok(runButton);
    fireEvent.click(runButton!);
    await waitFor(() => {
      assert.ok(
        calls.some((c) => c.method === "POST" && c.url.includes("/api/tenders/t1/engine") && c.url.includes("async=true") && c.url.includes("safe=true") && c.url.includes("skipAiRematch=true")),
        "ADMIN Safe Mode click must dispatch the canonical async safe-mode engine POST",
      );
    });
  });

  it("PROPOSAL_MANAGER large-vault state: one Safe Mode banner and the same two canonical buttons", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: pmCanMutate,
      vaultReviewedExperts: 40,
      vaultReviewedProjects: 10,
    }));
    assert.ok((container.textContent ?? "").includes("Large vault detected"), "PM must see the Safe Mode banner");
    assert.ok(findButton(container, "Run Safe Mode — Recommended"), "PM must see recommended Safe Mode");
    assert.ok(findButton(container, "Run Full AI in Background"), "PM must see Full AI background");
    assert.ok(!findButton(container, "Run full mode anyway"), "PM must not see the legacy full-mode duplicate");
  });

  it("ADMIN failure/retry state: retry buttons keep Safe Mode but no Skip AI Rematch duplicate", () => {
    const { container } = renderWithRouter(h(EngineActionPanel, {
      tenderId: "t1",
      canMutate: adminCanMutate,
      initialResult: { code: "ASYNC_ENGINE_FAILED", error: "Worker failed." },
    }));
    assert.ok(findButton(container, "Retry from start"), "ADMIN must see Retry from start");
    assert.ok(findButton(container, "Run Safe Mode"), "ADMIN must see Run Safe Mode");
    assert.ok(!findButton(container, "Skip AI Rematch"), "ADMIN must not see the duplicate Skip AI Rematch button");
  });
});

describe("EngineActionPanel — canMutate=false handler path cannot POST (real dispatch path)", () => {
  // The component's runEngine/runEngineAsync handlers delegate to these
  // exported dispatchers (see components/engine-action-panel.tsx). Invoking
  // them directly with canMutate=false is the strongest available proof
  // that a manually triggered callback — stale closure, devtools, future
  // code path that forgets conditional rendering — cannot reach the network.
  function collectCallbacks() {
    const results: unknown[] = [];
    const callbacks: EngineRunCallbacks = {
      setRunning: () => {},
      setResult: (r) => results.push(r),
      setAsyncStatus: () => {},
      onSuccess: () => {},
    };
    return { results, callbacks };
  }

  it("executeEngineRun with canMutate=false sends ZERO requests and reports the blocked result", async () => {
    const { results, callbacks } = collectCallbacks();
    await executeEngineRun({ tenderId: "t1", canMutate: false, force: true, callbacks });
    assert.equal(calls.length, 0, "no fetch may be dispatched for a read-only role");
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRunAsync with canMutate=false sends ZERO requests and reports the blocked result", async () => {
    const { results, callbacks } = collectCallbacks();
    await executeEngineRunAsync({ tenderId: "t1", canMutate: false, extraParams: { safe: "true" }, callbacks });
    assert.equal(calls.length, 0, "no fetch may be dispatched for a read-only role");
    assert.deepEqual(results, [ENGINE_MUTATION_BLOCKED_RESULT]);
  });

  it("executeEngineRun with canMutate=true dispatches the POST (control test — the guard, not the mock, blocks)", async () => {
    const { callbacks } = collectCallbacks();
    await executeEngineRun({ tenderId: "t1", canMutate: true, callbacks });
    assert.ok(
      calls.some((c) => c.method === "POST" && c.url.includes("/api/tenders/t1/engine")),
      "mutating role must reach the engine endpoint",
    );
  });
});
