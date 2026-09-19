// A rule no machine can decide must not sit in the machine's denominator.
//
// Reproduced defect (live Preview, tender 50940b8b, run 34625093741). The
// whole durable chain ran green and export refused, permanently:
//
//   MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE
//   "Automatic matching found release-qualified FULL/SUBSTANTIAL coverage
//    for 2/3 mandatory requirements."
//
//   title      "Technical Proposal Email Submission"
//   mandatory  true   displayStatus PARTIALLY_MET
//   code       SUBMISSION_RULE_AWAITING_PACKAGE
//   reason     "This packaging rule ... cannot be decided from the stored
//               package bytes. It is never reported as met, and no
//               owner-supplied evidence can prove it either."
//   nextAction "No owner action: ... is verified automatically once the
//               package is produced."
//
// Three sentences that cannot all be true. The rule is counted as uncovered;
// it can never be covered; and the owner is told to do nothing about it. On
// run 34627029199 the same gate also refused GET /download?type=pdf, so the
// delivered document could not be inspected by any route either.
//
// GENERIC ROOT CAUSE. 5cb8d694 folded two different things into one status:
//
//   conformance.status === "SATISFIED" ? "FULLY_MET"
//     : conformance.status === "VIOLATED" ? "NOT_MET"
//       : "PARTIALLY_MET"        // PENDING_PACKAGE *and* NOT_MACHINE_DECIDABLE
//
// PENDING_PACKAGE means "not decided YET" and must keep blocking — the
// package will decide it. NOT_MACHINE_DECIDABLE means "not decidable at all":
// page limits, fonts, hard-copy counts, binding, envelope marking. Producing
// the package changes nothing about it, so as a member of the coverage
// denominator it is an equation with no solution.
//
// GENERIC FIX. Such a rule keeps its honest PARTIALLY_MET status — nothing is
// reported as verified that was not verified — and leaves the machine-coverage
// population entirely, surfaced instead as a human-judgement review item.
//
// Nothing here keys on a sector, a client or a tender. Five sectors below,
// none of them healthcare, all with the same shape.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifyPackageRule, evaluatePackageConformance } from "../lib/engine/package-conformance";
import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";
import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

const PACKAGE_FACTS = {
  documents: [
    {
      id: "doc-1",
      name: "Technical Proposal",
      exactFileName: "Technical Proposal.pdf",
      documentType: "TECHNICAL_PROPOSAL",
      generationStatus: "GENERATED",
      validationStatus: "VALID",
      reviewStatus: "APPROVED",
      format: "PDF",
      contentByteLength: 226948,
      contentSha256: "a".repeat(64),
    },
  ],
  plannedFileNames: ["Technical Proposal.pdf"],
  planConfirmed: true,
} as unknown as Parameters<typeof evaluatePackageConformance>[1];

// One per sector. Each is a real packaging constraint that stored bytes
// cannot adjudicate.
const UNDECIDABLE_BY_SECTOR = [
  ["civil works", "Page Limit", "The technical proposal must not exceed 40 pages excluding annexes."],
  ["software", "Tabs and Dividers", "Each hard copy shall be tabbed and indexed by section with printed dividers."],
  ["logistics", "Hard Copy Count", "Bidders shall deliver one original and three hard copies."],
  ["agriculture", "Binding", "Each hard copy must be spiral bound with a transparent cover."],
  ["energy", "Envelope Marking", 'The outer envelope must be marked "DO NOT OPEN BEFORE THE DEADLINE".'],
] as const;

// Not covered here, and deliberately: a pure typography rule ("typed in Arial
// 11pt") matches no PACKAGING_PHRASE, so classifyPackageRule returns null and
// it takes the ordinary evidence path. That is a pre-existing gap in the
// CLASSIFIER, not in the coverage denominator this change is about, and
// widening the classifier would move requirements between two behaviours
// under cover of an unrelated fix. Recorded in operator_handoff.md instead.

function requirementRow(title: string, description: string) {
  return {
    id: `req-${title.replace(/\s+/g, "-").toLowerCase()}`,
    title,
    description,
    priority: "MANDATORY",
    requirementType: "SUBMISSION_RULE",
    restrictions: null,
    sourceExactQuote: description,
    complianceMatrixRows: [],
  };
}

describe("a packaging rule nobody can decide", () => {
  for (const [sector, title, description] of UNDECIDABLE_BY_SECTOR) {
    it(`${sector}: classifies as NOT_MACHINE_DECIDABLE and is never claimed as met`, () => {
      const requirement = { title, description, requirementType: "SUBMISSION_RULE" };
      assert.equal(classifyPackageRule(requirement), "NOT_MACHINE_DECIDABLE");
      const verdict = evaluatePackageConformance(requirement, PACKAGE_FACTS);
      assert.equal(verdict.applicable, true);
      assert.equal(verdict.status, "NOT_MACHINE_DECIDABLE");
    });

    it(`${sector}: leaves the machine-coverage population without being reported as met`, () => {
      const [status] = mapRequirementsToEvidence(
        [requirementRow(title, description)] as never,
        [],
        [],
        [],
        PACKAGE_FACTS,
      );
      // Excluded from the population...
      assert.equal(status.machineDecidable, false);
      // ...but NOT upgraded. Claiming FULLY_MET would report a verdict nobody
      // reached, which is the failure mode this whole fix exists to avoid.
      assert.notEqual(status.displayStatus, "FULLY_MET");
      assert.equal(status.packageRule?.status, "NOT_MACHINE_DECIDABLE");
    });
  }

  it("a rule the package CAN decide is still in the population and still blocks", () => {
    // The guard that keeps this fix narrow. FINANCIAL_SEPARATION is decidable,
    // so nothing about it changes.
    const requirement = {
      title: "Separate Financial Envelope",
      description: "The financial proposal must be submitted in a separate sealed envelope from the technical proposal.",
      requirementType: "SUBMISSION_RULE",
    };
    assert.equal(classifyPackageRule(requirement), "FINANCIAL_SEPARATION");
    const [status] = mapRequirementsToEvidence(
      [requirementRow(requirement.title, requirement.description)] as never,
      [],
      [],
      [],
      PACKAGE_FACTS,
    );
    assert.equal(status.machineDecidable, true);
  });

  it("an ordinary evidence requirement is untouched", () => {
    const [status] = mapRequirementsToEvidence(
      [
        {
          id: "req-iso",
          title: "ISO 9001 Certification",
          description: "Bidders shall hold a valid ISO 9001 quality management certificate.",
          priority: "MANDATORY",
          requirementType: "CERTIFICATION",
          restrictions: null,
          sourceExactQuote: null,
          complianceMatrixRows: [],
        },
      ] as never,
      [],
      [],
      [],
      PACKAGE_FACTS,
    );
    assert.equal(status.machineDecidable, true);
    assert.equal(status.packageRule, null);
    // Still fail-closed: no evidence, so no coverage.
    assert.notEqual(status.displayStatus, "FULLY_MET");
  });
});

describe("the coverage gate reads the decidable population", () => {
  const base = {
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
    mandatoryTracedCount: 3,
    mandatoryComplianceRowsCount: 3,
    confirmedBuildPlanExists: true,
    requiredDocumentsTotal: 1,
    generatedDocumentsTotal: 1,
    exportReadyDocumentsTotal: 1,
    documentsValidated: true,
    documentsApproved: true,
    pdfRequiredButUnavailable: false,
    finalExportAllowed: true,
    authorityOrQualityBlockers: false,
  };

  it("2 of 3, where the third is undecidable, is not a coverage blocker", () => {
    // The live numbers from run 34625093741.
    const decision = buildCanonicalWorkflowDecision({
      ...base,
      mandatoryRequirementCount: 3,
      mandatoryFullOrSubstantialCoverageCount: 2,
      mandatoryNotMachineDecidableCount: 1,
    });
    assert.equal(
      decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"),
      false,
      `still blocked: ${decision.blockerDetails.join(" | ")}`,
    );
  });

  it("2 of 3 with all three decidable still blocks — fail-closed is unchanged", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...base,
      mandatoryRequirementCount: 3,
      mandatoryFullOrSubstantialCoverageCount: 2,
      mandatoryNotMachineDecidableCount: 0,
    });
    assert.equal(decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"), true);
  });

  it("a genuinely uncovered requirement still blocks even when another is undecidable", () => {
    // 4 mandatory, 1 undecidable, so 3 decidable — and only 2 covered.
    const decision = buildCanonicalWorkflowDecision({
      ...base,
      mandatoryRequirementCount: 4,
      mandatoryFullOrSubstantialCoverageCount: 2,
      mandatoryNotMachineDecidableCount: 1,
    });
    assert.equal(decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"), true);
  });

  it("omitting the count preserves the previous behaviour exactly", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...base,
      mandatoryRequirementCount: 3,
      mandatoryFullOrSubstantialCoverageCount: 2,
    });
    assert.equal(decision.blockerCodes.includes("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"), true);
  });
});
