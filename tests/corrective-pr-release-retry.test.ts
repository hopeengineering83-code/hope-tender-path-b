// Corrective PR — release/migration integrity + AI Analyze retry button.
//
// These tests lock in the 13 required scenarios from the corrective PR
// spec. They use source inspection (the established pattern in this repo
// for contracts that span routes, handlers, and DB state) plus
// pure-function assertions where the logic is isolatable.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

function expectContains(source: string, pattern: RegExp, message?: string) {
  assert.match(source, pattern, message);
}

function expectNotContains(source: string, pattern: RegExp, message?: string) {
  assert.doesNotMatch(source, pattern, message);
}

// ─── Part A: Migration safety ─────────────────────────────────────────

describe("Part A — migration safety", () => {

  // Test 4: Production migration/schema verification fails closed.
  describe("Test 4 — production verification fails closed", () => {
    it("migrate-deploy-safe does NOT swallow verify-retroactive-init failures", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      // The old PR #757 pattern was console.warn + non-fatal. The fix
      // must throw on verification failure.
      expectNotContains(
        src,
        /Don't throw - migrations are deployed; verification warnings are non-fatal/,
        "must NOT swallow retroactive-init verification with 'non-fatal' comment",
      );
      expectContains(
        src,
        /Post-migration retroactive-init verification FAILED/,
        "must log a FAILED error (not warn) when retroactive-init fails",
      );
      expectContains(
        src,
        /throw new Error\(\s*"Post-migration verification failed: retroactive-init/,
        "must throw when retroactive-init verification fails",
      );
    });

    it("migrate-deploy-safe does NOT swallow check-critical-schema failures", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectNotContains(
        src,
        /Non-fatal for Vercel build - schema is already deployed/,
        "must NOT swallow critical-schema verification with 'non-fatal' comment",
      );
      expectContains(
        src,
        /Post-migration critical-schema verification FAILED/,
        "must log a FAILED error (not warn) when critical-schema fails",
      );
      expectContains(
        src,
        /throw new Error\(\s*"Post-migration verification failed: critical-schema/,
        "must throw when critical-schema verification fails",
      );
    });

    it("migrate-deploy-safe runs the credential-safe zero-drift schema diff", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(
        src,
        /migrate.*diff.*--from-schema-datasource.*prisma\/schema\.prisma.*--to-schema-datamodel.*prisma\/schema\.prisma.*--exit-code/s,
        "must run prisma migrate diff with credential-safe from-schema-datasource + to-schema-datamodel + --exit-code",
      );
      expectContains(
        src,
        /schema drift detected/,
        "must fail closed when drift is detected",
      );
    });

    it("migrate-deploy-safe never uses process.exit(0) after a failed migration", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      // The ONLY legitimate process.exit(0) is the preview-skip gate.
      // There must be NO "preview-error" return path, NO no-history
      // exit(0), and NO blanket catch-and-exit-0.
      expectNotContains(src, /preview-error/, "must NOT have a preview-error return path");
      expectNotContains(
        src,
        /process\.exit\(0\)[\s\S]*Skipping migration baseline/,
        "must NOT process.exit(0) on no-history",
      );
      // Count process.exit(0) in CODE (not comments). There should be
      // exactly ONE — the preview-skip gate. Comment references to
      // process.exit(0) are OK (they document what NOT to do).
      const codeLines = src.split("\n").filter((l) => !l.trim().startsWith("//"));
      const exitZeroCount = (codeLines.join("\n").match(/process\.exit\(0\)/g) ?? []).length;
      assert.ok(
        exitZeroCount === 1,
        `expected exactly 1 process.exit(0) in code (the preview-skip gate), found ${exitZeroCount}`,
      );
    });

    it("migrate-deploy-safe does NOT use prisma db push or prisma db execute", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectNotContains(src, /prisma.*db.*push/i, "must NOT use prisma db push");
      expectNotContains(src, /prisma.*db.*execute/i, "must NOT use prisma db execute");
    });
  });

  // Test 5: Preview without isolated preview DB remains build-only.
  describe("Test 5 — preview without isolated DB is build-only", () => {
    it("preview skip clearly states build-only and not database-verified", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(src, /Skipping database migrations by preview safety policy/);
      expectContains(src, /build-only and is not database-verified/);
      expectContains(src, /ALLOW_PREVIEW_DB_MIGRATIONS/);
    });

    it("preview with ALLOW_PREVIEW_DB_MIGRATIONS requires isolated preview DB", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(
        src,
        /DATABASE_URL matches PRODUCTION_DATABASE_URL/,
        "must refuse when preview DATABASE_URL matches production",
      );
      expectContains(
        src,
        /refusing to migrate a production database from a preview build/,
        "must fail closed when preview DB is not isolated",
      );
    });
  });

  // Test 6: Exact failed-init repair is blocked unless all checks pass.
  describe("Test 6 — failed-init repair requires all verification checks", () => {
    it("failed-init recovery only targets 20260601000000_init (no arbitrary migration)", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(src, /INIT_MIGRATION = "20260601000000_init"/);
      expectContains(src, /migrate.*resolve.*--rolled-back.*INIT_MIGRATION/);
      expectContains(src, /migrate.*resolve.*--applied.*INIT_MIGRATION/);
    });

    it("failed-init recovery requires verify-retroactive-init with --expect-failed-init --require-schema", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(
        src,
        /verify-retroactive-init\.mjs.*--expect-failed-init.*--require-schema/s,
        "must call verify-retroactive-init with both flags before resolve",
      );
      expectContains(
        src,
        /Safety check failed: cannot resolve failed-init because schema preconditions are not met/,
        "must throw when preconditions fail",
      );
    });

    it("no-history is a hard error (no automatic baselining)", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(
        src,
        /Automatic baselining is disabled; use a separately reviewed manual recovery procedure/,
        "no-history must throw, not baseline",
      );
    });
  });
});

// ─── Part B: Schema alignment ─────────────────────────────────────────

describe("Part B — schema alignment", () => {

  // Test 3: Prisma schema diff exits clean with zero drift.
  describe("Test 3 — prisma schema diff is wired and credential-safe", () => {
    it("CI runs prisma migrate diff with credential-safe flags", () => {
      const ci = read(".github/workflows/ci.yml");
      expectContains(
        ci,
        /prisma migrate diff/,
        "CI must run prisma migrate diff",
      );
      expectContains(
        ci,
        /--from-schema-datasource/,
        "CI must use --from-schema-datasource (credential-safe, no --from-url)",
      );
      expectContains(
        ci,
        /--to-schema-datamodel/,
        "CI must use --to-schema-datamodel",
      );
      expectContains(
        ci,
        /--exit-code/,
        "CI must use --exit-code so drift fails the build",
      );
      expectNotContains(
        ci,
        /--from-url/,
        "CI must NOT use --from-url (credential leak risk)",
      );
    });

    it("migrate-deploy-safe also runs the zero-drift diff", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(
        src,
        /credential-safe zero-drift schema comparison/,
        "migrate-deploy-safe must run the zero-drift diff",
      );
    });
  });

  // Test 2: Second prisma migrate deploy succeeds with no changes (idempotency).
  describe("Test 2 — migration idempotency", () => {
    it("CI runs prisma migrate deploy twice for idempotency", () => {
      const ci = read(".github/workflows/ci.yml");
      const deployCount = (ci.match(/npx prisma migrate deploy/g) ?? []).length;
      assert.ok(
        deployCount >= 2,
        `CI must run 'npx prisma migrate deploy' at least twice (idempotency), found ${deployCount}`,
      );
    });
  });

  // Test 1: Fresh PostgreSQL database: prisma migrate deploy succeeds.
  describe("Test 1 — fresh DB migration deploy", () => {
    it("CI deploys the complete migration history", () => {
      const ci = read(".github/workflows/ci.yml");
      expectContains(ci, /Deploy complete migration history/);
      expectContains(ci, /npx prisma migrate deploy/);
    });

    it("CI does NOT use prisma db push or prisma db execute", () => {
      const ci = read(".github/workflows/ci.yml");
      expectNotContains(ci, /prisma db push/, "CI must NOT use prisma db push");
      expectNotContains(ci, /prisma db execute/, "CI must NOT use prisma db execute");
    });
  });

  // Schema alignment checks
  describe("schema/migration alignment", () => {
    it("migration_lock.toml exists", () => {
      assert.ok(
        existsSync("prisma/migrations/migration_lock.toml"),
        "migration_lock.toml must exist",
      );
      const content = read("prisma/migrations/migration_lock.toml");
      expectContains(content, /provider = "postgresql"/);
    });

    it("no duplicate migration timestamps", () => {
      const dirs = readdirSync("prisma/migrations")
        .filter((d) => !d.startsWith("."))
        .filter((d) => d !== "migration_lock.toml");
      const timestamps = dirs.map((d) => d.split("_")[0]);
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const ts of timestamps) {
        if (seen.has(ts)) duplicates.push(ts);
        seen.add(ts);
      }
      assert.deepEqual(
        duplicates,
        [],
        `duplicate migration timestamps found: ${duplicates.join(", ")}`,
      );
    });

    it("SubmissionPlanState model exists in schema with correct fields", () => {
      const schema = read("prisma/schema.prisma");
      expectContains(schema, /model SubmissionPlanState/);
      expectContains(schema, /tenderId\s+String\s+@id/);
      expectContains(schema, /provenance\s+String\s+@default\("NONE"\)/);
      expectContains(schema, /confirmationStatus\s+String\s+@default\("NOT_REQUIRED"\)/);
      expectContains(schema, /derivedDocumentCount\s+Int\s+@default\(0\)/);
      expectContains(schema, /activeDocumentCount\s+Int\s+@default\(0\)/);
      expectContains(schema, /confirmedAt\s+DateTime\?/);
      expectContains(schema, /tender\s+Tender\s+@relation.*onDelete:\s*Cascade/);
    });

    it("SubmissionPlanState table exists in migration SQL", () => {
      const migration = read("prisma/migrations/20260613190000_comprehensive_gap_guards/migration.sql");
      expectContains(migration, /CREATE TABLE IF NOT EXISTS "SubmissionPlanState"/);
      expectContains(migration, /"tenderId" text PRIMARY KEY/);
      expectContains(migration, /"provenance" text NOT NULL DEFAULT 'NONE'/);
      expectContains(migration, /FOREIGN KEY \("tenderId"\) REFERENCES "Tender"\(id\) ON DELETE CASCADE/);
    });
  });
});

// ─── Part C: AI Analyze retry button ──────────────────────────────────

describe("Part C — AI Analyze retry button", () => {

  // Test 7: Retry button is disabled when no provider is eligible.
  describe("Test 7 — retry disabled when no provider eligible", () => {
    it("panel gates retry on server-side anyAvailable", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(
        panel,
        /providerAvail\?\.anyAvailable/,
        "panel must gate retry on providerAvail.anyAvailable (server-side check)",
      );
      expectContains(
        panel,
        /canRetry.*=.*!analyzing.*&&.*Boolean\(providerAvail\?\.anyAvailable\)/,
        "canRetry must require both !analyzing AND anyAvailable",
      );
      expectContains(
        panel,
        /disabled=\{!canRetry\}/,
        "retry button must be disabled when !canRetry",
      );
    });

    it("panel shows 'Providers unavailable' when no provider is eligible", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /Providers unavailable — retry after/);
      expectContains(panel, /Providers unavailable — retry later/);
    });
  });

  // Test 8: Retry button automatically becomes enabled when a provider becomes healthy.
  describe("Test 8 — retry auto-enables when provider becomes healthy", () => {
    it("panel polls /api/ai-providers/availability", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(
        panel,
        /\/api\/ai-providers\/availability/,
        "panel must poll the provider-availability endpoint",
      );
    });

    it("panel starts availability polling when there's an error or partial result", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(
        panel,
        /if \(error \|\| \(analyzeResult && !analyzeResult\.ai\)\)/,
        "panel must start polling when error or non-AI result",
      );
    });

    it("panel shows 'Provider available' when a provider is ready", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /Provider available — Retry AI Analyze/);
    });

    it("availability endpoint computes server-side from configured keys + health + cooldown", () => {
      const route = read("app/api/ai-providers/availability/route.ts");
      expectContains(route, /isProviderConfigured/);
      expectContains(route, /getProviderRuntimeSnapshot/);
      expectContains(route, /getMinCooldownExpiryMs/);
      expectContains(route, /anyAvailable/);
    });

    it("availability endpoint does NOT expose API keys or raw errors", () => {
      const route = read("app/api/ai-providers/availability/route.ts");
      expectNotContains(route, /apiKey|API_KEY/i, "must not reference API keys");
      expectNotContains(route, /lastSafeErrorMessage|lastFailureMessage/, "must not expose raw error messages");
    });
  });

  // Test 9: Retry never creates duplicate active jobs.
  describe("Test 9 — retry never creates duplicate active jobs", () => {
    it("createAnalysisJob reuses existing QUEUED/RUNNING/PARTIAL_SUCCESS job for same hash", () => {
      const svc = read("lib/ai-jobs/analysis-job-service.ts");
      expectContains(
        svc,
        /jobType:\s*"AI_ANALYZE".*analysisInputHash:\s*contentHash.*status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING",\s*"PARTIAL_SUCCESS"\]/s,
        "createAnalysisJob must findFirst by contentHash + active statuses before creating",
      );
      expectContains(
        svc,
        /if \(!job\)/,
        "must only create a new job when no existing active job is found",
      );
    });

    it("background-enqueue delegates to createAnalysisJob (idempotent)", () => {
      const enq = read("lib/ai-analyze/background-enqueue.ts");
      expectContains(enq, /await createAnalysisJob\(\s*\{\s*tenderId,\s*userId\s*\}\s*\)/);
    });
  });

  // Test 10: Retry uses the durable background job route, never the direct SSE route.
  describe("Test 10 — retry uses durable background, never SSE", () => {
    it("panel POSTs to ?mode=background", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(
        panel,
        /\/api\/tenders\/\$\{tenderId\}\/ai-analyze\?mode=background/,
        "panel must POST to ?mode=background",
      );
    });

    it("panel does NOT use Accept: text/event-stream", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectNotContains(
        panel,
        /Accept["']:\s*["']text\/event-stream["']/,
        "panel must NOT use Accept: text/event-stream (direct SSE)",
      );
    });

    it("panel triggers run-next with authenticated session", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/);
    });

    it("panel polls /api/ai-jobs/[jobId] for status", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /\/api\/ai-jobs\/\$\{jobId\}/);
    });

    it("route wires ?mode=background to enqueueBackgroundAnalysis", () => {
      const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
      expectContains(route, /mode.*background/);
      expectContains(route, /enqueueBackgroundAnalysis/);
    });
  });

  // Test 5 (Part C): Worker 401/403/429/500 is visible in UI and not silently swallowed.
  describe("worker-start errors are visible in the UI", () => {
    it("panel surfaces worker 401/403 as a clear error", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(
        panel,
        /workerRes\.status\s*===\s*401\s*\|\|\s*workerRes\.status\s*===\s*403/,
      );
      expectContains(panel, /Worker could not be started: your session has expired/);
    });

    it("panel surfaces worker 429 as a clear error", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /workerRes\.status\s*===\s*429/);
      expectContains(panel, /Worker start rate-limited/);
    });

    it("panel surfaces worker 5xx as a clear error", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /workerRes\.status\s*>=\s*500/);
      expectContains(panel, /Worker start failed/);
    });
  });

  // Polling lifecycle
  describe("availability polling lifecycle", () => {
    it("panel stops polling after success, unmount, or new active job", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /stopAvailPolling/);
      expectContains(
        panel,
        /if \(error \|\| \(analyzeResult && !analyzeResult\.ai\)\)\s*\{[^}]*startAvailPolling/s,
        "must start polling only on error/partial",
      );
    });
  });
});

// ─── Durable workflow correctness ─────────────────────────────────────

describe("Durable workflow correctness", () => {

  // Test 11: Full AI success finalizes canonical analysis correctly.
  describe("Test 11 — full success calls finalizer + promotes canonical", () => {
    it("handler calls finalizeAnalysisJob on full AI success", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      expectContains(
        handlers,
        /result\.success\s*&&\s*!result\.isPartial\s*&&\s*result\.analysisSource\s*===\s*"AI"/,
        "handler must gate finalization on full AI success",
      );
      expectContains(
        handlers,
        /await finalizeAnalysisJob\(result\.jobId,\s*ctx\.userId\)/,
        "handler must call finalizeAnalysisJob on success",
      );
    });

    it("handler returns terminalStatus so run-next respects it", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      expectContains(handlers, /terminalStatus:\s*finalizationStatus/);
    });

    it("run-next reads terminalStatus and routes correctly", () => {
      const route = read("app/api/ai-jobs/run-next/route.ts");
      expectContains(route, /output\?\.terminalStatus/);
      expectContains(route, /completeJobWithStatus/);
      expectContains(
        route,
        /if \(terminalStatus === "SUCCEEDED"\)/,
        "run-next must gate completeJob on SUCCEEDED",
      );
    });

    it("completeJobWithStatus guards on status=RUNNING (no downgrade)", () => {
      const jobs = read("lib/ai-jobs.ts");
      expectContains(
        jobs,
        /where:\s*\{\s*id:\s*jobId,\s*status:\s*"RUNNING"\s*\}/,
        "completeJobWithStatus must guard on RUNNING so a promoted job cannot be downgraded",
      );
    });
  });

  // Test 12: Partial/fallback/failed analysis cannot promote canonical data or unlock generation/export/Final ZIP.
  describe("Test 12 — partial/failed never promotes canonical", () => {
    it("handler does NOT call finalizeAnalysisJob on the partial branch", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const callCount = (handlers.match(/await finalizeAnalysisJob\(/g) ?? []).length;
      assert.equal(callCount, 1, `handler must call finalizeAnalysisJob exactly once (success only), found ${callCount}`);
    });

    it("handler returns PARTIAL_SUCCESS or FAILED for non-success", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      expectContains(
        handlers,
        /const terminalStatus:\s*"PARTIAL_SUCCESS"\s*\|\s*"FAILED"/,
      );
    });

    it("handler does NOT create GeneratedDocument rows", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const analyzeBlock = handlers.slice(
        handlers.indexOf("AI_ANALYZE:"),
        handlers.indexOf("AI_REMATCH:"),
      );
      expectNotContains(
        analyzeBlock,
        /generatedDocument\.create/i,
        "AI_ANALYZE handler must NOT create GeneratedDocument rows",
      );
    });

    it("regex fallback is never AI success", () => {
      const orchestrator = read("lib/engine/analysis-orchestrator.ts");
      expectNotContains(
        orchestrator,
        /analysisSource\s*=\s*"REGEX_FALLBACK"/,
        "orchestrator must never set analysisSource to REGEX_FALLBACK",
      );
    });

    it("generation gate blocks non-ready analysis states", () => {
      const gate = read("lib/engine/generation-readiness-gate.ts");
      expectContains(gate, /ANALYSIS_NOT_READY/);
      expectContains(gate, /FALLBACK_UNAPPROVED/);
      expectContains(gate, /ANALYSIS_NO_PROMOTED_JOB/);
      expectContains(gate, /CHUNKS_INCOMPLETE/);
    });
  });

  // Test 13: Blocked flows create zero GeneratedDocument rows.
  describe("Test 13 — blocked flows create zero GeneratedDocument rows", () => {
    it("PROPOSAL_GENERATION handler calls the gate before generatedDocument.create", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const propGenBlock = handlers.slice(
        handlers.indexOf("PROPOSAL_GENERATION:"),
        handlers.indexOf("EVALUATOR_SIM:"),
      );
      const gateIdx = propGenBlock.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = propGenBlock.indexOf("generatedDocument.create");
      assert.ok(
        gateIdx > -1 && createIdx > -1 && gateIdx < createIdx,
        "PROPOSAL_GENERATION must call the gate BEFORE generatedDocument.create",
      );
    });

    it("generate route calls the gate before generateTenderDocuments", () => {
      const route = read("app/api/tenders/[id]/generate/route.ts");
      const gateIdx = route.indexOf("assertTenderReadyForGenerationAndExport");
      const genIdx = route.indexOf("generateTenderDocuments(");
      assert.ok(
        gateIdx > -1 && genIdx > -1 && gateIdx < genIdx,
        "generate route must call the gate BEFORE generateTenderDocuments",
      );
    });

    it("export route calls the gate", () => {
      const route = read("app/api/tenders/[id]/export/route.ts");
      expectContains(route, /assertTenderReadyForGenerationAndExport/);
    });

    it("download route calls the gate (final ZIP)", () => {
      const route = read("app/api/tenders/[id]/download/route.ts");
      expectContains(route, /assertTenderReadyForGenerationAndExport/);
    });
  });
});

// ─── Non-negotiable tender safety rules ───────────────────────────────

describe("Non-negotiable tender safety", () => {
  it("Anthropic remains last in provider fallback", () => {
    const catalog = read("lib/ai-provider-catalog.cjs");
    expectContains(catalog, /"anthropic"/);
    // Anthropic must be the last entry in the CANONICAL_AI_PROVIDER_ORDER array.
    const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, "must find CANONICAL_AI_PROVIDER_ORDER array");
    const order = match[1];
    // Extract all provider names in order.
    const providers = Array.from(order.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.ok(providers.length >= 10, `expected at least 10 providers, found ${providers.length}`);
    assert.equal(
      providers[providers.length - 1],
      "anthropic",
      `anthropic must be the last provider in the fallback chain, got: ${providers[providers.length - 1]}`,
    );
  });

  it("background-enqueue verifies tender ownership", () => {
    const enq = read("lib/ai-analyze/background-enqueue.ts");
    expectContains(
      enq,
      /prisma\.tender\.findFirst\(\s*\{[^}]*where:\s*\{\s*id:\s*tenderId,\s*userId\s*\}/s,
      "must findFirst by (id, userId) to enforce ownership",
    );
  });

  it("background-enqueue validates extraction quality", () => {
    const enq = read("lib/ai-analyze/background-enqueue.ts");
    expectContains(enq, /assessExtractionQuality/);
    expectContains(enq, /EXTRACTION_CORRUPTED_AI_SKIPPED/);
  });

  it("availability endpoint requires ADMIN or PROPOSAL_MANAGER", () => {
    const route = read("app/api/ai-providers/availability/route.ts");
    expectContains(route, /requireRole\("ADMIN",\s*"PROPOSAL_MANAGER"\)/);
  });
});
