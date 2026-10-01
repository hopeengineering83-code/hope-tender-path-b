import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableAutomaticCoverageConflict,
  runAutomaticCoverageWithRetry,
} from "../lib/engine/reconcile-automatic-requirement-coverage";

describe("automatic requirement coverage concurrency", () => {
  it("recognizes database uniqueness, serialization, and deadlock conflicts", () => {
    assert.equal(isRetryableAutomaticCoverageConflict({ code: "P2002" }), true);
    assert.equal(isRetryableAutomaticCoverageConflict({ code: "P2034" }), true);
    assert.equal(isRetryableAutomaticCoverageConflict({ code: "40001" }), true);
    assert.equal(isRetryableAutomaticCoverageConflict({ code: "40P01" }), true);
    assert.equal(isRetryableAutomaticCoverageConflict(new Error("unique constraint failed")), true);
    assert.equal(isRetryableAutomaticCoverageConflict(new Error("permission denied")), false);
  });

  it("converges after a transient concurrent-insert conflict", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await runAutomaticCoverageWithRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("concurrent insert"), { code: "P2002" });
      return { persistedLinks: 4 };
    }, {
      wait: async (milliseconds) => { waits.push(milliseconds); },
    });

    assert.deepEqual(result, { persistedLinks: 4 });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [25]);
  });

  it("does not retry authorization or validation failures", async () => {
    let calls = 0;
    await assert.rejects(
      runAutomaticCoverageWithRetry(async () => {
        calls += 1;
        throw new Error("tenant ownership invalid");
      }, { wait: async () => undefined }),
      /tenant ownership invalid/,
    );
    assert.equal(calls, 1);
  });

  it("stops after the bounded attempt count", async () => {
    let calls = 0;
    await assert.rejects(
      runAutomaticCoverageWithRetry(async () => {
        calls += 1;
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }, { attempts: 3, wait: async () => undefined }),
      /serialization failure/,
    );
    assert.equal(calls, 3);
  });
});
