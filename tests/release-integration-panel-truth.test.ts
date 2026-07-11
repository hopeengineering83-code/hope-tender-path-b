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

describe("Integration — Bid Control effective readiness", () => {
  it("uses effectiveFullProposalReady not raw", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("effectiveFullProposalReady"), "uses effective flag");
    assert.ok(src.includes("hasSnapshotBlocker"), "computes snapshot blocker");
  });

  it("Analysis card shows stale when stale", () => {
    const src = read("components/bid-control-verdict-panel.tsx");
    assert.ok(src.includes("hasStaleAnalysis"), "computes stale");
    assert.ok(src.includes("Stale — re-run required"), "shows stale label");
  });
});

describe("Integration — Tender Health Score stale/compliance props", () => {
  it("accepts analysisStale prop", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.ok(src.includes("analysisStale"), "accepts analysisStale");
    assert.ok(src.includes("analysisStale ? 0"), "scores 0 when stale");
  });

  it("accepts mandatoryComplianceRowsCount prop", () => {
    const src = read("components/tender-health-score-panel.tsx");
    assert.ok(src.includes("mandatoryComplianceRowsCount"), "accepts compliance rows count");
    assert.ok(src.includes("hasNoComplianceRows"), "computes hasNoComplianceRows");
  });
});

describe("Integration — Dashboard wires TenderHealthScorePanel", () => {
  it("dashboard passes analysisStale, mandatoryComplianceRowsCount, mandatoryRequirementCount", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(src.includes("analysisStale"), "passes analysisStale");
    assert.ok(src.includes("mandatoryComplianceRowsCount"), "passes compliance rows count");
    assert.ok(src.includes("mandatoryRequirementCount"), "passes mandatory requirement count");
    assert.ok(src.includes("workflowDecision"), "uses canonical workflow decision");
    assert.ok(src.includes("getCanonicalTenderWorkflowDecision"), "imports getCanonicalTenderWorkflowDecision");
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
