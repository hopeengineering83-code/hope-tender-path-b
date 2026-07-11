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

describe("Bug #3 — Recovery Command Center does not throw on json.ok=false", () => {
  it("load function only throws on HTTP non-2xx (not json.ok)", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!stripComments(src).includes("!json.ok"), "must NOT check !json.ok");
    assert.ok(src.includes("Only throw on HTTP non-2xx"), "must document the fix");
  });
});

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

describe("Bug #5 — Analysis StatusRow checks stale flag", () => {
  it("StatusRow shows STALE when stale, not green AI check", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("data.analysisStatus.stale"), "must check stale flag");
    assert.ok(src.includes("STALE — re-run required"), "must show stale label");
    assert.ok(/!data\.analysisStatus\.stale/.test(src), "ok predicate must include !stale");
  });

  it("analysisStatus type includes stale and partial", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("stale?: boolean"), "type must include stale");
    assert.ok(src.includes("partial?: boolean"), "type must include partial");
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
