// ─── Regression: AI Analyze and Run Engine must NEVER start automatically ────
//
// Owner contract:
//   1. Upload and extraction start automatically.
//   2. AI Analyze runs only after an authorized manual click.
//   3. Run Engine runs only after an authorized manual click.
//   4. After successful Run Engine, generation/finalization continue automatically.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function readCode(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function listFiles(dir: string, exts: string[] = [".ts", ".tsx", ".mjs"]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((extension) => entry.endsWith(extension))) out.push(full);
  }
  return out;
}

describe("REGRESSION: AI Analyze and Run Engine cannot start automatically", () => {
  it("extraction service does not queue AI Analyze", () => {
    const extraction = codeOnly(readCode("lib/ai-jobs/tender-extraction-service.ts"));
    assert.doesNotMatch(extraction, /queueAutomaticTenderPipeline/);
    assert.match(extraction, /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/);
  });

  it("browser auto-pipeline never nudges AI Analyze", () => {
    const pipeline = codeOnly(readCode("lib/ui/auto-pipeline.ts"));
    assert.doesNotMatch(pipeline, /export const AI_ANALYZE_WORKER_ENDPOINT/);
    assert.doesNotMatch(pipeline, /nudgeTenderWorker\(AI_ANALYZE_WORKER_ENDPOINT\)/);
    assert.match(pipeline, /export const EXTRACT_TEXT_WORKER_ENDPOINT/);
  });

  it("upload handlers do not queue AI Analyze or Engine", () => {
    for (const path of ["lib/tender-upload-first.ts", "lib/secure-upload-handler.ts"]) {
      const source = codeOnly(readCode(path));
      assert.doesNotMatch(source, /jobType:\s*["']AI_ANALYZE["']/);
      assert.doesNotMatch(source, /jobType:\s*["']ENGINE_RUN["']/);
      assert.doesNotMatch(source, /queueAutomaticTenderPipeline/);
    }
  });

  it("no library file calls the manual AI Analyze route", () => {
    for (const file of listFiles("lib").filter((path) => !path.includes(".test."))) {
      const source = codeOnly(readCode(file));
      if (/manual-ai-analyze/.test(source)) {
        assert.doesNotMatch(source, /fetch\s*\([^)]*manual-ai-analyze/);
      }
    }
  });

  it("no library file calls the manual Engine route", () => {
    for (const file of listFiles("lib").filter((path) => !path.includes(".test."))) {
      const source = codeOnly(readCode(file));
      if (/\/api\/tenders\/.*\/engine/.test(source)) {
        assert.doesNotMatch(source, /fetch\s*\([^)]*\/api\/tenders\/.*\/engine/);
      }
    }
  });

  it("the queue drainer only processes jobs that were already explicitly queued", () => {
    assert.match(codeOnly(readCode(".github/workflows/drain-ai-job-queue.yml")), /run-next/);
  });

  it("manual AI Analyze explicitly disables Engine continuation", () => {
    const route = readCode("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    assert.match(route, /autoContinue:\s*false/);
    assert.match(route, /manualRequested:\s*true/);
  });

  it("AI Analyze handler terminates at a durable manual Run Engine boundary", () => {
    const handler = readCode("lib/ai-job-handlers.ts");
    assert.match(handler, /stepName:\s*"manual-engine-required"/);
    assert.match(handler, /nextAction:\s*"RUN_ENGINE"/);
    assert.match(handler, /automaticEngineStarted:\s*false/);
    assert.doesNotMatch(handler, /engine\.auto-enqueue/);
    assert.doesNotMatch(handler, /enqueueEngineJobForCurrentSources/);
  });

  it("compatibility continuation service cannot create Engine automatically", () => {
    const continuation = readCode("lib/ai-jobs/engine-continuation-service.ts");
    assert.match(continuation, /MANUAL_ENGINE_REQUIRED/);
    assert.match(continuation, /Never act on it/);
    // The entire file must not contain upsertEngine or rearmFailedEngine.
    assert.doesNotMatch(continuation, /upsertEngine\(/);
    assert.doesNotMatch(continuation, /rearmFailedEngine\(/);
    // continueSuccessfulAnalysis must not enqueue anything.
    const fnStart = continuation.indexOf("export async function continueSuccessfulAnalysis");
    assert.ok(fnStart >= 0, "continueSuccessfulAnalysis must exist");
    const fnBody = continuation.slice(fnStart);
    assert.doesNotMatch(fnBody, /upsertEngine\(/);
    assert.doesNotMatch(fnBody, /rearmFailedEngine\(/);
    assert.doesNotMatch(fnBody, /queued: true/);
  });

  it("after explicit Run Engine succeeds, proposal generation and finalization continue automatically", () => {
    const worker = readCode("app/api/ai-jobs/run-next/route.ts");
    assert.match(worker, /claimed\.jobType === "ENGINE_RUN"/);
    assert.match(worker, /nextJobType = "PROPOSAL_GENERATION"/);
    assert.match(worker, /claimed\.jobType === "PROPOSAL_GENERATION"/);
    assert.match(worker, /nextJobType = "AUTO_FINALIZE"/);
  });

  it("action registry exposes both actions as normal manual mutations", () => {
    const { getTenderAction } = require("../lib/ui/action-registry");
    assert.equal(getTenderAction("AI_ANALYZE").availability, "NORMAL");
    assert.equal(getTenderAction("AI_ANALYZE").mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.equal(getTenderAction("RUN_ENGINE").availability, "NORMAL");
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine");
  });
});
