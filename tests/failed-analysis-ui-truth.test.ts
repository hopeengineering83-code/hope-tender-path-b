import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";

// ─── What this file proves ───────────────────────────────────────────────────
//
// The Analysis Quality panel told the owner:
//
//   "No structured requirements were extracted. Source-text-only generation
//    will proceed using the extracted tender scope, deliverables, and
//    submission instructions."
//
// on a tender whose AI Analyze had FAILED. Nothing was going to proceed. The
// generation gate (lib/engine/generation-readiness-gate.ts) refuses every
// analysis state except AI_SUCCEEDED, so the panel was promising a path the
// backend had already closed — and pointing the owner at a button that could
// only refuse them.
//
// The message was keyed on requirementCount === 0 and nothing else. It knew
// how many requirements there were and not whether the analysis they came from
// was real. These tests pin the message to the canonical analysis state.
//
// THE GATE IS NOT TOUCHED. Every assertion here is about what the UI SAYS.

const NO_REQUIREMENTS = {
  requirements: [],
  analysisSummary: "Extracted tender scope and deliverables.",
  submissionNotes: "Submit by email before the deadline.",
};

const PROCEED = /Source-text-only generation will proceed/i;

/** Every analysis state the generation gate refuses. */
const NON_RELEASE_READY = [
  "FAILED",
  "NOT_STARTED",
  "QUEUED",
  "RUNNING",
  "PARTIAL_NEEDS_RESUME",
  "REGEX_FALLBACK_UNAPPROVED",
  "HUMAN_APPROVED_FALLBACK",
  "SUPERSEDED",
  "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED",
] as const;

describe("zero-requirement messaging is bound to the analysis state", () => {
  for (const state of NON_RELEASE_READY) {
    it(`never promises generation will proceed when analysis is ${state}`, () => {
      const report = assessTenderAnalysisQuality({ ...NO_REQUIREMENTS, analysisState: state });
      const all = [...report.warnings, ...report.recommendations].join("\n");

      assert.doesNotMatch(all, PROCEED, `${state} was told generation would proceed`);
      // It must say what is actually wrong, and name the state so the owner
      // can act on it rather than guessing.
      assert.match(all, /not in a release-ready state/i);
      assert.match(all, new RegExp(state, "i"));
    });

    it(`labels any source-text output draft-only and non-authoritative when analysis is ${state}`, () => {
      const report = assessTenderAnalysisQuality({ ...NO_REQUIREMENTS, analysisState: state });
      const all = [...report.warnings, ...report.recommendations].join("\n");
      // A draft capability may genuinely exist; it must be named as draft, and
      // explicitly denied export authority.
      assert.match(all, /DRAFT ONLY/);
      assert.match(all, /not export authority/i);
    });
  }

  it("keeps the original message when AI Analyze really is release-ready", () => {
    const report = assessTenderAnalysisQuality({
      ...NO_REQUIREMENTS,
      analysisState: "AI_SUCCEEDED",
      analysisMatchesCurrentSource: true,
    });
    const all = [...report.warnings, ...report.recommendations].join("\n");
    assert.match(all, PROCEED);
    assert.doesNotMatch(all, /DRAFT ONLY/);
  });

  it("treats a stale AI_SUCCEEDED analysis as not release-ready", () => {
    // The state is the best possible one and the analysis is still wrong for
    // this source: the promoted result no longer matches the current tender
    // files. "Stale" is the case the state alone cannot see.
    const report = assessTenderAnalysisQuality({
      ...NO_REQUIREMENTS,
      analysisState: "AI_SUCCEEDED",
      analysisMatchesCurrentSource: false,
    });
    const all = [...report.warnings, ...report.recommendations].join("\n");
    assert.doesNotMatch(all, PROCEED);
    assert.match(all, /DRAFT ONLY/);
  });

  it("does not reassure when the state was never established", () => {
    // No analysisState supplied at all. Unknown is not a licence to promise
    // that generation will proceed.
    const report = assessTenderAnalysisQuality(NO_REQUIREMENTS);
    const all = [...report.warnings, ...report.recommendations].join("\n");
    assert.doesNotMatch(all, PROCEED);
  });
});

describe("a good score never reads as permission to generate", () => {
  const RICH = {
    requirements: Array.from({ length: 8 }, (_, i) => ({
      title: `Requirement ${i + 1}`,
      description: "Bidder shall provide evaluation evidence and scoring detail.",
      priority: "MANDATORY",
      sectionReference: "3.2",
      sourcePageNumber: 4,
      sourceExactQuote: "The bidder shall provide evaluation evidence.",
    })),
    analysisSummary: "Full scope extracted with evaluation criteria and weights.",
    evaluationMethodology: "Technical 70 / Financial 30, scored out of 100 points.",
    submissionNotes: "Submit two envelopes by email before the deadline; file naming applies.",
    exactFileNaming: JSON.stringify(["Technical.pdf", "Financial.pdf"]),
    exactFileOrder: JSON.stringify(["Technical.pdf", "Financial.pdf"]),
  };

  it("says the analysis is usable only when the analysis itself is release-ready", () => {
    const ready = assessTenderAnalysisQuality({
      ...RICH,
      analysisState: "AI_SUCCEEDED",
      analysisMatchesCurrentSource: true,
    });
    const failed = assessTenderAnalysisQuality({ ...RICH, analysisState: "FAILED" });

    const usable = /appears usable for matching, scoring, and generation/i;
    if (ready.severity === "GOOD" && ready.warnings.length === 0) {
      assert.match(ready.recommendations.join("\n"), usable);
    }
    // Whatever the score says about the DATA, a FAILED analysis is never
    // described as usable for generation.
    assert.doesNotMatch(failed.recommendations.join("\n"), usable);
  });
});

describe("the panel and its API feed the assessor the canonical state", () => {
  it("the panel passes the release snapshot's analysis state, not the notes marker", () => {
    const source = readFileSync("components/analysis-quality-panel.tsx", "utf8");
    assert.match(source, /analysisState: snapshot\?\.analysis\.state/);
    assert.match(source, /analysisMatchesCurrentSource: snapshot\?\.analysis\.contentHashMatch/);
  });

  it("the analysis-quality route resolves the canonical state", () => {
    const source = readFileSync("app/api/tenders/[id]/analysis-quality/route.ts", "utf8");
    assert.match(source, /resolveTenderAnalysisState\(prisma, id, userId\)/);
    assert.match(source, /analysisState: analysisStateDetail\?\.state/);
  });

  it("generation readiness resolves the canonical state", () => {
    const source = readFileSync("lib/tender-generation-readiness.ts", "utf8");
    assert.match(source, /resolveTenderAnalysisState\(client, tenderId, userId\)/);
    assert.match(source, /analysisState: analysisStateDetail\?\.state/);
  });

  it("leaves the generation gate itself untouched", () => {
    // The fix is presentational. The gate still refuses everything but
    // AI_SUCCEEDED, and still refuses HUMAN_APPROVED_FALLBACK explicitly.
    const gate = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.match(gate, /if \(input\.analysisState === "HUMAN_APPROVED_FALLBACK"\)/);
    assert.match(gate, /if \(!canExportWithAnalysisState\(input\.analysisState\)\)/);
    const resolver = readFileSync("lib/engine/analysis-state-resolver.ts", "utf8");
    assert.match(resolver, /return state === "AI_SUCCEEDED";/);
  });
});
