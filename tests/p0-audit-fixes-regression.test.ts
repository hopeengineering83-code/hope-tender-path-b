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

describe("AI-001: redactMessage covers every provider key prefix", () => {
  // These asserted that specific regex LITERALS appeared in
  // lib/ai-provider-health.ts. That pinned one implementation of redaction
  // rather than redaction itself — and it was pinning the copy that had
  // DIVERGED from the shared redactor, which is how the AQ-format Gemini
  // pattern came to exist in one file and not the other. The behaviour is
  // asserted instead, through the function that actually runs.
  const SECRETS: ReadonlyArray<readonly [string, string]> = [
    ["Anthropic", "sk-ant-" + "api03realkey1234567890abcdefghijkl"],
    ["OpenRouter", "sk-or-" + "v1abcdefghijklmnopqrstuvwxyz0123456"],
    ["OpenAI / Together / legacy", "sk-" + "proj1234567890abcdefghijklmnopqrst"],
    ["Groq", "gsk_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
    ["DeepSeek", "dsk-" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
    ["Cerebras", "csk_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"],
    ["Gemini legacy", "AIza" + "SyD1234567890abcdefghijklmnopqrstu"],
    ["Gemini new-format", "AQ" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8"],
  ];

  for (const [label, secret] of SECRETS) {
    it(`redacts ${label} keys`, async () => {
      const { resetProviderHealth, recordProviderFailure, getProviderHealth } =
        await import("../lib/ai-provider-health");
      resetProviderHealth();
      recordProviderFailure("groq", new Error(`provider rejected request: ${secret}`));
      const stored = getProviderHealth("groq").lastFailureMessage ?? "";
      assert.ok(!stored.includes(secret), `${label} key must not be stored in provider health`);
      resetProviderHealth();
    });
  }

  it("redacts Authorization: Bearer <token>", async () => {
    const { resetProviderHealth, recordProviderFailure, getProviderHealth } =
      await import("../lib/ai-provider-health");
    resetProviderHealth();
    recordProviderFailure("groq", new Error("sent Authorization: Bearer abc123def456ghi789jkl"));
    const stored = getProviderHealth("groq").lastFailureMessage ?? "";
    assert.ok(!stored.includes("abc123def456ghi789jkl"));
    resetProviderHealth();
  });

  it("delegates to the shared redactor instead of keeping a private list", () => {
    const source = readFileSync("lib/ai-provider-health.ts", "utf8");
    assert.match(source, /redactSecrets\(/);
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

// ── The shared redactor must not diverge from its local twins ────────────────
describe("redactSecrets covers every provider key format in use", () => {
  it("redacts Google's new-format Gemini keys (AQ...)", async () => {
    // lib/sanitize-error.ts says every caller must use it "so the redaction
    // patterns cannot diverge". They had: lib/ai-provider-health.ts carried the
    // AQ pattern locally while the shared redactor did not, so a new-format
    // Gemini key was redacted on one path and printed verbatim on the other.
    const { redactSecrets } = await import("../lib/sanitize-error");
    const key = "AQ" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8";
    const out = redactSecrets(`Request failed with key ${key} attached`);
    assert.ok(!out.includes(key), "AQ-format Gemini key must be redacted");
    assert.match(out, /\[KEY_REDACTED\]/);
  });

  it("redacts a bare key= query parameter, not only api_key=", async () => {
    // Google's generative-language API authenticates with `?key=`, so any URL
    // of theirs that reaches a message carries the credential in plain sight.
    const { redactSecrets } = await import("../lib/sanitize-error");
    const out = redactSecrets("GET https://generativelanguage.googleapis.com/v1beta/models?key=SUPERSECRETVALUE&pageSize=200 failed");
    assert.ok(!out.includes("SUPERSECRETVALUE"));
    assert.match(out, /key=\[KEY_REDACTED\]/);
  });

  it("still redacts legacy AIza keys and does not mangle ordinary text", async () => {
    const { redactSecrets } = await import("../lib/sanitize-error");
    const legacy = "AIza" + "SyD1234567890abcdefghijklmnopqrstu";
    assert.ok(!redactSecrets(legacy).includes(legacy));
    assert.equal(redactSecrets("the monkey= sat on the wall"), "the monkey= sat on the wall");
  });
});

describe("the capability test never puts a credential in a URL", () => {
  it("authenticates Gemini's model listing with a header, not ?key=", () => {
    const source = readFileSync("lib/ai-provider-capability-test.ts", "utf8");
    assert.match(source, /"x-goog-api-key": key/);
    assert.doesNotMatch(source, /\?key=\$\{/, "a credential in a URL ends up in every log and error string that URL touches");
  });
});

// ─── Consolidating redactors must never LOSE coverage ────────────────────────
describe("the shared redactor is at least as strong as every copy it replaced", () => {
  // Delegating several private redactors onto one shared implementation is only
  // safe if the shared one is a superset. It was not: the private copies matched
  // gsk_/csk_/dsk- after 8 characters, while the shared one required 30 — so the
  // consolidation would have started leaking short or truncated keys that were
  // previously caught. Broader formats, narrower thresholds. This pins the
  // thresholds so the next consolidation cannot repeat it.
  const SHORT_KEYS = [
    "gsk_abcdef123456",
    "csk_abcdef123456",
    "dsk-abcdef123456",
    "dsk_abcdef123456",
    "sk-abcdef123456",
    "sk-ant-abcdef123456",
    "sk-or-v1-abcdef123456",
  ];

  for (const key of SHORT_KEYS) {
    it(`redacts the short form ${key.split(/[-_]/)[0]}… (${key.length} chars)`, async () => {
      const { redactSecrets } = await import("../lib/sanitize-error");
      const out = redactSecrets(`provider said: ${key}`);
      assert.ok(!out.includes(key), `${key} must be redacted, got: ${out}`);
    });
  }

  it("still leaves ordinary prose alone", async () => {
    const { redactSecrets } = await import("../lib/sanitize-error");
    const prose = "the task was risky but the deadline held";
    assert.equal(redactSecrets(prose), prose);
  });
});
