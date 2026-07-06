/**
 * Tests for the Universal Tender Intelligence foundation modules.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  classifyTender,
  classifyRequirement,
  classifyRequirementMandatory,
  type TenderType,
  type ProcurementStructure,
  type CompanyService,
} from "../lib/engine/tender-classification";
import { buildPageLedger, type PageLedger } from "../lib/engine/page-ledger";
import {
  determineCandidateStatus,
  canAutoConfirm,
  markStale,
  isEvidenceUsable,
  type TenderFactCandidate,
} from "../lib/engine/evidence-candidate";
import {
  classifyTenderRequirement,
  determineUnresolvedReason,
  getMandatoryCategories,
} from "../lib/engine/requirement-categories";

// ─── Tender Classification Tests ────────────────────────────────────────────

describe("tender-classification — classifyTender", () => {
  it("classifies RFP", () => {
    const result = classifyTender("Request for Proposal for Consulting Services");
    assert.equal(result.tenderType, "RFP");
    assert.ok(result.tenderTypeEvidence);
  });

  it("classifies RFQ", () => {
    const result = classifyTender("Request for Quotation for Office Equipment");
    assert.equal(result.tenderType, "RFQ");
  });

  it("classifies EOI", () => {
    const result = classifyTender("Expression of Interest for Design Services");
    assert.equal(result.tenderType, "EOI");
  });

  it("classifies REOI", () => {
    const result = classifyTender("Request for Expression of Interest");
    assert.equal(result.tenderType, "REOI");
  });

  it("classifies ITB", () => {
    const result = classifyTender("Invitation to Bid for Construction Works");
    assert.equal(result.tenderType, "ITB");
  });

  it("classifies prequalification", () => {
    const result = classifyTender("Prequalification of Contractors");
    assert.equal(result.tenderType, "prequalification");
  });

  it("classifies works tender", () => {
    const result = classifyTender("Civil Works Contract for Road Construction");
    assert.equal(result.tenderType, "works");
  });

  it("classifies goods supply", () => {
    const result = classifyTender("Supply of Medical Equipment");
    assert.equal(result.tenderType, "goods");
  });

  it("classifies framework agreement", () => {
    const result = classifyTender("Framework Agreement for Engineering Services");
    assert.equal(result.tenderType, "framework");
  });

  it("returns unknown for unrecognized text", () => {
    const result = classifyTender("Random document with no tender type indicators");
    assert.equal(result.tenderType, "unknown");
  });

  it("classifies separate envelopes", () => {
    const result = classifyTender("Submit in separate envelopes: technical and financial");
    assert.equal(result.procurementStructure, "separate-envelopes");
  });

  it("classifies email submission", () => {
    const result = classifyTender("Submit by email to procurement@example.com");
    assert.equal(result.procurementStructure, "email");
  });

  it("classifies portal submission", () => {
    const result = classifyTender("Submit via the e-procurement portal");
    assert.equal(result.procurementStructure, "portal");
  });

  it("classifies physical submission", () => {
    const result = classifyTender("Submit by hand in sealed envelope");
    assert.equal(result.procurementStructure, "physical");
  });

  it("classifies architecture service", () => {
    const result = classifyTender("Architectural design services for the new building");
    assert.ok(result.companyServices.includes("architecture"));
  });

  it("classifies water sanitation service", () => {
    const result = classifyTender("Water and sanitation engineering consultancy");
    assert.ok(result.companyServices.includes("water-sanitation"));
  });

  it("classifies geotechnical service", () => {
    const result = classifyTender("Geotechnical investigation and soil study");
    assert.ok(result.companyServices.includes("geotechnical"));
  });

  it("classifies multidisciplinary services", () => {
    const result = classifyTender("Multidisciplinary engineering consultancy services");
    assert.ok(result.companyServices.includes("multidisciplinary"));
  });

  it("classifies multiple services", () => {
    const result = classifyTender("Architectural design, structural engineering, and MEP services");
    assert.ok(result.companyServices.includes("architecture"));
    assert.ok(result.companyServices.includes("structural"));
    assert.ok(result.companyServices.includes("mep"));
  });

  it("returns unknown services for unrecognized text", () => {
    const result = classifyTender("Random text with no service indicators");
    assert.ok(result.companyServices.includes("unknown"));
  });

  it("returns confidence based on signal count", () => {
    const result = classifyTender("Request for Proposal for Architectural Services. Submit by email.");
    assert.ok(result.confidence > 0);
    assert.ok(result.confidence <= 1);
  });
});

describe("tender-classification — classifyRequirement", () => {
  it("classifies eligibility requirements", () => {
    assert.equal(classifyRequirement("The bidder must meet eligibility criteria"), "eligibility");
  });

  it("classifies personnel requirements", () => {
    assert.equal(classifyRequirement("Key personnel CVs must be provided"), "personnel");
  });

  it("classifies evaluation criteria", () => {
    assert.equal(classifyRequirement("Evaluation criteria will be used for scoring"), "evaluation-criteria");
  });

  it("classifies bid security", () => {
    assert.equal(classifyRequirement("Bid security of 2% is required"), "bid-security");
  });

  it("returns unknown for unrecognized text", () => {
    assert.equal(classifyRequirement("Random text"), "unknown");
  });
});

describe("tender-classification — classifyRequirementMandatory", () => {
  it("classifies 'must' as mandatory", () => {
    assert.equal(classifyRequirementMandatory("The bidder must submit CVs"), "mandatory");
  });

  it("classifies 'should' as advisory", () => {
    assert.equal(classifyRequirementMandatory("The bidder should provide references"), "advisory");
  });

  it("classifies 'critical' as critical", () => {
    assert.equal(classifyRequirementMandatory("Essential qualifications are listed"), "critical");
  });
});

// ─── Page Ledger Tests ──────────────────────────────────────────────────────

describe("page-ledger — buildPageLedger", () => {
  it("reports 4/7 coverage when 4 of 7 pages are processed", () => {
    const pageStatusJson = JSON.stringify([
      { page: 1, status: "GOOD", charCount: 2000, hasContent: true },
      { page: 2, status: "GOOD", charCount: 1800, hasContent: true },
      { page: 3, status: "WEAK", charCount: 500, hasContent: true },
      { page: 4, status: "GOOD", charCount: 2200, hasContent: true },
    ]);
    const ledger = buildPageLedger(7, pageStatusJson, 85);
    assert.equal(ledger.totalPages, 7);
    assert.equal(ledger.processedPages, 4);
    assert.equal(ledger.coveragePercent, 57);
    assert.deepEqual(ledger.missingPages, [5, 6, 7]);
    assert.equal(ledger.hasMissingPages, true);
    assert.equal(ledger.isSafeForAnalysis, false); // Missing pages → not safe
    assert.ok(ledger.summary.includes("4/7"));
    assert.ok(ledger.summary.includes("57%"));
    assert.ok(ledger.summary.includes("Missing: 5, 6, 7"));
  });

  it("reports 100% coverage when all pages are processed", () => {
    const pageStatusJson = JSON.stringify([
      { page: 1, status: "GOOD", charCount: 2000, hasContent: true },
      { page: 2, status: "GOOD", charCount: 1800, hasContent: true },
    ]);
    const ledger = buildPageLedger(2, pageStatusJson, 90);
    assert.equal(ledger.coveragePercent, 100);
    assert.equal(ledger.missingPages.length, 0);
    assert.equal(ledger.isSafeForAnalysis, true);
  });

  it("reports unknown page count when totalPages is null", () => {
    const ledger = buildPageLedger(null, null, null);
    assert.equal(ledger.hasUnknownPageCount, true);
    assert.equal(ledger.isSafeForAnalysis, false);
    assert.ok(ledger.summary.includes("unknown"));
  });

  it("reports failed pages", () => {
    const pageStatusJson = JSON.stringify([
      { page: 1, status: "GOOD", charCount: 2000, hasContent: true },
      { page: 2, status: "FAILED", charCount: 0, hasContent: false },
    ]);
    const ledger = buildPageLedger(2, pageStatusJson, 30);
    assert.equal(ledger.hasFailedPages, true);
    assert.equal(ledger.isSafeForAnalysis, false); // Failed pages → not safe
  });

  it("reports not safe when extraction score is below threshold", () => {
    const pageStatusJson = JSON.stringify([
      { page: 1, status: "GOOD", charCount: 2000, hasContent: true },
    ]);
    const ledger = buildPageLedger(1, pageStatusJson, 30); // Score 30 < 40
    assert.equal(ledger.isSafeForAnalysis, false);
  });
});

// ─── Evidence Candidate Tests ───────────────────────────────────────────────

describe("evidence-candidate — determineCandidateStatus", () => {
  it("returns GROUNDED when all evidence is present", () => {
    const candidate = {
      field: "clientName",
      candidateType: "regex" as const,
      normalizedValue: "ministry of health",
      originalValue: "Ministry of Health",
      confidence: 0.9,
      tenderFileId: "file-1",
      pageNumber: 1,
      exactQuote: "The Ministry of Health invites sealed bids",
      sourceContentHash: "abc123",
      extractionSource: "regex:inferClientName",
      validationResult: "valid" as const,
      createdAt: new Date(),
    };
    assert.equal(determineCandidateStatus(candidate, 0), "GROUNDED");
  });

  it("returns CANDIDATE when evidence is incomplete", () => {
    const candidate = {
      field: "clientName",
      candidateType: "regex" as const,
      normalizedValue: "ministry of health",
      originalValue: "Ministry of Health",
      confidence: 0.5,
      tenderFileId: null,
      pageNumber: null,
      exactQuote: null,
      sourceContentHash: null,
      extractionSource: "regex",
      validationResult: "valid" as const,
      createdAt: new Date(),
    };
    assert.equal(determineCandidateStatus(candidate, 0), "CANDIDATE");
  });

  it("returns NEEDS_REVIEW when competing candidates exist", () => {
    const candidate = {
      field: "clientName",
      candidateType: "regex" as const,
      normalizedValue: "ministry of health",
      originalValue: "Ministry of Health",
      confidence: 0.9,
      tenderFileId: "file-1",
      pageNumber: 1,
      exactQuote: "The Ministry of Health invites sealed bids",
      sourceContentHash: "abc123",
      extractionSource: "regex",
      validationResult: "valid" as const,
      createdAt: new Date(),
    };
    assert.equal(determineCandidateStatus(candidate, 1), "NEEDS_REVIEW");
  });

  it("returns REJECTED for invalid values", () => {
    const candidate = {
      field: "clientName",
      candidateType: "regex" as const,
      normalizedValue: "tbd",
      originalValue: "TBD",
      confidence: 0.1,
      tenderFileId: null,
      pageNumber: null,
      exactQuote: null,
      sourceContentHash: null,
      extractionSource: "regex",
      validationResult: "placeholder" as const,
      createdAt: new Date(),
    };
    assert.equal(determineCandidateStatus(candidate, 0), "REJECTED");
  });
});

describe("evidence-candidate — canAutoConfirm", () => {
  it("auto-confirms grounded, high-confidence, non-competing candidates", () => {
    const candidate: TenderFactCandidate = {
      field: "clientName",
      candidateType: "regex",
      normalizedValue: "ministry of health",
      originalValue: "Ministry of Health",
      status: "GROUNDED",
      confidence: 0.9,
      tenderFileId: "file-1",
      pageNumber: 1,
      exactQuote: "The Ministry of Health invites sealed bids",
      sourceContentHash: "abc123",
      extractionSource: "regex",
      validationResult: "valid",
      hasCompetingCandidates: false,
      createdAt: new Date(),
      isStale: false,
    };
    assert.equal(canAutoConfirm(candidate, 0), true);
  });

  it("does not auto-confirm when confidence is too low", () => {
    const candidate: TenderFactCandidate = {
      field: "clientName",
      candidateType: "regex",
      normalizedValue: "ministry of health",
      originalValue: "Ministry of Health",
      status: "GROUNDED",
      confidence: 0.5,
      tenderFileId: "file-1",
      pageNumber: 1,
      exactQuote: "The Ministry of Health invites sealed bids",
      sourceContentHash: "abc123",
      extractionSource: "regex",
      validationResult: "valid",
      hasCompetingCandidates: false,
      createdAt: new Date(),
      isStale: false,
    };
    assert.equal(canAutoConfirm(candidate, 0), false);
  });
});

describe("evidence-candidate — isEvidenceUsable", () => {
  it("returns true when all checks pass", () => {
    const result = isEvidenceUsable(
      { tenderFileId: "file-1", pageNumber: 1, exactQuote: "Ministry of Health", sourceContentHash: "abc" },
      new Set(["file-1"]),
      10,
      "The Ministry of Health invites sealed bids for the project",
      "abc",
    );
    assert.equal(result, true);
  });

  it("returns false when file is not active", () => {
    const result = isEvidenceUsable(
      { tenderFileId: "file-deleted", pageNumber: 1, exactQuote: "Ministry of Health", sourceContentHash: "abc" },
      new Set(["file-1"]),
      10,
      "The Ministry of Health invites sealed bids",
      "abc",
    );
    assert.equal(result, false);
  });

  it("returns false when page is outside range", () => {
    const result = isEvidenceUsable(
      { tenderFileId: "file-1", pageNumber: 99, exactQuote: "Ministry of Health", sourceContentHash: "abc" },
      new Set(["file-1"]),
      10,
      "The Ministry of Health invites sealed bids",
      "abc",
    );
    assert.equal(result, false);
  });

  it("returns false when quote is not in extracted text", () => {
    const result = isEvidenceUsable(
      { tenderFileId: "file-1", pageNumber: 1, exactQuote: "Non-existent quote text here", sourceContentHash: "abc" },
      new Set(["file-1"]),
      10,
      "The Ministry of Health invites sealed bids",
      "abc",
    );
    assert.equal(result, false);
  });

  it("returns false when content hash doesn't match", () => {
    const result = isEvidenceUsable(
      { tenderFileId: "file-1", pageNumber: 1, exactQuote: "Ministry of Health", sourceContentHash: "old-hash" },
      new Set(["file-1"]),
      10,
      "The Ministry of Health invites sealed bids",
      "new-hash",
    );
    assert.equal(result, false);
  });
});

// ─── Requirement Categories Tests ───────────────────────────────────────────

describe("requirement-categories — classifyTenderRequirement", () => {
  it("classifies and links to proposal section", () => {
    const result = classifyTenderRequirement("The bidder must provide key personnel CVs");
    assert.equal(result.category, "personnel");
    assert.equal(result.mandatory, "mandatory");
    assert.equal(result.linkedProposalSection, "Section C: Key Personnel & CVs");
  });

  it("classifies financial requirements", () => {
    const result = classifyTenderRequirement("Financial proposal must include a price schedule");
    assert.equal(result.category, "financial-requirements");
    assert.equal(result.linkedProposalSection, "Section D: Financial Proposal");
  });

  it("returns null proposal section for evaluation criteria", () => {
    const result = classifyTenderRequirement("Evaluation criteria will be used for scoring");
    assert.equal(result.category, "evaluation-criteria");
    assert.equal(result.linkedProposalSection, null);
  });
});

describe("requirement-categories — determineUnresolvedReason", () => {
  it("returns null for advisory requirements", () => {
    const classification = { category: "eligibility" as const, mandatory: "advisory" as const, linkedProposalSection: null, linkedCompanyEvidence: null, unresolvedReason: null };
    assert.equal(determineUnresolvedReason(classification, false), null);
  });

  it("returns company-evidence-missing for mandatory without evidence", () => {
    const classification = { category: "personnel" as const, mandatory: "mandatory" as const, linkedProposalSection: null, linkedCompanyEvidence: null, unresolvedReason: null };
    assert.equal(determineUnresolvedReason(classification, false), "company-evidence-missing");
  });

  it("returns null for mandatory with evidence", () => {
    const classification = { category: "personnel" as const, mandatory: "mandatory" as const, linkedProposalSection: null, linkedCompanyEvidence: null, unresolvedReason: null };
    assert.equal(determineUnresolvedReason(classification, true), null);
  });
});

describe("requirement-categories — getMandatoryCategories", () => {
  it("returns the list of mandatory categories", () => {
    const categories = getMandatoryCategories();
    assert.ok(categories.includes("eligibility"));
    assert.ok(categories.includes("personnel"));
    assert.ok(categories.includes("methodology"));
    assert.ok(categories.includes("financial-requirements"));
    assert.ok(categories.length >= 10);
  });
});
