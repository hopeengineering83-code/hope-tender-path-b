// A database behind the deployed code must be reported as such — by the health
// endpoint and by sign-in.
//
// WHY THIS FILE EXISTS
// --------------------
// A live preview was repointed at a new database that held every table but had
// not had the latest migrations applied. The result:
//
//   GET  /api/health        200 {"ok":true,"status":"healthy","tables":{...all true}}
//   POST /api/auth/login    503 "Authentication is temporarily unavailable.
//                                Please try again shortly."
//
// Both statements were wrong in the same way. The health check probed five
// tables for EXISTENCE and no columns, and none of those five were on the
// sign-in path, so a database that could not serve a single login reported
// itself healthy. Sign-in then blamed a transient outage and invited a retry,
// while the actual error was a PrismaClientKnownRequestError from
// prisma.user.findUnique — a column the client expects and the database does
// not have. No amount of retrying clears a missing column.
//
// These tests pin the two properties that failure violated: the health check
// must ask whether the client can actually query, not merely whether tables
// exist; and sign-in must distinguish "wait" from "migrate".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const LIVENESS = readFileSync("lib/liveness.ts", "utf8");
const LOGIN = readFileSync("app/api/auth/login/route.ts", "utf8");
const LOGIN_FORM = readFileSync("components/login-form.tsx", "utf8");

describe("health reports a database the deployed code cannot query", () => {
  it("probes the tables sign-in actually uses", () => {
    // The original five could all be present while login was completely dead.
    for (const table of ["User", "Session", "AuditLog"]) {
      assert.match(
        LIVENESS,
        new RegExp(`"${table}"`),
        `${table} is on the authentication path and must be a critical table`,
      );
    }
  });

  it("asks whether the client can query, not only whether tables exist", () => {
    // Existence checks cannot see a missing COLUMN, which is what actually
    // broke. The probe must issue a real read through the Prisma client.
    assert.match(LIVENESS, /SCHEMA_PROBE_MODELS/);
    assert.match(LIVENESS, /findFirst/);
    assert.match(
      LIVENESS,
      /schemaAgreement/,
      "a schema-agreement probe must exist alongside the table-existence probe",
    );
  });

  it("counts schema disagreement as unusable, not merely degraded", () => {
    // "degraded" is for optional subsystems (AI providers, storage). A database
    // the client cannot query means nobody can sign in — that is a 503.
    assert.match(LIVENESS, /const databaseUsable = allCriticalTablesExist && schema\.matches;/);
    assert.match(LIVENESS, /const httpStatus = databaseUsable \? 200 : 503;/);
    assert.doesNotMatch(
      LIVENESS,
      /const httpStatus = allCriticalTablesExist \? 200 : 503;/,
      "table existence alone must no longer decide the HTTP status",
    );
  });

  it("says plainly whether the schema matches, so the reason needs no log dive", () => {
    assert.match(LIVENESS, /schemaMatchesDeployedCode: snapshot\.schema\.matches/);
  });
});

describe("sign-in distinguishes a transient outage from a stale schema", () => {
  it("treats missing-table and missing-column Prisma codes as schema drift", () => {
    assert.match(LOGIN, /SCHEMA_DRIFT_PRISMA_CODES = new Set\(\["P2021", "P2022"\]\)/);
  });

  it("tells the operator to migrate rather than to wait", () => {
    assert.match(LOGIN, /AUTH_DATABASE_SCHEMA_OUTDATED/);
    const message = /AUTH_DATABASE_SCHEMA_OUTDATED: "([^"]+)"/.exec(LOGIN)?.[1] ?? "";
    assert.ok(message.length > 0, "the schema-drift code needs a public message");
    assert.match(message, /migration/i, "the message must name the actual remedy");
    assert.doesNotMatch(
      message,
      /try again|shortly/i,
      "retrying cannot clear a missing column, so the message must not suggest it",
    );
  });

  it("passes the error to the responder at every call site", () => {
    // If any call site drops the error, that path silently reverts to the
    // misleading "try again shortly".
    assert.doesNotMatch(
      LOGIN,
      /authenticationUnavailable\(req, nativeForm, requestId\);/,
      "every authenticationUnavailable call must pass the error so drift can be detected",
    );
  });

  it("records the Prisma code so the cause is visible without reproducing it", () => {
    // The route deliberately logs no messages. Without the code, a genuine
    // schema failure and a genuine outage are indistinguishable in the logs —
    // which is exactly what made the live incident take a code read to explain.
    assert.match(LOGIN, /prismaCode: \(error as \{ code\?: unknown \} \| null\)\?\.code \?\? null/);
  });
});

describe("the sign-in screen shows the reason the server worked out", () => {
  it("knows the schema-drift code instead of collapsing it into the generic 503", () => {
    // The server had already identified P2022 and answered
    // AUTH_DATABASE_SCHEMA_OUTDATED. This component mapped ANY 503 to
    // "temporarily unavailable" because the code was absent from its own map,
    // so the specific reason never reached the screen.
    assert.match(LOGIN_FORM, /AUTH_DATABASE_SCHEMA_OUTDATED/);
    const message = /AUTH_DATABASE_SCHEMA_OUTDATED: "([^"]+)"/.exec(LOGIN_FORM)?.[1] ?? "";
    assert.ok(message.length > 0, "the code needs a message in the client map");
    assert.match(message, /migration/i);
  });

  it("does not count down and resubmit against an error retrying cannot clear", () => {
    assert.match(LOGIN_FORM, /NON_RETRYABLE_503_CODES/);
    // The countdown must be conditional now, not armed for every 503.
    assert.doesNotMatch(
      LOGIN_FORM,
      /setIsDbError\(true\);\s*\n\s*setError\(publicLoginMessage\(data\?\.code, response\.status\)\);\s*\n\s*setRetryCountdown\(DB_RETRY_COUNTDOWN_S\);/,
      "a non-retryable 503 must not arm the auto-retry countdown",
    );
    assert.match(LOGIN_FORM, /if \(retryable\) setRetryCountdown\(DB_RETRY_COUNTDOWN_S\);/);
  });
});
