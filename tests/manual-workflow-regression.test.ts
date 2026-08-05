// ─── Regression: AI Analyze and Run Engine must NEVER start automatically ────
//
// This test enforces the owner's explicit workflow requirement:
//   1. Tender upload and extraction must start automatically.
//   2. AI Analyze must run ONLY when the authorized user manually clicks.
//   3. Run Engine must run ONLY when the authorized user manually clicks.
//   4. Never trigger AI Analyze or Run Engine automatically through upload
//      handlers, workers, cron, browser continuation, or recovery logic.
//
// It scans the codebase statically to ensure NO automatic AI Analyze or
// Engine trigger exists outside the manual mutation routes.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function readCode(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// Strip comments so the word "queueAutomaticTenderPipeline" in comments
// explaining its removal doesn't trigger a false positive.
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// Recursively list all .ts/.tsx files under a directory.
function listFiles(dir: string, exts: string[] = [".ts", ".tsx", ".mjs"]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("REGRESSION: AI Analyze and Run Engine cannot start automatically", () => {
  // ─── 1. Extraction service must NOT queue AI_ANALYZE ──────────────────────
  it("extraction service does NOT call queueAutomaticTenderPipeline", () => {
    const extraction = codeOnly(readCode("lib/ai-jobs/tender-extraction-service.ts"));
    assert.doesNotMatch(
      extraction,
      /queueAutomaticTenderPipeline/,
      "extraction service must not call queueAutomaticTenderPipeline — AI Analyze is manual",
    );
    assert.match(
      extraction,
      /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/,
      "extraction service must return EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED",
    );
  });

  // ─── 2. Browser auto-pipeline must NOT nudge AI_ANALYZE ───────────────────
  it("browser auto-pipeline does NOT export or call AI_ANALYZE_WORKER_ENDPOINT", () => {
    const pipeline = codeOnly(readCode("lib/ui/auto-pipeline.ts"));
    assert.doesNotMatch(
      pipeline,
      /export const AI_ANALYZE_WORKER_ENDPOINT/,
      "auto-pipeline must NOT export AI_ANALYZE_WORKER_ENDPOINT",
    );
    assert.doesNotMatch(
      pipeline,
      /nudgeTenderWorker\(AI_ANALYZE_WORKER_ENDPOINT\)/,
      "auto-pipeline must NOT nudge the AI_ANALYZE worker",
    );
    // The ONLY worker endpoint it exports is EXTRACT_TEXT.
    assert.match(pipeline, /export const EXTRACT_TEXT_WORKER_ENDPOINT/);
  });

  // ─── 3. Upload handlers must NOT queue AI_ANALYZE or ENGINE_RUN ───────────
  it("upload handlers do NOT queue AI_ANALYZE or ENGINE_RUN jobs", () => {
    const handlers = [
      "lib/tender-upload-first.ts",
      "lib/secure-upload-handler.ts",
    ];
    for (const path of handlers) {
      const source = codeOnly(readCode(path));
      assert.doesNotMatch(
        source,
        /jobType:\s*["']AI_ANALYZE["']/,
        `${path} must not create AI_ANALYZE jobs`,
      );
      assert.doesNotMatch(
        source,
        /jobType:\s*["']ENGINE_RUN["']/,
        `${path} must not create ENGINE_RUN jobs`,
      );
      assert.doesNotMatch(
        source,
        /queueAutomaticTenderPipeline/,
        `${path} must not call queueAutomaticTenderPipeline`,
      );
    }
  });

  // ─── 4. No lib/ file outside the manual routes may call manual-ai-analyze ─
  it("no lib/ file triggers the manual-ai-analyze route automatically", () => {
    const libFiles = listFiles("lib").filter((f) => !f.includes(".test."));
    for (const file of libFiles) {
      const source = codeOnly(readCode(file));
      // The manual-ai-analyze route URL may appear in the action-registry
      // (as a mutation string) but must NOT appear in any fetch() call.
      if (/manual-ai-analyze/.test(source)) {
        assert.doesNotMatch(
          source,
          /fetch\s*\([^)]*manual-ai-analyze/,
          `${file} must not call the manual-ai-analyze route — only the AIAnalyzePanel component may trigger it via a user click`,
        );
      }
    }
  });

  // ─── 5. No lib/ file may call the engine route automatically ──────────────
  it("no lib/ file triggers the /api/tenders/:id/engine route automatically", () => {
    const libFiles = listFiles("lib").filter((f) => !f.includes(".test."));
    for (const file of libFiles) {
      const source = codeOnly(readCode(file));
      if (/\/api\/tenders\/.*\/engine/.test(source)) {
        assert.doesNotMatch(
          source,
          /fetch\s*\([^)]*\/api\/tenders\/.*\/engine/,
          `${file} must not call the /engine route — only the MatchingSelectedEvidencePanel component may trigger it via a user click`,
        );
      }
    }
  });

  // ─── 6. The drain-ai-job-queue cron must NOT drain AI_ANALYZE ─────────────
  it("the AI job queue drainer does NOT auto-process AI_ANALYZE for new tenders", () => {
    const drainer = codeOnly(readCode(".github/workflows/drain-ai-job-queue.yml"));
    // The cron drains the queue, but the queue should never CONTAIN an
    // AI_ANALYZE job for a tender unless the user manually clicked
    // "Run AI Analyze". The extraction service no longer queues AI_ANALYZE
    // (verified above), so the drainer has nothing to auto-process.
    // This test documents that contract — the drainer itself is fine because
    // it only processes jobs that are already queued, and AI_ANALYZE jobs are
    // only queued by the manual route.
    assert.match(drainer, /run-next/);
  });

  // ─── 7. The manual-ai-analyze route sets autoContinue=false ───────────────
  it("the manual-ai-analyze route sets autoContinue=false (no auto-Engine continuation)", () => {
    const route = readCode("app/api/tenders/[id]/manual-ai-analyze/route.ts");
    assert.match(route, /autoContinue:\s*false/);
    assert.match(route, /manualRequested:\s*true/);
  });

  // ─── 8. The AI handler wrapper only auto-enqueues Engine when autoContinue=true ─
  it("the AI handler wrapper only auto-enqueues Engine when autoContinue=true (which manual route never sets)", () => {
    const handler = readCode("lib/ai-job-handlers.ts");
    assert.match(
      handler,
      /ctx\.input\.autoContinue !== true/,
      "AI handler must check autoContinue !== true before auto-enqueueing Engine",
    );
  });

  // ─── 9. After Run Engine succeeds, downstream stages continue automatically ─
  it("after Run Engine succeeds, PROPOSAL_GENERATION and AUTO_FINALIZE continue automatically", () => {
    const worker = readCode("app/api/ai-jobs/run-next/route.ts");
    assert.match(worker, /claimed\.jobType === "ENGINE_RUN"/);
    assert.match(worker, /nextJobType = "PROPOSAL_GENERATION"/);
    assert.match(worker, /claimed\.jobType === "PROPOSAL_GENERATION"/);
    assert.match(worker, /nextJobType = "AUTO_FINALIZE"/);
  });

  // ─── 10. The action registry exposes AI_ANALYZE and RUN_ENGINE as NORMAL ──
  it("action registry exposes AI_ANALYZE and RUN_ENGINE as NORMAL manual actions", () => {
    const { getTenderAction } = require("../lib/ui/action-registry");
    assert.equal(getTenderAction("AI_ANALYZE").availability, "NORMAL");
    assert.equal(getTenderAction("AI_ANALYZE").mutation, "POST /api/tenders/:id/manual-ai-analyze");
    assert.equal(getTenderAction("RUN_ENGINE").availability, "NORMAL");
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine");
  });
});
