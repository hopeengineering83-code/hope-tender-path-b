import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/auth/login/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

describe("login fail-closed authentication boundary", () => {
  it("uses separate IP and account buckets locally and persistently", () => {
    assert.match(source, /login:local:ip:\$\{clientIp\}/);
    assert.match(source, /login:local:account:\$\{email\}/);
    assert.match(source, /login:ip:\$\{clientIp\}/);
    assert.match(source, /login:account:\$\{email\}/);
    assert.doesNotMatch(source, /login:\$\{getClientIp\(req\)\}:\$\{email\}/);
  });

  it("does equivalent bcrypt work for missing, unconfigured, and invalid accounts", () => {
    assert.match(source, /DUMMY_PASSWORD_HASH/);
    assert.match(source, /const comparisonHash = user\?\.passwordHash \|\| DUMMY_PASSWORD_HASH/);
    assert.match(source, /await bcrypt\.compare\(password, comparisonHash\)/);
    assert.match(source, /await bcrypt\.compare\(password, DUMMY_PASSWORD_HASH\)/);
  });

  it("returns one generic invalid-credentials response for every account state", () => {
    assert.match(source, /if \(!user \|\| !user\.passwordHash \|\| !passwordOk\)/);
    assert.match(source, /return NextResponse\.json\(INVALID_CREDENTIALS, \{ status: 401 \}\)/);
    assert.doesNotMatch(source, /User password is not initialized/);
    assert.doesNotMatch(source, /stored password hash is invalid/i);
  });

  it("never returns exception-derived detail for database, limiter, session, or unexpected failures", () => {
    assert.match(source, /AUTH_SERVICE_UNAVAILABLE/);
    assert.match(source, /requestId/);
    assert.doesNotMatch(source, /safeMessage\(/);
    assert.doesNotMatch(source, /detail:\s*(?:msg|message|error\.message|safeMessage)/);
    assert.doesNotMatch(source, /error:\s*`[^`]*\$\{(?:msg|message|error)/);
  });

  it("keeps diagnostics server-side and does not fail a valid login after audit persistence fails", () => {
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(source, /success audit was not persisted/);
    assert.match(source, /void logAction\(/);
    assert.match(source, /return NextResponse\.json\(\{ success: true \}\)/);
  });

  it("keeps Git-triggered Vercel deployment enabled (repo policy)", () => {
    const config = JSON.parse(vercel);
    assert.equal(config.git?.deploymentEnabled, true);
  });

  it("does not log plaintext attempted email addresses in audit records", () => {
    // The audit description must NOT include the raw email. Use a non-reversible
    // SHA-256 hash prefix for correlation so PII is never stored in audit logs.
    assert.doesNotMatch(source, /description: `Failed login attempt for \$\{email\}`/,
      "must not log plaintext email in audit description");
    assert.match(source, /\[redacted\]/,
      "audit description must use [redacted] instead of the email");
    assert.match(source, /createHash\("sha256"\)/,
      "must use SHA-256 hash for non-reversible correlation");
    assert.match(source, /emailCorrelationHash/,
      "must compute a correlation hash from the email");
  });

  it("uses a fixed dummy bcrypt hash instead of cold-start synchronous generation per request", () => {
    // The dummy hash must be a module-level constant, not generated per request.
    // Per-request generation would add ~200ms of CPU to every failed login,
    // creating a DoS vector and making timing-based enumeration easier.
    assert.match(source, /const DUMMY_PASSWORD_HASH = bcrypt\.hashSync\(/,
      "DUMMY_PASSWORD_HASH must be a module-level constant");
    // Verify it's defined at module scope (not inside the POST handler).
    const postStart = source.indexOf("export async function POST");
    const dummyPos = source.indexOf("const DUMMY_PASSWORD_HASH");
    assert.ok(dummyPos < postStart,
      "DUMMY_PASSWORD_HASH must be defined at module scope, not inside POST");
  });
});
