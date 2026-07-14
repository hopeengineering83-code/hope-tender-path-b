import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Regression test for the zero-evidence silent-generation bug.
 *
 * Before the fix, generateTenderDocuments() in lib/engine/generate-elite.ts
 * only logged a warning when both the selected records AND the entire
 * reviewed vault were empty. It then proceeded to generate a proposal with
 * zero factual authority — every expert/project citation would be
 * hallucinated or generic.
 *
 * The /generate route had an EMPTY_VAULT gate, but the lib itself did not
 * hard-block. This meant any future caller of generateTenderDocuments
 * (a new route, a worker path, a test) could bypass the evidence
 * requirement.
 *
 * The fix throws a ZERO_REVIEWED_EVIDENCE error, mirroring the
 * NO_REVIEWED_EXPERT_EVIDENCE / NO_REVIEWED_PROJECT_EVIDENCE pattern
 * in lib/ai-job-handlers.ts.
 */

test("generateTenderDocuments hard-blocks on zero reviewed evidence (defense-in-depth)", () => {
  const elitePath = path.join(
    process.cwd(),
    "lib/engine/generate-elite.ts"
  );
  const src = fs.readFileSync(elitePath, "utf8");

  // The old code only logged a warning. The new code must throw.
  assert.ok(
    !src.includes("ZERO-EVIDENCE: No reviewed experts or projects available"),
    "generate-elite.ts must NOT contain the old warn-only ZERO-EVIDENCE log. " +
    "It must throw an error instead."
  );

  assert.ok(
    src.includes("ZERO_REVIEWED_EVIDENCE"),
    "generate-elite.ts must throw a ZERO_REVIEWED_EVIDENCE error when " +
    "both experts and projects are empty — preventing any caller from " +
    "generating a proposal with zero factual authority."
  );

  // The throw must be inside generateTenderDocuments (not some other function).
  const fnIdx = src.indexOf("export async function generateTenderDocuments(");
  assert.ok(fnIdx > -1, "generateTenderDocuments must exist");
  const fnBody = src.slice(fnIdx, fnIdx + 5000); // first 5KB is enough

  assert.ok(
    fnBody.includes("ZERO_REVIEWED_EVIDENCE"),
    "The ZERO_REVIEWED_EVIDENCE throw must be inside generateTenderDocuments"
  );

  // The check must guard both experts AND projects being empty.
  assert.ok(
    fnBody.includes("experts.length === 0 && projects.length === 0"),
    "The guard must check both experts.length === 0 AND projects.length === 0"
  );
});
