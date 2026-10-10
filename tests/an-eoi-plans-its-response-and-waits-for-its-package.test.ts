/**
 * An EOI plans its own response, and a package rule waits for the package.
 *
 * 2026-09-30, Preview, a 4-page EOI (inspect run 36730080968): after Run
 * Engine finally succeeded, the chain stopped before Proposal Generation.
 *  1. The confirmed plan held three declarations and no EOI response:
 *     "Company Profile and Tax Registration Documents" (a 25-page profile plus
 *     certificates) was filed as original evidence, and "Previous
 *     Telecommunications Tower Experience" is SCORED, so nothing planned the
 *     document that answers them.
 *  2. The generation gate stopped at 7/9 coverage. One row was "No prices
 *     should be provided with this EOI": a FINANCIAL_SEPARATION rule the
 *     package decides, which is PENDING_PACKAGE until a package exists.
 *
 * Generic fixture (a maintenance-services EOI), not the tender under test.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";
import { classifyPackageRule } from "../lib/engine/package-conformance";

const base = { exactFileName: null, exactOrder: null } as const;
const REQUIREMENTS = [
  { ...base, id: "p1", priority: "MANDATORY", requirementType: "COMPANY_PROFILE", title: "Company Profile and Tax Registration Documents", description: "Submit a Company Profile (max 25 pages), Certificate of Incorporation and a Tax Registration Certificate." },
  { ...base, id: "x1", priority: "SCORED", requirementType: "PROJECT_EXPERIENCE", title: "Previous Maintenance Experience", description: "List similar maintenance contracts in the last 5 years with client references." },
  { ...base, id: "d1", priority: "MANDATORY", requirementType: "DECLARATION", title: "Litigation History Disclosure", description: "Disclose litigation history for the last 3 years." },
  { ...base, id: "s1", priority: "MANDATORY", requirementType: "SUBMISSION_RULE", title: "Exclusion of Pricing Information", description: "No prices should be provided with this EOI." },
];

describe("an EOI plans its response", () => {
  it("plans one Expression of Interest answering the profile and experience, first in order", () => {
    const plan = buildSubmissionPlan({ id: "t", title: "Provision of Maintenance Services", requirements: REQUIREMENTS as any });
    const eoi = plan.files.find((file) => file.exactFileName === "Expression of Interest.docx");
    assert.ok(eoi, plan.files.map((file) => file.exactFileName).join(", "));
    assert.equal(eoi!.documentType, "EXPRESSION_OF_INTEREST");
    assert.deepEqual([...eoi!.sourceRequirementIds].sort(), ["p1", "x1"]);
    assert.equal(Math.min(...plan.files.map((file) => file.exactOrder)), eoi!.exactOrder);
    assert.equal(new Set(plan.files.map((file) => file.exactOrder)).size, plan.files.length, "no two files share an order");
  });

  it("a tender without a narrative row plans no proposal", () => {
    const plan = buildSubmissionPlan({ id: "t", requirements: [REQUIREMENTS[2]] as any });
    assert.equal(plan.files.some((file) => /expression of interest|technical proposal/i.test(file.exactFileName)), false);
  });
});

describe("a package-decided rule waits for the package at the generation gate", () => {
  it("the pricing exclusion is a FINANCIAL_SEPARATION rule", () => {
    assert.equal(classifyPackageRule(REQUIREMENTS[3] as any), "FINANCIAL_SEPARATION");
  });

  it("the canonical decision counts pending package-decided rules as awaiting output", () => {
    const source = readFileSync("lib/engine/canonical-workflow-decision.ts", "utf8");
    assert.match(source, /mandatoryAwaitingPackageVerdictCount/);
    assert.match(source, /family !== null && family !== "NOT_MACHINE_DECIDABLE"/);
    assert.match(source, /mandatoryAwaitingPlannedArtifactCount \+ mandatoryAwaitingPackageVerdictCount/);
  });
});
