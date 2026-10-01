// Regression test: middleware must NOT enforce CSRF on authenticated
// server-to-server callers (GitHub Actions drain job, Vercel Cron).
// These callers carry a shared secret header and have no browser
// Origin/Referer, so the CSRF origin check would reject them with
// HTTP 403 "Invalid request origin." — breaking the AI jobs drain
// workflow and Vercel Cron triggers.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("middleware — automated caller CSRF bypass", () => {
  it("declares isAutomatedCaller helper that checks worker + cron secrets", () => {
    const src = read("middleware.ts");
    assert.match(src, /function isAutomatedCaller\(req: NextRequest\): boolean/);
    // Worker secret path
    assert.match(src, /AI_JOBS_WORKER_SECRET/);
    assert.match(src, /x-worker-secret/);
    // Cron secret path
    assert.match(src, /CRON_SECRET\s*\|\|\s*process\.env\.VERCEL_CRON_SECRET/);
    assert.match(src, /Bearer \$\{cronSecret\}/);
  });

  it("skips the CSRF evaluateCsrf call when isAutomatedCaller returns true", () => {
    const src = read("middleware.ts");
    // The CSRF block must be gated on `!isAutomatedCaller(req)`. Additional
    // trusted-caller conjuncts (e.g. the internal rate-guard hop) may follow,
    // but this one must remain the leading condition.
    assert.match(src, /if\s*\(\s*!isAutomatedCaller\(req\)\s*(?:&&[^)]*)?\)\s*\{[\s\S]*?evaluateCsrf/);
  });

  it("still enforces CSRF for browser-style requests (no secret header)", () => {
    const src = read("middleware.ts");
    // The evaluateCsrf call must still exist and must still produce a 403
    // response when the decision is not allowed.
    assert.match(src, /evaluateCsrf\(\{[\s\S]*?\}\)/);
    assert.match(src, /NextResponse\.json\(\s*\{\s*error:\s*decision\.reason\s*\}\s*,\s*\{\s*status:\s*403\s*\}\s*\)/);
  });

  it("requires the worker secret to be at least 16 characters (no trivial bypass)", () => {
    const src = read("middleware.ts");
    // A short or missing secret must NOT trigger the bypass — otherwise an
    // attacker could send an empty x-worker-secret header to skip CSRF.
    assert.match(src, /workerSecret\.length\s*>=\s*16/);
    assert.match(src, /cronSecret\.length\s*>=\s*16/);
  });

  it("the bypass only skips CSRF — it does NOT authenticate the caller", () => {
    const src = read("middleware.ts");
    // The helper's docstring must call out that the route handler still
    // re-validates the secret, so a reviewer knows this is not an auth
    // bypass.
    assert.match(src, /route handler still re-validates the secret/i);
    assert.match(src, /does NOT authenticate the caller/i);
  });
});
