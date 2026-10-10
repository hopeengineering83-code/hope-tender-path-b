// A company record cannot prove a rule about the submission itself.
//
// Reproduced defect (live Preview, tender 08e250af, read-only inspect
// 34612881290). The acceptance run took the whole chain to a complete,
// export-ready package and stopped on one gate — and these were the two rows
// holding it, quoted from the API:
//
//   Email Submission Only        SUBMISSION_RULE  MANDATORY  PARTIAL
//     sourceExactQuote "Submission Method: Email submission only"
//     link  source=Company evidence available for drafting
//           reference=Expert CVS.pdf.txt
//
//   Required Email Subject Line  SUBMISSION_RULE  MANDATORY  PARTIAL
//     sourceExactQuote "Required Email Subject: Technical Proposal for Pharo Ventures"
//     link  reference=Expert CVS.pdf.txt
//
// A file of expert CVs, offered as the evidence that the bid must be emailed.
//
// lib/engine/packaging-requirement-rule.ts already documents this exact
// failure, with this exact file, for "Submission in a Single PDF Technical
// File" — a rule about the SHAPE of the submission. That was fixed. Rules
// about the ADDRESSING of the submission were not: they match no
// PACKAGING_PHRASE, so they still fell through to the GENERAL wildcard, which
// the selector admits every candidate for. Every CV contains an email
// address, so a CV wins on two tokens.
//
// Two producers did it independently and both are covered here:
//   * inferAutomaticEvidenceKinds  — the GENERAL fallback
//   * findRequirementSupportDocument — bare token overlap over extracted text
//
// Generic: nothing here keys on a sector, a client or a tender. Every tender
// that names a submission channel meets this, against any vault holding a
// document with ordinary words in it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  isSubmissionInstructionRequirement,
  isPackagingOrFormatRequirement,
} from "../lib/engine/packaging-requirement-rule";
import { inferAutomaticEvidenceKinds } from "../lib/engine/automatic-requirement-coverage";
import { findRequirementSupportDocument } from "../lib/engine/compliance";

const req = (title: string, description: string, requirementType = "SUBMISSION_RULE") => ({
  title, description, requirementType, restrictions: null, exactFileName: null,
});

/** A vault document whose text mentions email, as essentially every CV does. */
const CV_DOC = {
  category: "EXPERT_CV",
  originalFileName: "Expert CVS.pdf.txt",
  fileName: "Expert CVS.pdf.txt",
  extractedText:
    "Curriculum Vitae. Ahmed Kebede Tekaw, Senior Architect. "
    + "Email: ahmed@example.org. Telephone +251 11 000 0000. "
    + "Submission of design proposal drawings for hospital projects. "
    + "Subject matter expert in healthcare facility design.",
};

const knowledgeWith = (docs: unknown[]) => ({
  documents: docs, experts: [], projects: [], financialRecords: [],
  complianceRecords: [], certifications: [],
} as unknown as Parameters<typeof findRequirementSupportDocument>[0]);

describe("a CV cannot prove how the bid is sent", () => {
  it("the reproduced rows are recognised as submission instructions", () => {
    assert.equal(
      isSubmissionInstructionRequirement(req("Email Submission Only", "Submission Method: Email submission only")),
      true,
    );
    assert.equal(
      isSubmissionInstructionRequirement(
        req("Required Email Subject Line", "Required Email Subject: Technical Proposal for Pharo Ventures"),
      ),
      true,
    );
  });

  it("they no longer fall through to the GENERAL wildcard", () => {
    // GENERAL is the bug: the selector admits every candidate for it.
    for (const r of [
      req("Email Submission Only", "Submission Method: Email submission only"),
      req("Required Email Subject Line", "Required Email Subject: Technical Proposal for Pharo Ventures"),
    ]) {
      const kinds = inferAutomaticEvidenceKinds(r);
      assert.ok(!kinds.includes("GENERAL"), `still wildcard: ${kinds.join(", ")}`);
    }
  });

  it("the generated artifact can still prove one", () => {
    // The point that the reverted 8f2eed4b got wrong. A delivery instruction
    // IS answerable by the produced artifact's own validated text.
    const kinds = inferAutomaticEvidenceKinds(req("Email Submission Only", "Submission Method: Email submission only"));
    assert.ok(kinds.includes("OUTPUT_ARTIFACT"), `artifact evidence must remain admissible: ${kinds.join(", ")}`);
  });

  it("no vault document is returned as support for one", () => {
    for (const r of [
      req("Email Submission Only", "Submission Method: Email submission only"),
      req("Required Email Subject Line", "Required Email Subject: Technical Proposal for Pharo Ventures"),
    ]) {
      const found = findRequirementSupportDocument(
        knowledgeWith([CV_DOC]),
        r as unknown as Parameters<typeof findRequirementSupportDocument>[1],
      );
      assert.equal(found, undefined, `a vault document was still offered: ${String((found as { originalFileName?: string })?.originalFileName)}`);
    }
  });

  it("guard the guard: that CV really would have matched before", () => {
    // If the fixture stopped matching, the case above would pass vacuously
    // and this whole test would prove nothing. An ordinary evidence
    // requirement with the same tokens must still find it.
    const found = findRequirementSupportDocument(
      knowledgeWith([CV_DOC]),
      req("Key Expert Team", "Provide curriculum vitae for each proposed expert", "EXPERT") as never,
    );
    assert.ok(found, "the CV fixture no longer matches anything — the fix is untested");
  });

  it("a requirement that also asks for real evidence keeps its evidence link", () => {
    // "Email the audited accounts" is an accounts requirement with a delivery
    // note attached. Narrowing that would lose a real, correct link.
    const r = req("Audited Accounts", "Email the audited financial statements for the last three years");
    assert.equal(isSubmissionInstructionRequirement(r), false);
  });

  // Cross-sector: the mechanism is about clause subject, not domain.
  const SECTORS: ReadonlyArray<[string, string, string]> = [
    ["road rehabilitation", "Submission Channel", "Submissions by email to roads@example.gov only"],
    ["water supply", "Portal Upload Required", "Bids must be uploaded to the e-procurement portal"],
    ["urban planning", "Email Subject Line", "The email subject line must quote the reference number"],
    ["geotechnical survey", "Delivery Address", "Proposals shall be submitted to the following address"],
    ["hospital supervision", "Courier Submission", "Hand delivery or courier submission before the deadline"],
  ];
  for (const [sector, title, description] of SECTORS) {
    it(`${sector}: a CV is not offered as proof of the delivery rule`, () => {
      const r = req(title, description);
      assert.equal(isSubmissionInstructionRequirement(r), true, `${sector} not recognised`);
      assert.ok(!inferAutomaticEvidenceKinds(r).includes("GENERAL"), `${sector} still wildcard`);
      assert.equal(
        findRequirementSupportDocument(knowledgeWith([CV_DOC]), r as never),
        undefined,
        `${sector} still offered a vault document`,
      );
    });
  }

  it("packaging rules are untouched by the new predicate", () => {
    // The two predicates must stay separate: packaging resolves to
    // PACKAGE_FORMAT alone, and folding them together would narrow
    // submission instructions past the artifact evidence that answers them.
    const packaging = req("Single PDF", "Submission in a single consolidated PDF file", "SUBMISSION_FORMAT");
    assert.equal(isPackagingOrFormatRequirement(packaging), true);
    assert.deepEqual(inferAutomaticEvidenceKinds(packaging), ["PACKAGE_FORMAT"]);
  });
});
