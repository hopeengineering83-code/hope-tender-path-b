import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE DEFECT, and how close it came to costing data.
 * ---------------------------------------------------
 * On 2026-09-14 the Preview /api/health reported:
 *
 *   ok                        = False
 *   status                    = unhealthy
 *   schemaMatchesDeployedCode = False
 *   tables present            = 0/8
 *   tables NOT present        = ['User','Session','AuditLog','RateLimitBucket',
 *                                'PasswordResetToken','SubmissionPlanState',
 *                                'AiAnalyzeChunk','AiJob']
 *
 * Read plainly, that says the schema is gone. It was not. The provision job,
 * connecting directly with the migration URL, got the real answer:
 *
 *   PrismaClientInitializationError:
 *   Can't reach database server at `ep-...c-2.us-east-2.aws.neon.tech:5432`
 *
 * The database was UNREACHABLE, not empty. tableStatus() returned `false` for
 * every critical table on any thrown error, so "I could not ask" and "they are
 * missing" produced identical output.
 *
 * WHY THIS IS SAFETY-CRITICAL, not cosmetic
 * -----------------------------------------
 * The documented remedy for missing critical tables is the provision job, and
 * that job runs DROP SCHEMA public CASCADE. A false "the schema is gone"
 * reading points its reader straight at a destructive rebuild of a database
 * that is perfectly fine. On this occasion the rebuild refused only because it
 * could not connect either -- a database reachable from one network path and
 * not another would not have been protected by that accident.
 *
 * WHAT IS PINNED
 * --------------
 * That unknown is reported as null and never as false; that `ok`, the HTTP
 * status and the critical-table gate are exactly as strict as before (every
 * consumer asserts `=== true`, and null is not true); and that the status
 * string distinguishes the two conditions, because they have opposite
 * remedies -- one needs migrations, the other needs the server back.
 */

const LIVENESS = readFileSync(join(process.cwd(), "lib", "liveness.ts"), "utf8");

describe("an unreachable database is never reported as a missing schema", () => {
  it("reports unknown as null, not as false", () => {
    // The precise regression: `[name, false]` in the catch block.
    const catchBlock = LIVENESS.slice(LIVENESS.indexOf("async function tableStatus"));
    const body = catchBlock.slice(0, catchBlock.indexOf("\n}\n"));
    assert.match(body, /CRITICAL_TABLES\.map\(\(name\) => \[name, null\]\)/, "the unreachable case must report null");
    assert.doesNotMatch(body, /CRITICAL_TABLES\.map\(\(name\) => \[name, false\]\)/, "reporting false asserts a fact it does not have");
  });

  it("carries an explicit reachability flag on both payloads", () => {
    // Without this, `tables` alone cannot express the difference at all.
    const occurrences = LIVENESS.split("databaseReachable: snapshot.databaseReachable").length - 1;
    assert.equal(occurrences, 2, "public liveness AND admin diagnostics must both carry it");
  });

  it("keeps the critical-table gate strict — null is not a present table", () => {
    // The whole fix would be worthless, and actively dangerous, if reporting
    // "unknown" also made the gate accept it.
    assert.match(
      LIVENESS,
      /CRITICAL_TABLES\.every\(\(name\) => tables\[name\] === true\)/,
      "the gate must still require === true",
    );
  });

  it("still refuses to serve 200 and still reports not-ok when the database is unusable", () => {
    assert.match(LIVENESS, /const httpStatus = databaseUsable \? 200 : 503;/);
    assert.match(LIVENESS, /const ok = databaseUsable && aiUsable && storageHealth\.ready;/);
  });

  it("names the two conditions differently, because the remedies differ", () => {
    assert.match(LIVENESS, /"database-unreachable"/);
    // And the distinction is derived from reachability, not guessed from the
    // table list.
    assert.match(LIVENESS, /databaseReachable\s*\n?\s*\?\s*"unhealthy"/);
  });

  it("every consumer of `tables` still fails on an unknown", () => {
    // Three scripts consume this field. All assert `=== true`, so null keeps
    // them failing exactly as false did. If one ever loosened to a truthiness
    // check, an unknown would start passing a readiness gate.
    for (const [file, pattern] of [
      ["scripts/verify-deployment.mjs", /health\.tables\?\.\[table\] !== true/],
      ["scripts/verify-production-health.mjs", /health\.tables\?\.\[table\] === true/],
      ["e2e/production-smoke.spec.ts", /\.toBe\(true\)/],
    ] as const) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.match(source, pattern, `${file} must compare against true explicitly`);
    }
  });
});
