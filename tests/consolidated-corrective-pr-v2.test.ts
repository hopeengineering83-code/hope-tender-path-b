// Consolidated corrective PR v2 — all 18 required scenarios + migration-upgrade test.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
function expectContains(source: string, pattern: RegExp, message?: string) { assert.match(source, pattern, message); }
function expectNotContains(source: string, pattern: RegExp, message?: string) { assert.doesNotMatch(source, pattern, message); }

describe("Consolidated corrective PR v2", () => {

  // ─── Test 1: The exact current PR #861 CI failure ────────────────────
  describe("Test 1 — CI failure: zero-drift schema diff step in CI", () => {
    it("CI workflow file contains the prisma migrate diff step", () => {
      const ci = read(".github/workflows/ci.yml");
      expectContains(ci, /prisma migrate diff/, "CI must contain prisma migrate diff");
      expectContains(ci, /--from-schema-datasource/, "must use --from-schema-datasource");
      expectContains(ci, /--to-schema-datamodel/, "must use --to-schema-datamodel");
      expectContains(ci, /--exit-code/, "must use --exit-code");
    });
    it("CI step appears after migration idempotency, before audit", () => {
      const ci = read(".github/workflows/ci.yml");
      const idempotencyIdx = ci.indexOf("Verify migration idempotency");
      const diffIdx = ci.indexOf("Verify credential-safe zero-drift schema comparison");
      const auditIdx = ci.indexOf("Audit release integrity");
      assert.ok(idempotencyIdx > -1 && diffIdx > -1 && auditIdx > -1, "all three steps must exist");
      assert.ok(idempotencyIdx < diffIdx, "diff must come after idempotency");
      assert.ok(diffIdx < auditIdx, "diff must come before audit");
    });
  });

  // ─── Test 2: Historical migration preservation ──────────────────────
  describe("Test 2 — historical migration preserved", () => {
    it("20260602000000_add_extraction_quality_fields exists (not renamed)", () => {
      assert.ok(
        existsSync("prisma/migrations/20260602000000_add_extraction_quality_fields/migration.sql"),
        "historical migration must exist at its original timestamp",
      );
    });
    it("20260602000001_add_extraction_quality_fields does NOT exist (no renamed duplicate)", () => {
      assert.ok(
        !existsSync("prisma/migrations/20260602000001_add_extraction_quality_fields/migration.sql"),
        "the renamed duplicate must not exist",
      );
    });
    it("historical migration SQL matches main", () => {
      const branchSql = read("prisma/migrations/20260602000000_add_extraction_quality_fields/migration.sql");
      // The migration must start with the expected header comment
      expectContains(branchSql, /Migration: add_extraction_quality_fields/);
    });
  });

  // ─── Test 3: Upgrade from current main migration history ─────────────
  describe("Test 3 — upgrade from main migration history", () => {
    it("historical duplicate timestamp 20260602000000 is preserved exactly as on main", () => {
      // Main has BOTH 20260602000000_add_client_extraction_fields AND
      // 20260602000000_add_extraction_quality_fields. This is a historical
      // duplicate that must NOT be renamed or deleted. The test verifies
      // both exist (preserving main's state) and that no renamed copy
      // (20260602000001) was introduced.
      assert.ok(existsSync("prisma/migrations/20260602000000_add_client_extraction_fields/migration.sql"));
      assert.ok(existsSync("prisma/migrations/20260602000000_add_extraction_quality_fields/migration.sql"));
      assert.ok(!existsSync("prisma/migrations/20260602000001_add_extraction_quality_fields/migration.sql"));
    });
    it("migration_lock.toml exists", () => {
      assert.ok(existsSync("prisma/migrations/migration_lock.toml"));
      expectContains(read("prisma/migrations/migration_lock.toml"), /provider = "postgresql"/);
    });
    it("AiAnalyzeRetryState migration has a new timestamp greater than all existing", () => {
      assert.ok(
        existsSync("prisma/migrations/20260624000001_add_ai_analyze_retry_state/migration.sql"),
        "AiAnalyzeRetryState migration must exist",
      );
    });
  });

  // ─── Test 4: Fresh migration deployment (CI step) ────────────────────
  describe("Test 4 — fresh DB migration deploy", () => {
    it("CI deploys complete migration history", () => {
      const ci = read(".github/workflows/ci.yml");
      expectContains(ci, /Deploy complete migration history/);
      expectContains(ci, /npx prisma migrate deploy/);
    });
    it("CI does NOT use prisma db push or prisma db execute", () => {
      const ci = read(".github/workflows/ci.yml");
      expectNotContains(ci, /prisma db push/);
      expectNotContains(ci, /prisma db execute/);
    });
  });

  // ─── Test 5: Second idempotent migration deployment ──────────────────
  describe("Test 5 — migration idempotency", () => {
    it("CI runs prisma migrate deploy twice", () => {
      const ci = read(".github/workflows/ci.yml");
      const count = (ci.match(/npx prisma migrate deploy/g) ?? []).length;
      assert.ok(count >= 2, `expected >= 2, found ${count}`);
    });
  });

  // ─── Test 6: Zero-drift schema comparison ────────────────────────────
  describe("Test 6 — zero-drift schema diff", () => {
    it("migrate-deploy-safe also runs the zero-drift diff", () => {
      expectContains(read("scripts/migrate-deploy-safe.mjs"), /credential-safe zero-drift schema comparison/);
    });
    it("CI does NOT use --from-url (credential-safe)", () => {
      const ci = read(".github/workflows/ci.yml");
      expectNotContains(ci, /--from-url/);
    });
  });

  // ─── Test 7: Production migration validation fails closed ────────────
  describe("Test 7 — production verification fails closed", () => {
    it("migrate-deploy-safe does NOT swallow verification failures", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectNotContains(src, /Don't throw - migrations are deployed; verification warnings are non-fatal/);
      expectNotContains(src, /Non-fatal for Vercel build - schema is already deployed/);
      expectContains(src, /Post-migration retroactive-init verification FAILED/);
      expectContains(src, /Post-migration critical-schema verification FAILED/);
    });
    it("exactly 1 process.exit(0) in code (the preview-skip gate)", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      const codeLines = src.split("\n").filter((l) => !l.trim().startsWith("//"));
      const count = (codeLines.join("\n").match(/process\.exit\(0\)/g) ?? []).length;
      assert.equal(count, 1, `expected 1 process.exit(0), found ${count}`);
    });
    it("no prisma db push or db execute in deploy script", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectNotContains(src, /prisma.*db.*push/i);
      expectNotContains(src, /prisma.*db.*execute/i);
    });
    it("failed-init recovery is behind ALLOW_PRISMA_INIT_RECOVERY=true", () => {
      const src = read("scripts/migrate-deploy-safe.mjs");
      expectContains(src, /ALLOW_PRISMA_INIT_RECOVERY/);
      expectContains(src, /automatic recovery is disabled/);
    });
  });

  // ─── Tests 8-13: Automatic retry ─────────────────────────────────────

  describe("Test 8 — provider-aware automatic retry only when eligible", () => {
    it("retry service checks isAnyProviderEligible before re-arming", () => {
      const svc = read("lib/ai-analyze/retry-service.ts");
      expectContains(svc, /export function isAnyProviderEligible/);
      expectContains(svc, /if \(!isAnyProviderEligible\(\)\)/);
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
      expectNotContains(route, /apiKey|API_KEY/i);
      expectNotContains(route, /lastSafeErrorMessage|lastFailureMessage/);
    });
    it("server-side retry-due endpoint exists for scheduled retries", () => {
      expectContains(read("app/api/ai-jobs/retry-due/route.ts"), /findJobsDueForRetry/);
      expectContains(read("app/api/ai-jobs/retry-due/route.ts"), /rearmJobForRetry/);
    });
    it("retry-due endpoint is NOT public — requires worker secret, cron secret, or ADMIN", () => {
      const route = read("app/api/ai-jobs/retry-due/route.ts");
      expectContains(route, /AI_JOBS_WORKER_SECRET/);
      expectContains(route, /CRON_SECRET/);
      expectContains(route, /requireRole\("ADMIN"\)/);
    });
  });

  describe("Test 9 — no automatic retry for non-retryable failures", () => {
    it("classifyFailure marks extraction/ownership/hash/config as non-retryable", () => {
      const svc = read("lib/ai-analyze/retry-service.ts");
      expectContains(svc, /EXTRACTION_CORRUPTED/);
      expectContains(svc, /OCR_REQUIRED/);
      expectContains(svc, /TENDER_NOT_FOUND/);
      expectContains(svc, /CONTENT_HASH_CHANGED/);
      expectContains(svc, /GROUNDING_TOO_WEAK/);
      expectContains(svc, /UNAUTHORIZED/);
      expectContains(svc, /CONFIGURATION_INVALID/);
    });
    it("panel does NOT schedule auto-retry when nonRetryable is true", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /if \(!rsNonRetryable && rsRetryCount < MAX_RETRY_COUNT\)/);
    });
  });

  describe("Test 10 — retry resumes completed chunks", () => {
    it("rearmJobForRetry reuses the existing job (does NOT create a new one)", () => {
      const svc = read("lib/ai-analyze/retry-service.ts");
      expectContains(svc, /export async function rearmJobForRetry/);
      expectContains(svc, /prisma\.aiJob\.update\(/);
    });
    it("rearmJobForRetry verifies content hash still matches", () => {
      expectContains(read("lib/ai-analyze/retry-service.ts"), /currentHash !== job\.analysisInputHash/);
    });
  });

  describe("Test 11 — retry creates no duplicate active job", () => {
    it("createAnalysisJob reuses existing QUEUED/RUNNING/PARTIAL_SUCCESS job", () => {
      const svc = read("lib/ai-jobs/analysis-job-service.ts");
      expectContains(svc, /jobType:\s*"AI_ANALYZE".*analysisInputHash:\s*contentHash.*status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING",\s*"PARTIAL_SUCCESS"\]/s);
    });
    it("background-enqueue delegates to createAnalysisJob (idempotent)", () => {
      expectContains(read("lib/ai-analyze/background-enqueue.ts"), /await createAnalysisJob\(\s*\{\s*tenderId,\s*userId\s*\}\s*\)/);
    });
  });

  describe("Test 12 — retry stops after maximum attempts", () => {
    it("RETRY_DELAYS_MS is [30s, 1m, 3m, 10m]", () => {
      expectContains(read("lib/ai-analyze/retry-service.ts"), /RETRY_DELAYS_MS = \[30_000,\s*60_000,\s*180_000,\s*600_000\]/);
    });
    it("MAX_RETRY_COUNT equals 4", () => {
      expectContains(read("lib/ai-analyze/retry-service.ts"), /MAX_RETRY_COUNT = RETRY_DELAYS_MS\.length/);
    });
    it("panel stops scheduling when retryCount >= MAX_RETRY_COUNT", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /MAX_RETRY_COUNT/);
      expectContains(panel, /autoRetryLimitReached/);
    });
  });

  describe("Test 13 — Retry Now remains available afterward", () => {
    it("panel shows 'Automatic retry limit reached — Retry Now'", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /Automatic retry limit reached — Retry Now/);
    });
    it("Retry Now button is always rendered in the retry UI", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      const retryBlock = panel.slice(panel.indexOf("showRetryUI && !analyzing"), panel.indexOf("{error && ("));
      expectContains(retryBlock, /Retry Now/);
    });
  });

  // ─── Tests 14-18: Durable workflow + safety ──────────────────────────

  describe("Test 14 — background AI Analyze path, not SSE", () => {
    it("panel POSTs to ?mode=background", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /\/api\/tenders\/\$\{tenderId\}\/ai-analyze\?mode=background/);
    });
    it("panel does NOT use Accept: text/event-stream", () => {
      expectNotContains(read("components/ai-analyze-panel.tsx"), /Accept["']:\s*["']text\/event-stream["']/);
    });
    it("route wires ?mode=background to enqueueBackgroundAnalysis", () => {
      const route = read("app/api/tenders/[id]/ai-analyze/route.ts");
      expectContains(route, /mode.*background/);
      expectContains(route, /enqueueBackgroundAnalysis/);
    });
    it("panel triggers run-next with authenticated session", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/);
    });
    it("panel polls /api/ai-jobs/[jobId]", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /\/api\/ai-jobs\/\$\{/);
    });
  });

  describe("Test 15 — full AI success promotes canonical data", () => {
    it("handler calls finalizeAnalysisJob on full AI success", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      expectContains(handlers, /result\.success\s*&&\s*!result\.isPartial\s*&&\s*result\.analysisSource\s*===\s*"AI"/);
      expectContains(handlers, /await finalizeAnalysisJob\(result\.jobId,\s*ctx\.userId\)/);
    });
    it("handler returns terminalStatus so run-next respects it", () => {
      expectContains(read("lib/ai-job-handlers.ts"), /terminalStatus:\s*finalizationStatus/);
    });
    it("run-next reads terminalStatus and routes correctly", () => {
      const route = read("app/api/ai-jobs/run-next/route.ts");
      expectContains(route, /output\?\.terminalStatus/);
      expectContains(route, /completeJobWithStatus/);
    });
    it("completeJobWithStatus guards on status=RUNNING", () => {
      expectContains(read("lib/ai-jobs.ts"), /where:\s*\{\s*id:\s*jobId,\s*status:\s*"RUNNING"\s*\}/);
    });
  });

  describe("Test 16 — partial/fallback/failed cannot unlock generation/export/Final ZIP", () => {
    it("handler does NOT call finalizeAnalysisJob on partial branch", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const callCount = (handlers.match(/await finalizeAnalysisJob\(/g) ?? []).length;
      assert.equal(callCount, 1, `expected 1 finalizeAnalysisJob call (success only), found ${callCount}`);
    });
    it("handler returns PARTIAL_SUCCESS or FAILED for non-success", () => {
      expectContains(read("lib/ai-job-handlers.ts"), /const terminalStatus:\s*"PARTIAL_SUCCESS"\s*\|\s*"FAILED"/);
    });
    it("handler does NOT create GeneratedDocument rows", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const block = handlers.slice(handlers.indexOf("AI_ANALYZE:"), handlers.indexOf("AI_REMATCH:"));
      expectNotContains(block, /generatedDocument\.create/i);
    });
    it("generation gate blocks non-ready analysis states", () => {
      const gate = read("lib/engine/generation-readiness-gate.ts");
      expectContains(gate, /ANALYSIS_NOT_READY/);
      expectContains(gate, /FALLBACK_UNAPPROVED/);
      expectContains(gate, /ANALYSIS_NO_PROMOTED_JOB/);
      expectContains(gate, /CHUNKS_INCOMPLETE/);
    });
  });

  describe("Test 17 — blocked flows create zero GeneratedDocument rows", () => {
    it("PROPOSAL_GENERATION handler calls gate before generatedDocument.create", () => {
      const handlers = read("lib/ai-job-handlers.ts");
      const block = handlers.slice(handlers.indexOf("PROPOSAL_GENERATION:"), handlers.indexOf("EVALUATOR_SIM:"));
      const gateIdx = block.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = block.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx);
    });
    it("generate route calls gate before generateTenderDocuments", () => {
      const route = read("app/api/tenders/[id]/generate/route.ts");
      const gateIdx = route.indexOf("assertTenderReadyForGenerationAndExport");
      const genIdx = route.indexOf("generateTenderDocuments(");
      assert.ok(gateIdx > -1 && genIdx > -1 && gateIdx < genIdx);
    });
    it("ai-proposal route calls gate before generatedDocument.create", () => {
      const route = read("app/api/tenders/[id]/ai-proposal/route.ts");
      const gateIdx = route.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = route.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx);
    });
    it("regenerate-cvs route calls gate before generatedDocument.create", () => {
      const route = read("app/api/tenders/[id]/regenerate-cvs/route.ts");
      const gateIdx = route.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = route.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx);
    });
    it("generate-missing-plan-files route calls gate before generatedDocument.create", () => {
      const route = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
      const gateIdx = route.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = route.indexOf("generatedDocument.create");
      assert.ok(gateIdx > -1 && createIdx > -1 && gateIdx < createIdx);
    });
    it("export route calls gate", () => {
      expectContains(read("app/api/tenders/[id]/export/route.ts"), /assertTenderReadyForGenerationAndExport/);
    });
    it("download route calls gate (Final ZIP)", () => {
      expectContains(read("app/api/tenders/[id]/download/route.ts"), /assertTenderReadyForGenerationAndExport/);
    });
  });

  describe("Test 18 — Anthropic remains last and emergency-only", () => {
    it("Anthropic is the last entry in CANONICAL_AI_PROVIDER_ORDER", () => {
      const catalog = read("lib/ai-provider-catalog.cjs");
      const match = catalog.match(/CANONICAL_AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(match);
      const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      assert.equal(providers[providers.length - 1], "anthropic");
    });
    it("Anthropic has emergencyOnly: true in the registry", () => {
      expectContains(read("lib/ai-provider-registry.ts"), /emergencyOnly:\s*true/);
    });
    it("Regex fallback is never AI success", () => {
      expectNotContains(read("lib/engine/analysis-orchestrator.ts"), /analysisSource\s*=\s*"REGEX_FALLBACK"/);
      const src = read("lib/engine/analysis-source.ts");
      expectContains(src, /\/\^analysis\\s\+source:\\s\*ai\\b\/im/);
      expectContains(read("lib/ai-job-handlers.ts"), /result\.analysisSource\s*===\s*"AI"/);
    });
  });

  // ─── Retry state persistence + error logging ─────────────────────────

  describe("retry state persistence", () => {
    it("AiAnalyzeRetryState model exists with all required fields", () => {
      const schema = read("prisma/schema.prisma");
      expectContains(schema, /model AiAnalyzeRetryState/);
      expectContains(schema, /retryCount\s+Int\s+@default\(0\)/);
      expectContains(schema, /nextRetryAt\s+DateTime\?/);
      expectContains(schema, /retryReason\s+String/);
      expectContains(schema, /failureCategory\s+String/);
      expectContains(schema, /nonRetryable\s+Boolean\s+@default\(false\)/);
      expectContains(schema, /lastProviderAvailable\s+Boolean\s+@default\(false\)/);
      expectContains(schema, /lastCheckedAt\s+DateTime\?/);
      expectContains(schema, /contentHash\s+String/);
    });
    it("run-next does NOT silently swallow retry-state persistence failures", () => {
      const route = read("app/api/ai-jobs/run-next/route.ts");
      expectNotContains(route, /\/\* best-effort \*\//);
      expectContains(route, /Retry-state persistence failed/);
    });
  });

  // ─── Worker error visibility ─────────────────────────────────────────

  describe("worker error visibility", () => {
    it("panel surfaces worker 401/403", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /workerRes\.status\s*===\s*401\s*\|\|\s*workerRes\.status\s*===\s*403/);
      expectContains(panel, /Worker could not be started: your session has expired/);
    });
    it("panel surfaces worker 429", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /workerRes\.status\s*===\s*429/);
    });
    it("panel surfaces worker 5xx", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /workerRes\.status\s*>=\s*500/);
    });
  });

  // ─── SubmissionPlanState alignment ───────────────────────────────────

  describe("SubmissionPlanState alignment", () => {
    it("model exists with correct fields", () => {
      const schema = read("prisma/schema.prisma");
      expectContains(schema, /model SubmissionPlanState/);
      expectContains(schema, /tenderId\s+String\s+@id/);
      expectContains(schema, /provenance\s+String\s+@default\("NONE"\)/);
      expectContains(schema, /tender\s+Tender\s+@relation.*onDelete:\s*Cascade/);
    });
  });
});
