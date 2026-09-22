// ─── The Export Hub must name the blocker, not its category ─────────────────
//
// THE DEFECT, from the owner's Export Hub on the Preview at commit 804a0598:
//
//   Architectural Consultancy Services ...          [Not ready]
//   1 / 1 docs generated
//   ZIP locked — 1 blocker
//   Canonical export blockers
//     Next action: Fix authority/quality blockers
//     AUTHORITY_OR_QUALITY_BLOCKERS
//   Submission checklist
//     ✅ Document workspace initialized
//     ✅ 1 document generated
//     ✅ All documents validated
//     ✅ No critical compliance gaps (0 remaining)
//     ✅ 0 warning gaps (non-blocking)
//     ✅ 2 mandatory requirements covered
//     ❌ Canonical readiness: 1 blocker(s)
//   Document checklist
//     ✅ 1. Technical Proposal.pdf
//
// Every itemised line is green. The single document passes. The only red line
// restates, as a count, the fact that a blocker exists. The owner is told to
// "fix authority/quality blockers" and given nothing to fix.
//
// THE CAUSE. The names were never missing — snapshot.exportBlockers holds
// them. The caller reduced them to a boolean by comparing list LENGTHS:
//
//   snapshot.exportBlockers.length > snapshot.generationBlockers.length
//
// so the decision layer received a bare `true` and could only paraphrase its
// own code back at the reader.
//
// TWO RULES PINNED HERE.
//   1. A locked ZIP names what locks it.
//   2. The set of authority/quality blockers is the set DIFFERENCE between
//      export and generation blockers, not the difference of their sizes —
//      counting gives the wrong answer as soon as the two lists diverge, which
//      is a correctness bug independent of the reporting one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/engine/canonical-workflow-decision.ts", "utf8");

describe("a locked ZIP must name what locks it", () => {
  it("no longer reports the category as though it were the reason", () => {
    // The bare paraphrase must not be the only thing a blocked owner is given.
    assert.equal(
      /blockerDetails\.push\("Authority review or document quality blockers remain\."\);/.test(SRC),
      false,
      "the blocker detail still restates its own category",
    );
  });

  it("renders the blocker names when the snapshot supplies them", () => {
    // Matched by SHAPE, not by the local's spelling: the derivation was later
    // hoisted and renamed so one sentence could feed both the detail row and
    // the next-action reason, and a literal-name pin would have failed on the
    // rename while the behaviour it guards was strictly improving.
    assert.match(SRC, /Authority or document quality blockers remain: \$\{\w+\.join\("; "\)\}/);
  });

  it("still fails closed when no names are available, and says so", () => {
    // Fail-closed is preserved: a nameless blocker still blocks. What changes
    // is that the message admits the detail is missing rather than implying
    // there is none.
    assert.match(SRC, /no blocker detail was supplied by the readiness snapshot/);
    assert.match(SRC, /blockerCodes\.push\("AUTHORITY_OR_QUALITY_BLOCKERS"\);/);
  });
});

describe("authority/quality blockers are identified, not counted", () => {
  it("no longer compares list lengths", () => {
    assert.equal(
      /exportBlockers\.length > snapshot\.generationBlockers\.length/.test(SRC),
      false,
      "the boolean is still derived by arithmetic on list sizes",
    );
  });

  it("uses the set difference between export and generation blockers", () => {
    assert.match(SRC, /const generationBlockerSet = new Set\(snapshot\.generationBlockers\);/);
    assert.match(SRC, /snapshot\.exportBlockers\.filter\(\(blocker\) => !generationBlockerSet\.has\(blocker\)\)/);
    // The boolean is now downstream of the identified set, not beside it.
    assert.match(SRC, /const authorityOrQualityBlockers = authorityOrQualityBlockerNames\.length > 0;/);
  });

  it("keeps the generation-blockers-first precedence", () => {
    // When generation itself is blocked, authority/quality is not yet the
    // owner's problem — that ordering must survive the change.
    assert.match(SRC, /snapshot\.exportBlockers\.length > 0 && !snapshot\.generationEligible/);
  });

  it("passes the names to the decision layer", () => {
    assert.match(SRC, /authorityOrQualityBlockerNames\?: string\[\];/);
    assert.match(SRC, /^\s{4}authorityOrQualityBlockerNames,$/m);
  });
});

describe("the change carries no tender-, sector- or benchmark-specific logic", () => {
  it("names no sector or client in the blocker derivation", () => {
    const start = SRC.indexOf("const generationBlockerSet");
    const end = SRC.indexOf("const finalExportAllowed", start);
    assert.ok(start > -1 && end > start);
    const code = SRC.slice(start, end)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of [/\bPharo\b/i, /\bhospital/i, /\bhealthcare/i, /\bEthiopia/i, /\bmedical\b/i]) {
      assert.equal(forbidden.test(code), false, `the derivation mentions ${forbidden}`);
    }
  });
});

// ─── ONE DERIVATION, BOTH SURFACES ──────────────────────────────────────────
//
// The repair above put the names in `blockerDetails` and the owner still saw
// the paraphrase, because the Export Hub renders `nextRequiredActionReason`,
// which came from a static table. Verbatim from the exact-head Preview
// (tender d2b85e2a, GET /api/tenders/{id}/export-readiness):
//
//   CANONICAL BLOCKERS: ok=False zipReady=True
//     primaryBlockerReason='Authority review or document quality blockers remain.'
//     summary.documentBlockers=0
//     summary.tenderLevelBlockers=0
//     summary.qualityFailedDocuments=0
//     blockers: 1
//       [BLOCKER] AUTHORITY_OR_QUALITY_BLOCKERS: Authority review or document quality blockers remain.
//     documents.generated (1): ["Technical Proposal.pdf"]
//     documents.missingRequired (0): []
//
// These tests call the decision rather than reading its source, because the
// defect was never visible in one string -- it was two copies of a sentence
// that drifted.

import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

/** The exact-head Preview state: everything green except the authority gate. */
function lockedByAuthorityOnly(names?: string[]) {
  return buildCanonicalWorkflowDecision({
    hasFiles: true,
    extractionUnsafe: false,
    extractionCorrupted: false,
    ocrRequired: false,
    aiAnalysisExists: true,
    aiAnalysisTrusted: true,
    aiAnalysisPartial: false,
    aiAnalysisStale: false,
    resumableAnalysisAvailable: false,
    criticalTenderDetailsValid: true,
    requirementsExist: true,
    requirementsTrusted: true,
    mandatoryRequirementCount: 2,
    mandatoryTracedCount: 2,
    mandatoryComplianceRowsCount: 2,
    mandatoryFullOrSubstantialCoverageCount: 2,
    confirmedBuildPlanExists: true,
    requiredDocumentsTotal: 1,
    generatedDocumentsTotal: 1,
    exportReadyDocumentsTotal: 1,
    documentsValidated: true,
    documentsApproved: true,
    pdfRequiredButUnavailable: false,
    finalExportAllowed: false,
    authorityOrQualityBlockers: true,
    ...(names === undefined ? {} : { authorityOrQualityBlockerNames: names }),
  });
}

describe("the reason the owner reads names the blocker", () => {
  it("reaches the authority/quality stage from the live Preview state", () => {
    const decision = lockedByAuthorityOnly(["Final Tender Facts are not ready for export."]);
    assert.equal(decision.currentBlockingStage, "AUTHORITY_OR_QUALITY_BLOCKERS");
  });

  it("puts the snapshot's blocker names in nextRequiredActionReason", () => {
    const decision = lockedByAuthorityOnly([
      "Final Tender Facts are not ready for export.",
      "Evidence coverage is 40% (need >= 50% for export).",
    ]);
    assert.match(decision.nextRequiredActionReason, /Final Tender Facts are not ready for export\./);
    assert.match(decision.nextRequiredActionReason, /Evidence coverage is 40%/);
  });

  it("no longer answers with the paraphrase the owner was given", () => {
    const decision = lockedByAuthorityOnly(["Final Tender Facts are not ready for export."]);
    assert.notEqual(
      decision.nextRequiredActionReason,
      "Authority review or document quality blockers remain.",
      "the next-action reason is still restating the blocker's own category",
    );
  });

  it("gives the detail row and the next-action reason the SAME sentence", () => {
    // Two copies of one fact is how the first repair stopped a layer short.
    const names = ["Final Tender Facts are not ready for export."];
    const decision = lockedByAuthorityOnly(names);
    const index = decision.blockerCodes.indexOf("AUTHORITY_OR_QUALITY_BLOCKERS");
    assert.notEqual(index, -1, "the blocker code was not recorded");
    assert.equal(decision.blockerDetails[index], decision.nextRequiredActionReason);
  });

  it("still fails closed, and says the detail is missing, when no names arrive", () => {
    for (const names of [undefined, [], ["", "   "]]) {
      const decision = lockedByAuthorityOnly(names);
      assert.equal(decision.currentBlockingStage, "AUTHORITY_OR_QUALITY_BLOCKERS");
      assert.match(decision.nextRequiredActionReason, /no blocker detail was supplied/);
    }
  });

  it("keeps the action label, which says what to do rather than what is wrong", () => {
    const decision = lockedByAuthorityOnly(["Final Tender Facts are not ready for export."]);
    assert.equal(decision.nextRequiredActionLabel, "Fix authority/quality blockers");
  });

  it("carries no sector, client or benchmark vocabulary of its own", () => {
    const decision = lockedByAuthorityOnly(["Final Tender Facts are not ready for export."]);
    const forbidden = /pharo|ethiop|addis|healthcare|architect|consultanc/i;
    assert.equal(forbidden.test(decision.nextRequiredActionReason), false);
    assert.equal(forbidden.test(decision.nextRequiredActionLabel), false);
  });
});
