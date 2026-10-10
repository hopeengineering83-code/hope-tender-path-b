/**
 * Owner UAT finding (Preview, tender 0b0e1dcd): the release panel rendered
 *
 *   RELEASE STATUS  Ready to download
 *   "The final ZIP package is ready. Download it below."   [Download Final ZIP]
 *
 * directly beside its own CURRENT BLOCKER ("release-qualified FULL/SUBSTANTIAL
 * coverage for 2/4 mandatory requirements") and "CURRENT OUTPUTS: 0". Clicking
 * the button returned CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE.
 *
 * Cause: tender-lifecycle-orchestrator computed its mandatory population with
 * `priority === "MANDATORY"`, while the canonical evidence statuses count
 * `isMandatoryRequirement` (MANDATORY OR CRITICAL). Two CRITICAL requirements
 * holding only partial evidence were therefore invisible to
 * mandatoryEvidenceReady, finalExportReady became true, and the lifecycle
 * reached EXPORT_READY while the real download gate refused.
 *
 * Same defect class as the release snapshot's numerator/denominator split.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

const FILE = {
  id: "file-1",
  extractedText: "Required Documents: Technical Proposal.pdf. Submission instructions on page 3.",
  totalPages: 10,
};

function requirement(id: string, priority: string, supportLevel: string | null) {
  return {
    id,
    title: `Requirement ${id}`,
    description: "",
    requirementType: "FORMAT",
    priority,
    sourcePageNumber: 3,
    sourceExactQuote: "Required Documents: Technical Proposal.pdf",
    sourceTenderFileId: FILE.id,
    complianceMatrixRows: supportLevel ? [{ supportLevel }] : [],
  };
}

describe("export readiness uses the canonical mandatory population", () => {
  it("a partially covered CRITICAL requirement keeps the tender out of EXPORT_READY", () => {
    // Two MANDATORY fully covered, two CRITICAL only partial — the exact shape
    // that rendered "Ready to download" beside a 2/4 blocker.
    const requirements = [
      requirement("m1", "MANDATORY", "FULL"),
      requirement("m2", "MANDATORY", "SUBSTANTIAL"),
      requirement("c1", "CRITICAL", "PARTIAL"),
      requirement("c2", "CRITICAL", "PARTIAL"),
    ];
    const statuses = mapRequirementsToEvidence(requirements as never, [], [], [FILE]);
    const byId = new Map(statuses.map((s) => [s.requirementId, s]));

    const canonicalMandatory = requirements.filter((r) => byId.get(r.id)?.mandatory);
    const legacyMandatory = requirements.filter((r) => r.priority === "MANDATORY");

    assert.equal(canonicalMandatory.length, 4, "CRITICAL rows belong to the mandatory population");
    assert.equal(legacyMandatory.length, 2, "fixture must exercise the divergence");

    const readyUnderCanonical = canonicalMandatory.every(
      (r) => byId.get(r.id)?.displayStatus === "FULLY_MET",
    );
    const readyUnderLegacy = legacyMandatory.every(
      (r) => byId.get(r.id)?.displayStatus === "FULLY_MET",
    );

    assert.equal(readyUnderLegacy, true, "the legacy population is what wrongly claimed ready");
    assert.equal(
      readyUnderCanonical,
      false,
      "the canonical population must withhold export readiness while CRITICAL rows are partial",
    );
  });

  it("orchestrator derives its mandatory population from the canonical statuses", () => {
    const src = readFileSync("lib/engine/tender-lifecycle-orchestrator.ts", "utf8");
    assert.match(
      src,
      /requirementEvidenceStatuses\.filter\(\(status\) => status\.mandatory\)\.map\(\(status\) => status\.requirementId\)/,
      "mandatory population must come from status.mandatory",
    );
    assert.doesNotMatch(
      src,
      /const mandatoryReqs = requirements\.filter\(\(r\) => r\.priority === "MANDATORY"\)/,
      "the MANDATORY-only population must not be reintroduced",
    );
  });

  it("the mandatory population is built after the statuses it derives from", () => {
    const src = readFileSync("lib/engine/tender-lifecycle-orchestrator.ts", "utf8");
    const statuses = src.indexOf("const requirementEvidenceStatuses = mapRequirementsToEvidence");
    const population = src.indexOf("const mandatoryRequirementIds = new Set(");
    assert.ok(statuses > -1 && population > -1);
    assert.ok(population > statuses, "population must be derived after the statuses exist");
  });
});
