// Release integration panel truth tests.

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
    assert.ok(src.includes("ok: true"));
    assert.ok(!src.includes('ok: result.finalSubmissionStatus !== "BLOCKED"'));
  });
});

// "Recovery Command Center does not throw on blocked" test removed --
// components/tender-recovery-command-center.tsx was deleted as unrendered
// dead code (nothing imports or renders it).

describe("Integration — Orchestrator stale analysis detection", () => {
  it("analysisStatus type includes stale and partial", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("stale?: boolean"));
    assert.ok(src.includes("partial?: boolean"));
  });

  it("computes analysisIsStale via hash comparison", () => {
    const src = read("lib/engine/tender-lifecycle-orchestrator.ts");
    assert.ok(src.includes("analysisIsStale"));
    assert.ok(src.includes("resolveCurrentAnalysisBinding"));
    assert.ok(src.includes("stale: analysisIsStale"));
    assert.ok(src.includes("partial: analysisPartialNeedsResume"));
  });
});

// "Recovery Command Center StatusRow stale" test removed --
// components/tender-recovery-command-center.tsx was deleted as unrendered
// dead code (nothing imports or renders it).

describe("Integration — Generation Readiness blocked on stale/compliance/PDF", () => {
  it("checks stale analysis and compliance blockers", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(src.includes("hasStaleAnalysis"));
    assert.ok(src.includes("hasNoComplianceRows"));
    assert.ok(src.includes("hasPdfRequiredUnavailable"));
  });
});

describe("Integration — canonical Tender Release State gates on grounded, non-stale analysis", () => {
  it("gates readinessScore/verdict behind extraction and analysis grounding", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.ok(src.includes("readinessCalculable"));
    assert.ok(src.includes("extractionGrounded = snapshot.extraction.overallOk"));
    assert.ok(src.includes("analysisGrounded = snapshot.analysis.eligibleForExport"));
    assert.ok(src.includes("if (readinessCalculable)"));
  });

  it("reconciles blockers from canonical final-submission readiness", () => {
    const src = read("lib/engine/tender-release-state.ts");
    assert.ok(src.includes("getFinalSubmissionReadiness"));
    assert.ok(src.includes("reconcileBlockers"));
  });
});

describe("Integration — tender workspace exposes one release-state owner", () => {
  it("mounts one NextActionPanel and no competing release-state panel", () => {
    const page = stripComments(read("app/dashboard/tenders/[id]/page.tsx"));
    assert.equal((page.match(/<NextActionPanel\b/g) ?? []).length, 1);
    assert.doesNotMatch(page, /<TenderReleaseStatePanel\b/);
    assert.doesNotMatch(page, /<TenderRecoveryCommandCenter\b/);
    assert.doesNotMatch(page, /<FinalSubmissionControlCenter\b/);
  });

  it("keeps the canonical release-state engine and separate read-only Command Center", () => {
    const releaseState = read("lib/engine/tender-release-state.ts");
    assert.ok(releaseState.includes("getCanonicalTenderWorkflowDecision"));
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(!page.includes("getCanonicalTenderWorkflowDecision"));
    assert.match(page, /Open read-only Command Center/);
  });

  // "retired release-state panel still gates BidDecisionForm" test removed --
  // components/tender-release-state-panel.tsx was deleted as unrendered dead
  // code, and components/bid-decision-form.tsx (its exclusive consumer) is
  // deleted alongside it as a cascading orphan.
});

describe("Integration — Duplicate blocker removed", () => {
  it("only one MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN push", () => {
    const src = read("lib/engine/final-submission-readiness.ts");
    const matches = src.match(/category:\s*"MANDATORY_REQUIREMENTS_NO_SUBMISSION_PLAN"/g);
    assert.ok(matches);
    assert.equal(matches.length, 1);
  });
});

describe("Integration — Final export fail-closed", () => {
  it("excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED", validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT", format: "DOCX",
      documentType: "T", name: "T", exactFileName: "T.docx",
    } as any), false);
  });

  it("excludes PLANNED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "PLANNED", validationStatus: "PENDING",
      reviewStatus: "PENDING", format: "DOCX",
      documentType: "T", name: "T", exactFileName: "T.docx",
    } as any), false);
  });
});

describe("Integration — No user-facing metadata wording", () => {
  it("lifecycle route has no user-facing metadata", () => {
    const src = stripComments(read("app/api/tenders/[id]/lifecycle/route.ts"));
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(src));
  });
});

describe("Integration — Provider fallback order", () => {
  it("all 10 providers are present", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    for (const provider of ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(src.includes(provider));
    }
  });
});
