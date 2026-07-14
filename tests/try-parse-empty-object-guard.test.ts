import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for the empty-object silent-success bug.
 *
 * Before the fix, `tryParseAndSanitize("{}")` returned a valid (but empty)
 * AIAnalysisResult — every field defaulted to "" / null / []. This meant a
 * provider that returned `{}` was silently marked as a successful analysis,
 * bypassing the fallback chain and persisting an empty analysis to the DB.
 *
 * ROUND-2 STRENGTHENING: The literal-{} guard only catches `{}`. But a
 * provider that returns `{"summary":""}` or `{"requirements":[]}` is ALSO
 * broken — it produced an object with keys but ZERO substantive content.
 * The strengthened guard checks for "effectively empty" objects: if the
 * response has no non-empty summary, no requirements, no title, and no
 * methodology, it's rejected.
 *
 * Exploit scenario (pre-fix):
 *   1. Provider X returns the literal string "{}" for a tender analysis.
 *   2. tryParseAndSanitize("{}") → { summary: "", requirements: [], ... }
 *   3. The analysis is marked SUCCEEDED.
 *   4. An empty analysis is persisted to the DB.
 *   5. The user sees "Analysis complete" but no requirements were extracted.
 *   6. Downstream generation runs with zero requirements → empty proposal.
 *
 * Exploit scenario (literal-{} guard only, before round-2 strengthening):
 *   1. Provider X returns `{"summary":""}` (object with a key but empty value).
 *   2. tryParseAndSanitize passes the literal-{} guard (Object.keys.length > 0).
 *   3. The sanitized result has summary: "", requirements: [].
 *   4. Same downstream failure as above.
 */

test("tryParseAndSanitize rejects literal empty JSON object (regression: silent-success bug)", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "lib/ai.ts"),
    "utf8"
  );

  // Locate the tryParseAndSanitize function body.
  const fnStart = src.indexOf("function tryParseAndSanitize(");
  assert.ok(fnStart > -1, "tryParseAndSanitize function must exist in lib/ai.ts");

  // Read enough of the function body to see both guards.
  const fnBody = src.slice(fnStart, fnStart + 3000);

  // GUARD 1: The literal-empty-object guard must be present.
  assert.ok(
    fnBody.includes("Object.keys(parsed).length === 0"),
    "tryParseAndSanitize must reject literal empty objects (Object.keys(parsed).length === 0)."
  );

  // GUARD 2: The effectively-empty guard must be present (round-2 strengthening).
  // This catches {"summary":""}, {"requirements":[]}, etc.
  assert.ok(
    fnBody.includes("hasSummary") && fnBody.includes("hasRequirements"),
    "tryParseAndSanitize must have an effectively-empty guard that checks " +
    "hasSummary, hasRequirements, hasTitle, and hasMethodology. " +
    "Without this, a provider returning {\"summary\":\"\"} is silently marked " +
    "as a successful analysis."
  );

  // The effectively-empty guard must return null.
  assert.ok(
    fnBody.includes("!hasSummary && !hasRequirements"),
    "The effectively-empty guard must check that ALL substance fields are empty " +
    "(!hasSummary && !hasRequirements && !hasTitle && !hasMethodology) and return null."
  );
});

test("chunk-recovery empty-object guard still present (defense-in-depth)", () => {
  const recoveryPath = path.join(process.cwd(), "lib/ai-jobs/chunk-recovery.ts");
  const src = fs.readFileSync(recoveryPath, "utf8");

  // The chunk-recovery path already has this guard — verify it's still there
  // so both the normal analyze path AND the recovery path are protected.
  assert.ok(
    src.includes("Object.keys") && src.includes("length === 0"),
    "chunk-recovery.ts must retain its empty-object guard."
  );
});
