// Release integration panel truth merge tests.
// Proves the merged #1040+#1044 integration fixes all screenshot contradictions.

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

describe("Integration — Lifecycle ok=true on HTTP 200", () => {
  it("lifecycle route sets ok:true", () => {
    const src = read("app/api/tenders/[id]/lifecycle/route.ts");
    assert.ok(src.includes("ok: true"), "must set ok:true");
    assert.ok(!src.includes('ok: result.finalSubmissionStatus !== "BLOCKED"'), "must NOT set ok from finalSubmissionStatus");
  });
});

describe("Integration — Recovery Command Center does not throw on blocked", () => {
  it("load function only throws on HTTP non-2xx", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!stripComments(src).includes("!json.ok"), "must NOT check !json.ok");
  });
});

describe("Integration — Orchestrator stale analysis detection", () => {
  it("analysisStatus type includes stale and partial", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("stale?: boolean"), "type includes stale");
    assert.ok(src.includes("partial?: boolean"), "type includes partial");
  });

  it("computes analysisIsStale via hash comparison", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("analysisIsStale"), "computes analysisIsStale");
    assert.ok(src.includes("resolveCurrentAnalysisBinding"), "calls resolveCurrentAnalysisBinding");
    assert.ok(src.includes("stale: analysisIsStale"), "forwards stale");
    assert.ok(src.includes("partial: analysisPartialNeedsResume"), "forwards partial");
  });
});

describe("Integration — Recovery Command Center StatusRow stale", () => {
  it("shows STALE when stale, not green AI check", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("data.analysisStatus.stale"), "checks stale flag");
    assert.ok(src.includes("STALE — re-run required"), "shows stale label");
  });
});

describe("Integration — Generation Readiness blocked on stale/compliance/PDF", () => {
  it("checks stale analysis and compliance blockers", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(src.includes("hasStaleAnalysis"), "checks stale analysis");
    assert.ok(src.includes("hasNoComplianceRows"), "checks compliance rows");
    assert.ok(src.includes("hasPdfRequiredUnavailable"), "checks PDF required");
  });
});

// components/bid-control-verdict-panel.tsx and components/tender-health-score-panel.tsx
// were retired in favor of the canonical Tender Release State
// (lib/engine/tender-release-state.ts + components/tender-release-state-panel.tsx),
// which replaced their independent readiness/verdict/score computations with
// one reconciled, gated payload. The protective property these tests locked
// — a stale or ungrounded analysis must never present as a confident ready
// score/verdict — is now enforced at the engine layer via readinessCalculable,
// which is gated on snapshot.analysis.eligibleForExport (true ONLY when
// AI_SUCCEEDED AND the content hash still matches, i.e. NOT stale).
describe("Integration — canonical Tender Release State gates on grounded, non-stale analysis", () => {
  it("readinessScore/verdict are gated behind extraction + analysis grounding, not independently recomputed", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.ok(src.includes("readinessCalculable"), "computes a single grounding gate");
    assert.ok(src.includes("extractionGrounded = snapshot.extraction.overallOk"), "extraction grounding reads the authoritative snapshot");
    assert.ok(src.includes("analysisGrounded = snapshot.analysis.eligibleForExport"), "analysis grounding reads eligibleForExport (false when stale)");
    assert.ok(src.includes("if (readinessCalculable)"), "score/verdict only computed when the grounding gate passes");
  });

  it("blockers are reconciled from the canonical final-submission readiness, not recomputed locally", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.ok(src.includes("getFinalSubmissionReadiness"), "reads the canonical blocker source");
    assert.ok(src.includes("reconcileBlockers"), "dedupes overlapping blockers from upstream engines");
  });
});

describe("Integration — Dashboard wires TenderReleaseStatePanel", () => {
  it("dashboard mounts the canonical release-state panel with canMutate", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(src.includes("<TenderReleaseStatePanel"), "mounts TenderReleaseStatePanel");
    assert.ok(/<TenderReleaseStatePanel[^>]*canMutate=\{canMutate\}/.test(src), "passes canMutate");
  });

  it("release-state route resolves the canonical workflow decision server-side, not the page", () => {
    const releaseState = read("lib/engine/tender-release-state.ts");
    assert.ok(releaseState.includes("getCanonicalTenderWorkflowDecision"), "engine calls the canonical workflow decision");
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(!page.includes("getCanonicalTenderWorkflowDecision"), "page no longer re-fetches it directly");
  });

  it("suppresses the panel's own next-action banner since NextActionPanel already renders the one canonical next action on this page", () => {
    // Confirmed via a real Playwright screenshot: with the panel's default
    // showNextAction=true and the "Detailed readiness and submission
    // controls" disclosure open by default (owner request 2026-07-20), the
    // page rendered "Next required action" twice — once from NextActionPanel
    // at the top, once from TenderReleaseStatePanel further down. Passing
    // showNextAction={false} here keeps exactly one visible.
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /<NextActionPanel /);
    assert.match(page, /<TenderReleaseStatePanel[^>]*showNextAction=\{false\}/);
  });

  it("TenderReleaseStatePanel only renders its next-action block when showNextAction is not explicitly disabled", () => {
    const panel = read("components/tender-release-state-panel.tsx");
    assert.match(panel, /showNextAction\s*=\s*true/);
    assert.match(panel, /\{showNextAction && data\.primaryNextAction && \(/);
  });
});

describe("Integration — Duplicate blocker removed", () => {
  it("only one MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN push", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    const matches = src.match(/category:\s*"MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"/g);
    assert.ok(matches);
    assert.equal(matches.length, 1, "exactly ONE push (was 2)");
  });
});

describe("Integration — Final export fail-closed", () => {
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

describe("Integration — No 'metadata' wording", () => {
  it("lifecycle route has no user-facing 'metadata'", () => {
    const src = stripComments(read("app/api/tenders/[id]/lifecycle/route.ts"));
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(src));
  });
});

describe("Integration — Provider fallback order", () => {
  it("all 10 providers present", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    for (const p of ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(src.includes(p));
    }
  });
});
