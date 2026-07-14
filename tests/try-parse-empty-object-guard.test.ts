import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression test for the empty-object silent-success bug.
 *
 * Before the fix, `tryParseAndSanitize("{}")` returned a valid (but empty)
 * AIAnalysisResult — every field defaulted to "" / null / []. This meant a
 * provider that returned `{}` was silently marked as a successful analysis,
 * bypassing the fallback chain and persisting an empty analysis to the DB.
 *
 * The same bug pattern was previously fixed in the chunk-recovery path
 * (lib/ai-jobs/chunk-recovery.ts) but NOT in the normal analyze path
 * (lib/ai.ts → tryParseAndSanitize). This test verifies the guard is in
 * place by reading the source text (the function is a closure inside
 * analyzeTenderWithAI and cannot be imported directly).
 *
 * Exploit scenario (pre-fix):
 *   1. Provider X returns the literal string "{}" for a tender analysis.
 *   2. tryParseAndSanitize("{}") → { summary: "", requirements: [], ... }
 *   3. The analysis is marked SUCCEEDED.
 *   4. An empty analysis is persisted to the DB.
 *   5. The user sees "Analysis complete" but no requirements were extracted.
 *   6. Downstream generation runs with zero requirements → empty proposal.
 */

test("tryParseAndSanitize rejects empty JSON object (regression: silent-success bug)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(process.cwd(), "lib/ai.ts"),
    "utf8"
  );

  // Locate the tryParseAndSanitize function body.
  const fnStart = src.indexOf("function tryParseAndSanitize(");
  assert.ok(fnStart > -1, "tryParseAndSanitize function must exist in lib/ai.ts");

  // Read the first ~1200 chars of the function body — enough to see the guard.
  const fnBody = src.slice(fnStart, fnStart + 1200);

  // The guard must explicitly reject empty objects.
  assert.ok(
    fnBody.includes("Object.keys(parsed).length === 0"),
    "tryParseAndSanitize must reject empty objects (Object.keys(parsed).length === 0). " +
    "Without this guard, a provider returning '{}' is silently marked as a successful analysis."
  );

  // The guard must return null (not a default-valued object).
  assert.ok(
    fnBody.includes("return null"),
    "tryParseAndSanitize must return null for empty objects, not a default-valued AIAnalysisResult."
  );
});

test("chunk-recovery empty-object guard still present (defense-in-depth)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const recoveryPath = path.join(process.cwd(), "lib/ai-jobs/chunk-recovery.ts");
  const src = fs.readFileSync(recoveryPath, "utf8");

  // The chunk-recovery path already has this guard — verify it's still there
  // so both the normal analyze path AND the recovery path are protected.
  assert.ok(
    src.includes("Object.keys") && src.includes("length === 0"),
    "chunk-recovery.ts must retain its empty-object guard."
  );
});
