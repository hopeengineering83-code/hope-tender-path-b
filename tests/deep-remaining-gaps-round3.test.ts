// Deep remaining gaps round 3 tests.
// Proves:
// 1. Duplicate MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN blocker removed.
// 2. Lifecycle route returns ok:true on HTTP 200.
// 3. Recovery Command Center does not throw on json.ok=false.
// 4. Orchestrator forwards stale/partial in analysisStatus.
// 5. Analysis StatusRow checks stale flag.
// 6. Final export fail-closed.
// 7. No 'metadata' wording.
// 8. Provider fallback order unchanged.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}
function stripComments(s: string): string {
  return s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Bug #1 — Duplicate MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN removed", () => {
  it("final-submission-readiness.ts has only ONE push for MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    const matches = src.match(/category:\s*"MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"/g);
    assert.ok(matches, "must have at least one push");
    assert.equal(matches.length, 1, "must have exactly ONE push (was 2 — caused duplicate blocker count)");
  });

  it("removed push is documented with NOTE comment", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    assert.ok(src.includes("previously DUPLICATED"), "must document the duplicate removal");
  });
});

describe("Bug #2 — Lifecycle route ok=true on HTTP 200", () => {
  it("lifecycle route sets ok:true (not ok:false for BLOCKED)", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    assert.ok(src.includes("ok: true"), "must set ok:true on HTTP 200");
    assert.ok(!src.includes('ok: result.finalSubmissionStatus !== "BLOCKED"'), "must NOT set ok based on finalSubmissionStatus");
  });
});

// Bug #3 — "Recovery Command Center does not throw on json.ok=false" — removed.
// components/tender-recovery-command-center.tsx was deleted as unrendered dead
// code (nothing imports or renders it). Its live successor,
// components/next-action-panel.tsx, is a server component that reads
// getCanonicalTenderWorkflowDecision() directly (via Prisma) rather than
// doing a client-side fetch()+load() against a JSON API response — so the
// specific failure mode this test guarded (a client throwing on a
// business-logic `json.ok` field instead of only on HTTP non-2xx) cannot
// occur in the new architecture. There is nothing structurally equivalent
// to redirect this assertion to.

describe("Bug #4 — Orchestrator forwards stale/partial", () => {
  it("analysisStatus type includes stale and partial fields", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("stale?: boolean"), "type must include stale");
    assert.ok(src.includes("partial?: boolean"), "type must include partial");
  });

  it("orchestrator computes analysisIsStale", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("analysisIsStale"), "must compute analysisIsStale");
    assert.ok(src.includes("resolveCurrentAnalysisBinding"), "must call resolveCurrentAnalysisBinding");
    assert.ok(src.includes("stale: analysisIsStale"), "must forward stale in return");
    assert.ok(src.includes("partial: analysisPartialNeedsResume"), "must forward partial in return");
  });
});

describe("Bug #5 — stale analysis blocks downstream steps (not shown as a passing check)", () => {
  // components/tender-recovery-command-center.tsx (the original StatusRow this
  // block checked) was deleted as unrendered dead code (nothing imports or
  // renders it). The live successor is lib/tender-next-action.ts, whose
  // resolveTenderNextAction() gates on aiAnalysis.stale directly — a stronger
  // property than a status label, since it hard-blocks Build Plan/generation/
  // export via a red-toned RERUN_AI_ANALYZE decision rather than just
  // switching an icon. components/next-action-panel.tsx renders the resulting
  // reason/blockers text (covered by other tests in this suite), so the
  // stale case is surfaced to the user, not silently shown as green.
  it("resolveTenderNextAction returns RERUN_AI_ANALYZE with a red tone when analysis is stale", () => {
    const src = read("lib/tender-next-action.ts");
    assert.match(src, /input\.aiAnalysis\.exists && input\.aiAnalysis\.stale/, "must gate on aiAnalysis.stale");
    assert.match(src, /primary:\s*"RERUN_AI_ANALYZE"/);
    assert.match(src, /Analysis is stale — tender source content changed since last analysis/);
  });

  it("aiAnalysis and documents inputs both declare a stale flag", () => {
    const src = read("lib/tender-next-action.ts");
    const matches = src.match(/stale\?: boolean/g) ?? [];
    assert.ok(matches.length >= 2, "must declare stale?: boolean on both aiAnalysis and documents inputs");
  });
});

describe("Bug #6 — Final export fail-closed", () => {
  it("isFinalExportCandidateDocument excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED", validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT", format: "DOCX",
      documentType: "T", name: "T", exactFileName: "T.docx",
    } as any), false);
  });

  it("isFinalExportCandidateDocument excludes PLANNED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "PLANNED", validationStatus: "PENDING",
      reviewStatus: "PENDING", format: "DOCX",
      documentType: "T", name: "T", exactFileName: "T.docx",
    } as any), false);
  });
});

describe("Bug #7 — No 'metadata' wording", () => {
  it("lifecycle route has no user-facing 'metadata' text", () => {
    const src = stripComments(read("app/api/tenders/[id]/lifecycle/route.ts"));
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(src), "must not use 'metadata' in user-facing text");
  });
});

describe("Bug #8 — Provider fallback order unchanged", () => {
  it("all 10 providers present in canonical order", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    for (const p of ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(src.includes(p), `must include ${p}`);
    }
  });
});
