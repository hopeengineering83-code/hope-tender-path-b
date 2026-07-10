// Release acceptance — Work Package D.7/D.8 + G (safe API error responses).
//
// A public API failure must NEVER leak the raw exception: no stack traces, no
// DATABASE_URL / connection strings, no file paths, no provider error bodies,
// no internal tender/user IDs. The response carries only a caller-controlled
// safe message, a code, and a short correlation ID (the full error is logged
// server-side against that ID).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { safeError, logSafeError } from "../lib/safe-error";

// A deliberately toxic original error carrying every kind of thing that must
// never reach the client.
const TOXIC = new Error(
  "connect ECONNREFUSED postgresql://app:s3cr3t@db.internal:5432/prod " +
  "tenderId=ten_abc123 userId=usr_xyz789 at /var/task/lib/prisma.ts:42:17",
);

function assertNoLeak(payload: unknown) {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of [
    "postgresql://", "postgres://", "s3cr3t", "econnrefused", "db.internal",
    "/var/task", "prisma.ts", "ten_abc123", "usr_xyz789", "at ", "stack",
  ]) {
    assert.ok(!serialized.includes(forbidden), `response must not leak "${forbidden}"`);
  }
}

describe("release-acceptance D/G — safeError never leaks internals", () => {
  it("returns only a safe message + code + correlationId", () => {
    const res = safeError("Something went wrong. Please retry.", "INTERNAL_ERROR", TOXIC);
    assert.deepEqual(Object.keys(res).sort(), ["code", "correlationId", "error"].sort());
    assert.equal(res.error, "Something went wrong. Please retry.");
    assert.equal(res.code, "INTERNAL_ERROR");
    assert.ok(res.correlationId && res.correlationId.length >= 6, "has a correlation id");
    assertNoLeak(res);
  });

  it("does not echo the original error even when the caller message is generic", () => {
    const res = safeError("Unavailable", "SERVICE_UNAVAILABLE", TOXIC);
    assertNoLeak(res);
    assert.ok(!res.error.includes("ECONNREFUSED"));
  });

  it("handles non-Error throwables (strings/objects) without leaking them", () => {
    const res = safeError("Request failed", "BAD_REQUEST", { secret: "postgres://u:p@h/db", id: "usr_leak" });
    assertNoLeak(res);
  });

  it("logSafeError logs full detail server-side but returns only the safe body", () => {
    const captured: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = { error: (msg: string, ctx?: Record<string, unknown>) => captured.push({ msg, ctx }) };
    const res = logSafeError(logger, "Export failed", "EXPORT_ERROR", TOXIC, { route: "download" });

    // The response body is safe...
    assertNoLeak(res);
    assert.equal(res.error, "Export failed");
    assert.equal(res.code, "EXPORT_ERROR");
    // ...while the server-side log DID receive the detail + correlation id for tracing.
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx?.correlationId, res.correlationId);
    assert.ok(String(captured[0].ctx?.detail).includes("ECONNREFUSED"), "full detail is logged server-side");
  });

  it("correlation ids are unique per call (so operators can trace a specific failure)", () => {
    const a = safeError("x", "E", TOXIC).correlationId;
    const b = safeError("x", "E", TOXIC).correlationId;
    assert.notEqual(a, b);
  });
});
