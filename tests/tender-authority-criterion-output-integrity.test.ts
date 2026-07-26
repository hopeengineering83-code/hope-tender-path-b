// Load-bearing regression tests for the tender-authority, criterion, and
// client-output integrity work.
//
// Each test FAILS before the fix and PASSES after. These tests encode the
// acceptance requirements from the task spec.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  PHARO_ACCEPTANCE_FIXTURE,
  PHARO_TITLE,
  PHARO_CLIENT,
  PHARO_DEADLINE_ISO,
  PHARO_DEADLINE_DISPLAY,
  PHARO_SUBMISSION_EMAILS,
  PHARO_EMAIL_SUBJECT,
  PHARO_REQUIRED_DELIVERABLE,
  PHARO_FINANCIAL_PROPOSAL_REQUIRED,
  PHARO_TENDER_REFERENCE,
  PHARO_PHYSICAL_ADDRESS,
  PHARO_PROPOSAL_VALIDITY,
  PHARO_EVALUATION_CRITERIA,
  PHARO_SCOPE_WORKSTREAMS,
  PHARO_DISCIPLINES,
  PHARO_APPENDICES,
  findPharoClientContentViolations,
  isPharoDeadlineCorrect,
  isPharoEmailsCorrect,
} from "../lib/engine/pharo-acceptance-fixture";
import {
  classifyExtractedFact,
  isNotStatedPhrase,
  isConditionalPhrase,
  isLabelValue,
  isOptionalFactField,
  isSubmissionCriticalFactField,
} from "../lib/engine/fact-extraction-phrase-classifier";
import {
  assignWeightStatus,
  hasValidWeightAssignment,
  evaluateCriterionCoverage,
  blocksFinalExport as criterionBlocksFinalExport,
  MANDATORY_HEALTHCARE_CRITERIA,
} from "../lib/engine/criterion-coverage-model";
import {
  isDisciplineSatisfied,
  validateCrosswalk,
  SIX_SCOPE_WORKSTREAMS,
  FOURTEEN_HEALTHCARE_DISCIPLINES,
  MANDATORY_NAMED_EXPERT_DISCIPLINES,
} from "../lib/engine/scope-discipline-crosswalk";
import {
  validateAppendixReferences,
  DEFAULT_APPENDIX_REGISTER,
  findAppendixReferences,
  appendixViolationsBlockFinalExport,
} from "../lib/engine/appendix-authority-register";
import {
  sanitizeClientOutput,
  findInternalTermViolations,
  verifyFinalisationOrder,
  FORBIDDEN_INTERNAL_PATTERNS,
  FINALISATION_ORDER,
} from "../lib/engine/client-output-separation";
import {
  validateConsistency,
  detectConflictingDeadlines,
  detectSubmissionMethodContradictions,
  detectUnnamedMandatorySpecialists,
  consistencyViolationsBlockFinalExport,
} from "../lib/engine/cross-source-consistency-validator";
import {
  computeClientQualityScore,
  scoreSectionCompleteness,
  scoreAbsenceOfInternalNotes,
} from "../lib/engine/client-quality-scoring";

// ─── 1. Pharo acceptance fixture ────────────────────────────────────────────

describe("Pharo acceptance fixture — authoritative facts", () => {
  it("has the exact title", () => {
    assert.equal(
      PHARO_TITLE,
      "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
    );
  });

  it("has Pharo Ventures as the client", () => {
    assert.equal(PHARO_CLIENT, "Pharo Ventures");
  });

  it("has the exact August 25, 2026 deadline with Addis Ababa Time", () => {
    assert.ok(isPharoDeadlineCorrect(PHARO_DEADLINE_ISO));
    assert.match(PHARO_DEADLINE_DISPLAY, /August 25, 2026/);
    assert.match(PHARO_DEADLINE_DISPLAY, /5:00 PM/);
    assert.match(PHARO_DEADLINE_DISPLAY, /Addis Ababa/i);
  });

  it("has exactly two submission emails", () => {
    assert.equal(PHARO_SUBMISSION_EMAILS.length, 2);
    assert.ok(isPharoEmailsCorrect([...PHARO_SUBMISSION_EMAILS]));
    assert.ok(PHARO_SUBMISSION_EMAILS.includes("edessalegn@pharoventures.com"));
    assert.ok(PHARO_SUBMISSION_EMAILS.includes("fgetachewdesta@pharoventures.com"));
  });

  it("has the exact email subject", () => {
    assert.equal(PHARO_EMAIL_SUBJECT, "Technical Proposal for Pharo Ventures");
  });

  it("has Technical Proposal.pdf as the required deliverable", () => {
    assert.equal(PHARO_REQUIRED_DELIVERABLE, "Technical Proposal.pdf");
  });

  it("does NOT require a financial proposal", () => {
    assert.equal(PHARO_FINANCIAL_PROPOSAL_REQUIRED, false);
  });

  it("has null tender reference (not provided)", () => {
    assert.equal(PHARO_TENDER_REFERENCE, null);
  });

  it("has null physical address (email-only submission)", () => {
    assert.equal(PHARO_PHYSICAL_ADDRESS, null);
  });

  it("has null proposal validity (not provided)", () => {
    assert.equal(PHARO_PROPOSAL_VALIDITY, null);
  });

  it("has exactly 5 evaluation criteria with 'Not provided' weights", () => {
    assert.equal(PHARO_EVALUATION_CRITERIA.length, 5);
    for (const c of PHARO_EVALUATION_CRITERIA) {
      assert.equal(c.weightStatus, "Not provided");
    }
  });

  it("has exactly 6 scope workstreams", () => {
    assert.equal(PHARO_SCOPE_WORKSTREAMS.length, 6);
  });

  it("has exactly 14 healthcare disciplines including biomedical engineering", () => {
    assert.equal(PHARO_DISCIPLINES.length, 14);
    const names = PHARO_DISCIPLINES.map((d) => d.name);
    assert.ok(names.includes("Biomedical engineering"));
  });

  it("has 5 appendices A–E with the correct titles", () => {
    assert.equal(PHARO_APPENDICES.length, 5);
    const letters = PHARO_APPENDICES.map((a) => a.letter);
    assert.deepEqual(letters, ["A", "B", "C", "D", "E"]);
    // Appendix A is NOT CVs — it's Company Profile
    const appendixA = PHARO_APPENDICES.find((a) => a.letter === "A")!;
    assert.match(appendixA.title, /Company Profile/i);
    // CVs are in Appendix C
    const appendixC = PHARO_APPENDICES.find((a) => a.letter === "C")!;
    assert.match(appendixC.title, /Expert CVs/i);
    // Drawings are in Appendix D
    const appendixD = PHARO_APPENDICES.find((a) => a.letter === "D")!;
    assert.match(appendixD.title, /Drawings/i);
  });
});

// ─── 2. Forbidden client content ────────────────────────────────────────────

describe("Forbidden client content — Pharo proposal must never contain", () => {
  it("rejects March 2026 deadline", () => {
    const violations = findPharoClientContentViolations("Submit by March 2026");
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.reason.includes("March 2026")));
  });

  it("rejects Bid-Team Action", () => {
    const violations = findPharoClientContentViolations("Bid-Team Action: assign expert");
    assert.ok(violations.length > 0);
  });

  it("rejects Proposal Self-Score", () => {
    const violations = findPharoClientContentViolations("Proposal Self-Score: 85/100");
    assert.ok(violations.length > 0);
  });

  it("rejects Win Probability", () => {
    const violations = findPharoClientContentViolations("Win Probability: 70%");
    assert.ok(violations.length > 0);
  });

  it("rejects Evaluator Simulation", () => {
    const violations = findPharoClientContentViolations("Evaluator Simulation results attached");
    assert.ok(violations.length > 0);
  });

  it("rejects invented physical Pharo address", () => {
    const violations = findPharoClientContentViolations("Submit to Pharo office address");
    assert.ok(violations.length > 0);
  });

  it("rejects invented proposal validity", () => {
    const violations = findPharoClientContentViolations("Proposal validity is 90 days");
    assert.ok(violations.length > 0);
  });

  it("rejects invented bid bond amount", () => {
    const violations = findPharoClientContentViolations("Bid bond amount: 50,000 ETB");
    assert.ok(violations.length > 0);
  });

  it("accepts clean text with no violations", () => {
    const clean = "We are pleased to submit our technical proposal for the Architectural Consultancy Services.";
    const violations = findPharoClientContentViolations(clean);
    assert.equal(violations.length, 0);
  });
});

// ─── 3. Fact extraction phrase classifier ───────────────────────────────────

describe("Fact extraction phrase classifier", () => {
  it("classifies 'not provided' as NOT_STATED", () => {
    assert.ok(isNotStatedPhrase("not provided"));
    assert.ok(isNotStatedPhrase("Not Provided"));
    assert.ok(isNotStatedPhrase("NOT PROVIDED"));
    const result = classifyExtractedFact("not provided", "reference");
    assert.equal(result.classification, "NOT_STATED");
  });

  it("classifies 'not mentioned' as NOT_STATED", () => {
    assert.ok(isNotStatedPhrase("not mentioned"));
    const result = classifyExtractedFact("not mentioned", "bidBond");
    assert.equal(result.classification, "NOT_STATED");
  });

  it("classifies 'not applicable' as NOT_STATED", () => {
    assert.ok(isNotStatedPhrase("not applicable"));
    const result = classifyExtractedFact("not applicable", "preBidMeeting");
    assert.equal(result.classification, "NOT_STATED");
  });

  it("classifies 'TBD' as CONDITIONAL", () => {
    assert.ok(isConditionalPhrase("TBD"));
    const result = classifyExtractedFact("TBD", "deadline");
    assert.equal(result.classification, "CONDITIONAL");
  });

  it("classifies 'to be confirmed' as CONDITIONAL", () => {
    assert.ok(isConditionalPhrase("to be confirmed"));
    const result = classifyExtractedFact("to be confirmed", "preBidMeeting");
    assert.equal(result.classification, "CONDITIONAL");
  });

  it("classifies 'by arrangement' as CONDITIONAL", () => {
    assert.ok(isConditionalPhrase("by arrangement"));
    const result = classifyExtractedFact("by arrangement", "siteVisit");
    assert.equal(result.classification, "CONDITIONAL");
  });

  it("classifies 'if required' as CONDITIONAL", () => {
    assert.ok(isConditionalPhrase("if required"));
    const result = classifyExtractedFact("if required", "bidBond");
    assert.equal(result.classification, "CONDITIONAL");
  });

  it("rejects 'Type:' as a label, not a value", () => {
    assert.ok(isLabelValue("Type: RFP"));
    const result = classifyExtractedFact("Type: RFP", "tenderReference");
    assert.equal(result.classification, "REJECTED");
  });

  it("rejects 'Reference:' as a label", () => {
    assert.ok(isLabelValue("Reference:"));
    const result = classifyExtractedFact("Reference:", "tenderReference");
    assert.equal(result.classification, "REJECTED");
  });

  it("rejects 'Not provided' as a tender reference (it's NOT_STATED, not a value)", () => {
    const result = classifyExtractedFact("Not provided", "tenderReference");
    assert.equal(result.classification, "NOT_STATED");
    assert.equal(result.cleanedValue, null);
  });

  it("classifies a genuine value as VALUE", () => {
    const result = classifyExtractedFact("August 25, 2026", "deadline");
    assert.equal(result.classification, "VALUE");
    assert.equal(result.cleanedValue, "August 25, 2026");
  });

  it("does NOT block drafting for optional fields when NOT_STATED", () => {
    const result = classifyExtractedFact("not provided", "bidBond");
    assert.equal(result.blocksDrafting, false);
  });

  it("blocks final export for submission-critical fields when UNKNOWN", () => {
    const result = classifyExtractedFact("", "deadline");
    assert.equal(result.blocksFinalExport, true);
  });

  it("does NOT block final export for optional fields when NOT_STATED", () => {
    const result = classifyExtractedFact("not provided", "proposalValidity");
    assert.equal(result.blocksFinalExport, false);
  });

  it("recognizes bidBond as an optional field", () => {
    assert.ok(isOptionalFactField("bidBond"));
    assert.ok(isOptionalFactField("preBidMeeting"));
    assert.ok(isOptionalFactField("pageLimit"));
    assert.ok(isOptionalFactField("proposalValidity"));
  });

  it("recognizes deadline as a submission-critical field", () => {
    assert.ok(isSubmissionCriticalFactField("deadline"));
    assert.ok(isSubmissionCriticalFactField("clientName"));
    assert.ok(isSubmissionCriticalFactField("submissionMethod"));
  });
});

// ─── 4. Unweighted criterion coverage ───────────────────────────────────────

describe("Unweighted criterion coverage", () => {
  it("NEVER assigns equal or estimated weights", () => {
    const result = assignWeightStatus(null);
    assert.equal(result.weightStatus, "Not provided");
    assert.equal(result.weightPercent, null);
  });

  it("assigns 'Stated' only when a concrete weight is given", () => {
    const result = assignWeightStatus(30);
    assert.equal(result.weightStatus, "Stated");
    assert.equal(result.weightPercent, 30);
  });

  it("has exactly 5 mandatory healthcare criteria", () => {
    assert.equal(MANDATORY_HEALTHCARE_CRITERIA.length, 5);
  });

  it("blocks final export when a mandatory criterion is missing", () => {
    assert.ok(criterionBlocksFinalExport({ coverageState: "missing", isMandatory: true }));
  });

  it("blocks final export when a mandatory criterion is partial", () => {
    assert.ok(criterionBlocksFinalExport({ coverageState: "partial", isMandatory: true }));
  });

  it("does NOT block final export when a mandatory criterion is covered", () => {
    assert.equal(criterionBlocksFinalExport({ coverageState: "covered", isMandatory: true }), false);
  });

  it("does NOT block final export for non-mandatory criteria", () => {
    assert.equal(criterionBlocksFinalExport({ coverageState: "missing", isMandatory: false }), false);
  });

  it("validates weight assignment — no 'equal' or 'estimated'", () => {
    const criteria = [
      { weightStatus: "Not provided" as const },
      { weightStatus: "Stated" as const },
    ];
    assert.ok(hasValidWeightAssignment(criteria));
  });

  it("evaluates coverage as 'missing' when no evidence", () => {
    assert.equal(evaluateCriterionCoverage({ evidence: [] }), "missing");
  });

  it("evaluates coverage as 'covered' when evidence has source page", () => {
    assert.equal(
      evaluateCriterionCoverage({
        evidence: [{ type: "expert", id: "e1", source: "CV.pdf", sourcePage: 1 }],
      }),
      "covered",
    );
  });

  it("evaluates coverage as 'partial' when evidence has no source page", () => {
    assert.equal(
      evaluateCriterionCoverage({
        evidence: [{ type: "expert", id: "e1", source: "", sourcePage: null }],
      }),
      "partial",
    );
  });
});

// ─── 5. Scope and discipline crosswalk ──────────────────────────────────────

describe("Scope and discipline crosswalk", () => {
  it("has exactly 6 scope workstreams", () => {
    assert.equal(SIX_SCOPE_WORKSTREAMS.length, 6);
  });

  it("has exactly 14 healthcare disciplines", () => {
    assert.equal(FOURTEEN_HEALTHCARE_DISCIPLINES.length, 14);
  });

  it("biomedical engineering is a mandatory named-expert discipline", () => {
    assert.ok(MANDATORY_NAMED_EXPERT_DISCIPLINES.has("Biomedical engineering"));
  });

  it("rejects unnamed 'specialist to be engaged' for biomedical engineering", () => {
    const result = isDisciplineSatisfied({
      name: "Biomedical engineering",
      expertId: null,
      expertName: null,
      allowsUnnamedSubcontractor: false,
      isTenderPermittedSubcontractor: false,
    });
    assert.equal(result.satisfied, false);
    assert.match(result.reason!, /named.*reviewed expert/i);
  });

  it("accepts a named expert for biomedical engineering", () => {
    const result = isDisciplineSatisfied({
      name: "Biomedical engineering",
      expertId: "expert-123",
      expertName: "Dr. Jane Smith",
      allowsUnnamedSubcontractor: false,
      isTenderPermittedSubcontractor: false,
    });
    assert.equal(result.satisfied, true);
  });

  it("rejects architect with unnamed subcontractor (mandatory named)", () => {
    const result = isDisciplineSatisfied({
      name: "Architecture",
      expertId: null,
      expertName: null,
      allowsUnnamedSubcontractor: true,
      isTenderPermittedSubcontractor: true,
    });
    assert.equal(result.satisfied, false);
  });

  it("accepts unnamed subcontractor for non-mandatory discipline when tender permits", () => {
    const result = isDisciplineSatisfied({
      name: "IT and telehealth",
      expertId: null,
      expertName: null,
      allowsUnnamedSubcontractor: true,
      isTenderPermittedSubcontractor: true,
    });
    assert.equal(result.satisfied, true);
  });

  it("validateCrosswalk returns violations for unsatisfied disciplines", () => {
    const violations = validateCrosswalk({
      disciplines: [
        { name: "Biomedical engineering", expertId: null, expertName: null, allowsUnnamedSubcontractor: false, isTenderPermittedSubcontractor: false },
        { name: "Architecture", expertId: "e1", expertName: "John Doe", allowsUnnamedSubcontractor: false, isTenderPermittedSubcontractor: false },
      ],
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0].discipline, /Biomedical/);
  });
});

// ─── 6. Appendix authority register ─────────────────────────────────────────

describe("Appendix authority register", () => {
  it("does NOT hard-code Appendix A as CVs", () => {
    const appendixA = DEFAULT_APPENDIX_REGISTER.entries.find((e) => e.letter === "A")!;
    assert.doesNotMatch(appendixA.title, /CV/i);
    assert.match(appendixA.title, /Company Profile/i);
  });

  it("finds appendix references in narrative text", () => {
    const refs = findAppendixReferences("See Appendix A for details. Appendix C contains CVs.");
    assert.equal(refs.length, 2);
    assert.equal(refs[0].letter, "A");
    assert.equal(refs[1].letter, "C");
  });

  it("detects conflicting appendix label (drawings as Appendix A)", () => {
    const text = "Appendix A: Selected Drawings and Photographs";
    const violations = validateAppendixReferences(text, DEFAULT_APPENDIX_REGISTER);
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.type === "conflicting_label"));
  });

  it("detects unknown appendix letter (Appendix F)", () => {
    const text = "See Appendix F for financial details";
    const violations = validateAppendixReferences(text, DEFAULT_APPENDIX_REGISTER);
    assert.ok(violations.some((v) => v.type === "unknown_appendix"));
  });

  it("accepts correct appendix references", () => {
    const text = "See Appendix A for Company Profile and Appendix C for Expert CVs.";
    const violations = validateAppendixReferences(text, DEFAULT_APPENDIX_REGISTER);
    // The titles should match — no conflicting_label violations
    assert.equal(violations.filter((v) => v.type === "conflicting_label").length, 0);
  });

  it("blocks final export for conflicting appendix labels", () => {
    const violations = [
      { type: "conflicting_label" as const, message: "test", referencedLabel: "A", expectedTitle: "X", excerpt: "" },
    ];
    assert.ok(appendixViolationsBlockFinalExport(violations));
  });
});

// ─── 7. Client output separation ────────────────────────────────────────────

describe("Client output separation — internal terms excluded from client proposal", () => {
  it("removes 'Bid-Team Action' from client text", () => {
    const { cleanedText, removedTerms } = sanitizeClientOutput("Bid-Team Action: assign expert");
    assert.doesNotMatch(cleanedText, /bid[- ]?team[- ]?action/i);
    assert.ok(removedTerms.length > 0);
  });

  it("removes 'Proposal Self-Score' from client text", () => {
    const { cleanedText } = sanitizeClientOutput("Proposal Self-Score: 85/100");
    assert.doesNotMatch(cleanedText, /proposal[- ]?self[- ]?score/i);
  });

  it("removes 'Win Probability' from client text", () => {
    const { cleanedText } = sanitizeClientOutput("Win Probability: 70%");
    assert.doesNotMatch(cleanedText, /win\s+probability/i);
  });

  it("removes placeholder tokens [TBD]", () => {
    const { cleanedText } = sanitizeClientOutput("Expert name: [TBD]");
    assert.doesNotMatch(cleanedText, /\[TBD\]/i);
  });

  it("removes AI provider names (Claude, OpenAI)", () => {
    const { cleanedText } = sanitizeClientOutput("Generated by Claude. Powered by OpenAI.");
    assert.doesNotMatch(cleanedText, /Claude|OpenAI/i);
  });

  it("finds internal term violations", () => {
    const violations = findInternalTermViolations("This section contains Bid-Team Action items.");
    assert.ok(violations.length > 0);
  });

  it("verifies correct finalisation order", () => {
    const result = verifyFinalisationOrder([...FINALISATION_ORDER]);
    assert.equal(result.valid, true);
  });

  it("rejects finalisation order with injector after sanitiser", () => {
    const badOrder = [
      "assemble_grounded_content",
      "remove_placeholders_and_internal_tokens",
      "apply_client_section_allowlist", // injector after sanitiser!
      "rebuild_section_order_and_toc",
      "render_client_document",
    ] as const;
    const result = verifyFinalisationOrder([...badOrder]);
    assert.equal(result.valid, false);
  });
});

// ─── 8. Cross-source consistency validator ──────────────────────────────────

describe("Cross-source consistency validator", () => {
  it("detects conflicting March 2026 deadline vs August 2026", () => {
    const violations = detectConflictingDeadlines(
      "Submit by March 2026",
      PHARO_DEADLINE_ISO,
    );
    assert.ok(violations.length > 0);
    assert.equal(violations[0].type, "conflicting_deadline");
  });

  it("does NOT flag the correct August 2026 deadline", () => {
    const violations = detectConflictingDeadlines(
      "Submit by August 25, 2026",
      PHARO_DEADLINE_ISO,
    );
    assert.equal(violations.length, 0);
  });

  it("detects physical address contradiction for email-only submission", () => {
    const violations = detectSubmissionMethodContradictions(
      "Submit to our physical office at 123 Main Street",
      "email",
    );
    assert.ok(violations.length > 0);
  });

  it("detects unnamed mandatory specialist (biomedical engineer)", () => {
    const violations = detectUnnamedMandatorySpecialists(
      "The biomedical engineer will be a specialist to be engaged.",
    );
    assert.ok(violations.length > 0);
  });

  it("blocks final export for error-severity violations", () => {
    assert.ok(consistencyViolationsBlockFinalExport([
      { type: "conflicting_deadline", severity: "error", message: "", authorityClass: "tender_fact", excerpt: "" },
    ]));
  });

  it("does NOT block final export for warning-severity violations only", () => {
    assert.equal(consistencyViolationsBlockFinalExport([
      { type: "duplicate_role", severity: "warning", message: "", authorityClass: "company_evidence", excerpt: "" },
    ]), false);
  });
});

// ─── 9. Client quality scoring ──────────────────────────────────────────────

describe("Client quality scoring", () => {
  it("scores section completeness — full marks when all sections present", () => {
    const text = "Cover letter. Executive summary. Company profile. Proposed team. Relevant experience. Technical approach. Compliance matrix. Appendix register. Declaration.";
    const dim = scoreSectionCompleteness(text);
    assert.equal(dim.score, 100);
  });

  it("scores section completeness — partial marks when sections missing", () => {
    const text = "Cover letter. Executive summary.";
    const dim = scoreSectionCompleteness(text);
    assert.ok(dim.score < 100);
  });

  it("scores absence of internal notes — full marks when clean", () => {
    const dim = scoreAbsenceOfInternalNotes("This is a clean client proposal with no internal terms.");
    assert.equal(dim.score, 100);
  });

  it("scores absence of internal notes — reduced when internal terms present", () => {
    const dim = scoreAbsenceOfInternalNotes("Bid-Team Action: assign expert. Proposal Self-Score: 85.");
    assert.ok(dim.score < 100);
  });

  it("computes overall client quality score", () => {
    const dimensions = [
      { id: "test1", name: "Test 1", score: 80, reason: "" },
      { id: "test2", name: "Test 2", score: 60, reason: "" },
    ];
    const result = computeClientQualityScore(dimensions);
    assert.equal(result.overall, 70);
    assert.equal(result.blocksFinalExport, false); // 70 is not < 70
  });

  it("blocks final export when overall score < 70", () => {
    const dimensions = [
      { id: "test1", name: "Test 1", score: 50, reason: "" },
      { id: "test2", name: "Test 2", score: 60, reason: "" },
    ];
    const result = computeClientQualityScore(dimensions);
    assert.ok(result.blocksFinalExport);
  });
});
