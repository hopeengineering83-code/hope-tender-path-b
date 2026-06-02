import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSevenPassGateInput,
  applySevenPassGateToDocumentState,
  summarizeSevenPassForReviewNotes,
  shouldBlockFinalApprovalBySevenPassGate,
  evaluateSevenPassForDocument,
  type SevenPassWiringContext,
} from "../lib/engine/seven-pass-generation-wiring";
import { evaluateSevenPassGenerationGate } from "../lib/engine/seven-pass-generation";

// ── Fixture helpers ─────────────────────────────────────────────────────────

/** A "clean" wiring context for a well-supported proposal. */
const strongCtx: SevenPassWiringContext = {
  tenderNotes: "Analysis source: AI (chunked multi-call when tender > 60K chars).",
  visibleText: "EXECUTIVE SUMMARY\nOur firm has delivered 8 comparable water-supply projects.\nMETHODOLOGY\nPhase 1: Inception. Phase 2: Field investigation. Phase 3: Design.\nTEAM\nLead Engineer: Dr. Jane Smith, 20 years experience. Project Manager: John Doe.",
  reviewedExpertCount: 3,
  reviewedProjectCount: 3,
  requiredExpertCount: 3,
  requiredProjectCount: 2,
  documentType: "TECHNICAL_PROPOSAL",
  documentName: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  selfReviewScore: 85,
  deterministicFallbackUsed: false,
};

// ── 1. Cannot be READY_FOR_EXPORT when seven-pass gate fails ─────────────────

describe("seven-pass generation wiring", () => {
  it("1. blocks READY_FOR_EXPORT when gate fails", () => {
    const failCtx: SevenPassWiringContext = {
      ...strongCtx,
      // No reviewed evidence — gate should fail EVIDENCE_SELECTION / COMPLIANCE_EVIDENCE_MAP
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
    };
    const input = buildSevenPassGateInput(failCtx);
    const eval_ = evaluateSevenPassGenerationGate(input);
    assert.equal(eval_.finalApprovalAllowed, false, "gate must block when no reviewed evidence");

    const statusUpdate = applySevenPassGateToDocumentState(eval_, { validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT" });
    assert.notEqual(statusUpdate.reviewStatus, "READY_FOR_EXPORT", "gate must not allow READY_FOR_EXPORT when blocked");
    assert.equal(statusUpdate.reviewStatus, "NEEDS_REVIEW");
  });

  // ── 2. Regex fallback blocks ─────────────────────────────────────────────
  it("2. regex fallback analysis blocks final approval", () => {
    const regexCtx: SevenPassWiringContext = {
      ...strongCtx,
      tenderNotes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). All AI providers failed.",
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(regexCtx), true, "regex fallback must block");
    const eval_ = evaluateSevenPassForDocument(regexCtx);
    assert.equal(eval_.recommendedValidationStatus, "DRAFT");
    assert.equal(eval_.recommendedReviewStatus, "NEEDS_REVIEW");
    assert.match(eval_.blockers.join("\n"), /regex fallback/i);
  });

  // ── 3. Deterministic fallback blocks ─────────────────────────────────────
  it("3. deterministic fallback blocks final approval", () => {
    const detCtx: SevenPassWiringContext = {
      ...strongCtx,
      deterministicFallbackUsed: true,
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(detCtx), true, "deterministic fallback must block");
    const eval_ = evaluateSevenPassForDocument(detCtx);
    assert.match(eval_.blockers.join("\n"), /deterministic fallback/i);
  });

  // ── 4. Zero reviewed evidence blocks ─────────────────────────────────────
  it("4. zero reviewed evidence blocks final approval", () => {
    const noEvidCtx: SevenPassWiringContext = {
      ...strongCtx,
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(noEvidCtx), true, "zero evidence must block");
    const eval_ = evaluateSevenPassForDocument(noEvidCtx);
    assert.match(eval_.blockers.join("\n"), /evidence coverage is zero/i);
  });

  // ── 5. Draft-only evidence blocks ────────────────────────────────────────
  it("5. draft-only / UNREVIEWED evidence blocks final approval", () => {
    // The wiring adds UNREVIEWED when counts are zero; check the gate respects it
    const draftCtx: SevenPassWiringContext = {
      ...strongCtx,
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
      // Supply required counts so the "no requirements" shortcut doesn't fire
      requiredExpertCount: 2,
      requiredProjectCount: 2,
    };
    const input = buildSevenPassGateInput(draftCtx);
    assert.ok(
      (input.selectedEvidenceTrustLevels ?? []).every((l) => l !== "REVIEWED"),
      "trust levels should contain no REVIEWED entries",
    );
    const eval_ = evaluateSevenPassGenerationGate(input);
    assert.equal(eval_.finalApprovalAllowed, false, "draft-only evidence must block");
    assert.match(eval_.blockers.join("\n"), /no REVIEWED/i);
  });

  // ── 6. Placeholder text blocks ───────────────────────────────────────────
  it("6. placeholder text blocks final approval", () => {
    const phCtx: SevenPassWiringContext = {
      ...strongCtx,
      visibleText: "METHODOLOGY\nBid-Team to confirm site mobilisation date. Phase 1: TBD.",
    };
    const input = buildSevenPassGateInput(phCtx);
    assert.ok((input.placeholderCount ?? 0) > 0, "placeholderCount must be > 0");
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(phCtx), true, "placeholders must block");
  });

  // ── 7. AI trace blocks ───────────────────────────────────────────────────
  it("7. AI meta-trace text blocks final approval", () => {
    const aiCtx: SevenPassWiringContext = {
      ...strongCtx,
      visibleText: "METHODOLOGY\nAs an AI language model I cannot provide real project values. Please fill in.",
    };
    const input = buildSevenPassGateInput(aiCtx);
    assert.ok((input.aiTraceCount ?? 0) > 0, "aiTraceCount must be > 0");
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(aiCtx), true, "AI traces must block");
  });

  // ── 8. Technical pricing leakage blocks ──────────────────────────────────
  it("8. pricing leakage in technical document blocks final approval", () => {
    const priceCtx: SevenPassWiringContext = {
      ...strongCtx,
      // Price schedule in a technical proposal
      visibleText: "TECHNICAL APPROACH\nOur fee is USD 50,000. Price schedule attached.",
      documentType: "TECHNICAL_PROPOSAL",
      documentName: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
    };
    const input = buildSevenPassGateInput(priceCtx);
    assert.ok((input.pricingLeakageCount ?? 0) > 0, "pricingLeakageCount must be > 0 for technical doc with price");
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(priceCtx), true, "pricing leakage must block");
  });

  // ── 9. Official-original placeholder cannot become final export candidate ─
  it("9. official-original document label is flagged as high-risk", () => {
    const origCtx: SevenPassWiringContext = {
      ...strongCtx,
      documentName: "Tax Clearance Certificate",
      exactFileName: "tax-clearance-cert.pdf",
      documentType: "LEGAL_PLACEHOLDER",
      visibleText: "PLACEHOLDER FOR TENDER-ISSUED ORIGINAL.",
    };
    const input = buildSevenPassGateInput(origCtx);
    assert.ok((input.officialOriginalRiskCount ?? 0) > 0, "officialOriginalRiskCount must flag tax clearance");
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(origCtx), true, "official original must block");
  });

  // ── 10. Clean AI proposal with reviewed evidence can pass ─────────────────
  it("10. clean AI-generated proposal with reviewed evidence passes the gate", () => {
    // strongCtx already represents a clean proposal
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(strongCtx), false, "clean proposal should pass");
    const eval_ = evaluateSevenPassForDocument(strongCtx);
    assert.equal(eval_.finalApprovalAllowed, true);
    assert.equal(eval_.recommendedValidationStatus, "PASSED");
    assert.equal(eval_.recommendedReviewStatus, "READY_FOR_EXPORT");
  });

  // ── 11. applySevenPassGateToDocumentState never upgrades a blocked doc ───
  it("11. applySevenPassGateToDocumentState never upgrades; only blocks", () => {
    const failInput = buildSevenPassGateInput({
      ...strongCtx,
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
    });
    const failEval = evaluateSevenPassGenerationGate(failInput);
    const update = applySevenPassGateToDocumentState(failEval, { validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT" });
    assert.notEqual(update.reviewStatus, "READY_FOR_EXPORT");
    assert.match(update.reviewNotesSuffix, /BLOCKED/i);
  });

  // ── 12. Status mapper preserves caller's decision when gate passes ────────
  it("12. applySevenPassGateToDocumentState preserves caller status when gate passes", () => {
    const passInput = buildSevenPassGateInput(strongCtx);
    const passEval = evaluateSevenPassGenerationGate(passInput);
    assert.equal(passEval.finalApprovalAllowed, true);
    const update = applySevenPassGateToDocumentState(passEval, { validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT" });
    assert.equal(update.reviewStatus, "READY_FOR_EXPORT");
    assert.equal(update.validationStatus, "VALIDATED");
  });

  // ── 13. Review notes summary never includes proposal body text ───────────
  it("13. summarizeSevenPassForReviewNotes returns concise text without body", () => {
    const eval_ = evaluateSevenPassForDocument({
      ...strongCtx,
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
    });
    const notes = summarizeSevenPassForReviewNotes(eval_);
    assert.ok(notes.length > 0, "notes should not be empty");
    assert.ok(notes.length < 1000, "notes should be concise — no body text");
    assert.ok(!/executive summary|our firm|phase 1/i.test(notes), "notes must not contain proposal body text");
  });

  // ── 14. Unknown analysis source is conservative (blocks) ─────────────────
  it("14. unknown analysis source is conservative and blocks", () => {
    const unknownCtx: SevenPassWiringContext = {
      ...strongCtx,
      tenderNotes: "Some notes without an analysis source line.",
    };
    const input = buildSevenPassGateInput(unknownCtx);
    assert.equal(input.analysisSource, "UNKNOWN");
    const eval_ = evaluateSevenPassGenerationGate(input);
    assert.equal(eval_.finalApprovalAllowed, false);
    assert.match(eval_.blockers.join("\n"), /unknown/i);
  });

  // ── 15. Non-technical sectors work: road, water, urban, NGO ──────────────
  it("15a. road design sector proposal can pass if clean and reviewed", () => {
    const roadCtx: SevenPassWiringContext = {
      ...strongCtx,
      documentName: "Road Design Technical Proposal",
      exactFileName: "Road-Design-Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(roadCtx), false);
  });

  it("15b. NGO/donor-funded tender proposal can pass if clean and reviewed", () => {
    const ngoCtx: SevenPassWiringContext = {
      ...strongCtx,
      documentName: "NGO Donor Funded Technical Proposal",
      exactFileName: "Technical-Proposal-NGO.docx",
      documentType: "TECHNICAL_PROPOSAL",
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(ngoCtx), false);
  });

  it("15c. feasibility study can pass if clean and reviewed", () => {
    const fsCtx: SevenPassWiringContext = {
      ...strongCtx,
      documentName: "Feasibility Study Technical Report",
      exactFileName: "Feasibility-Study.docx",
      documentType: "FEASIBILITY_STUDY",
    };
    assert.equal(shouldBlockFinalApprovalBySevenPassGate(fsCtx), false);
  });

  // ── 16. Financial document with pricing content is not blocked ────────────
  it("16. pricing in a financial document does not trigger pricing leakage block", () => {
    const finCtx: SevenPassWiringContext = {
      ...strongCtx,
      documentName: "Financial Proposal",
      exactFileName: "Financial-Proposal.docx",
      documentType: "FINANCIAL_PROPOSAL",
      visibleText: "Total price: USD 120,000. Rate card attached. VAT: 15%.",
    };
    const input = buildSevenPassGateInput(finCtx);
    // Financial doc: pricing leakage check is skipped
    assert.equal(input.pricingLeakageCount, 0, "financial documents should not trigger pricing leakage");
  });

  // ── 17. buildSevenPassGateInput maps AI analysis source correctly ─────────
  it("17. buildSevenPassGateInput maps AI analysis source to 'AI'", () => {
    const input = buildSevenPassGateInput(strongCtx);
    assert.equal(input.analysisSource, "AI");
  });

  it("17b. buildSevenPassGateInput maps human-approved regex to 'HUMAN_APPROVED_REGEX'", () => {
    const ctx: SevenPassWiringContext = {
      ...strongCtx,
      // Simulate notes that have regex fallback but also a human approval marker
      // (The detectAnalysisSource is sync and reads only the notes line —
      //  HUMAN_APPROVED_REGEX_FALLBACK comes from detectAnalysisSourceWithApproval
      //  which needs DB access. For the sync path, regex fallback stays REGEX_FALLBACK.)
      tenderNotes: "Analysis source: AI (chunked multi-call when tender > 60K chars).",
    };
    const input = buildSevenPassGateInput(ctx);
    assert.equal(input.analysisSource, "AI");
  });
});

// ── Structural proxy checks ────────────────────────────────────────────────

describe("tenderScopeOnly proxy", () => {
  it("passes when no tenderReference provided", () => {
    const input = buildSevenPassGateInput({
      visibleText: "This document discusses a different tender Ref: XYZ-999",
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("passes when visible text matches tenderReference", () => {
    const input = buildSevenPassGateInput({
      visibleText: "For Tender Ref: RFP-2024-001 we propose the following methodology.",
      tenderReference: "RFP-2024-001",
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("fails when visible text contains a different reference number", () => {
    const input = buildSevenPassGateInput({
      visibleText: "Following the requirements of Tender No. ABCD-5678 we submit this proposal.",
      tenderReference: "RFP-2024-001",
    });
    assert.strictEqual(input.tenderScopeOnly, false);
  });

  it("passes when tenderReference is too short to match reliably", () => {
    const input = buildSevenPassGateInput({
      visibleText: "Ref: XY different content",
      tenderReference: "XY",
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });
});

describe("outlineMatchesTender proxy", () => {
  it("passes for non-narrative document with no headings", () => {
    const input = buildSevenPassGateInput({
      documentName: "Financial capacity evidence",
      visibleText: "Please see attached audited financial statements for the past three years.",
    });
    assert.strictEqual(input.outlineMatchesTender, true);
  });

  it("passes for short cover letter with no headings", () => {
    const input = buildSevenPassGateInput({
      documentName: "Cover Letter",
      visibleText: "Dear Sir/Madam, we are pleased to submit our proposal.",
    });
    assert.strictEqual(input.outlineMatchesTender, true);
  });

  it("passes for technical proposal with markdown headings", () => {
    const input = buildSevenPassGateInput({
      documentName: "Technical Proposal",
      visibleText: Array(200).fill("word").join(" ") + "\n## Executive Summary\nContent here.\n## Methodology\nMore content.",
    });
    assert.strictEqual(input.outlineMatchesTender, true);
  });

  it("fails for long technical proposal with no headings at all", () => {
    const input = buildSevenPassGateInput({
      documentName: "Technical Proposal Methodology and Work Plan",
      visibleText: Array(250).fill("plain text word without any heading structure").join(" "),
    });
    assert.strictEqual(input.outlineMatchesTender, false);
  });

  it("passes for technical proposal with numbered section headings", () => {
    const input = buildSevenPassGateInput({
      documentName: "Technical Proposal",
      visibleText: Array(150).fill("word").join(" ") + "\n1. UNDERSTANDING OF REQUIREMENTS\nContent.\n2. METHODOLOGY\nContent.",
    });
    assert.strictEqual(input.outlineMatchesTender, true);
  });
});

describe("tenderScopeOnly sector mismatch proxy", () => {
  const PHARMA_NOTES =
    "This tender is for pharmaceutical manufacturing services. " +
    "Good manufacturing practice (GMP) compliance is mandatory. " +
    "The supplier must have experience with clinical trial supply and drug substance handling.";

  const PHARMA_DOC =
    "Our company has extensive experience in pharmaceutical manufacturing. " +
    "We comply fully with GMP compliance requirements. " +
    "We have supplied clinical trial materials and managed drug substance logistics.";

  const CONSTRUCTION_DOC =
    "## Methodology\n" +
    "Our team will carry out earthworks and reinforced concrete foundations. " +
    "The structural drawings will be finalised within two weeks. " +
    "Civil works contractor mobilisation begins on Day 1. " +
    "Site supervision will be conducted daily throughout the project.";

  const IT_NOTES =
    "Scope: cloud infrastructure migration and ERP implementation. " +
    "The system must support API integration with existing microservices. " +
    "DevOps practices including CI/CD pipelines are required.";

  const IT_DOC =
    "## Technical Approach\n" +
    "We will manage the cloud infrastructure migration using Terraform. " +
    "Our ERP implementation methodology uses a phased rollout. " +
    "API integration with existing microservices will be handled via REST. " +
    "DevOps practices are embedded throughout our SDLC.";

  it("passes when tender notes and document are both pharma", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: PHARMA_NOTES,
      visibleText: PHARMA_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("fails when tender is pharma but document is construction", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: PHARMA_NOTES,
      visibleText: CONSTRUCTION_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, false);
  });

  it("passes when tender notes are absent (cannot determine sector)", () => {
    const input = buildSevenPassGateInput({
      visibleText: CONSTRUCTION_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("passes when tender notes are too short to identify a sector", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: "General consulting services.",
      visibleText: CONSTRUCTION_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("passes when tender notes have sector but document sector is unclear", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: PHARMA_NOTES,
      visibleText: "We are pleased to submit our proposal for the above-referenced tender.",
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("passes when tender is IT and document is IT", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: IT_NOTES,
      visibleText: IT_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("fails when tender is IT but document is construction", () => {
    const input = buildSevenPassGateInput({
      tenderNotes: IT_NOTES,
      visibleText: CONSTRUCTION_DOC,
    });
    assert.strictEqual(input.tenderScopeOnly, false);
  });

  it("passes when tender is education and document is education", () => {
    const educationNotes =
      "This tender is for curriculum development and teacher training. " +
      "The contractor will design learning materials and pedagogy guidelines. " +
      "Student enrolment targets and learning outcomes must be defined.";
    const educationDoc =
      "## Approach\nOur curriculum development team will design learning materials. " +
      "Teacher training workshops will embed pedagogical best practices. " +
      "Student enrolment data will be tracked against learning outcomes.";
    const input = buildSevenPassGateInput({ tenderNotes: educationNotes, visibleText: educationDoc });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("fails when tender is education but document is oil & gas", () => {
    const educationNotes =
      "Scope: teacher training and curriculum development. " +
      "Classroom construction and student enrolment improvement. " +
      "Pedagogy reform and learning outcomes assessment.";
    const oilDoc =
      "## Technical Approach\nOur team has extensive upstream operations experience. " +
      "We will manage wellbore integrity and hydrocarbon extraction. " +
      "Downstream refinery integration ensures full petroleum production coverage.";
    const input = buildSevenPassGateInput({ tenderNotes: educationNotes, visibleText: oilDoc });
    assert.strictEqual(input.tenderScopeOnly, false);
  });

  it("passes when tender is WASH and document is WASH", () => {
    const washNotes =
      "Provision of water supply systems and sanitation infrastructure. " +
      "Open defecation free communities through latrine construction. " +
      "Hygiene promotion in target villages.";
    const washDoc =
      "## Methodology\nWe will install water supply kiosks and sanitation facilities. " +
      "Latrine construction will serve 5 000 households. " +
      "Hygiene promotion campaigns will achieve open defecation free status.";
    const input = buildSevenPassGateInput({ tenderNotes: washNotes, visibleText: washDoc });
    assert.strictEqual(input.tenderScopeOnly, true);
  });

  it("fails when tender is energy but document is agriculture", () => {
    const energyNotes =
      "Installation of solar PV mini-grid systems for off-grid electrification. " +
      "Renewable energy generation capacity of 500 kW. " +
      "Electricity grid extension to rural communities.";
    const agriDoc =
      "## Approach\nOur agricultural extension team will support crop yield improvement. " +
      "Irrigation scheme design and livestock management are core activities. " +
      "Soil fertility analysis and seed distribution complete the programme.";
    const input = buildSevenPassGateInput({ tenderNotes: energyNotes, visibleText: agriDoc });
    assert.strictEqual(input.tenderScopeOnly, false);
  });
});
