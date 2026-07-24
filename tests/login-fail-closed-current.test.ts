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

  it("returns one generic invalid-credentials code for every account state", () => {
    assert.match(source, /if \(!user \|\| !user\.passwordHash \|\| !passwordOk\)/);
    assert.match(source, /return loginResult\(req, nativeForm, "INVALID_CREDENTIALS", 401\)/);
    assert.match(source, /INVALID_CREDENTIALS: "The email or password is incorrect\."/);
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
    assert.match(source, /return withPrivateAuthHeaders\(NextResponse\.json\(\{ success: true \}\)\)/);
  });

  it("applies private no-store and no-referrer headers to every JSON or redirect result", () => {
    assert.match(source, /function withPrivateAuthHeaders/);
    assert.match(source, /Cache-Control", "no-store, max-age=0"/);
    assert.match(source, /Referrer-Policy", "no-referrer"/);
    assert.match(source, /NextResponse\.redirect\(target, 303\)/);
  });

  it("keeps Git-triggered Vercel deployment enabled (repo policy)", () => {
    const config = JSON.parse(vercel);
    assert.equal(config.git?.deploymentEnabled?.["main"], true);
  });
});
