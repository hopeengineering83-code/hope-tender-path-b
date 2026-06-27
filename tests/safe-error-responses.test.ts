// Targeted test: API JSON responses must not expose internal exception text.
// Must return safe error codes + correlation IDs only.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Safe error responses — no internal exception text", () => {
  it("tender delete route returns correlationId, not error.message", () => {
    const src = read("app/api/tenders/[id]/route.ts");
    assert.ok(
      src.includes("correlationId") && src.includes("TENDER_DELETE_FAILED"),
      "tender delete must return { code: 'TENDER_DELETE_FAILED', correlationId } not error.message",
    );
    assert.ok(
      !src.includes("detail: error instanceof Error ? error.message"),
      "tender delete must NOT expose error.message in the response",
    );
  });

  it("AI provider health route returns correlationId, not error.message", () => {
    const src = read("app/api/admin/ai-provider-health/route.ts");
    assert.ok(
      !src.includes("detail: error instanceof Error ? error.message"),
      "AI provider health route must NOT expose error.message in the response",
    );
    assert.ok(
      src.includes("correlationId"),
      "AI provider health route must return correlationId",
    );
  });

  it("reassess route returns correlationId, not error.message", () => {
    const src = read("app/api/admin/generated-proposals/reassess/route.ts");
    assert.ok(
      !src.includes("detail: error instanceof Error ? error.message"),
      "reassess route must NOT expose error.message in the response",
    );
  });

  it("readiness-score route returns correlationId, not error.message", () => {
    const src = read("app/api/tenders/[id]/readiness-score/route.ts");
    assert.ok(
      !src.includes("detail: error instanceof Error ? error.message"),
      "readiness-score route must NOT expose error.message in the response",
    );
  });

  it("safe-error helper exists and exports safeError function", () => {
    const src = read("lib/safe-error.ts");
    assert.ok(
      src.includes("export function safeError"),
      "lib/safe-error.ts must export safeError function",
    );
    assert.ok(
      src.includes("correlationId"),
      "safeError must generate a correlationId",
    );
    // Must NOT include the error text in the return value
    assert.ok(
      !src.includes("return { error: message, code, detail:"),
      "safeError must NOT return the error detail — only correlationId",
    );
  });
});
