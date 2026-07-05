// Regression tests for P0 audit gaps fixed in this PR.
//
// Covers:
//   SEC-001: reclassify-documents route must NOT fall back to unscoped findFirst
//   SEC-002: repair-metadata route must NOT fall back to unscoped findFirst
//   SEC-003: deduplicate-documents route must scope tender lookup by userId
//   DB-001:  prisma/demo-seed.ts must refuse to run without NODE_ENV guard
//   AI-001:  redactMessage must redact ALL 8 provider key prefixes
//   OBS-002: instrumentation.ts must register unhandledRejection + uncaughtException

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// ─── SEC-001 / SEC-002 / SEC-003: cross-tenant mutation fixes ────────────────

describe("SEC-001: reclassify-documents has no unscoped tender fallback", () => {
  const source = readFileSync("app/api/tenders/[id]/reclassify-documents/route.ts", "utf8");

  it("does NOT contain the unscoped `?? findFirst({ where: { id } })` fallback", () => {
    // The dangerous pattern was: findFirst({ where: { id, userId } }) ?? findFirst({ where: { id } })
    // The fix removes the fallback so the owner-scoped lookup is the only one.
    assert.doesNotMatch(
      source,
      /\?\?\s*await\s+prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId\s*\}/,
      "The unscoped `?? findFirst({ where: { id: tenderId } })` fallback must be removed (audit SEC-001)",
    );
  });

  it("scopes the tender lookup by userId", () => {
    assert.match(
      source,
      /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId,\s*userId:\s*actorId\s*\}/,
      "Tender lookup must be scoped by userId (audit SEC-001)",
    );
  });
});

describe("SEC-002: repair-metadata has no unscoped tender fallback", () => {
  const source = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

  it("does NOT contain the unscoped `?? findFirst({ where: { id } })` fallback", () => {
    assert.doesNotMatch(
      source,
      /\?\?\s*await\s+prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId\s*\}/,
      "The unscoped `?? findFirst({ where: { id: tenderId } })` fallback must be removed (audit SEC-002)",
    );
  });

  it("scopes the tender lookup by userId", () => {
    assert.match(
      source,
      /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId,\s*userId:\s*actor\.id\s*\}/,
      "Tender lookup must be scoped by actor.id (audit SEC-002)",
    );
  });
});

describe("SEC-003: deduplicate-documents scopes tender lookup by userId", () => {
  const source = readFileSync("app/api/tenders/[id]/deduplicate-documents/route.ts", "utf8");

  it("does NOT contain an unscoped `findFirst({ where: { id: tenderId } })`", () => {
    // The dangerous pattern was: findFirst({ where: { id: tenderId } }) with NO userId filter
    // The fix adds userId: actor.id to the where clause.
    assert.doesNotMatch(
      source,
      /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId\s*\}\s*,\s*select/,
      "Unscoped findFirst({ where: { id: tenderId } }) must be replaced with a userId-scoped lookup (audit SEC-003)",
    );
  });

  it("scopes the tender lookup by userId", () => {
    assert.match(
      source,
      /prisma\.tender\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*tenderId,\s*userId:\s*actor\.id\s*\}/,
      "Tender lookup must be scoped by actor.id (audit SEC-003)",
    );
  });
});

// ─── DB-001: demo-seed production guard ──────────────────────────────────────

describe("DB-001: prisma/demo-seed.ts has a production guard", () => {
  const source = readFileSync("prisma/demo-seed.ts", "utf8");

  it("checks NODE_ENV before running", () => {
    assert.match(
      source,
      /process\.env\.NODE_ENV\s*===\s*["']development["']\s*\|\|\s*process\.env\.NODE_ENV\s*===\s*["']test["']/,
      "demo-seed must refuse to run unless NODE_ENV is development or test (audit DB-001)",
    );
  });

  it("has an explicit DEMO_SEED_ALLOWED escape hatch", () => {
    assert.match(
      source,
      /process\.env\.DEMO_SEED_ALLOWED/,
      "demo-seed must check DEMO_SEED_ALLOWED as an escape hatch (audit DB-001)",
    );
  });

  it("calls process.exit(2) when the guard fails", () => {
    // exit code 2 (misuse of command) rather than 1 (general error) so CI can
    // distinguish "refused to run" from "ran and failed".
    assert.match(
      source,
      /process\.exit\(2\)/,
      "demo-seed must exit with code 2 when the production guard fails (audit DB-001)",
    );
  });
});

// ─── AI-001: redactMessage covers all 8 provider key prefixes ────────────────

describe("AI-001: redactMessage covers all 8 provider key prefixes", () => {
  const source = readFileSync("lib/ai-provider-health.ts", "utf8");

  it("redacts Anthropic keys (sk-ant-...)", () => {
    assert.match(source, /sk-ant-\[A-Za-z0-9-_\=\]\{8,\}/);
  });

  it("redacts OpenRouter keys (sk-or-...)", () => {
    assert.match(source, /sk-or-\[A-Za-z0-9-_\=\]\{8,\}/);
  });

  it("redacts OpenAI / Together / legacy keys (sk-...)", () => {
    assert.match(source, /sk-\[A-Za-z0-9-_\]\{8,\}/);
  });

  it("redacts Groq keys (gsk_...)", () => {
    assert.match(source, /gsk_\[A-Za-z0-9-_\]\{8,\}/);
  });

  it("redacts DeepSeek keys (dsk-... or dsk_...)", () => {
    assert.match(source, /dsk\[-_\]\[A-Za-z0-9-_\]\{8,\}/);
  });

  it("redacts Google Gemini legacy keys (AIza...)", () => {
    assert.match(source, /AIza\[A-Za-z0-9_-\]\{20,\}/);
  });

  it("redacts Google Gemini new-format keys (AQ...)", () => {
    assert.match(source, /\\bAQ\[A-Za-z0-9_-\]\{30,\}\\b/);
  });

  it("redacts Authorization: Bearer <token>", () => {
    assert.match(source, /Bearer\\s\+\[A-Za-z0-9\._-\]\+/i);
  });

  it("redacts authorization: <value> header", () => {
    // The regex in source is: /authorization:\s*[A-Za-z0-9._\-+/=]+/gi
    // Match the key parts: "authorization:" + optional whitespace + char class
    assert.match(source, /authorization:\\s\*\[A-Za-z0-9\._/);
  });
});

// ─── OBS-002: instrumentation.ts global exception capture ────────────────────

describe("OBS-002: instrumentation.ts registers global exception capture", () => {
  it("instrumentation.ts exists at the project root", () => {
    assert.ok(existsSync("instrumentation.ts"), "instrumentation.ts must exist at the project root (audit OBS-002)");
  });

  const source = existsSync("instrumentation.ts")
    ? readFileSync("instrumentation.ts", "utf8")
    : "";

  it("exports a register() function (Next.js instrumentation convention)", () => {
    assert.match(source, /export\s+async\s+function\s+register\s*\(/);
  });

  it("registers a process.on('unhandledRejection', ...) listener", () => {
    assert.match(source, /process\.on\(\s*["']unhandledRejection["']/);
  });

  it("registers a process.on('uncaughtException', ...) listener", () => {
    assert.match(source, /process\.on\(\s*["']uncaughtException["']/);
  });

  it("routes captured errors through reportError() from lib/observability", () => {
    assert.match(source, /reportError/);
    // The import is a dynamic `await import("./lib/observability")` to keep
    // the browser bundle from pulling in the server-only observability module.
    assert.match(source, /import\(["']\.\/lib\/observability["']\)/);
  });

  it("guards against the browser bundle (typeof process check)", () => {
    // Next.js calls register() in every runtime; the guard skips the browser.
    assert.match(source, /typeof\s+process\s*===\s*["']undefined["']/);
  });
});

// ─── DB-002: missing FK indexes migration ────────────────────────────────────

describe("DB-002: migration 20260620120000 adds missing FK indexes", () => {
  const migrationPath = "prisma/migrations/20260620120000_add_missing_fk_indexes/migration.sql";
  it("migration file exists", () => {
    assert.ok(existsSync(migrationPath), `Migration file must exist at ${migrationPath} (audit DB-002)`);
  });

  const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("creates Tender_userId_idx", () => {
    assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"Tender_userId_idx"\s+ON\s+"Tender"\s*\("userId"\)/i);
  });

  it("creates GeneratedDocument_tenderId_idx", () => {
    assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"GeneratedDocument_tenderId_idx"\s+ON\s+"GeneratedDocument"\s*\("tenderId"\)/i);
  });

  it("creates AuditLog indexes (userId, entityType+entityId, action, createdAt, composite)", () => {
    assert.match(sql, /"AuditLog_userId_idx"\s+ON\s+"AuditLog"\s*\("userId"\)/i);
    assert.match(sql, /"AuditLog_entityType_entityId_idx"\s+ON\s+"AuditLog"\s*\("entityType",\s*"entityId"\)/i);
    assert.match(sql, /"AuditLog_action_idx"\s+ON\s+"AuditLog"\s*\("action"\)/i);
    assert.match(sql, /"AuditLog_createdAt_idx"\s+ON\s+"AuditLog"\s*\("createdAt"\)/i);
    assert.match(sql, /"AuditLog_entityType_entityId_action_createdAt_idx"\s+ON\s+"AuditLog"\s*\("entityType",\s*"entityId",\s*"action",\s*"createdAt"\)/i);
  });

  it("creates Session_userId_idx", () => {
    assert.match(sql, /"Session_userId_idx"\s+ON\s+"Session"\s*\("userId"\)/i);
  });

  it("uses CREATE INDEX IF NOT EXISTS (idempotent)", () => {
    // Every CREATE INDEX statement must use IF NOT EXISTS so the migration
    // is safe to re-run.
    const createIndexStatements = sql.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"[^"]+"/gi) ?? [];
    assert.ok(createIndexStatements.length >= 10, `Expected at least 10 CREATE INDEX statements, got ${createIndexStatements.length}`);
    for (const stmt of createIndexStatements) {
      assert.match(stmt, /IF\s+NOT\s+EXISTS/i, `Statement must use IF NOT EXISTS: ${stmt}`);
    }
  });
});

describe("DB-002: schema.prisma @@index directives match the migration", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  it("Tender model has @@index([userId])", () => {
    const tenderBlock = schema.match(/model\s+Tender\s*\{[\s\S]*?\n\}/);
    assert.ok(tenderBlock, "Tender model not found");
    assert.match(tenderBlock[0], /@@index\(\[userId\]\)/);
  });

  it("GeneratedDocument model has @@index([tenderId])", () => {
    const block = schema.match(/model\s+GeneratedDocument\s*\{[\s\S]*?\n\}/);
    assert.ok(block, "GeneratedDocument model not found");
    assert.match(block[0], /@@index\(\[tenderId\]\)/);
  });

  it("AuditLog model has 5 @@index directives", () => {
    const block = schema.match(/model\s+AuditLog\s*\{[\s\S]*?\n\}/);
    assert.ok(block, "AuditLog model not found");
    const indexCount = (block[0].match(/@@index\(/g) ?? []).length;
    assert.ok(indexCount >= 5, `AuditLog must have at least 5 @@index directives, got ${indexCount}`);
  });

  it("Session model has @@index([userId])", () => {
    const block = schema.match(/model\s+Session\s*\{[\s\S]*?\n\}/);
    assert.ok(block, "Session model not found");
    assert.match(block[0], /@@index\(\[userId\]\)/);
  });
});

// ─── DOC-001: neon-switch-checklist corrected ────────────────────────────────

describe("DOC-001: neon-switch-checklist.md no longer recommends prisma db push", () => {
  const source = readFileSync("scripts/neon-switch-checklist.md", "utf8");

  it("does NOT recommend running `prisma db push` against production", () => {
    // The old checklist said "The Vercel buildCommand runs: prisma db push"
    // which was wrong and dangerous. The corrected version must NOT contain
    // that recommendation.
    assert.doesNotMatch(
      source,
      /Vercel buildCommand runs:\s*prisma db push/i,
      "neon-switch-checklist must not claim the build runs prisma db push (audit DOC-001)",
    );
  });

  it("explicitly warns against running npm run db:push", () => {
    assert.match(
      source,
      /DO\s+NOT\s+run\s+`npm\s+run\s+db:push`/i,
      "neon-switch-checklist must explicitly warn against db:push (audit DOC-001)",
    );
  });

  it("documents that the build runs prisma migrate deploy", () => {
    assert.match(
      source,
      /prisma migrate deploy/i,
      "neon-switch-checklist must document that the build runs prisma migrate deploy (audit DOC-001)",
    );
  });

  it("references the SubmissionPlanState risk", () => {
    assert.match(
      source,
      /SubmissionPlanState/i,
      "neon-switch-checklist must reference the SubmissionPlanState drop risk (audit DOC-001 / DB-005)",
    );
  });
});

// ─── DOC-007: .env.example documents previously-undocumented security vars ──

describe("DOC-007: .env.example documents security-critical env vars", () => {
  const source = readFileSync(".env.example", "utf8");

  it("documents ADMIN_SECRET", () => {
    assert.match(source, /#\s*ADMIN_SECRET=/);
  });

  it("documents AI_JOBS_WORKER_SECRET", () => {
    assert.match(source, /#\s*AI_JOBS_WORKER_SECRET=/);
  });

  it("documents CRON_SECRET", () => {
    assert.match(source, /#\s*CRON_SECRET=/);
  });

  it("documents AI_PROVIDER_STRICT_AUTH", () => {
    assert.match(source, /#\s*AI_PROVIDER_STRICT_AUTH=/);
  });

  it("documents RATE_LIMIT_ALLOW_DEGRADED", () => {
    assert.match(source, /#\s*RATE_LIMIT_ALLOW_DEGRADED=/);
  });

  it("documents ALLOW_DB_FILE_STORAGE", () => {
    assert.match(source, /#\s*ALLOW_DB_FILE_STORAGE=/);
  });

  it("documents TRUST_PROXY", () => {
    assert.match(source, /#\s*TRUST_PROXY=/);
  });

  it("documents SENTRY_DSN", () => {
    assert.match(source, /#\s*SENTRY_DSN=/);
  });

  it("documents DEMO_SEED_ALLOWED (the demo-seed escape hatch)", () => {
    assert.match(source, /#\s*DEMO_SEED_ALLOWED=/);
  });
});
