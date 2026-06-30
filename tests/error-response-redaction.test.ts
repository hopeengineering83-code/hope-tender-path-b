/**
 * Guardrail: API error responses must not echo raw exception text.
 *
 * Leaking `error.message` (or String(error)) into an HTTP error body can
 * expose internal/DB details (connection strings, schema, stack fragments).
 * Each of these routes already logs the full error server-side, so the
 * response only needs a stable `code` — never the raw message.
 *
 * This is a source-level guard (no server/DB needed): it asserts the known
 * leak pattern is absent from the response builders.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ROUTES = [
  "app/api/admin/ai-usage/route.ts",
  "app/api/tenders/[id]/authority-review/route.ts",
  "app/api/tenders/[id]/export-readiness/route.ts",
  "app/api/tenders/[id]/download/route.ts",
];

describe("API error responses do not leak raw exception text", () => {
  for (const route of ROUTES) {
    it(`${route} returns no raw error.message in any response body`, () => {
      const src = read(route);
      assert.ok(
        !src.includes("detail: error instanceof Error ? error.message : String(error)"),
        `${route} must not echo raw error.message in a response — log it server-side and return only a code`,
      );
    });
  }

  it("download route still logs the failures server-side (redaction must not drop observability)", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes('logger.error("Tender download route failed"'), "top-level download catch must log");
    assert.ok(
      src.includes('logger.error("readContentOrError: document bytes unavailable"'),
      "readContentOrError must log the error server-side now that the response no longer carries it",
    );
  });
});
