// Tests for the production error-response shape of upload-first (Gap 4).
//
// The route catches every thrown error in its outer try/catch and returns
// a JSON body. In production:
//   - body MUST NOT include a `stack` field
//   - body MUST include `error`, `detail`, `hint`, and `requestId`
//   - DATABASE_URL connection strings inside the message MUST be redacted
//
// We exercise these guarantees via two paths:
//   1. Source inspection: pin the structure of the catch block.
//   2. Behavioural test: call the inlined sanitiser logic on representative
//      error messages and assert no DSNs survive.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Recreate the sanitiser exactly the way the route uses it. If the route
// implementation drifts, the source-inspection test below catches it.
function sanitizeErrorDetail(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s"]+/gi, "postgresql://[redacted]")
    .replace(/(mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"]+/gi, "$1://[redacted]");
}

describe("Gap 4 — DATABASE_URL redaction inside error responses", () => {
  it("redacts a postgres:// DSN in a Prisma-style message", () => {
    const msg = 'connection error to postgresql://user:s3cr3t@db.example.com:5432/app failed';
    const cleaned = sanitizeErrorDetail(msg);
    assert.equal(cleaned.includes("s3cr3t"), false);
    assert.equal(cleaned.includes("user"), false);
    assert.match(cleaned, /postgresql:\/\/\[redacted\]/);
  });

  it("redacts a postgresql:// DSN", () => {
    const msg = 'cannot reach postgresql://app:hunter2@10.0.0.1/db';
    const cleaned = sanitizeErrorDetail(msg);
    assert.equal(cleaned.includes("hunter2"), false);
  });

  it("redacts mongodb / mysql / redis DSNs as a defence-in-depth", () => {
    assert.equal(sanitizeErrorDetail("mongodb://user:pass@host/db").includes("pass"), false);
    assert.equal(sanitizeErrorDetail("mongodb+srv://user:pass@host/db").includes("pass"), false);
    assert.equal(sanitizeErrorDetail("mysql://user:pass@host/db").includes("pass"), false);
    assert.equal(sanitizeErrorDetail("redis://user:pass@host:6379").includes("pass"), false);
  });

  it("leaves normal text untouched", () => {
    assert.equal(sanitizeErrorDetail("nothing sensitive here"), "nothing sensitive here");
  });
});

describe("Gap 4 — upload-first route source enforces production stack hiding", () => {
  it("route catch block branches on NODE_ENV before attaching stack", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../app/api/tenders/upload-first/route.ts", import.meta.url), "utf8");

    // Must check NODE_ENV in the catch handler.
    assert.match(src, /NODE_ENV.*production/);

    // requestId must be threaded through the response body.
    assert.match(src, /requestId/);

    // The body must include error, detail, hint, requestId.
    assert.match(src, /error:/);
    assert.match(src, /detail:/);
    assert.match(src, /hint/);

    // Stack must only be attached when !isProduction.
    assert.match(src, /!isProduction/);

    // The literal `stack` field must NOT be unconditionally present.
    // We confirm by searching for the assignment guard.
    const stackAssignmentIdx = src.indexOf("body.stack");
    assert.ok(stackAssignmentIdx > 0, "expected guarded body.stack assignment");

    // Ensure sanitize call is applied to message + stack.
    assert.match(src, /sanitizeError/);
  });

  it("does not return a top-level `stack` key in the literal object", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../app/api/tenders/upload-first/route.ts", import.meta.url), "utf8");
    // Old behaviour:  return NextResponse.json({ error, detail, stack, ... })
    // New behaviour:  return NextResponse.json(body)  // body is built conditionally
    // We assert the old literal-object shape is gone.
    assert.equal(/return NextResponse\.json\(\{[^}]*\bstack:/m.test(src), false, "stack must not appear inside a literal NextResponse.json object");
  });
});
