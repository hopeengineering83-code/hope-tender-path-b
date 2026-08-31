/**
 * A financial-proposal narrative draft must not carry technical-envelope
 * language.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * After fixing the FINANCIAL_PROPOSAL misclassification (see
 * tests/missing-plan-file-financial-proposal-classification.test.ts), driving
 * the real pipeline further exposed a SECOND, previously-unreachable defect:
 * once "02-Financial-Proposal.docx" was correctly typed FINANCIAL_PROPOSAL,
 * export failed with "Technical methodology content detected in a FINANCIAL
 * document" (document-quality-validator.ts's TECHNICAL_IN_FINANCIAL_RE
 * check). The cause is narrativeDraftContent() in
 * lib/engine/missing-plan-file-generation.ts: its ONE generic template
 * (used for every non-official-original planned file) instructs the reader
 * to "Describe the methodology..." and mentions "work plan" — technical
 * envelope language that is safe in a technical draft but fails the
 * financial envelope's own hygiene rule.
 *
 * This was never exercised for a financial-proposal file before, because the
 * misclassification bug routed it to FINANCIAL_EVIDENCE's
 * "replace with the tender-issued original" template instead — the
 * classification fix is what made this second bug reachable at all.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";

const { documentTypeFor, isNarrativeDraft, narrativeDraftContent } = __testing__;

async function docxVisibleText(base64: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(base64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("narrativeDraftContent avoids technical-envelope language for a financial proposal", () => {
  it("documentTypeFor + isNarrativeDraft route a financial proposal filename into the narrative-draft path", () => {
    const type = documentTypeFor("02-Financial-Proposal.docx", "");
    assert.equal(type, "FINANCIAL_PROPOSAL");
    assert.equal(isNarrativeDraft("02-Financial-Proposal.docx", type), true);
  });

  it("the financial-proposal draft template contains no methodology/work-plan/technical-approach language", async () => {
    const content = await narrativeDraftContent("Sample Tender", "02-Financial-Proposal.docx", "FINANCIAL_PROPOSAL", []);
    const text = await docxVisibleText(content);
    assert.doesNotMatch(text, /methodology|work\s+plan|staffing\s+plan|technical\s+approach/i);
  });

  it("the financial-proposal draft template still mentions pricing so the reviewer knows what to complete", async () => {
    const content = await narrativeDraftContent("Sample Tender", "02-Financial-Proposal.docx", "FINANCIAL_PROPOSAL", []);
    const text = await docxVisibleText(content);
    assert.match(text, /pric(e|ing)|rate|bill of quantities/i);
  });

  it("a real docx produced from the financial-proposal template opens (sanity check on the writer itself)", async () => {
    const content = await narrativeDraftContent("Sample Tender", "02-Financial-Proposal.docx", "FINANCIAL_PROPOSAL", []);
    const buffer = Buffer.from(content, "base64");
    assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  });

  it("a technical narrative draft still uses the methodology-oriented template (no regression for the existing path)", async () => {
    const content = await narrativeDraftContent("Sample Tender", "01-Technical-Proposal.docx", "TECHNICAL_PROPOSAL", []);
    const text = await docxVisibleText(content);
    assert.match(text, /methodology/i);
  });

  it("does not quote an unrelated technical requirement's methodology/work-plan text into a financial proposal draft", async () => {
    // The exact real-pipeline reproduction: matchingRequirements() matches on
    // the shared generic word "proposal", so a financial-proposal filename
    // pulled in these two TECHNICAL requirements verbatim and reintroduced
    // the forbidden language via the quoted requirement text, even after the
    // template itself was fixed.
    const requirements = [
      {
        title: "Separate financial proposal",
        description: "The Technical Proposal and the Financial Proposal must be submitted as two separate password protected files. The Technical Proposal must not contain any financial information.",
      },
      {
        title: "Technical approach and methodology",
        description: "The technical proposal shall present the approach and methodology for the scope of services, evaluated at 35 points.",
      },
      {
        title: "Work plan, staffing schedule and quality assurance",
        description: "The technical proposal shall include a work plan, staffing schedule and quality assurance arrangements, evaluated at 15 points.",
      },
    ];
    const content = await narrativeDraftContent("Sample Tender", "02-Financial-Proposal.docx", "FINANCIAL_PROPOSAL", requirements);
    const text = await docxVisibleText(content);
    assert.doesNotMatch(text, /methodology|work\s+plan|staffing\s+plan|technical\s+approach/i);
    assert.match(text, /Separate financial proposal/, "the genuinely relevant financial requirement must still be listed");
  });
});
