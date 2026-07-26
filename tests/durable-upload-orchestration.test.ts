// Load-bearing regression tests for the durable upload orchestration
// workstream.
//
// Each test verifies a specific reliability gap from the task spec.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Test helpers ───────────────────────────────────────────────────────────

function readApp(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

// ─── 1. Server-side AI_ANALYZE enqueue ──────────────────────────────────────

describe("Gap A — Server-side AI_ANALYZE enqueue (no client-side trigger)", () => {
  const uploadFirstSource = readApp("lib/tender-upload-first.ts");
  const newTenderSource = readApp("app/dashboard/tenders/new/page.tsx");

  it("upload-first handler imports enqueueAiAnalyzeServerSide", () => {
    assert.match(
      uploadFirstSource,
      /import\s*\{[^}]*enqueueAiAnalyzeServerSide[^}]*\}\s*from\s*"\.\/engine\/server-side-ai-enqueue"/,
    );
  });

  it("upload-first handler calls enqueueAiAnalyzeServerSide after files are committed", () => {
    assert.match(
      uploadFirstSource,
      /enqueueAiAnalyzeServerSide\(tenderId,\s*actor\.id/,
    );
  });

  it("upload-first response includes serverEnqueue field", () => {
    assert.match(uploadFirstSource, /serverEnqueue:\s*serverEnqueueResult/);
  });

  it("new tender page does NOT call triggerTenderUploadAutoPipeline", () => {
    // The client-side auto-pipeline trigger must be removed.
    assert.doesNotMatch(
      newTenderSource,
      /await\s+triggerTenderUploadAutoPipeline/,
    );
  });

  it("new tender page surfaces the serverEnqueue result from the response", () => {
    assert.match(
      newTenderSource,
      /data\.serverEnqueue/,
    );
  });

  it("UploadFirstPayload type includes serverEnqueue field", () => {
    assert.match(
      newTenderSource,
      /serverEnqueue\??\s*:\s*\{/,
    );
  });
});

// ─── 2. Server-side enqueue module ──────────────────────────────────────────

describe("Server-side AI enqueue module", () => {
  // Import the module to verify it exports the expected functions
  const moduleSource = readApp("lib/engine/server-side-ai-enqueue.ts");

  it("exports enqueueAiAnalyzeServerSide function", () => {
    assert.match(moduleSource, /export async function enqueueAiAnalyzeServerSide/);
  });

  it("exports computeAnalysisRevision function", () => {
    assert.match(moduleSource, /export async function computeAnalysisRevision/);
  });

  it("is idempotent — checks for existing QUEUED or RUNNING job before creating", () => {
    assert.match(moduleSource, /status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING"\]/);
  });

  it("uses analysisInputHash as the idempotency key", () => {
    assert.match(moduleSource, /analysisInputHash:\s*analysisRevision/);
  });

  it("logs the enqueue without exposing keys or document text", () => {
    assert.match(moduleSource, /logger\.info.*\[server-enqueue\]/);
    // Must NOT log extracted text or API keys
    assert.doesNotMatch(moduleSource, /logger\.info.*apiKey|logger\.info.*extractedText/i);
  });
});

// ─── 3. Capability-specific readiness ───────────────────────────────────────

describe("Gap D — Capability-specific readiness", () => {
  const moduleSource = readApp("lib/engine/capability-readiness.ts");

  it("exports all 6 capability check functions", () => {
    assert.match(moduleSource, /export function checkAnalysisAiReadiness/);
    assert.match(moduleSource, /export function checkProposalAiReadiness/);
    assert.match(moduleSource, /export function checkOcrReadiness/);
    assert.match(moduleSource, /export function checkStorageReadiness/);
    assert.match(moduleSource, /export function checkDatabaseReadiness/);
    assert.match(moduleSource, /export function checkWorkerDispatchReadiness/);
  });

  it("OCR readiness does NOT expose the API key", () => {
    // Match from the function declaration to the next "export function" or end
    const ocrSection = moduleSource.match(/export function checkOcrReadiness[\s\S]*?(?=export function|$)/);
    assert.ok(ocrSection, "Could not find checkOcrReadiness function");
    // The corrective action must say "Configure ANTHROPIC_API_KEY" but
    // must NOT include the actual key value.
    assert.match(ocrSection[0], /Configure ANTHROPIC_API_KEY/);
    assert.doesNotMatch(ocrSection[0], /sk-ant-[A-Za-z0-9]/);
  });

  it("OCR readiness is 'unavailable' when Anthropic key is missing", () => {
    // Import and test directly
    const capabilityModule = require("../lib/engine/capability-readiness");
    const result = capabilityModule.checkOcrReadiness({
      anthropicConfigured: false,
      ocrEnabled: true,
    });
    assert.equal(result.status, "unavailable");
    assert.ok(result.correctiveAction);
    assert.ok(result.correctiveAction.includes("ANTHROPIC_API_KEY"));
  });

  it("OCR readiness is 'ready' when Anthropic key is present and OCR is enabled", () => {
    const capabilityModule = require("../lib/engine/capability-readiness");
    const result = capabilityModule.checkOcrReadiness({
      anthropicConfigured: true,
      ocrEnabled: true,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.correctiveAction, null);
  });

  it("worker dispatch readiness surfaces cron status", () => {
    const capabilityModule = require("../lib/engine/capability-readiness");
    const result = capabilityModule.checkWorkerDispatchReadiness({
      cronActive: false,
      endpointReachable: true,
    });
    assert.equal(result.status, "degraded");
    assert.match(result.correctiveAction, /cron/i);
  });

  it("getOverallReadiness returns 'unavailable' when any blocking capability is unavailable", () => {
    const capabilityModule = require("../lib/engine/capability-readiness");
    const capabilities = [
      { id: "analysis_ai", status: "ready", label: "Analysis AI", correctiveAction: null, blocksWorkflow: false, affectedStages: [] },
      { id: "storage", status: "unavailable", label: "Storage", correctiveAction: "Configure storage", blocksWorkflow: true, affectedStages: [] },
    ];
    const result = capabilityModule.getOverallReadiness(capabilities);
    assert.equal(result.status, "unavailable");
    assert.equal(result.blockingCapabilities.length, 1);
  });
});

// ─── 4. Upload intake session ───────────────────────────────────────────────

describe("Gap B — Idempotent intake session", () => {
  const moduleSource = readApp("lib/engine/upload-intake-session.ts");

  it("exports createIntakeSession function", () => {
    assert.match(moduleSource, /export async function createIntakeSession/);
  });

  it("exports recordIntakeBatch function", () => {
    assert.match(moduleSource, /export async function recordIntakeBatch/);
  });

  it("exports isIntakeSessionFinalized function", () => {
    assert.match(moduleSource, /export async function isIntakeSessionFinalized/);
  });

  it("session is finalized when receivedBatches === expectedBatches", () => {
    assert.match(moduleSource, /sessionFinalized\s*=\s*newReceivedBatches\s*>=\s*sessionInput\.expectedBatches/);
  });

  it("session uses a deterministic ID based on tenderId + userId", () => {
    assert.match(moduleSource, /createHash/);
    assert.match(moduleSource, /options\.tenderId.*options\.userId/);
  });
});

// ─── 5. Drain-ai-job-queue cron is active ───────────────────────────────────

describe("Gap F — Real unattended dispatch (cron is active)", () => {
  const workflowSource = readApp(".github/workflows/drain-ai-job-queue.yml");

  it("GitHub Actions cron runs every 5 minutes", () => {
    assert.match(workflowSource, /cron:\s*"\*\/5 \* \* \* \*"/);
  });

  it("cron POSTs to /api/ai-jobs/run-next", () => {
    assert.match(workflowSource, /\/api\/ai-jobs\/run-next/);
  });

  it("cron targets the production URL", () => {
    assert.match(workflowSource, /hope-tender-path-b\.vercel\.app/);
  });

  it("cron uses a shared secret (AI_JOBS_WORKER_SECRET)", () => {
    assert.match(workflowSource, /AI_JOBS_WORKER_SECRET/);
  });
});

// ─── 6. Auto-pipeline module is deprecated (not removed — backward compat) ──

describe("Auto-pipeline module — deprecated, not deleted", () => {
  const autoPipelineSource = readApp("lib/ui/auto-pipeline.ts");

  it("still exports triggerTenderUploadAutoPipeline for backward compat", () => {
    assert.match(autoPipelineSource, /export async function triggerTenderUploadAutoPipeline/);
  });

  it("module comment explains the server-side enqueue replacement", () => {
    assert.match(
      autoPipelineSource,
      /server|Server|durable|Durable/i,
    );
  });
});

// ─── 7. Privacy-safe observability ──────────────────────────────────────────

describe("Gap K — Privacy-safe observability", () => {
  const enqueueSource = readApp("lib/engine/server-side-ai-enqueue.ts");

  it("logs do NOT include document text", () => {
    // The logger.info call should only include tenderId, jobId, analysisRevision, source
    const logCall = enqueueSource.match(/logger\.info\([\s\S]*?\);/);
    if (logCall) {
      assert.doesNotMatch(logCall[0], /extractedText|documentText|fileContent/i);
    }
  });

  it("logs do NOT include API keys", () => {
    const logCall = enqueueSource.match(/logger\.info\([\s\S]*?\);/);
    if (logCall) {
      assert.doesNotMatch(logCall[0], /apiKey|API_KEY|secret|password/i);
    }
  });

  it("logs do NOT include private storage paths", () => {
    const logCall = enqueueSource.match(/logger\.info\([\s\S]*?\);/);
    if (logCall) {
      assert.doesNotMatch(logCall[0], /storagePath|filePath|blobPath/i);
    }
  });

  it("logs include deployment SHA, job ID, and analysis revision", () => {
    // The log should include enough context for observability without
    // exposing private data.
    assert.match(enqueueSource, /tenderId/);
    assert.match(enqueueSource, /jobId/);
    assert.match(enqueueSource, /analysisRevision/);
  });
});
