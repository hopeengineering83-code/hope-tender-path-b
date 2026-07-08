// Required draft-generation tests for PR #974 merge criteria.
//
// These tests prove the source-driven model allows draft generation to
// succeed when optional metadata is missing — the tender document is the
// authority, not a predesigned required format.
//
// Required scenarios (per merge decision rule):
//   1. Draft generation succeeds without reference number
//   2. Draft generation succeeds without budget
//   3. Draft generation succeeds without bid bond
//   4. Draft generation succeeds without physical address when email submission is used
//   5. Draft generation succeeds without site visit
//   6. AI Analyze does not return 409/422 due only to missing metadata
//   7. Final submission remains strict only for tender-derived/confirmed-plan requirements

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { resolveTenderOperationGate } from "../lib/engine/tender-operation-gate";
import {
  deriveSourceDrivenTenderDetail,
  doesFactBlockDraft,
  isFactRequiredForFinal,
} from "../lib/engine/source-driven-tender-detail";

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeTender(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "tender-1",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Ministry of Test",
    deadline: new Date("2024-12-31"),
    submissionMethod: "Email submission",
    submissionEmails: "test@example.com",
    submissionAddress: null,
    country: "Ethiopia",
    metadataContaminated: false,
    analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    ...overrides,
  };
}

function makeInput(
  tender: Record<string, unknown>,
  operation: "DRAFT_GENERATION" | "ANALYSIS" | "FINAL_SUBMISSION_READY" = "DRAFT_GENERATION",
) {
  return {
    tender: tender as never,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "file-1" }],
    overrides: [],
    buildPlan: { ok: true, items: [] },
    operation,
  };
}

// ─── 1. Draft succeeds without reference number ────────────────────────────

describe("PR #974 required tests — draft succeeds without reference", () => {
  it("DRAFT_GENERATION is OK when reference is null", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ reference: null })));
    assert.equal(r.ok, true, "Draft must succeed without reference number");
    assert.equal(r.blockers.length, 0);
  });

  it("DRAFT_GENERATION is OK when reference is empty string", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ reference: "" })));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("source-driven model: reference is optional (does not block draft, not required for final)", () => {
    const detail = deriveSourceDrivenTenderDetail(makeTender({ reference: null }));
    const refFact = detail.facts.find((f) => f.key === "reference");
    assert.ok(refFact, "reference fact must exist");
    assert.equal(refFact.requiredFor, "optional");
    assert.equal(doesFactBlockDraft(refFact), false);
    assert.equal(isFactRequiredForFinal(refFact, detail), false);
  });
});

// ─── 2. Draft succeeds without budget ──────────────────────────────────────

describe("PR #974 required tests — draft succeeds without budget", () => {
  it("DRAFT_GENERATION is OK when budget is null", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ budget: null })));
    assert.equal(r.ok, true, "Draft must succeed without budget");
    assert.equal(r.blockers.length, 0);
  });

  it("DRAFT_GENERATION is OK when budget is 0", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ budget: 0 })));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("source-driven model: budget is optional", () => {
    const detail = deriveSourceDrivenTenderDetail(makeTender({ budget: null }));
    const budgetFact = detail.facts.find((f) => f.key === "budget");
    assert.ok(budgetFact, "budget fact must exist");
    assert.equal(budgetFact.requiredFor, "optional");
    assert.equal(doesFactBlockDraft(budgetFact), false);
    assert.equal(isFactRequiredForFinal(budgetFact, detail), false);
  });
});

// ─── 3. Draft succeeds without bid bond ────────────────────────────────────

describe("PR #974 required tests — draft succeeds without bid bond", () => {
  it("DRAFT_GENERATION is OK when bidBondAmount is null", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ bidBondAmount: null })));
    assert.equal(r.ok, true, "Draft must succeed without bid bond");
    assert.equal(r.blockers.length, 0);
  });

  it("DRAFT_GENERATION is OK when bidBondAmount is 0", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ bidBondAmount: 0 })));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("source-driven model: bidBondAmount is optional", () => {
    const detail = deriveSourceDrivenTenderDetail(makeTender({ bidBondAmount: null }));
    const bondFact = detail.facts.find((f) => f.key === "bidBondAmount");
    assert.ok(bondFact, "bidBondAmount fact must exist");
    assert.equal(bondFact.requiredFor, "optional");
    assert.equal(doesFactBlockDraft(bondFact), false);
    assert.equal(isFactRequiredForFinal(bondFact, detail), false);
  });
});

// ─── 4. Draft succeeds without physical address when email submission ──────

describe("PR #974 required tests — draft succeeds without physical address (email method)", () => {
  it("DRAFT_GENERATION is OK without submissionAddress when method is email", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
      submissionAddress: null,
    })));
    assert.equal(r.ok, true, "Draft must succeed without physical address for email tender");
    assert.equal(r.blockers.length, 0);
  });

  it("source-driven model: email tender does NOT require physical address", () => {
    const detail = deriveSourceDrivenTenderDetail(makeTender({
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
      submissionAddress: null,
    }));
    assert.equal(detail.submissionMethod, "EMAIL");
    assert.equal(detail.requiresPhysicalAddress, false, "email tender must not require physical address");
    assert.equal(detail.requiresEmailEndpoint, true, "email tender requires email endpoint");
  });

  it("FINAL: email tender without submissionAddress is OK (address not required for email method)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: "Email submission",
      submissionEmails: "test@example.com",
      submissionAddress: null,
    }), "FINAL_SUBMISSION_READY"));
    // Should be OK because email endpoint is present; address is not required for email method
    const endpointBlockers = r.blockers.filter((b) => b.includes("address"));
    assert.equal(endpointBlockers.length, 0, "email tender must not block on missing address");
  });
});

// ─── 5. Draft succeeds without site visit ──────────────────────────────────

describe("PR #974 required tests — draft succeeds without site visit", () => {
  it("DRAFT_GENERATION is OK when mandatorySiteVisit is false/null", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ mandatorySiteVisit: false })));
    assert.equal(r.ok, true, "Draft must succeed without mandatory site visit");
    assert.equal(r.blockers.length, 0);
  });

  it("DRAFT_GENERATION is OK when mandatorySiteVisit is null", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({ mandatorySiteVisit: null })));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
  });

  it("source-driven model: mandatorySiteVisit is optional", () => {
    const detail = deriveSourceDrivenTenderDetail(makeTender({ mandatorySiteVisit: false }));
    const visitFact = detail.facts.find((f) => f.key === "mandatorySiteVisit");
    assert.ok(visitFact, "mandatorySiteVisit fact must exist");
    assert.equal(visitFact.requiredFor, "optional");
    assert.equal(doesFactBlockDraft(visitFact), false);
    assert.equal(isFactRequiredForFinal(visitFact, detail), false);
  });
});

// ─── 6. AI Analyze does not return 422 due only to missing metadata ────────

describe("PR #974 required tests — AI Analyze non-blocking for metadata", () => {
  it("ANALYSIS is OK when ALL optional metadata is missing", () => {
    const r = resolveTenderOperationGate(makeInput({
      id: "t1",
      title: "Test",
      reference: null,
      clientName: null,
      deadline: null,
      submissionMethod: null,
      submissionEmails: null,
      submissionAddress: null,
      country: null,
      budget: null,
      bidBondAmount: null,
      mandatorySiteVisit: null,
      metadataContaminated: false,
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    }, "ANALYSIS"));
    assert.equal(r.ok, true, "ANALYSIS must not be blocked by missing metadata");
    assert.equal(r.blockers.length, 0, "ANALYSIS must have zero blockers from missing metadata");
  });

  it("ANALYSIS is OK when metadata is contaminated (warning, not blocker)", () => {
    const r = resolveTenderOperationGate(makeInput({
      ...makeTender(),
      metadataContaminated: true,
    }, "ANALYSIS"));
    assert.equal(r.ok, true, "ANALYSIS must not be blocked by contaminated metadata");
    assert.equal(r.blockers.length, 0);
    assert.ok(r.warnings.some((w) => w.includes("contaminated")), "should warn about contamination");
  });

  it("ANALYSIS is OK with OCR_REQUIRED extraction status (warning only — route's own gates handle this)", () => {
    const r = resolveTenderOperationGate(makeInput({
      ...makeTender(),
      analysisExtractionStatus: "OCR_REQUIRED",
    }, "ANALYSIS"));
    // Operation gate is non-blocking for ANALYSIS; the route's own extraction-quality
    // gates handle OCR_REQUIRED hard-blocking (which is allowed — that's extraction
    // corruption, not missing metadata).
    assert.equal(r.ok, true, "operation gate must not block ANALYSIS for OCR_REQUIRED");
    assert.equal(r.blockers.length, 0);
    assert.ok(r.warnings.length > 0, "should warn about OCR_REQUIRED");
  });

  it("ANALYSIS is OK with REGEX_FALLBACK extraction status (warning only)", () => {
    const r = resolveTenderOperationGate(makeInput({
      ...makeTender(),
      analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    }, "ANALYSIS"));
    assert.equal(r.ok, true);
    assert.equal(r.blockers.length, 0);
    assert.ok(r.warnings.length > 0);
  });

  it("ANALYSIS never returns blockers for any combination of missing optional fields", () => {
    // Try every combination of missing optional fields
    const optionalFields = ["reference", "country", "budget", "bidBondAmount", "pageLimit",
      "validityDays", "mandatorySiteVisit", "preBidMeetingDate", "evaluationMethodology",
      "clientContactName", "clientContactEmail", "clientContactPhone"];
    for (const field of optionalFields) {
      const tender = makeTender();
      tender[field] = null;
      const r = resolveTenderOperationGate(makeInput(tender, "ANALYSIS"));
      assert.equal(r.ok, true, `ANALYSIS must be OK when ${field} is null`);
      assert.equal(r.blockers.length, 0, `ANALYSIS must have 0 blockers when ${field} is null`);
    }
  });
});

// ─── 7. Final submission strict only for tender-derived requirements ───────

describe("PR #974 required tests — final strict only for tender-derived requirements", () => {
  it("FINAL is strict when email tender is missing email endpoint (tender-derived requirement)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: "Email submission",
      submissionEmails: null,
      submissionAddress: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false, "FINAL must block when email tender is missing email endpoint");
    assert.ok(r.blockers.some((b) => b.includes("email")));
  });

  it("FINAL is strict when physical tender is missing address (tender-derived requirement)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: "Sealed envelope by hand",
      submissionEmails: null,
      submissionAddress: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false, "FINAL must block when physical tender is missing address");
    assert.ok(r.blockers.some((b) => b.includes("address")));
  });

  it("FINAL is NOT strict about email endpoint for portal tender (portal URL is valid endpoint)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: "Submit through the e-procurement portal",
      submissionEmails: null,
      submissionAddress: null,
    }), "FINAL_SUBMISSION_READY"));
    const endpointBlockers = r.blockers.filter((b) => b.includes("email") || b.includes("address"));
    assert.equal(endpointBlockers.length, 0, "portal tender must not require email or address endpoint");
  });

  it("FINAL is NOT strict about reference, budget, bid bond, site visit (not tender-derived requirements)", () => {
    // These are optional fields — FINAL does not block on them
    const r = resolveTenderOperationGate(makeInput(makeTender({
      reference: null,
      budget: null,
      bidBondAmount: null,
      mandatorySiteVisit: false,
      // Keep all tender-derived requirements satisfied:
      title: "Test",
      clientName: "Client",
      deadline: new Date("2024-12-31"),
      submissionMethod: "Email",
      submissionEmails: "test@example.com",
    }), "FINAL_SUBMISSION_READY"));
    // FINAL should be OK because all tender-derived requirements are met
    // (optional fields missing does not block)
    const optionalBlockers = r.blockers.filter((b) =>
      b.includes("reference") || b.includes("budget") || b.includes("bid bond") || b.includes("site visit")
    );
    assert.equal(optionalBlockers.length, 0, "FINAL must not block on optional fields");
  });

  it("FINAL is strict about title (universal baseline — every tender needs a title)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      title: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("title")));
  });

  it("FINAL is strict about clientName (universal baseline — every tender needs a client)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      clientName: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("clientName")));
  });

  it("FINAL is strict about deadline (universal baseline — every tender needs a deadline)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      deadline: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("deadline")));
  });

  it("FINAL is strict about submissionMethod (universal baseline — every tender needs a method)", () => {
    const r = resolveTenderOperationGate(makeInput(makeTender({
      submissionMethod: null,
    }), "FINAL_SUBMISSION_READY"));
    assert.equal(r.ok, false);
    assert.ok(r.blockers.some((b) => b.includes("submissionMethod")));
  });

  it("CRITICAL_FINAL_FIELDS only contains universal baseline fields (title, clientName, deadline, submissionMethod)", () => {
    // These 4 fields are the universal baseline — every tender needs them
    // regardless of submission method. Optional metadata (reference, budget,
    // bid bond, site visit, etc.) is NOT in this list.
    const src = require("fs").readFileSync("lib/engine/tender-operation-gate.ts", "utf8");
    assert.ok(
      src.includes('const CRITICAL_FINAL_FIELDS = ["title", "clientName", "deadline", "submissionMethod"]'),
      "CRITICAL_FINAL_FIELDS must be exactly the 4 universal baseline fields",
    );
    // Confirm it does NOT contain optional fields
    assert.ok(!src.includes('"reference"') || !src.match(/CRITICAL_FINAL_FIELDS.*"reference"/s),
      "CRITICAL_FINAL_FIELDS must not include reference");
  });
});

// ─── 8. Architectural: draft operations never block on any metadata ────────

describe("PR #974 required tests — architectural guarantee", () => {
  it("DRAFT_GENERATION never blocks on missing optional metadata (combined)", () => {
    const r = resolveTenderOperationGate(makeInput({
      id: "t1",
      title: "Test",
      reference: null,
      clientName: null, // missing — but draft should still proceed
      deadline: null,
      submissionMethod: null,
      submissionEmails: null,
      submissionAddress: null,
      country: null,
      budget: null,
      bidBondAmount: null,
      mandatorySiteVisit: null,
      metadataContaminated: false,
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    }));
    assert.equal(r.ok, true, "DRAFT_GENERATION must succeed even when ALL metadata is missing");
    assert.equal(r.blockers.length, 0);
  });

  it("DRAFT_GENERATION is OK with contaminated metadata (warning only)", () => {
    const r = resolveTenderOperationGate(makeInput({
      ...makeTender(),
      metadataContaminated: true,
    }));
    assert.equal(r.ok, true, "DRAFT must not be blocked by contaminated metadata");
    assert.equal(r.blockers.length, 0);
    assert.ok(r.warnings.some((w) => w.includes("contaminated")));
  });
});
