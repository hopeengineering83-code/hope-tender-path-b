import { after, before, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  testAutomaticChainCapabilities,
  diagnosticDeadlineFrom,
  DIAGNOSTIC_RESPONSE_RESERVE_MS,
  MIN_PROVIDER_TEST_BUDGET_MS,
} from "../lib/ai-provider-capability-test";
import { getAutomaticProviderOrder, providerAutomaticEligibility } from "../lib/ai-provider-registry";

// ─── What this file proves ───────────────────────────────────────────────────
//
// The operator diagnostic drives up to ten REAL provider round-trips, serially,
// inside a serverless route with a hard execution limit. Nothing bounded it to
// that limit: the loop ran until the platform killed the worker, which returns a
// 504 with no body. Every provider result already measured was thrown away, so
// an operator running the diagnostic to find out why AI Analyze was failing
// learned nothing — including nothing about the providers that HAD answered.
//
// These tests use mock providers with controllable latency to prove the route
// now exits cooperatively before its own deadline and returns truthful partial
// state: what it measured, and exactly what it never got to.

const originalFetch = globalThis.fetch;
const touchedEnv = new Map<string, string | undefined>();

/** One record per outbound request, so serialisation can be checked. */
type Call = { host: string; path: string; startedAt: number; endedAt: number | null };
let calls: Call[] = [];

/** Hosts whose requests hang until aborted. */
const SLOW_HOSTS = new Set(["api.mistral.ai", "api.z.ai", "api.cerebras.ai"]);

function setEnv(name: string, value: string) {
  if (!touchedEnv.has(name)) touchedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * A provider that never answers. It honours the AbortSignal, so a test that
 * passes proves the caller really cancelled the socket — not that it gave up
 * waiting while the request carried on.
 */
function hangUntilAborted(signal: AbortSignal | null | undefined, call: Call): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return; // never settles; the test's own deadline is the bound
    const onAbort = () => {
      call.endedAt = Date.now();
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

before(() => {
  // groq answers instantly. mistral / zai / cerebras hang. Everything else is
  // left unconfigured, so the chain's shape is deterministic.
  for (const prefix of ["GROQ", "MISTRAL", "ZAI", "CEREBRAS"]) {
    setEnv(`${prefix}_API_KEY`, `test-${prefix.toLowerCase()}-key`);
    setEnv(`${prefix}_PROPOSAL_MODEL`, "mock-model");
    setEnv(`${prefix}_ANALYSIS_MODEL`, "mock-model");
    setEnv(`${prefix}_FAST_MODEL`, "mock-model");
  }
  for (const prefix of ["GEMINI", "OPENROUTER", "OPENAI", "TOGETHER", "DEEPSEEK", "ANTHROPIC"]) {
    setEnv(`${prefix}_API_KEY`, "");
  }

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const call: Call = { host: url.hostname, path: url.pathname, startedAt: Date.now(), endedAt: null };
    calls.push(call);

    if (SLOW_HOSTS.has(url.hostname)) {
      return hangUntilAborted(init?.signal ?? null, call);
    }

    call.endedAt = Date.now();
    if (url.pathname.endsWith("/models")) {
      return jsonResponse({ data: [{ id: "mock-model" }] });
    }
    return jsonResponse({ choices: [{ message: { content: "OK" } }] });
  }) as typeof fetch;
});

beforeEach(() => {
  calls = [];
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of touchedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("diagnosticDeadlineFrom", () => {
  it("derives the deadline from the route's own maxDuration and keeps a response reserve", () => {
    const now = 1_700_000_000_000;
    const deadline = diagnosticDeadlineFrom(60, now);
    assert.equal(deadline, now + 60_000 - DIAGNOSTIC_RESPONSE_RESERVE_MS);
    // The reserve is the whole point: summarising, the audit write and JSON
    // serialisation must happen INSIDE the execution window, not after it.
    assert.ok(deadline < now + 60_000);
    assert.ok(DIAGNOSTIC_RESPONSE_RESERVE_MS >= 5_000);
  });

  it("never returns a deadline already in the past for a short route budget", () => {
    const now = 1_700_000_000_000;
    assert.equal(diagnosticDeadlineFrom(1, now), now + MIN_PROVIDER_TEST_BUDGET_MS);
  });
});

describe("chain diagnostic under a request deadline", () => {
  it("stops before its deadline and reports what it never tested", async () => {
    const budgetMs = 6_000;
    const startedAt = Date.now();
    const run = await testAutomaticChainCapabilities({
      capabilities: ["connectivity"],
      deadlineAt: startedAt + budgetMs,
    });
    const elapsed = Date.now() - startedAt;

    // 1. Cooperative exit. Unbounded, four hanging round-trips at their static
    //    timeouts would run far past this; the run must land on ITS clock.
    assert.ok(
      elapsed <= budgetMs + 2_500,
      `chain ran ${elapsed}ms against a ${budgetMs}ms budget`,
    );

    // 2. It says so, rather than presenting a partial answer as a whole one.
    assert.equal(run.deadlineExceeded, true);
    assert.ok(run.notTested.length > 0);
    assert.equal(run.chainLength, getAutomaticProviderOrder().length);

    // 3. Results actually completed are still returned. Groq answered before
    //    the slow providers ate the budget, and that measurement survives.
    const groq = run.reports.find((report) => report.provider === "groq");
    assert.ok(groq, "groq was contacted first and must be reported");
    assert.equal(groq.results.some((result) => result.status === "ok"), true);

    // 4. Nothing is invented. Every untested provider is one that WOULD have
    //    been contacted — never a provider we already know is unconfigured.
    for (const untested of run.notTested) {
      assert.equal(
        providerAutomaticEligibility(untested.provider).eligible,
        true,
        `${untested.provider} was reported untested but is not even eligible`,
      );
      assert.match(untested.reason, /not tested/i);
    }

    // 5. No contradiction: a provider that produced a real verdict is never
    //    also listed as untested.
    const measured = new Set(
      run.reports
        .filter((report) => report.results.some((r) => r.status === "ok" || r.status === "failed"))
        .map((report) => report.provider),
    );
    for (const untested of run.notTested) {
      assert.equal(measured.has(untested.provider), false, `${untested.provider} is both measured and untested`);
    }
  });

  it("contacts nobody when the deadline has already passed", async () => {
    const run = await testAutomaticChainCapabilities({
      capabilities: ["connectivity"],
      deadlineAt: Date.now() - 1,
    });

    assert.equal(calls.length, 0, "an expired budget must not open a single socket");
    assert.equal(run.deadlineExceeded, true);

    const eligible = getAutomaticProviderOrder().filter((p) => providerAutomaticEligibility(p).eligible);
    assert.deepEqual(run.notTested.map((u) => u.provider).sort(), [...eligible].sort());

    // Providers we already know are unconfigured still get their real answer —
    // "not configured" is actionable and must not be downgraded to "not tested".
    for (const report of run.reports) {
      assert.equal(providerAutomaticEligibility(report.provider).eligible, false);
    }
  });

  it("does not fire providers in parallel to beat the clock", async () => {
    const startedAt = Date.now();
    await testAutomaticChainCapabilities({
      capabilities: ["connectivity"],
      deadlineAt: startedAt + 6_000,
    });

    // Real provider requests fired concurrently trip the very rate limits the
    // diagnostic exists to measure. Running out of time is not a licence to
    // burst: every request must still start after the previous one finished.
    const settled = calls.filter((c) => c.endedAt !== null);
    for (let i = 1; i < settled.length; i += 1) {
      assert.ok(
        settled[i].startedAt >= (settled[i - 1].endedAt as number) - 5,
        `request ${i} (${settled[i].host}) overlapped the previous one`,
      );
    }
  });

  it("attempts each provider at most once per capability", async () => {
    await testAutomaticChainCapabilities({
      capabilities: ["connectivity"],
      deadlineAt: Date.now() + 6_000,
    });

    const chatCallsByHost = new Map<string, number>();
    for (const call of calls) {
      if (call.path.endsWith("/models")) continue;
      chatCallsByHost.set(call.host, (chatCallsByHost.get(call.host) ?? 0) + 1);
    }
    for (const [host, count] of chatCallsByHost) {
      assert.ok(count <= 1, `${host} was attempted ${count} times for one capability`);
    }
  });

  it("leaves routing health state untouched for providers it could not test", async () => {
    const { buildProviderDiagnosticsSnapshot } = await import("../lib/ai-provider-health");
    const before = buildProviderDiagnosticsSnapshot();

    const run = await testAutomaticChainCapabilities({
      capabilities: ["connectivity"],
      deadlineAt: Date.now() + 6_000,
    });
    const after = buildProviderDiagnosticsSnapshot();

    // Running out of time must not impose a cooldown on real analysis work.
    // A diagnostic that made the workload worse is the harm the isolation
    // exists to prevent, and a deadline is not an excuse to break it.
    for (const untested of run.notTested) {
      const beforeEntry = before.perProvider.find((p) => p.provider === untested.provider);
      const afterEntry = after.perProvider.find((p) => p.provider === untested.provider);
      assert.deepEqual(afterEntry?.cooldownUntil ?? null, beforeEntry?.cooldownUntil ?? null);
      assert.equal(afterEntry?.coolingDown ?? false, beforeEntry?.coolingDown ?? false);
      assert.deepEqual(afterEntry?.lastErrorCategory ?? null, beforeEntry?.lastErrorCategory ?? null);
    }
  });
});

describe("diagnostic routes are bound to their own execution limit", () => {
  const routes = [
    "app/api/admin/ai-provider-health/test/route.ts",
    "app/api/ai-providers/diagnostics/route.ts",
  ];

  for (const path of routes) {
    it(`${path} derives its deadline from maxDuration`, () => {
      const source = readFileSync(path, "utf8");
      assert.match(source, /export const maxDuration = \d+/);
      // Passing the constant itself, not a second hand-written number, is what
      // stops the two from drifting apart the next time the limit changes.
      assert.match(source, /diagnosticDeadlineFrom\(maxDuration\)/);
    });
  }

  it("the admin route reports partial state instead of implying a complete run", () => {
    const source = readFileSync("app/api/admin/ai-provider-health/test/route.ts", "utf8");
    assert.match(source, /notTested/);
    assert.match(source, /partial: deadlineExceeded/);
  });

  it("the live diagnostics route does not headline a negative it never measured", () => {
    const source = readFileSync("app/api/ai-providers/diagnostics/route.ts", "utf8");
    assert.match(source, /partial: run\.deadlineExceeded/);
    assert.match(source, /before concluding the chain is broken/);
  });
});
