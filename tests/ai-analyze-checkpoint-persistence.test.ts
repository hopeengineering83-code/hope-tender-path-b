// Source-read tests for the typed AiAnalyzeCheckpointPersistenceError contract.
// Verifies that silent failure patterns have been removed and that errors are
// propagated with structured diagnostics while keeping sensitive data out of logs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf-8");

describe("AiAnalyzeCheckpointPersistenceError contract (lib/ai-analyze-checkpoints.ts)", () => {
  it("exports AiAnalyzeCheckpointPersistenceError", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(
      helper.includes("export class AiAnalyzeCheckpointPersistenceError"),
      "lib/ai-analyze-checkpoints.ts must export AiAnalyzeCheckpointPersistenceError",
    );
  });

  it("error class has code = AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(
      helper.includes('readonly code = "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED"'),
      'AiAnalyzeCheckpointPersistenceError must have readonly code = "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED"',
    );
  });

  it("has no silent .catch(() => []) or .catch(() => {}) patterns in public functions", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    const silentCatchEmpty = (helper.match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) ?? []).length;
    const silentCatchArray = (helper.match(/\.catch\(\(\)\s*=>\s*\[\]\)/g) ?? []).length;
    const silentCatchNull = (helper.match(/\.catch\(\(\)\s*=>\s*null\)/g) ?? []).length;
    assert.equal(silentCatchEmpty, 0, "No silent .catch(() => {}) patterns allowed");
    assert.equal(silentCatchArray, 0, "No silent .catch(() => []) patterns allowed");
    assert.equal(silentCatchNull, 0, "No silent .catch(() => null) patterns allowed");
  });

  it("route imports AiAnalyzeCheckpointPersistenceError", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(
      route.includes("AiAnalyzeCheckpointPersistenceError"),
      "app/api/tenders/[id]/ai-analyze/route.ts must import AiAnalyzeCheckpointPersistenceError",
    );
  });

  it("route returns 503 with code AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED", () => {
    const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(
      route.includes("AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED"),
      "route must return AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED code",
    );
    assert.ok(
      route.includes("status: 503"),
      "route must return HTTP 503 for checkpoint persistence errors",
    );
  });

  it("error class has diagnosticId, operation, tenderId, contentHashPrefix fields", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    assert.ok(helper.includes("readonly operation: string"), "must have readonly operation field");
    assert.ok(helper.includes("readonly diagnosticId: string"), "must have readonly diagnosticId field");
    assert.ok(helper.includes("readonly tenderId: string"), "must have readonly tenderId field");
    assert.ok(helper.includes("readonly contentHashPrefix: string"), "must have readonly contentHashPrefix field");
  });

  it("error class does NOT expose resultJson, raw DB message, or connection strings", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    // Find the class definition block
    const classStart = helper.indexOf("export class AiAnalyzeCheckpointPersistenceError");
    const classEnd = helper.indexOf("\n}\n", classStart);
    const classBlock = helper.slice(classStart, classEnd + 3);
    assert.ok(!classBlock.includes("resultJson"), "error class must not expose resultJson");
    assert.ok(!classBlock.includes("connectionString"), "error class must not expose connection strings");
    assert.ok(!classBlock.includes("DATABASE_URL"), "error class must not expose DATABASE_URL");
  });

  it("log call does NOT include resultJson or full contentHash fields", () => {
    const helper = read("lib/ai-analyze-checkpoints.ts");
    // Find all console.error calls in the file
    const errorCalls = helper.split("console.error");
    // Skip the first (before any console.error)
    for (let i = 1; i < errorCalls.length; i++) {
      const callBlock = errorCalls[i].slice(0, errorCalls[i].indexOf(")") + 1);
      assert.ok(
        !callBlock.includes("resultJson"),
        `console.error call ${i} must not include resultJson`,
      );
      assert.ok(
        !callBlock.includes("contentHash:"),
        `console.error call ${i} must not include full contentHash (only contentHashPrefix is allowed)`,
      );
    }
  });
});
