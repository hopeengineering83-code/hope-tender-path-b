import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("PR #1175 preserves the required two-manual-action workflow", () => {
  const analyze = source("app/api/tenders/[id]/manual-ai-analyze/route.ts");
  const analyzeService = source("lib/ai-jobs/analysis-job-service.ts");
  const engine = source("app/api/tenders/[id]/engine/route.ts");
  const handlers = source("lib/ai-job-handlers.ts");

  // FIX 1: After the atomic-manual-authority refactor, autoContinue=false is
  // persisted atomically by createAnalysisJob() in the service. The route
  // forwards a manualAuthority parameter instead of patching the job later.
  assert.match(analyze, /manualAuthority:/);
  assert.match(analyze, /source: "manual-ai-analyze"/);
  assert.match(analyze, /actorUserId: actor\.id/);
  assert.match(analyzeService, /autoContinue:\s*false/);
  assert.match(analyzeService, /manualRequested: true/);
  // The race-window updateMany patch must NOT exist in the route.
  assert.doesNotMatch(analyze, /prisma\.aiJob\.updateMany/);

  // FIX 6: Engine fails closed with CURRENT_ANALYSIS_REQUIRED — never
  // re-analyzes the tender.
  assert.match(engine, /CURRENT_ANALYSIS_REQUIRED/);

  assert.match(handlers, /manual-engine-required/);
  assert.match(handlers, /nextJobType = "PROPOSAL_GENERATION"|automatic Build Plan|build-plan\.automatic/);
  assert.doesNotMatch(handlers, /engine\.auto-enqueue/);
});

test("PR #1175 excludes duplicate source representations from canonical readiness", () => {
  const canonical = source("lib/tender/canonical-source-files.ts");
  const analyzePanel = source("components/ai-analyze-panel.tsx");
  assert.match(canonical, /selectCanonicalTenderFiles/);
  assert.match(canonical, /duplicateFileCount/);
  assert.match(analyzePanel, /source-readiness/);
});

test("PR #1175 keeps Preview builds isolated from Production migrations", () => {
  const build = source("scripts/vercel-build.mjs");
  assert.match(build, /vercelEnvironment !== "production"/);
  assert.match(build, /Skipping database migrations/);
  assert.match(build, /production-recovery-regression\.test\.ts/);
});
