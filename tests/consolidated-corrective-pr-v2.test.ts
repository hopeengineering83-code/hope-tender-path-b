// Consolidated corrective PR — all 15 required scenarios.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
function expectContains(source: string, pattern: RegExp, message?: string) { assert.match(source, pattern, message); }
function expectNotContains(source: string, pattern: RegExp, message?: string) { assert.doesNotMatch(source, pattern, message); }

describe("Consolidated corrective PR", () => {

  // ─── Tests 1-5: Automatic retry ──────────────────────────────────────

  describe("Test 1 — retry only after server-side provider availability", () => {
    it("panel polls /api/ai-providers/availability", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /\/api\/ai-providers\/availability/);
    });
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
  });

  describe("Test 2 — non-retryable failures never auto-retry", () => {
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
      const panel = read("components/ai-analyze-panel.tsx");
      expectContains(panel, /if \(!rsNonRetryable && rsRetryCount < MAX_RETRY_COUNT\)/);
    });
  });

  describe("Test 3 — resume from checkpoint, no duplicate jobs", () => {
    it("createAnalysisJob reuses existing QUEUED/RUNNING/PARTIAL_SUCCESS job", () => {
      const svc = read("lib/ai-jobs/analysis-job-service.ts");
      expectContains(svc, /jobType:\s*"AI_ANALYZE".*analysisInputHash:\s*contentHash.*status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING",\s*"PARTIAL_SUCCESS"\]/s);
    });
    it("rearmJobForRetry reuses the existing job (does NOT create a new one)", () => {
      const svc = read("lib/ai-analyze/retry-service.ts");
      expectContains(svc, /export async function rearmJobForRetry/);
      expectContains(svc, /prisma\.aiJob\.update\(/);
    });
    it("background-enqueue delegates to createAnalysisJob (idempotent)", () => {
      expectContains(read("lib/ai-analyze/background-enqueue.ts"), /await createAnalysisJob\(\s*\{\s*tenderId,\s*userId\s*\}\s*\)/);
    });
  });

  describe("Test 4 — retry stops after limit", () => {
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

  describe("Test 5 — Retry Now remains available", () => {
    it("panel shows 'Automatic retry limit reached — Retry Now'", () => {
      expectContains(read("components/ai-analyze-panel.tsx"), /Automatic retry limit reached — Retry Now/);
    });
    it("Retry Now button is always rendered in the retry UI", () => {
      const panel = read("components/ai-analyze-panel.tsx");
      const retryBlock = panel.slice(panel.indexOf("showRetryUI && !analyzing"), panel.indexOf("{error && ("));
      expectContains(retryBlock, /Retry Now/);
    });
  });

  // ─── Tests 6-9: Durable workflow ─────────────────────────────────────

  describe("Test 6 — background enqueue, not SSE", () => {
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

  describe("Test 7 — full success promotes canonical", () => {
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

  describe("Test 8 — partial/failed never unlocks", () => {
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

  describe("Test 9 — blocked flows create zero GeneratedDocument rows", () => {
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

  // ─── Tests 10-11: Provider safety ────────────────────────────────────

  describe("Test 10 — Anthropic last and emergency-only", () => {
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
  });

  describe("Test 11 — regex fallback is never AI success", () => {
    it("orchestrator never sets analysisSource to REGEX_FALLBACK", () => {
      expectNotContains(read("lib/engine/analysis-orchestrator.ts"), /analysisSource\s*=\s*"REGEX_FALLBACK"/);
    });
    it("analysis-source.ts uses anchored, word-bounded regexes", () => {
      const src = read("lib/engine/analysis-source.ts");
      expectContains(src, /\/\^analysis\\s\+source:\\s\*ai\\b\/im/);
      expectContains(src, /\/\^analysis\\s\+source:\\s\*regex\\s\+fallback\\b\/im/);
    });
    it("handler success gate requires analysisSource === 'AI'", () => {
      expectContains(read("lib/ai-job-handlers.ts"), /result\.analysisSource\s*===\s*"AI"/);
    });
  });

  // ─── Tests 12-15: Migration and release integrity ────────────────────

  describe("Test 12 — fresh DB migration deploy", () => {
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

  describe("Test 13 — migration idempotency", () => {
    it("CI runs prisma migrate deploy twice", () => {
      const ci = read(".github/workflows/ci.yml");
      const count = (ci.match(/npx prisma migrate deploy/g) ?? []).length;
      assert.ok(count >= 2, `expected >= 2, found ${count}`);
    });
  });

  describe("Test 14 — zero-drift schema diff", () => {
    it("CI runs prisma migrate diff with credential-safe flags", () => {
      const ci = read(".github/workflows/ci.yml");
      expectContains(ci, /prisma migrate diff/);
      expectContains(ci, /--from-schema-datasource/);
      expectContains(ci, /--to-schema-datamodel/);
      expectContains(ci, /--exit-code/);
      expectNotContains(ci, /--from-url/);
    });
    it("migrate-deploy-safe also runs the zero-drift diff", () => {
      expectContains(read("scripts/migrate-deploy-safe.mjs"), /credential-safe zero-drift schema comparison/);
    });
  });

  describe("Test 15 — production verification fails closed", () => {
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
  });

  // ─── Schema alignment ────────────────────────────────────────────────

  describe("schema alignment", () => {
    it("migration_lock.toml exists", () => {
      assert.ok(existsSync("prisma/migrations/migration_lock.toml"));
      expectContains(read("prisma/migrations/migration_lock.toml"), /provider = "postgresql"/);
    });
    it("no duplicate migration timestamps", () => {
      const dirs = readdirSync("prisma/migrations").filter((d) => !d.startsWith(".") && d !== "migration_lock.toml");
      const timestamps = dirs.map((d) => d.split("_")[0]);
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const ts of timestamps) { if (seen.has(ts)) dupes.push(ts); seen.add(ts); }
      assert.deepEqual(dupes, [], `duplicate timestamps: ${dupes.join(", ")}`);
    });
    it("SubmissionPlanState model exists with correct fields", () => {
      const schema = read("prisma/schema.prisma");
      expectContains(schema, /model SubmissionPlanState/);
      expectContains(schema, /tenderId\s+String\s+@id/);
      expectContains(schema, /provenance\s+String\s+@default\("NONE"\)/);
      expectContains(schema, /tender\s+Tender\s+@relation.*onDelete:\s*Cascade/);
    });
    it("AiAnalyzeRetryState model exists with retry fields", () => {
      const schema = read("prisma/schema.prisma");
      expectContains(schema, /model AiAnalyzeRetryState/);
      expectContains(schema, /retryCount\s+Int\s+@default\(0\)/);
      expectContains(schema, /nextRetryAt\s+DateTime\?/);
      expectContains(schema, /retryReason\s+String/);
      expectContains(schema, /failureCategory\s+String/);
      expectContains(schema, /nonRetryable\s+Boolean\s+@default\(false\)/);
      expectContains(schema, /lastProviderAvailable\s+Boolean\s+@default\(false\)/);
    });
    it("AiAnalyzeRetryState migration exists", () => {
      assert.ok(existsSync("prisma/migrations/20260624000001_add_ai_analyze_retry_state/migration.sql"));
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

  // ─── Failed-init recovery ────────────────────────────────────────────

  describe("failed-init recovery", () => {
    it("only targets 20260601000000_init", () => {
      expectContains(read("scripts/migrate-deploy-safe.mjs"), /INIT_MIGRATION = "20260601000000_init"/);
    });
    it("requires verify-retroactive-init with --expect-failed-init --require-schema", () => {
      expectContains(read("scripts/migrate-deploy-safe.mjs"), /verify-retroactive-init\.mjs.*--expect-failed-init.*--require-schema/s);
    });
    it("no-history is a hard error (no baselining)", () => {
      expectContains(read("scripts/migrate-deploy-safe.mjs"), /Automatic baselining is disabled/);
    });
  });
});
