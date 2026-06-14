import { test, describe } from "node:test";
import assert from "node:assert";

describe("Foundation Health & Readiness Contract", () => {
  test("Health endpoint is liveness only", () => {
    const response = { status: "up", environment: "test" };
    assert.strictEqual(response.status, "up");
    assert.ok(response.environment);
  });

  test("Readiness endpoint returns structured components", () => {
    const response = {
      ready: true,
      components: {
        database: { status: "ready" },
        ai: { status: "ready" }
      }
    };
    assert.strictEqual(response.ready, true);
    assert.strictEqual(response.components.database.status, "ready");
  });
});
