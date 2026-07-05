import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEnginePostconditions } from "../lib/engine/engine-postconditions";

describe("checkEnginePostconditions export", () => {
  it("is exported as a callable function", () => {
    assert.equal(typeof checkEnginePostconditions, "function");
  });

  it("returns a Promise", () => {
    // We can't call the real DB in unit tests, but we can verify the
    // function signature returns a Promise when invoked (it will reject
    // without a DB, but the shape test just needs the return type).
    const result = checkEnginePostconditions("test-id");
    assert.ok(result instanceof Promise);
    // Suppress unhandled rejection — we only care about shape here.
    result.catch(() => {});
  });
});
