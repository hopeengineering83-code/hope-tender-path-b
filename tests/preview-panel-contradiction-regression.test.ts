/**
 * Regression tests for the two panel contradictions reproduced on the real
 * Preview (commit db495d14) during owner UAT.
 *
 * 1. The Command Center / Export Readiness primary blocker announced
 *    "release-qualified FULL/SUBSTANTIAL coverage for 2/4 mandatory
 *    requirements" while the Requirements and Evidence panel reported
 *    "Release-qualified coverage: 0/4 (0%)" with all four rows a genuine gap.
 *    Cause: the release snapshot counted the mandatory POPULATION with
 *    `priority === "MANDATORY"` but counted covered/grounded rows with
 *    `isMandatoryRequirement` (MANDATORY OR CRITICAL), so CRITICAL rows
 *    entered the numerator without joining the denominator.
 *
 * 2. The workflow showed AI Analyze complete while the Export Readiness Gate
 *    raised ANALYSIS_SOURCE_UNKNOWN — "no analysis has been run". Cause: the
 *    export panel used the notes-only detector instead of the canonical
 *    analysis-state resolver that every other surface uses.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

const GROUNDED_FILE = {
  id: "file-1",
  extractedText: "The bidder shall provide professional team CVs for all key experts.",
  totalPages: 10,
};

function requirement(id: string, priority: string, supportLevel: string | null) {
  return {
    id,
    title: `Requirement ${id}`,
    description: "",
    requirementType: "TECHNICAL",
    priority,
    sourcePageNumber: 2,
    sourceExactQuote: "The bidder shall provide professional team CVs",
    sourceTenderFileId: GROUNDED_FILE.id,
    complianceMatrixRows: supportLevel ? [{ supportLevel }] : [],
  };
}

describe("mandatory coverage population is counted consistently", () => {
  it("counts CRITICAL requirements in the mandatory population, not only in the numerator", () => {
    // Two MANDATORY rows with no evidence, two CRITICAL rows fully supported —
    // the exact shape that produced "2/4" against a denominator of 2.
    const requirements = [
      requirement("m1", "MANDATORY", null),
      requirement("m2", "MANDATORY", null),
      requirement("c1", "CRITICAL", "FULL"),
      requirement("c2", "CRITICAL", "SUBSTANTIAL"),
    ];

    const statuses = mapRequirementsToEvidence(requirements as never, [], [], [GROUNDED_FILE]);
    const mandatoryStatuses = statuses.filter((status) => status.mandatory);
    const covered = mandatoryStatuses.filter((status) => status.displayStatus === "FULLY_MET").length;

    // The numerator predicate (`status.mandatory`) admits CRITICAL, so the
    // denominator built from the same predicate must admit it too.
    assert.equal(mandatoryStatuses.length, 4, "CRITICAL rows must join the mandatory population");
    assert.equal(covered, 2);
    assert.ok(
      covered <= mandatoryStatuses.length,
      "covered can never exceed the mandatory population it is measured against",
    );

    // The legacy denominator — MANDATORY only — is what made 2/2 render as an
    // inflated coverage claim against a population that excluded the very rows
    // being counted.
    const legacyDenominator = requirements.filter((r) => r.priority === "MANDATORY").length;
    assert.notEqual(
      legacyDenominator,
      mandatoryStatuses.length,
      "fixture must exercise the divergence between the two predicates",
    );
  });

  it("release snapshot derives population and counts from one predicate", () => {
    const source = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");
    // The mandatory population must be derived from the evidence statuses, not
    // from a second, narrower priority filter.
    assert.match(
      source,
      /const mandatoryStatuses = requirementEvidenceStatuses\.filter\(\(status\) => status\.mandatory\)/,
      "snapshot must build the mandatory population from status.mandatory",
    );
    assert.doesNotMatch(
      source,
      /tender\.requirements\.filter\(\s*\(requirement\) => \(requirement\.priority \?\? ""\)\.toUpperCase\(\) === "MANDATORY",?\s*\)/,
      "snapshot must not reintroduce a MANDATORY-only denominator",
    );
  });
});

describe("export readiness analysis source agrees with the canonical resolver", () => {
  it("export-readiness resolves analysis source through the canonical resolver", () => {
    const source = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.match(
      source,
      /resolveCanonicalAnalysisSource\(prisma, tenderId, tender\)/,
      "export readiness must use the canonical resolver-first analysis source",
    );
    assert.doesNotMatch(
      source,
      /detectAnalysisSourceWithApproval\(prisma, tenderId, tender\)/,
      "export readiness must not fall back to the notes-only detector as its primary source",
    );
  });

  it("canonical analysis source maps promoted AI analysis to AI, not UNKNOWN", () => {
    const source = readFileSync("lib/engine/analysis-source.ts", "utf8");
    assert.match(source, /export async function resolveCanonicalAnalysisSource/);
    // AI_SUCCEEDED must map to "AI" so a genuine analysis proven by AiJob rows
    // never renders as "no analysis has been run".
    assert.match(source, /case "AI_SUCCEEDED":\s*\n\s*return "AI";/);
    // Authority must not be widened: the approved fallback stays a fallback.
    assert.match(source, /case "HUMAN_APPROVED_FALLBACK":\s*\n\s*return "HUMAN_APPROVED_REGEX_FALLBACK";/);
    assert.match(source, /case "NOT_STARTED":\s*\n\s*return "UNKNOWN";/);
  });
});
