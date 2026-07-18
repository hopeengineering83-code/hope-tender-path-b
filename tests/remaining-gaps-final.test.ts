// Tests for remaining gap fixes — structured logging migration

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Remaining gaps — console.log migration to structured logger", () => {
  it("analysis-job-service.ts has no console.log/error/warn calls", () => {
    const src = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.ok(!src.includes("console.log("), "Must not use console.log");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
    assert.ok(!src.includes("console.warn("), "Must not use console.warn");
    assert.match(src, /import.*logger.*from.*observability/, "Must import logger from observability");
  });

  it("engine/route.ts uses logger.error not console.error", () => {
    const src = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
    assert.match(src, /logger\.error/, "Must use logger.error");
  });

  it("metadata-override/route.ts uses logger.error not console.error", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("ai-analyze-retry/route.ts uses logger.error not console.error", () => {
    const src = readFileSync("app/api/cron/ai-analyze-retry/route.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("run-next/route.ts uses logger.error not console.error", () => {
    const src = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("ai-analyze/runner.ts uses logger.error not console.error", () => {
    const src = readFileSync("lib/ai-analyze/runner.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("generation-readiness-gate.ts uses logger.error not console.error", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("generate.ts uses logger.error not console.error", () => {
    const src = readFileSync("lib/engine/generate.ts", "utf8");
    assert.ok(!src.includes("console.error("), "Must not use console.error");
  });

  it("delete-tender.ts uses logger.info not console.log", () => {
    const src = readFileSync("lib/tender/delete-tender.ts", "utf8");
    assert.ok(!src.includes("console.log("), "Must not use console.log");
    assert.match(src, /logger\.info/, "Must use logger.info");
  });
});
