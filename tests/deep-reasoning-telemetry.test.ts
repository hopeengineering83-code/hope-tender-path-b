// Unit tests for the deep-reasoning telemetry collector.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { DeepReasoningTelemetry } from "../lib/engine/deep-reasoning-telemetry";

describe("DeepReasoningTelemetry", () => {
  it("records nothing by default", () => {
    const t = new DeepReasoningTelemetry();
    assert.equal(t.getRecords().length, 0);
    assert.equal(t.summary().totalCalls, 0);
    assert.equal(t.format(), "");
  });

  it("track() records duration + success and propagates the result", async () => {
    const t = new DeepReasoningTelemetry();
    const result = await t.track("comprehension", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    });
    assert.equal(result, "ok");
    const records = t.getRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].step, "comprehension");
    assert.equal(records[0].succeeded, true);
    assert.ok(records[0].durationMs >= 0);
  });

  it("track() records a failed call and re-throws", async () => {
    const t = new DeepReasoningTelemetry();
    await assert.rejects(
      () => t.track("rewrite", async () => { throw new Error("boom"); }),
      /boom/,
    );
    const records = t.getRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].step, "rewrite");
    assert.equal(records[0].succeeded, false);
  });

  it("aggregates per-step counts correctly", async () => {
    const t = new DeepReasoningTelemetry();
    await t.track("critique", async () => "a");
    await t.track("critique", async () => "b");
    await t.track("rewrite", async () => "c");
    const s = t.summary();
    assert.equal(s.totalCalls, 3);
    assert.equal(s.successfulCalls, 3);
    assert.equal(s.failedCalls, 0);
    assert.equal(s.byStep.critique!.count, 2);
    assert.equal(s.byStep.critique!.succeeded, 2);
    assert.equal(s.byStep.rewrite!.count, 1);
    assert.equal(s.byStep.comprehension, null);
  });

  it("aggregates a mix of succeeded and failed", async () => {
    const t = new DeepReasoningTelemetry();
    await t.track("critique", async () => "a");
    await assert.rejects(() => t.track("critique", async () => { throw new Error("x"); }));
    const s = t.summary();
    assert.equal(s.byStep.critique!.count, 2);
    assert.equal(s.byStep.critique!.succeeded, 1);
    assert.equal(s.byStep.critique!.failed, 1);
    assert.equal(s.successfulCalls, 1);
    assert.equal(s.failedCalls, 1);
  });

  it("format() returns a human-readable summary when calls were recorded", async () => {
    const t = new DeepReasoningTelemetry();
    await t.track("comprehension", async () => "a");
    await t.track("critique", async () => "b");
    await t.track("rewrite", async () => "c");
    const line = t.format();
    assert.match(line, /\[deep-reasoning-telemetry\]/);
    assert.match(line, /3 call\(s\)/);
    assert.match(line, /comprehension \(1x/);
    assert.match(line, /critique \(1x/);
    assert.match(line, /rewrite \(1x/);
  });

  it("format() flags failure counts when present", async () => {
    const t = new DeepReasoningTelemetry();
    await t.track("comprehension", async () => "a");
    await assert.rejects(() => t.track("comprehension", async () => { throw new Error("x"); }));
    const line = t.format();
    assert.match(line, /comprehension \(2x,[^)]*failed=1\)/);
  });

  it("record() supports manual recording without an async wrapper", () => {
    const t = new DeepReasoningTelemetry();
    t.record({ step: "tools", durationMs: 42, succeeded: true });
    const s = t.summary();
    assert.equal(s.totalCalls, 1);
    assert.equal(s.byStep.tools!.totalMs, 42);
  });

  it("attaches metadata when supplied", async () => {
    const t = new DeepReasoningTelemetry();
    await t.track("alignment", async () => "a", { recordCount: 12, criteriaCount: 4 });
    const records = t.getRecords();
    assert.deepEqual(records[0].metadata, { recordCount: 12, criteriaCount: 4 });
  });
});
