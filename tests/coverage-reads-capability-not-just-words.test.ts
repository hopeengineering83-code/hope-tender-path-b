// Reported from the live Preview: a tender showed "2/4 mandatory requirements
// have FULL/SUBSTANTIAL coverage — add genuine owned source evidence for
// unsupported requirements", while the selected evidence directly underneath it
// listed Dessie Specialized Hospital and G+6 General Hospital against a
// requirement for Healthcare Facility Design Experience.
//
// The evidence was there. Two things stopped it counting, and the first is the
// larger one.
//
// 1. The requirement's own category never matched. The app labels these
//    requirements Project, Eligibility, Expert and Submission. The evidence-kind
//    inference matched ELIGIBILITY and EXPERT exactly, but for projects it
//    tested only the longer PROJECT_EXPERIENCE — so "PROJECT" matched nothing,
//    the requirement inferred no evidence kind, and every candidate started 38
//    points lower as a GENERAL match, below the threshold to link at all. That
//    is precisely why the Eligibility and Expert requirements on the reported
//    tender read "Fully verified" while the Project one did not. Its phrase list
//    had the same shape of problem: it demanded "relevant experience" or "past
//    performance", and a requirement titled "Healthcare Facility Design
//    Experience" says neither.
//
// 2. Scoring then compared words. The requirement says "healthcare", the record
//    says "hospital", they share no token, so a hospital earned nothing toward a
//    healthcare requirement. The fix reuses `capabilityFamilies` — the same
//    vocabulary the matching engine already uses to select these records, whose
//    HEALTHCARE_FACILITIES patterns include /\bhospital/ — so one system holds
//    one notion of relatedness instead of two.
//
// These tests pin the behaviour in both directions, because the second is what
// keeps the gate honest: related evidence must count, and unrelated evidence
// must still count for nothing.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  selectAutomaticEvidenceForRequirement,
  type AutomaticEvidenceCandidate,
} from "../lib/engine/automatic-requirement-coverage";

const healthcareRequirement = {
  id: "req-healthcare",
  title: "Healthcare Facility Design Experience",
  description: "The bidder shall demonstrate prior experience in the design of healthcare facilities.",
  restrictions: null,
  exactFileName: null,
  requiredQuantity: 1,
  // The category the app itself shows on this requirement in the reported
  // tender. "PROJECT" used to match nothing, so the requirement inferred no
  // evidence kind and its candidates could not clear the link threshold.
  requirementType: "PROJECT",
} as Parameters<typeof selectAutomaticEvidenceForRequirement>[0];

function projectCandidate(label: string, searchableText: string): AutomaticEvidenceCandidate {
  return {
    recordType: "PROJECT",
    recordId: `rec-${label.replace(/\W+/g, "-").toLowerCase()}`,
    label,
    searchableText,
    evidenceKinds: ["PROJECT_REFERENCE"],
    evidenceKey: `key-${label.replace(/\W+/g, "-").toLowerCase()}`,
    sourceDocumentId: "doc-1",
    sourceContentHash: "hash-1",
    sourceByteLength: 1024,
    selected: true,
    generatedReady: false,
    exactFileName: null,
  } as AutomaticEvidenceCandidate;
}

describe("requirement coverage reads capability, not just repeated words", () => {
  it("counts a hospital project toward a healthcare requirement that never says 'hospital'", () => {
    const candidate = projectCandidate(
      "Dessie Specialized Hospital",
      "Dessie City Admin. G+6 inpatient block, outpatient department and medical gas installation.",
    );

    const selected = selectAutomaticEvidenceForRequirement(healthcareRequirement, [candidate]);

    assert.equal(selected.length, 1, "the project must still be linked to the requirement");
    assert.notEqual(
      selected[0].supportLevel,
      "PARTIAL",
      "a hospital project is not partial evidence of healthcare facility design experience",
    );
    assert.ok(
      selected[0].reasons.some((reason) => reason.includes("HEALTHCARE_FACILITIES")),
      `the shared family must be named so a reviewer can check the inference, got: ${selected[0].reasons.join(" | ")}`,
    );
  });

  it("still refuses to credit a record with nothing in common", () => {
    // The half that matters. If everything scored up, the gate would be
    // decorative and unsupported claims would reach a submitted proposal.
    const candidate = projectCandidate(
      "Rural Feeder Road Gravelling",
      "Grading, gravelling and culvert works on 42km of rural feeder roads.",
    );

    const selected = selectAutomaticEvidenceForRequirement(healthcareRequirement, [candidate]);

    for (const item of selected) {
      assert.equal(
        item.supportLevel,
        "PARTIAL",
        "a road project must never be reported as substantial evidence of healthcare design experience",
      );
      assert.ok(
        !item.reasons.some((reason) => reason.startsWith("shared capability family")),
        "no family is shared, so none may be claimed",
      );
    }
  });

  it("does not let the family bonus alone carry a record of the wrong evidence kind", () => {
    // Family overlap is a bonus on top of the evidence-kind gate, never a
    // substitute for it: a candidate that is not the kind of evidence the
    // requirement asks for still scores zero and is not selected.
    const wrongKind = {
      ...projectCandidate("Hospital Design Note", "Healthcare facility design experience, hospital."),
      evidenceKinds: ["FINANCIAL_STATEMENT"],
    } as AutomaticEvidenceCandidate;

    const selected = selectAutomaticEvidenceForRequirement(healthcareRequirement, [wrongKind]);
    assert.deepEqual(selected, [], "sharing a topic does not make a financial statement a project reference");
  });
});
