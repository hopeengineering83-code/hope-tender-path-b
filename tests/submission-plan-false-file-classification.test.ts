// A tender rule must never become a required deliverable file.
//
// Reported from the preview: the Build Plan listed
// "Submission formatting, file and packaging rules.pdf" as a required output.
// Nobody can ever produce that file, because it is not a document — it is the
// tender telling you how to format and package the documents. A planned file
// that no upload can satisfy blocks the run permanently, which is the exact
// opposite of "upload the documents and the app does the rest".
//
// Two independent defects produced it, and fixing either alone left it broken:
//
//   1. official-template-detector lists a bare file extension
//      (/\.(xls|xlsx|pdf)\b/) among MEDIUM_SIGNALS, and that check ran BEFORE
//      the rule checks in classifySubmissionPlanItem. So attaching any
//      filename to a row promoted it to "possible official form/template",
//      overriding a classifier that had already judged it correctly on its
//      text. An extension describes a format, not who issues the document.
//
//   2. the internal-control patterns were literal contiguous phrases
//      ("formatting rules", "file naming"). The reported title reads
//      "Submission formatting, file and packaging rules" — a comma and a
//      conjunction split both phrases, so none of them matched.
//
// Genuine tender-issued templates must still be recognised and must stay
// fail-closed: they are obtained and completed, never invented.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { classifySubmissionPlanItem } from "../lib/engine/submission-plan-classifier";
import { detectOfficialTemplateRequirement } from "../lib/engine/official-template-detector";

function classify(title: string, requirementType: string, exactFileName: string | null = null) {
  return classifySubmissionPlanItem({
    title,
    description: null,
    requirementType,
    exactFileName,
  } as Parameters<typeof classifySubmissionPlanItem>[0]);
}

describe("Tender rules never become planned deliverable files", () => {
  it("rejects the exact reported row, with and without a filename attached", () => {
    const title = "Submission formatting, file and packaging rules";
    for (const exactFileName of [null, `${title}.pdf`, "packaging.xlsx"]) {
      const r = classify(title, "FORMAT", exactFileName);
      assert.equal(r.shouldBePlannedFile, false,
        `"${title}" must not become a file (exactFileName=${JSON.stringify(exactFileName)})`);
      assert.equal(r.category, "INTERNAL_COMPLIANCE_CONTROL");
    }
  });

  it("rejects formatting, packaging, labelling and naming rules however they are phrased", () => {
    const rules: Array<[string, string]> = [
      ["File naming and labelling rules", "FORMAT"],
      ["Packaging and binding instructions", "FORMAT"],
      ["Formatting, collation and numbering requirements", "FORMAT"],
      ["Rules for file naming", "FORMAT"],
      ["Page limit and font size", "FORMAT"],
    ];
    for (const [title, type] of rules) {
      const r = classify(title, type, `${title}.pdf`);
      assert.equal(r.shouldBePlannedFile, false, `"${title}" must not become a file`);
    }
  });

  it("keeps submission-process and commercial-separation rules as rules", () => {
    assert.equal(classify("Submission deadline and delivery instructions", "SUBMISSION_RULE", "d.pdf").category, "SUBMISSION_RULE");
    assert.equal(classify("Financial proposal in a separate sealed envelope", "FORMAT", "s.pdf").category, "COMMERCIAL_SEPARATION_RULE");
  });

  it("does not let a file extension alone establish an official template", () => {
    // The detector still reports the weak signal — that is its job — but the
    // classifier must no longer treat it as outranking explicit rule language.
    const detection = detectOfficialTemplateRequirement({
      title: "Submission formatting, file and packaging rules",
      description: null,
      exactFileName: "Submission formatting, file and packaging rules.pdf",
      documentType: "FORMAT",
    } as Parameters<typeof detectOfficialTemplateRequirement>[0]);
    assert.equal(detection.confidence, "MEDIUM", "an extension is a weak signal, not a strong one");
    assert.equal(classify("Submission formatting, file and packaging rules", "FORMAT", "x.pdf").shouldBePlannedFile, false);
  });
});

describe("Genuine deliverables and tender-issued templates are unaffected", () => {
  it("still plans bidder-produced outputs", () => {
    for (const [title, type] of [
      ["Technical Proposal Document", "TECHNICAL"],
      ["Company Profile", "COMPANY_PROFILE"],
      ["Expert CVs", "EXPERT"],
    ] as Array<[string, string]>) {
      assert.equal(classify(title, type).shouldBePlannedFile, true, `"${title}" must remain a planned file`);
    }
  });

  it("still plans tender-issued forms, schedules and evidence originals", () => {
    for (const [title, type, file] of [
      ["Bid Form Annex A", "FORM", "Bid-Form-Annex-A.pdf"],
      ["Price Schedule", "FINANCIAL", "price-schedule.xlsx"],
      ["Audited financial statements", "FINANCIAL", "audited.pdf"],
    ] as Array<[string, string, string]>) {
      const r = classify(title, type, file);
      assert.equal(r.shouldBePlannedFile, true, `"${title}" must remain a planned file`);
    }
  });

  it("keeps an explicit 'use the attached standard form' instruction fail-closed as a template", () => {
    // A HIGH template signal must still win outright — it is an instruction to
    // complete a provided document, not a formatting rule.
    const r = classify("Must use the attached standard form", "FORM", "std.xlsx");
    assert.equal(r.category, "FORM_TEMPLATE_TO_COMPLETE");
    assert.equal(r.shouldBePlannedFile, true);
  });
});
