import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../lib/extraction-quality";

const appReadyDocxText = `
APP-READY TENDER SUMMARY

CLIENT DETAILS AND TENDER METADATA
Tender Title: Architectural Consultancy Services for a Specialty Medical Center
Issuing Entity / Client: Pharo Ventures
Client / procuring entity: Pharo Ventures
Country: Ethiopia
City / location: Addis Ababa

SUBMISSION INSTRUCTIONS
Submission Method: Email submission only
Submission Format: PDF electronic submission only
Submission Emails: bids@example.org; procurement@example.org
Submission Deadline: March 25, 2026, 5:00 PM Addis Ababa Time
Required Email Subject: Technical Proposal for Pharo Ventures

REQUIRED DOCUMENTS / MANDATORY DOCUMENTS
Documents Required:
Mandatory Document: Technical Proposal.pdf
Required technical proposal sections: Company Profile; Relevant Experience; Technical Approach; Additional Information; Annexes / Supporting Documents

EVALUATION CRITERIA
1. Relevant healthcare project experience.
2. Quality and relevance of portfolio.
3. Technical understanding of healthcare facility design.
4. Strength of professional team.
5. Compliance with submission requirements.
`;

describe("DOCX extraction dashboard fallback", () => {
  it("detects tender sections without physical [Page N] markers", () => {
    const report = assessExtractionQualityPerPage(appReadyDocxText);

    assert.equal(report.detectionMode, "DOCUMENT_LEVEL");
    assert.equal(report.totalDetectedPages, 1);
    assert.ok(report.submissionInstructionPages.length > 0, "submission instructions should be detected");
    assert.ok(report.evaluationCriteriaPages.length > 0, "evaluation criteria should be detected");
    assert.ok(report.requiredDocumentPages.length > 0, "required documents should be detected");
    assert.ok(report.clientDetailPages.length > 0, "client details should be detected");
  });

  it("keeps clean DOCX-style text acceptable for analysis", () => {
    const text = `${appReadyDocxText}\n\n${appReadyDocxText}\n\n${appReadyDocxText}`;
    const quality = assessExtractionQuality(text, "app_ready_tender_summary.docx");

    assert.ok(quality.score >= 45, `expected acceptable extraction score, got ${quality.score}`);
    assert.equal(quality.corrupted, false);
  });

  it("does not report false zero section counts for app-ready DOCX text", () => {
    const report = assessExtractionQualityPerPage(appReadyDocxText);

    const counts = {
      submission: report.submissionInstructionPages.length,
      evaluation: report.evaluationCriteriaPages.length,
      requiredDocs: report.requiredDocumentPages.length,
      clientDetails: report.clientDetailPages.length,
    };

    assert.deepEqual(counts, {
      submission: 1,
      evaluation: 1,
      requiredDocs: 1,
      clientDetails: 1,
    });
  });

  it("catches low text density on a DOCX with no [Page N] markers when totalPages is known", () => {
    // A real 20-page DOCX that extracted almost nothing per page (e.g. a
    // near-empty template) has no [Page N] markers, so without a totalPages
    // fallback the density check silently never fires.
    const thinText = "Tender Title: X. ".repeat(20); // ~340 chars total, 20 real pages
    const withoutPages = assessExtractionQuality(thinText, "thin.docx");
    const withPages = assessExtractionQuality(thinText, "thin.docx", 20);

    assert.equal(withoutPages.averageCharsPerPage, null, "no page markers and no totalPages means density is unmeasured");
    assert.ok(withPages.averageCharsPerPage !== null && withPages.averageCharsPerPage < 300, "totalPages fallback must compute a low density estimate");
    assert.ok(withPages.warnings.some((w) => w.includes("Low text density")), "must warn on low density once totalPages is known");
    assert.ok(withPages.score < withoutPages.score, "the totalPages-aware score must be stricter than the blind one");
  });

  it("does not falsely flag low density for genuinely dense text once totalPages is known", () => {
    const denseText = appReadyDocxText.repeat(10); // plenty of content per page
    const quality = assessExtractionQuality(denseText, "dense.docx", 1);
    assert.ok(quality.averageCharsPerPage !== null && quality.averageCharsPerPage >= 300);
    assert.ok(!quality.warnings.some((w) => w.includes("Low text density")));
  });
});
