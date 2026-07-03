/**
 * Behavioral tests for mergeContactDetailsSource via buildCanonicalAnalysisTenderUpdate.
 *
 * These tests verify the MED-1 fix: when AI re-emits a contactDetailsSource
 * entry with a DIFFERENT quote, the existing fileId is dropped (not preserved)
 * because it was attributed to the OLD quote and may not point to a file
 * containing the NEW quote. When the quote is UNCHANGED, the existing fileId
 * is preserved.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";
import type { AIAnalysisResult } from "../lib/ai";

function makeBaseAiResult(overrides: Partial<AIAnalysisResult> = {}): AIAnalysisResult {
  return {
    summary: "Test summary",
    requirements: [],
    exactFileNaming: [],
    exactFileOrder: [],
    evaluationMethodology: null,
    submissionNotes: null,
    tenderCategory: null,
    envelopeMode: null,
    clientType: null,
    submissionFormat: null,
    tenderTitle: null,
    tenderTitleSourcePage: null,
    tenderTitleSourceQuote: null,
    deadline: null,
    deadlineSourcePage: null,
    deadlineSourceQuote: null,
    procuringEntityName: null,
    donorAgency: null,
    implementingAgency: null,
    clientWebsite: null,
    submissionEmailSubject: null,
    contactDetailsSource: null,
    clientContactName: null,
    clientContactTitle: null,
    clientContactEmail: null,
    clientContactPhone: null,
    clientAddress: null,
    clientCity: null,
    country: null,
    category: null,
    budget: null,
    currency: null,
    submissionMethod: null,
    submissionEmails: null,
    submissionAddress: null,
    validityDays: null,
    bidBondAmount: null,
    bidBondCurrency: null,
    preBidMeetingDate: null,
    preBidMeetingLocation: null,
    mandatorySiteVisit: false,
    numberOfCopiesRequired: null,
    pageLimit: null,
    technicalWeight: null,
    financialWeight: null,
    clientNameSourcePage: null,
    clientNameSourceQuote: null,
    submissionEmailSourcePage: null,
    submissionEmailSourceQuote: null,
    submissionMethodSourcePage: null,
    submissionMethodSourceQuote: null,
    submissionAddressSourcePage: null,
    submissionAddressSourceQuote: null,
    evaluationCriteriaSource: null,
    procurementReferenceNumber: null,
    clientRepresentative: null,
    preBidChannel: null,
    intakeSummary: null,
    description: null,
    ...overrides,
  } as AIAnalysisResult;
}

describe("mergeContactDetailsSource — via buildCanonicalAnalysisTenderUpdate", () => {
  it("preserves existing fileId when AI re-emits with the SAME quote", () => {
    const existingJson = JSON.stringify({
      procurementReferenceNumber: {
        page: 3,
        quote: "The procurement reference number is REF-2026-001.",
        fileId: "file-abc",
      },
    });
    const aiResult = makeBaseAiResult({
      contactDetailsSource: {
        procurementReferenceNumber: {
          page: 3,
          quote: "The procurement reference number is REF-2026-001.",
          // AI does NOT emit fileId
        },
      } as any,
    });
    const { data } = buildCanonicalAnalysisTenderUpdate(aiResult, {
      existingContactDetailsSourceJson: existingJson,
    });
    const parsed = JSON.parse(data.contactDetailsSourceJson as string);
    assert.equal(
      parsed.procurementReferenceNumber.fileId,
      "file-abc",
      "fileId must be preserved when the quote is unchanged",
    );
    assert.equal(parsed.procurementReferenceNumber.page, 3);
  });

  it("drops existing fileId when AI re-emits with a DIFFERENT quote", () => {
    const existingJson = JSON.stringify({
      procurementReferenceNumber: {
        page: 3,
        quote: "The procurement reference number is REF-2026-001.",
        fileId: "file-abc",
      },
    });
    const aiResult = makeBaseAiResult({
      contactDetailsSource: {
        procurementReferenceNumber: {
          page: 5,
          quote: "Different quote about a different reference number REF-2026-999.",
          // AI does NOT emit fileId
        },
      } as any,
    });
    const { data } = buildCanonicalAnalysisTenderUpdate(aiResult, {
      existingContactDetailsSourceJson: existingJson,
    });
    const parsed = JSON.parse(data.contactDetailsSourceJson as string);
    assert.equal(
      parsed.procurementReferenceNumber.fileId,
      null,
      "fileId must be DROPPED when the quote changes — it was attributed to the OLD quote",
    );
    assert.equal(parsed.procurementReferenceNumber.page, 5);
    assert.equal(
      parsed.procurementReferenceNumber.quote,
      "Different quote about a different reference number REF-2026-999.",
    );
  });

  it("preserves entries AI does NOT re-emit", () => {
    const existingJson = JSON.stringify({
      procurementReferenceNumber: {
        page: 3,
        quote: "The procurement reference number is REF-2026-001.",
        fileId: "file-abc",
      },
      donorAgency: {
        page: 2,
        quote: "Funded by the World Bank.",
        fileId: "file-xyz",
      },
    });
    const aiResult = makeBaseAiResult({
      contactDetailsSource: {
        // AI only re-emits procurementReferenceNumber, NOT donorAgency
        procurementReferenceNumber: {
          page: 3,
          quote: "The procurement reference number is REF-2026-001.",
        },
      } as any,
    });
    const { data } = buildCanonicalAnalysisTenderUpdate(aiResult, {
      existingContactDetailsSourceJson: existingJson,
    });
    const parsed = JSON.parse(data.contactDetailsSourceJson as string);
    // donorAgency entry must be preserved
    assert.ok(parsed.donorAgency, "donorAgency entry must be preserved when AI doesn't re-emit it");
    assert.equal(parsed.donorAgency.fileId, "file-xyz", "donorAgency fileId must be preserved");
    assert.equal(parsed.donorAgency.page, 2);
  });

  it("handles malformed existingJson gracefully", () => {
    const aiResult = makeBaseAiResult({
      contactDetailsSource: {
        procurementReferenceNumber: {
          page: 3,
          quote: "The procurement reference number is REF-2026-001.",
        },
      } as any,
    });
    const { data } = buildCanonicalAnalysisTenderUpdate(aiResult, {
      existingContactDetailsSourceJson: "not valid json {{{",
    });
    const parsed = JSON.parse(data.contactDetailsSourceJson as string);
    // Should not crash, should contain AI's entry
    assert.ok(parsed.procurementReferenceNumber, "AI entry must be present even with malformed existing JSON");
    assert.equal(parsed.procurementReferenceNumber.fileId, null, "fileId must be null when existing JSON is malformed");
  });

  it("handles null existingJson", () => {
    const aiResult = makeBaseAiResult({
      contactDetailsSource: {
        procurementReferenceNumber: {
          page: 3,
          quote: "The procurement reference number is REF-2026-001.",
        },
      } as any,
    });
    const { data } = buildCanonicalAnalysisTenderUpdate(aiResult, {
      existingContactDetailsSourceJson: null,
    });
    const parsed = JSON.parse(data.contactDetailsSourceJson as string);
    assert.ok(parsed.procurementReferenceNumber);
    assert.equal(parsed.procurementReferenceNumber.fileId, null, "fileId must be null when no existing JSON");
  });
});
