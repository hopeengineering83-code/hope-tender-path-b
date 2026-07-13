import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const source = readFileSync(join(rootDir, "app/api/tenders/route.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

const getStart = source.indexOf("export async function GET");
const postStart = source.indexOf("export async function POST");
const getRegion = source.slice(getStart, postStart);
const postRegion = source.slice(postStart);

describe("tender creation mutation RBAC", () => {
  it("keeps GET available to authenticated readers", () => {
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /tender-list:\$\{userId\}/);
    assert.match(getRegion, /where: \{\s*userId/);
  });

  it("requires ADMIN or PROPOSAL_MANAGER for POST with no session-only fallback", () => {
    assert.match(postRegion, /requireRoleOrRespond\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.doesNotMatch(postRegion, /getSession/);
    assert.doesNotMatch(postRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the canonical auth response helper instead of error-message classification", () => {
    // The route must use requireRoleOrRespond (the canonical helper) instead
    // of inline try/catch with error.message === "Forbidden" string matching.
    assert.match(postRegion, /requireRoleOrRespond\(/);
    assert.match(postRegion, /if \(authResult instanceof Response\) return authResult/);
    // Must NOT use the old inline error-message pattern.
    assert.doesNotMatch(postRegion, /error\.message === "Forbidden"/,
      "must not use error.message === 'Forbidden' string matching — use canonical helper");
    assert.doesNotMatch(postRegion, /forbiddenResponse\(\)/,
      "forbiddenResponse is handled by the canonical helper, not inline");
    assert.doesNotMatch(postRegion, /unauthorizedResponse\(\)/,
      "unauthorizedResponse is handled by the canonical helper, not inline");
  });

  it("uses the approved actor for persistent throttling and ownership", () => {
    assert.match(postRegion, /rateLimitPersistent\(`tender-create:\$\{actor\.id\}`/);
    assert.match(postRegion, /userId: actor\.id/);
    assert.match(postRegion, /extractRequestId\(req\)/);
  });

  it("preserves input validation and fresh intake state", () => {
    assert.match(postRegion, /title is required/);
    assert.match(postRegion, /title must be 500 characters or fewer/);
    assert.match(postRegion, /description must be 10,000 characters or fewer/);
    assert.match(postRegion, /budget must be a finite number/);
    assert.match(postRegion, /status: "DRAFT"/);
    assert.match(postRegion, /stage: "TENDER_INTAKE"/);
    assert.match(postRegion, /cleanTenderTitle/);
    assert.match(postRegion, /cleanClientName/);
  });

  it("returns stable correlated failures and makes audit non-fatal", () => {
    assert.match(postRegion, /TENDER_CREATE_FAILED/);
    assert.match(postRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.match(postRegion, /void logAction\(/);
    assert.match(postRegion, /tender creation audit persistence failed/);
    assert.match(postRegion, /requestId/);
    assert.doesNotMatch(postRegion, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Four-role matrix: ADMIN and PROPOSAL_MANAGER are allowed; VIEWER and
// REVIEWER must be rejected and cause zero created rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("tender creation four-role matrix and zero-created-row rejection", () => {
  it("the requireRoleOrRespond allowlist contains exactly ADMIN and PROPOSAL_MANAGER", () => {
    const match = postRegion.match(/requireRoleOrRespond\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.ok(match, "requireRoleOrRespond must be called with ADMIN and PROPOSAL_MANAGER");
  });

  it("VIEWER and REVIEWER are not in the allowlist", () => {
    const helperPos = postRegion.indexOf("requireRoleOrRespond(");
    const helperRegion = postRegion.slice(helperPos, helperPos + 120);
    assert.doesNotMatch(helperRegion, /"VIEWER"/,
      "VIEWER must not be in the allowlist");
    assert.doesNotMatch(helperRegion, /"REVIEWER"/,
      "REVIEWER must not be in the allowlist");
  });

  it("rejected roles cause zero created rows — auth check runs before any prisma call", () => {
    // requireRoleOrRespond must run BEFORE any prisma operation.
    const authPos = postRegion.indexOf("requireRoleOrRespond(");
    const firstPrismaPos = postRegion.indexOf("prisma.");
    assert.ok(authPos >= 0, "must call requireRoleOrRespond");
    assert.ok(firstPrismaPos > authPos,
      "requireRoleOrRespond must run before any prisma operation — rejected roles cause zero created rows");

    // The Response check must return before any prisma call.
    const responseCheckPos = postRegion.indexOf("if (authResult instanceof Response) return authResult");
    assert.ok(responseCheckPos > authPos,
      "must check authResult instanceof Response after requireRoleOrRespond");
    assert.ok(firstPrismaPos > responseCheckPos,
      "prisma operations must come after the Response check — rejected roles cause zero created rows");
  });

  it("no session-only fallback remains — getSession is absent from POST", () => {
    assert.doesNotMatch(postRegion, /getSession/,
      "getSession must not appear in POST — no session-only fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verify the canonical helper exists in lib/auth.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("canonical auth response helper", () => {
  it("lib/auth.ts exports requireRoleOrRespond", () => {
    const authSource = readFileSync(join(rootDir, "lib/auth.ts"), "utf8");
    assert.match(authSource, /export async function requireRoleOrRespond/);
    assert.match(authSource, /return forbiddenResponse\(\)/);
    assert.match(authSource, /return unauthorizedResponse\(\)/);
    // The helper must handle both Forbidden and other errors.
    assert.match(authSource, /error\.message === "Forbidden"/);
  });
});
