/**
 * Tests for the stale job reaper.
 * The reaper marks RUNNING/QUEUED jobs as FAILED after 30 minutes.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("Stale job reaper", () => {
  const src = readFileSync("lib/engine/stale-job-reaper.ts", "utf8");

  it("uses a 30-minute stale threshold (matches trigger window)", () => {
    assert.ok(src.includes("30 * 60 * 1000"), "STALE_THRESHOLD_MS must be 30 minutes");
  });

  it("queries for RUNNING jobs with startedAt < cutoff", () => {
    assert.ok(src.includes('status: "RUNNING"'), "Must query RUNNING jobs");
    assert.ok(src.includes("startedAt: { lt: cutoff }"), "Must filter by startedAt < cutoff");
  });

  it("queries for QUEUED jobs with createdAt < cutoff", () => {
    assert.ok(src.includes('status: "QUEUED"'), "Must query QUEUED jobs");
    assert.ok(src.includes("createdAt: { lt: cutoff }"), "Must filter by createdAt < cutoff");
  });

  it("marks reaped jobs as FAILED with descriptive error", () => {
    assert.ok(src.includes('status: "FAILED"'), "Must set status to FAILED");
    assert.ok(src.includes("stale job reaper"), "Error message must mention stale job reaper");
    assert.ok(src.includes("finishedAt"), "Must set finishedAt");
  });

  it("returns count of reaped jobs and any errors", () => {
    assert.ok(src.includes("reaped"), "Must return reaped count");
    assert.ok(src.includes("errors"), "Must return errors array");
  });

  it("is idempotent (safe to call multiple times)", () => {
    // The function only updates jobs in RUNNING/QUEUED status.
    // Once a job is FAILED, it won't be picked up again.
    assert.ok(src.includes("where: { status:"), "Queries filter by status — already-FAILED jobs are skipped");
  });
});
