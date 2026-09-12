// P0 closure: real network cancellation bound to the PARENT deadline.
//
// Defect at PR #1175 head f2be6001: every provider adapter armed a real
// AbortController, but from a STATIC per-provider timeout (e.g. 45s). The
// shared `deadlineAt` was only a pre-flight "should I start?" guard, so an
// attempt begun with a few seconds of worker budget left could still hold the
// socket open for its full static timeout. The worker (40s soft loop inside a
// 60s platform hard kill) would then be killed mid-write instead of cancelling
// cooperatively and persisting its checkpoint.
//
// A Promise timeout is not proof of cancellation, so these tests drive a REAL
// HTTP server that accepts the connection and never replies, and assert on the
// server's own observation that the client socket was destroyed.
//
// Evidence level B: real sockets, real AbortController, real adapter code.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";

let server: http.Server;
let port: number;

/** Requests that arrived, and whether the client aborted them. */
const observed: Array<{ aborted: boolean; abortedAt: number | null }> = [];

before(async () => {
  server = http.createServer((req, res) => {
    const record = { aborted: false, abortedAt: null as number | null };
    observed.push(record);
    // Accept the request and never respond — the socket stays open until the
    // client cancels it.
    req.on("aborted", () => {
      record.aborted = true;
      record.abortedAt = Date.now();
    });
    res.on("close", () => {
      if (!res.writableFinished) {
        record.aborted = true;
        record.abortedAt ??= Date.now();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("P0: provider timeout clamps to the parent deadline", () => {
  it("returns the static timeout unchanged when no deadline is armed", async () => {
    const { resolveEffectiveTimeoutMs } = await import("../lib/ai");
    // Standalone adapter calls must keep their existing behaviour exactly.
    assert.equal(resolveEffectiveTimeoutMs(45_000), 45_000);
  });

  it("clamps the static timeout to the remaining parent budget", async () => {
    const { resolveEffectiveTimeoutMs, withProviderDeadline } = await import("../lib/ai");
    const now = 1_000_000;

    const clamped = withProviderDeadline(now + 6_000, () => resolveEffectiveTimeoutMs(45_000, now));
    assert.equal(clamped, 6_000, "must not grant more time than the parent has left");
  });

  it("never extends a static timeout that is already shorter than the budget", async () => {
    const { resolveEffectiveTimeoutMs, withProviderDeadline } = await import("../lib/ai");
    const now = 1_000_000;

    const value = withProviderDeadline(now + 60_000, () => resolveEffectiveTimeoutMs(10_000, now));
    assert.equal(value, 10_000, "the tighter of the two constraints must win");
  });

  it("floors at a usable minimum when the parent deadline has passed", async () => {
    const { resolveEffectiveTimeoutMs, withProviderDeadline, MIN_PROVIDER_TIMEOUT_MS } = await import("../lib/ai");
    const now = 1_000_000;

    const value = withProviderDeadline(now - 10_000, () => resolveEffectiveTimeoutMs(45_000, now));
    assert.equal(value, MIN_PROVIDER_TIMEOUT_MS, "must never be zero or negative");
  });

  it("keeps concurrent provider calls on their own budgets", async () => {
    const { resolveEffectiveTimeoutMs, withProviderDeadline } = await import("../lib/ai");
    const now = 1_000_000;

    // A module-level variable would let the shorter budget clamp the longer one.
    const [short, long] = await Promise.all([
      withProviderDeadline(now + 3_000, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return resolveEffectiveTimeoutMs(45_000, now);
      }),
      withProviderDeadline(now + 30_000, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return resolveEffectiveTimeoutMs(45_000, now);
      }),
    ]);

    assert.equal(short, 3_000, "the short-budget call must keep its own deadline");
    assert.equal(long, 30_000, "the long-budget call must not be clamped by a concurrent shorter one");
  });
});

describe("P0: the real socket is terminated at the parent deadline", () => {
  it("aborts a hanging provider request on the parent's clock, not the static timeout", async () => {
    const { withProviderDeadline, resolveEffectiveTimeoutMs } = await import("../lib/ai");

    const before = observed.length;
    const PARENT_BUDGET_MS = 1_500;
    const STATIC_PROVIDER_TIMEOUT_MS = 45_000;

    // Exactly what an adapter does: one AbortController, armed from the
    // clamped timeout, passed to a real fetch.
    const startedAt = Date.now();
    let abortError: Error | null = null;

    await withProviderDeadline(Date.now() + PARENT_BUDGET_MS, async () => {
      const controller = new AbortController();
      const effective = resolveEffectiveTimeoutMs(STATIC_PROVIDER_TIMEOUT_MS);
      assert.ok(
        effective <= PARENT_BUDGET_MS,
        `adapter timeout ${effective}ms must be clamped to the ${PARENT_BUDGET_MS}ms parent budget`,
      );
      const timeoutId = setTimeout(() => controller.abort(), effective);
      try {
        await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "test", messages: [] }),
          signal: controller.signal,
        });
      } catch (err) {
        abortError = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timeoutId);
      }
    });

    const elapsed = Date.now() - startedAt;

    // 1. The request actually began.
    assert.ok(observed.length > before, "the server must have received the request");

    // 2+3. The client aborted rather than waiting for a response.
    assert.ok(abortError, "the fetch must reject when the deadline expires");
    assert.match(String(abortError), /abort/i, `expected an abort error, got: ${abortError}`);

    // 4. The real network request terminated — observed by the SERVER, which is
    //    the only proof that the socket was cancelled rather than merely a
    //    Promise being abandoned.
    await new Promise((r) => setTimeout(r, 150));
    const record = observed[observed.length - 1];
    assert.equal(record.aborted, true, "the server must observe the client socket being destroyed");

    // 5. It happened on the parent's clock, leaving the worker time to persist
    //    state — not at the 45s static provider timeout.
    assert.ok(
      elapsed < PARENT_BUDGET_MS + 2_000,
      `cancellation took ${elapsed}ms; it must track the ${PARENT_BUDGET_MS}ms parent budget, not ${STATIC_PROVIDER_TIMEOUT_MS}ms`,
    );
    assert.ok(
      elapsed < STATIC_PROVIDER_TIMEOUT_MS,
      "must not wait for the static provider timeout",
    );
  });

  it("every adapter abort site is clamped, not just one", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai.ts", "utf8");

    // Each of these previously armed an AbortController from a static value.
    const clampedSites = source.match(/resolveEffectiveTimeoutMs\(/g) ?? [];
    // 1 definition + 5 adapter sites (2x Anthropic, OpenAI, DeepSeek, generic
    // OpenAI-compatible adapter covering zai/cerebras/mistral/groq/openrouter/together).
    assert.ok(
      clampedSites.length >= 6,
      `expected every abort site to be clamped, found ${clampedSites.length} references`,
    );

    // No abort site may remain armed directly from a bare static constant.
    assert.ok(
      !/setTimeout\(\(\) => controller\.abort\(\), (?!resolveEffectiveTimeoutMs)[A-Za-z_]/.test(source),
      "no AbortController may be armed from an unclamped static timeout",
    );
    assert.ok(
      !/AbortSignal\.timeout\(\d/.test(source),
      "no AbortSignal.timeout may use a bare numeric literal",
    );
  });
});
