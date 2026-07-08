// Tests for the source-driven tender detail model.
//
// The tender document is the authority. Extracted Tender Detail is the
// single normal tender-fact source. This test suite proves:
//   1. Facts are derived from the tender source, NOT from a universal
//      "always critical" field list.
//   2. Missing optional facts NEVER block draft work (doesFactBlockDraft
//      always returns false).
//   3. Required-for-final status is tender-derived (e.g., email tender
//      requires email endpoint; physical tender requires address).
//   4. Coverage ratio is computed only from relevant facts.
//   5. Submission method is inferred from tender text, not hardcoded.
//   6. Placeholder/invalid values are rejected_invalid, not extracted_valid.
//   7. Source evidence (page + quote) drives confidence levels.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  deriveSourceDrivenTenderDetail,
  isFactRequiredForFinal,
  doesFactBlockDraft,
  type SourceDrivenTenderFact,
  type SourceDrivenTenderDetail,
} from "../lib/engine/source-driven-tender-detail";

// ─── 1. Source-driven — facts come from the tender source ───────────────────

describe("source-driven tender detail — facts come from the source", () => {
  it("derives facts from a tender with email submission method", () => {
    const tender = {
      id: "tender-1",
      title: "Supply of Medical Equipment",
      reference: "MOH/2024/001",
      clientName: "Ministry of Health",
      deadline: new Date("2024-12-31"),
      submissionMethod: "Email submission to procurement@moh.gov.et",
      submissionEmails: "procurement@moh.gov.et",
      submissionAddress: null,
      country: "Ethiopia",
      budget: 500000,
      bidBondAmount: null,
      pageLimit: 50,
      validityDays: 90,
      mandatorySiteVisit: false,
      preBidMeetingDate: null,
      evaluationMethodology: "Technical 70% / Financial 30%",
      clientContactName: "Mr. Abebe",
      clientContactEmail: "abebe@moh.gov.et",
      clientContactPhone: "+251911000000",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);

    assert.equal(detail.tenderId, "tender-1");
    assert.equal(detail.submissionMethod, "EMAIL", "submission method should be inferred as EMAIL");
    assert.equal(detail.requiresEmailEndpoint, true, "email tender requires email endpoint");
    assert.equal(detail.requiresPhysicalAddress, false, "email tender does NOT require physical address");
    assert.equal(detail.requiresDeadline, true, "deadline is always required for final submission");

    // Should have facts for all extracted fields
    const factKeys = detail.facts.map((f) => f.key);
    assert.ok(factKeys.includes("title"), "title fact present");
    assert.ok(factKeys.includes("reference"), "reference fact present");
    assert.ok(factKeys.includes("clientName"), "clientName fact present");
    assert.ok(factKeys.includes("deadline"), "deadline fact present");
    assert.ok(factKeys.includes("submissionMethod"), "submissionMethod fact present");
    assert.ok(factKeys.includes("submissionEmails"), "submissionEmails fact present");
    assert.ok(factKeys.includes("country"), "country fact present");
    assert.ok(factKeys.includes("budget"), "budget fact present");
    assert.ok(factKeys.includes("evaluationMethodology"), "evaluationMethodology fact present");

    // Email tender should not surface a missing submissionAddress (it's not_required)
    const addressFact = detail.facts.find((f) => f.key === "submissionAddress");
    // If address is null + not_required, it is skipped
    if (addressFact) {
      assert.equal(addressFact.requiredFor, "not_required");
    }
  });

  it("derives facts from a tender with physical submission method", () => {
    const tender = {
      id: "tender-2",
      title: "Construction of Road",
      reference: null,
      clientName: "Ethiopian Roads Authority",
      deadline: new Date("2024-11-30"),
      submissionMethod: "Sealed envelope by hand or courier",
      submissionEmails: null,
      submissionAddress: "ERA HQ, Addis Ababa",
      country: "Ethiopia",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);

    assert.equal(detail.submissionMethod, "PHYSICAL");
    assert.equal(detail.requiresPhysicalAddress, true);
    assert.equal(detail.requiresEmailEndpoint, false);

    // Physical tender requires address for final submission
    const addressFact = detail.facts.find((f) => f.key === "submissionAddress");
    assert.ok(addressFact, "submissionAddress fact present");
    assert.equal(addressFact?.requiredFor, "final_submission");
    assert.equal(addressFact?.status, "extracted_valid");

    // Reference is optional
    const refFact = detail.facts.find((f) => f.key === "reference");
    if (refFact) {
      assert.equal(refFact.requiredFor, "optional");
    }
  });

  it("derives facts from a tender with portal submission method", () => {
    const tender = {
      id: "tender-3",
      title: "IT Infrastructure Services",
      reference: "IT/2024/005",
      clientName: "Ministry of Innovation and Technology",
      deadline: new Date("2024-10-15"),
      submissionMethod: "Submit through the e-procurement portal",
      submissionEmails: null,
      submissionAddress: "https://procurement.portal.gov.et",
      country: "Ethiopia",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);

    assert.equal(detail.submissionMethod, "PORTAL");
    assert.equal(detail.requiresEmailEndpoint, false);
    assert.equal(detail.requiresPhysicalAddress, false);

    // Portal tender should not require email OR address
    const emailFact = detail.facts.find((f) => f.key === "submissionEmails");
    // If email is null + optional, it may be present as missing OR skipped
    if (emailFact) {
      assert.equal(emailFact.requiredFor, "optional");
    }
  });

  it("treats UNKNOWN submission method as not requiring any specific endpoint", () => {
    const tender = {
      id: "tender-4",
      title: "Consultancy Services",
      clientName: "World Bank",
      deadline: new Date("2024-09-30"),
      submissionMethod: null,
      submissionEmails: null,
      submissionAddress: null,
    };
    const detail = deriveSourceDrivenTenderDetail(tender);

    assert.equal(detail.submissionMethod, "UNKNOWN");
    assert.equal(detail.requiresEmailEndpoint, false);
    assert.equal(detail.requiresPhysicalAddress, false);
  });
});

// ─── 2. Missing optional facts NEVER block draft work ────────────────────────

describe("source-driven tender detail — draft never blocks on metadata", () => {
  it("doesFactBlockDraft always returns false for missing facts", () => {
    const missingFact: SourceDrivenTenderFact = {
      key: "clientName",
      label: "Client",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "draft_context",
    };
    assert.equal(doesFactBlockDraft(missingFact), false);
  });

  it("doesFactBlockDraft returns false even for missing required-for-final facts", () => {
    const criticalMissingFact: SourceDrivenTenderFact = {
      key: "deadline",
      label: "Deadline",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "final_submission",
    };
    assert.equal(doesFactBlockDraft(criticalMissingFact), false);
  });

  it("doesFactBlockDraft returns false for invalid placeholder values", () => {
    const invalidFact: SourceDrivenTenderFact = {
      key: "clientName",
      label: "Client",
      value: null,
      confidence: "low",
      status: "rejected_invalid",
      requiredFor: "draft_context",
      reason: "Placeholder value",
    };
    assert.equal(doesFactBlockDraft(invalidFact), false);
  });

  it("doesFactBlockDraft returns false for facts marked not_required", () => {
    const notRequiredFact: SourceDrivenTenderFact = {
      key: "submissionAddress",
      label: "Submission Address",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "not_required",
    };
    assert.equal(doesFactBlockDraft(notRequiredFact), false);
  });
});

// ─── 3. Tender-derived required-for-final status ────────────────────────────

describe("source-driven tender detail — required-for-final is tender-derived", () => {
  it("email tender requires submissionEmails for final", () => {
    const detail: SourceDrivenTenderDetail = {
      tenderId: "t1",
      facts: [],
      extractedCount: 0,
      missingRelevantCount: 0,
      notApplicableCount: 0,
      coverageRatio: 1,
      submissionMethod: "EMAIL",
      requiresDeadline: true,
      requiresPhysicalAddress: false,
      requiresEmailEndpoint: true,
      hasPreBidMeeting: false,
      hasBidBond: false,
      hasMandatorySiteVisit: false,
      hasBudget: false,
    };
    const emailFact: SourceDrivenTenderFact = {
      key: "submissionEmails",
      label: "Emails",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "optional",
    };
    assert.equal(isFactRequiredForFinal(emailFact, detail), true);
  });

  it("physical tender requires submissionAddress for final", () => {
    const detail: SourceDrivenTenderDetail = {
      tenderId: "t2",
      facts: [],
      extractedCount: 0,
      missingRelevantCount: 0,
      notApplicableCount: 0,
      coverageRatio: 1,
      submissionMethod: "PHYSICAL",
      requiresDeadline: true,
      requiresPhysicalAddress: true,
      requiresEmailEndpoint: false,
      hasPreBidMeeting: false,
      hasBidBond: false,
      hasMandatorySiteVisit: false,
      hasBudget: false,
    };
    const addressFact: SourceDrivenTenderFact = {
      key: "submissionAddress",
      label: "Address",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "not_required",
    };
    assert.equal(isFactRequiredForFinal(addressFact, detail), true);
  });

  it("deadline is required for final submission", () => {
    const detail: SourceDrivenTenderDetail = {
      tenderId: "t3",
      facts: [],
      extractedCount: 0,
      missingRelevantCount: 0,
      notApplicableCount: 0,
      coverageRatio: 1,
      submissionMethod: "EMAIL",
      requiresDeadline: true,
      requiresPhysicalAddress: false,
      requiresEmailEndpoint: true,
      hasPreBidMeeting: false,
      hasBidBond: false,
      hasMandatorySiteVisit: false,
      hasBudget: false,
    };
    const deadlineFact: SourceDrivenTenderFact = {
      key: "deadline",
      label: "Deadline",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "optional",
    };
    assert.equal(isFactRequiredForFinal(deadlineFact, detail), true);
  });

  it("reference is NOT required for final submission (optional)", () => {
    const detail: SourceDrivenTenderDetail = {
      tenderId: "t4",
      facts: [],
      extractedCount: 0,
      missingRelevantCount: 0,
      notApplicableCount: 0,
      coverageRatio: 1,
      submissionMethod: "EMAIL",
      requiresDeadline: true,
      requiresPhysicalAddress: false,
      requiresEmailEndpoint: true,
      hasPreBidMeeting: false,
      hasBidBond: false,
      hasMandatorySiteVisit: false,
      hasBudget: false,
    };
    const refFact: SourceDrivenTenderFact = {
      key: "reference",
      label: "Reference",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "optional",
    };
    assert.equal(isFactRequiredForFinal(refFact, detail), false);
  });

  it("budget is NOT required for final submission (optional)", () => {
    const detail: SourceDrivenTenderDetail = {
      tenderId: "t5",
      facts: [],
      extractedCount: 0,
      missingRelevantCount: 0,
      notApplicableCount: 0,
      coverageRatio: 1,
      submissionMethod: "EMAIL",
      requiresDeadline: true,
      requiresPhysicalAddress: false,
      requiresEmailEndpoint: true,
      hasPreBidMeeting: false,
      hasBidBond: false,
      hasMandatorySiteVisit: false,
      hasBudget: false,
    };
    const budgetFact: SourceDrivenTenderFact = {
      key: "budget",
      label: "Budget",
      value: null,
      confidence: "low",
      status: "missing",
      requiredFor: "optional",
    };
    assert.equal(isFactRequiredForFinal(budgetFact, detail), false);
  });
});

// ─── 4. Coverage ratio — only counts relevant facts ─────────────────────────

describe("source-driven tender detail — coverage ratio", () => {
  it("coverage is 1.0 when all relevant facts are extracted", () => {
    const tender = {
      id: "t1",
      title: "Test Tender",
      clientName: "Test Client",
      deadline: new Date("2024-12-31"),
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    assert.equal(detail.coverageRatio, 1);
    assert.ok(detail.extractedCount > 0);
    assert.equal(detail.missingRelevantCount, 0);
  });

  it("coverage < 1.0 when a required-for-final fact is missing", () => {
    const tender = {
      id: "t1",
      title: "Test Tender",
      clientName: "Test Client",
      deadline: null,
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    assert.ok(detail.missingRelevantCount >= 1, "deadline should be missing relevant");
    assert.ok(detail.coverageRatio < 1, "coverage should be < 1");
  });

  it("coverage is NOT penalized for missing optional fields", () => {
    const tender = {
      id: "t1",
      title: "Test Tender",
      clientName: "Test Client",
      deadline: new Date("2024-12-31"),
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
      // Missing: reference, country, budget, bidBondAmount, etc.
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    // Optional fields should not count against coverage
    assert.equal(detail.missingRelevantCount, 0);
    assert.equal(detail.coverageRatio, 1);
  });

  it("coverage handles empty tender gracefully (returns 0 when all relevant facts are missing)", () => {
    const tender = { id: "t1" };
    const detail = deriveSourceDrivenTenderDetail(tender);
    // Empty tender: title, clientName, submissionMethod all missing + draft_context
    // deadline is missing + final_submission → all missingRelevant
    // Coverage = 0 / N = 0
    assert.equal(detail.coverageRatio, 0);
    assert.ok(detail.missingRelevantCount > 0, "empty tender has missing relevant facts");
    assert.equal(detail.extractedCount, 0);
  });
});

// ─── 5. Submission method inference ─────────────────────────────────────────

describe("source-driven tender detail — submission method inference", () => {
  it("detects EMAIL from 'email' keyword", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      submissionMethod: "Submit by email",
    });
    assert.equal(detail.submissionMethod, "EMAIL");
  });

  it("detects PORTAL from 'portal' keyword", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      submissionMethod: "Submit through the e-procurement portal",
    });
    assert.equal(detail.submissionMethod, "PORTAL");
  });

  it("detects PHYSICAL from 'sealed envelope' keyword", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      submissionMethod: "Sealed envelope submitted by hand",
    });
    assert.equal(detail.submissionMethod, "PHYSICAL");
  });

  it("detects PHYSICAL from 'courier' keyword", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      submissionMethod: "By courier to the address below",
    });
    assert.equal(detail.submissionMethod, "PHYSICAL");
  });

  it("detects HYBRID from 'hybrid' keyword", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      submissionMethod: "Hybrid submission: email or physical",
    });
    assert.equal(detail.submissionMethod, "HYBRID");
  });

  it("returns UNKNOWN when method is null or unrecognized", () => {
    assert.equal(
      deriveSourceDrivenTenderDetail({ id: "t1", submissionMethod: null }).submissionMethod,
      "UNKNOWN",
    );
    assert.equal(
      deriveSourceDrivenTenderDetail({ id: "t1", submissionMethod: "" }).submissionMethod,
      "UNKNOWN",
    );
    assert.equal(
      deriveSourceDrivenTenderDetail({ id: "t1", submissionMethod: "Send it somehow" }).submissionMethod,
      "UNKNOWN",
    );
  });
});

// ─── 6. Placeholder/invalid values are rejected ─────────────────────────────

describe("source-driven tender detail — placeholder handling", () => {
  it("rejects placeholder clientName as rejected_invalid", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: "TBD",
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.ok(clientFact, "clientName fact present");
    assert.equal(clientFact?.status, "rejected_invalid");
    assert.equal(clientFact?.confidence, "low");
    assert.ok(clientFact?.reason, "reason should be provided");
  });

  it("rejects 'Not specified' as rejected_invalid", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: "Not specified",
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.status, "rejected_invalid");
  });

  it("marks missing values as 'missing' status (not rejected_invalid)", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: null,
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.status, "missing");
  });

  it("counts extracted_valid only for clean values", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: "Ministry of Health",
      submissionMethod: "Email",
      submissionEmails: "proc@moh.gov.et",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.status, "extracted_valid");
    assert.equal(clientFact?.confidence, "medium"); // no source evidence
  });
});

// ─── 7. Source evidence drives confidence ───────────────────────────────────

describe("source-driven tender detail — source evidence drives confidence", () => {
  it("assigns HIGH confidence when sourcePage + sourceQuote are present", () => {
    const tender = {
      id: "t1",
      title: "Test Tender",
      clientName: "Ministry of Health",
      clientNameSourcePage: 3,
      clientNameSourceQuote: "The procuring entity is the Ministry of Health.",
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.status, "extracted_valid");
    assert.equal(clientFact?.confidence, "high");
    assert.equal(clientFact?.sourcePage, 3);
    assert.equal(clientFact?.sourceQuote, "The procuring entity is the Ministry of Health.");
  });

  it("assigns MEDIUM confidence when no source evidence is provided", () => {
    const tender = {
      id: "t1",
      title: "Test Tender",
      clientName: "Ministry of Health",
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.status, "extracted_valid");
    assert.equal(clientFact?.confidence, "medium");
    assert.equal(clientFact?.sourcePage, null);
  });

  it("always assigns LOW confidence to missing or invalid facts", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: null,
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    const clientFact = detail.facts.find((f) => f.key === "clientName");
    assert.equal(clientFact?.confidence, "low");
  });
});

// ─── 8. Tender-derived flags ────────────────────────────────────────────────

describe("source-driven tender detail — tender-derived flags", () => {
  it("detects pre-bid meeting from preBidMeetingDate", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      preBidMeetingDate: new Date("2024-11-01"),
    });
    assert.equal(detail.hasPreBidMeeting, true);
  });

  it("detects pre-bid meeting from preBidMeetingLocation", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      preBidMeetingLocation: "Conference Room A",
    });
    assert.equal(detail.hasPreBidMeeting, true);
  });

  it("detects bid bond from bidBondAmount", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      bidBondAmount: 100000,
    });
    assert.equal(detail.hasBidBond, true);
  });

  it("detects mandatory site visit", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      mandatorySiteVisit: true,
    });
    assert.equal(detail.hasMandatorySiteVisit, true);
  });

  it("detects budget", () => {
    const detail = deriveSourceDrivenTenderDetail({
      id: "t1",
      budget: 500000,
    });
    assert.equal(detail.hasBudget, true);
  });

  it("returns false for all flags on a minimal tender", () => {
    const detail = deriveSourceDrivenTenderDetail({ id: "t1" });
    assert.equal(detail.hasPreBidMeeting, false);
    assert.equal(detail.hasBidBond, false);
    assert.equal(detail.hasMandatorySiteVisit, false);
    assert.equal(detail.hasBudget, false);
  });
});

// ─── 9. Architectural guarantee: NO universal critical list drives draft ────

describe("source-driven tender detail — no universal critical list for draft", () => {
  it("a tender missing all optional fields still derives successfully", () => {
    const tender = {
      id: "t1",
      title: "Minimal Tender",
      clientName: "Client",
      submissionMethod: "Email",
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    // No throw, returns a valid detail
    assert.equal(detail.tenderId, "t1");
    assert.ok(detail.facts.length > 0);
  });

  it("missing optional fields (reference, budget, etc.) do not appear as missingRelevant", () => {
    const tender = {
      id: "t1",
      title: "Test",
      clientName: "Client",
      deadline: new Date("2024-12-31"),
      submissionMethod: "Email",
      submissionEmails: "test@example.com",
      // reference, country, budget, bidBondAmount, pageLimit, validityDays, mandatorySiteVisit,
      // preBidMeetingDate, evaluationMethodology, clientContact* — all missing
    };
    const detail = deriveSourceDrivenTenderDetail(tender);
    // Only required-for-final or draft_context fields count as missingRelevant
    // Optional fields (reference, budget, etc.) are surfaced but not counted
    const missingRelevantKeys = detail.facts
      .filter((f) => f.status === "missing" && (f.requiredFor === "final_submission" || f.requiredFor === "draft_context"))
      .map((f) => f.key);
    // No required facts are missing
    assert.equal(missingRelevantKeys.length, 0, `no missing required facts: ${JSON.stringify(missingRelevantKeys)}`);
    assert.equal(detail.missingRelevantCount, 0);
  });
});
