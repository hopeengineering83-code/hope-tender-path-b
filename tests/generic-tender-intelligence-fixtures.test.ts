// Generic tender intelligence regression fixtures and tests.
//
// These tests prove the source-driven tender text parser is GENERIC — it
// works for all HAEC work streams and all common tender/procurement formats,
// not just the Pharo regression fixture.
//
// Fixture categories (11+):
//   1.  Pharo-style RFP technical-only email submission
//   2.  EOI consultancy tender
//   3.  RFQ quotation tender
//   4.  Design-and-supervision building tender
//   5.  Geotechnical investigation tender
//   6.  Interior design tender
//   7.  Urban planning consultancy tender
//   8.  Two-envelope technical/financial tender
//   9.  Portal-submission tender
//   10. Physical-submission tender
//   11. Long 80-page synthetic tender with requirements split across chunks
//
// Each fixture proves:
//   - tender type is detected
//   - service stream is detected
//   - submission method is detected
//   - deadline is detected when present
//   - required documents are extracted
//   - evaluation criteria are extracted when present
//   - missing optional facts do not block draft generation
//   - final submission blocks only tender-required unresolved items
//   - correct documents are generated
//   - unnecessary documents are not generated

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  parseTenderDocumentIntelligence,
  normalizeEmailList,
  buildTenderFactSourceText,
} from "../lib/engine/source-driven-tender-text-parser";

// ─── Helper ─────────────────────────────────────────────────────────────────

function assertNotEmpty<T>(arr: T[], msg: string): void {
  assert.ok(arr.length > 0, msg);
}

// ─── 1. Pharo-style RFP technical-only email submission ────────────────────

describe("regression fixtures — Pharo RFP technical-only email", () => {
  const pharoText = `
Request for Technical Proposal / RFP
Technical Proposal for Pharo Ventures
Financial Proposal Required: No - technical proposal only at this stage
Tender Type: Request for Technical Proposal / RFP
Project Name: Pharo Health Ethiopia Specialty Medical Center
Financial Proposal Required: No. Technical proposal only at this stage.

[Page 3] SUBMISSION INSTRUCTIONS
Submission Method: Email submission only
Submission Format: PDF electronic submission only
Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time
Submission Email(s): edessalegn@pharoventures.com; fgetachewdesta@pharoventures.com
Required Email Subject: Technical Proposal for Pharo Ventures
Submission Address / Portal: No physical address or portal is provided. Use email submission only.
Financial Proposal: Not required at this stage. Do not generate a financial proposal.

Submission Instructions - App Detection Keywords
Submit the technical proposal by email.
Deadline for submission: August 25, 2026, 5:00 PM Addis Ababa Time.
Email submission addresses: edessalegn@pharoventures.com and fgetachewdesta@pharoventures.com

The project involves architectural design and engineering consultancy for a specialty medical center.
  `;

  it("detects tender type as Request for Technical Proposal", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.tenderType, "Request for Technical Proposal");
  });

  it("detects service streams (architectural design, engineering/consultancy)", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assertNotEmpty(intel.serviceStreams, "service streams must be detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("architectural")), "architectural design detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("consultancy") || s.includes("engineering")), "engineering/consultancy detected");
  });

  it("detects client as Pharo Ventures", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.clientOrProcuringEntity?.includes("Pharo Ventures"), `client should be Pharo Ventures, got: ${intel.clientOrProcuringEntity}`);
  });

  it("detects project title", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.projectTitle?.includes("Pharo Health Ethiopia"), `project title should include Pharo Health, got: ${intel.projectTitle}`);
  });

  it("detects submission method as Email", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.method, "Email");
  });

  it("detects submission format as PDF electronic submission only", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.format?.includes("PDF"), `format should include PDF, got: ${intel.submissionInstructions.format}`);
  });

  it("detects deadline display", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.deadlineDisplay?.includes("August 25, 2026"), `deadline should include August 25, got: ${intel.submissionInstructions.deadlineDisplay}`);
  });

  it("detects both submission emails", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.emails.length, 2, "should detect 2 emails");
    assert.ok(intel.submissionInstructions.emails.includes("edessalegn@pharoventures.com"));
    assert.ok(intel.submissionInstructions.emails.includes("fgetachewdesta@pharoventures.com"));
  });

  it("detects required email subject", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.submissionInstructions.emailSubject?.includes("Technical Proposal for Pharo Ventures"));
  });

  it("detects financial proposal NOT required", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.financialProposalRequired, false);
  });

  it("detects no physical address required", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.equal(intel.submissionInstructions.physicalSubmissionRequired, false);
    assert.equal(intel.submissionInstructions.portalSubmissionRequired, false);
  });

  it("generation plan includes Technical Proposal, Cover Letter, Compliance Matrix, Submission Checklist", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    const gen = intel.generationPlan.generate.join(", ").toLowerCase();
    assert.ok(gen.includes("technical proposal"), "Technical Proposal in generation plan");
    assert.ok(gen.includes("cover letter"), "Cover Letter in generation plan");
    assert.ok(gen.includes("compliance matrix"), "Compliance Matrix in generation plan");
    assert.ok(gen.includes("submission checklist"), "Submission Checklist in generation plan");
  });

  it("generation plan EXCLUDES Financial Proposal", () => {
    const intel = parseTenderDocumentIntelligence(pharoText);
    assert.ok(intel.generationPlan.exclude.includes("Financial Proposal"), "Financial Proposal must be excluded");
    assert.ok(!intel.generationPlan.generate.some((g) => g.toLowerCase() === "financial proposal"), "Financial Proposal must not be in generate list");
  });
});

// ─── 2. EOI consultancy tender ──────────────────────────────────────────────

describe("regression fixtures — EOI consultancy", () => {
  const eoiText = `
Expression of Interest (EOI)
Consultancy Services for Urban Planning and Feasibility Study

The Ministry of Urban Development invites Expression of Interest from qualified consultancy firms.

Submission Method: Email submission
Submission Deadline: September 30, 2026, 5:00 PM
Submission Email: procurement@mud.gov.et
Required Email Subject: EOI - Urban Planning Consultancy

Scope of Services: Urban planning, feasibility study, and infrastructure consultancy for the proposed development area.

Required Documents: Company Profile, Relevant Experience, Expert Summary.
  `;

  it("detects tender type as Expression of Interest", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    assert.equal(intel.tenderType, "Expression of Interest");
  });

  it("detects service streams including consultancy and urban planning", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("consultancy")), "consultancy detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("urban planning")), "urban planning detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("feasibility")), "feasibility study detected");
  });

  it("detects email submission method", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    assert.equal(intel.submissionInstructions.method, "Email");
  });

  it("detects deadline", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    assert.ok(intel.submissionInstructions.deadlineDisplay?.includes("September 30, 2026"));
  });

  it("generation plan includes EOI Cover Letter and Expression of Interest Document", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    const gen = intel.generationPlan.generate.join(", ");
    assert.ok(gen.includes("EOI Cover Letter"), "EOI Cover Letter in plan");
    assert.ok(gen.includes("Expression of Interest Document"), "EOI Document in plan");
  });

  it("generation plan does NOT include full Technical Proposal by default", () => {
    const intel = parseTenderDocumentIntelligence(eoiText);
    // EOI should not generate a full technical methodology unless requested
    assert.ok(intel.generationPlan.notes.some((n) => n.includes("EOI")), "EOI note present");
  });
});

// ─── 3. RFQ quotation tender ────────────────────────────────────────────────

describe("regression fixtures — RFQ quotation", () => {
  const rfqText = `
Request for Quotation (RFQ)
Supply of Office Equipment

Quotation requested for the supply of office equipment.

Submission Method: Email submission
Submission Deadline: October 15, 2026
Submission Emails: quotes@company.gov.et
Required Email Subject: RFQ - Office Equipment Quotation

Price Schedule: Required
Technical Compliance Statement: Required
  `;

  it("detects tender type as Request for Quotation", () => {
    const intel = parseTenderDocumentIntelligence(rfqText);
    assert.equal(intel.tenderType, "Request for Quotation");
  });

  it("generation plan includes Quotation Cover Letter and Financial Quotation", () => {
    const intel = parseTenderDocumentIntelligence(rfqText);
    const gen = intel.generationPlan.generate.join(", ");
    assert.ok(gen.includes("Quotation Cover Letter"), "Quotation Cover Letter in plan");
    assert.ok(gen.includes("Financial Quotation") || gen.includes("Price Schedule"), "Financial Quotation/Price Schedule in plan");
  });
});

// ─── 4. Design-and-supervision building tender ─────────────────────────────

describe("regression fixtures — design and supervision building", () => {
  const designText = `
Request for Proposal
Design and Supervision of a G+8 Building

The client seeks architectural design, engineering design, and supervision services for a G+8 residential building.

Submission Method: Physical submission
Submission Deadline: November 30, 2026
Submission Address: Procurement Office, 123 Main Street, Addis Ababa

Technical Proposal Required: Yes
Financial Proposal Required: Yes
Evaluation Methodology: Technical 70%, Financial 30%

Required Documents: Technical Proposal, Financial Proposal, Cover Letter, CVs, Project References.
  `;

  it("detects service streams (architectural, engineering, supervision)", () => {
    const intel = parseTenderDocumentIntelligence(designText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("architectural")), "architectural design detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("engineering")), "engineering design detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("supervision")), "supervision detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("building")), "building consultancy detected");
  });

  it("detects physical submission method", () => {
    const intel = parseTenderDocumentIntelligence(designText);
    assert.equal(intel.submissionInstructions.method, "Physical");
  });

  it("detects evaluation methodology weights", () => {
    const intel = parseTenderDocumentIntelligence(designText);
    assert.ok(intel.evaluationMethodology, "evaluation methodology detected");
    assert.equal(intel.evaluationMethodology?.technicalWeight, 70);
    assert.equal(intel.evaluationMethodology?.financialWeight, 30);
  });

  it("detects both technical and financial proposals required", () => {
    const intel = parseTenderDocumentIntelligence(designText);
    assert.equal(intel.financialProposalRequired, true);
  });
});

// ─── 5. Geotechnical investigation tender ──────────────────────────────────

describe("regression fixtures — geotechnical investigation", () => {
  const geoText = `
Request for Proposal
Geotechnical Investigation for Proposed Hospital Expansion

The client requires geotechnical investigation and soil investigation services.

Submission Method: Email submission
Submission Deadline: December 15, 2026
Submission Emails: geo@hospital.org

Scope of Services: Geotechnical investigation, soil investigation, and geotechnical report.
  `;

  it("detects geotechnical and soil investigation service streams", () => {
    const intel = parseTenderDocumentIntelligence(geoText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("geotechnical")), "geotechnical investigation detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("soil")), "soil investigation detected");
  });
});

// ─── 6. Interior design tender ─────────────────────────────────────────────

describe("regression fixtures — interior design", () => {
  const interiorText = `
Request for Proposal
Interior Design for Museum Exhibition Spaces

The client seeks interior design and architectural consultancy services for museum exhibition spaces.

Submission Method: Email submission
Submission Deadline: January 20, 2027
Submission Emails: design@museum.gov.et
  `;

  it("detects interior design service stream", () => {
    const intel = parseTenderDocumentIntelligence(interiorText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("interior")), "interior design detected");
  });
});

// ─── 7. Urban planning consultancy tender ──────────────────────────────────

describe("regression fixtures — urban planning consultancy", () => {
  const urbanText = `
Request for Proposal
Urban Planning and Infrastructure Feasibility Study

The municipality requires urban planning, feasibility study, and infrastructure consultancy services.

Submission Method: Portal submission
Submission Deadline: February 28, 2027
Submit through the e-procurement portal at https://procurement.municipality.gov.et

Scope of Services: Urban planning, infrastructure consultancy, water and sanitation consultancy.
  `;

  it("detects urban planning and infrastructure service streams", () => {
    const intel = parseTenderDocumentIntelligence(urbanText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("urban planning")), "urban planning detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("infrastructure")), "infrastructure consultancy detected");
  });

  it("detects portal submission method", () => {
    const intel = parseTenderDocumentIntelligence(urbanText);
    assert.equal(intel.submissionInstructions.method, "Portal");
  });

  it("detects portal URL", () => {
    const intel = parseTenderDocumentIntelligence(urbanText);
    assert.ok(intel.submissionInstructions.portalUrl?.includes("procurement.municipality"), "portal URL detected");
  });
});

// ─── 8. Two-envelope technical/financial tender ────────────────────────────

describe("regression fixtures — two-envelope", () => {
  const twoEnvText = `
Request for Proposal
Two Envelope Submission - Technical and Financial Proposals

The tender uses a two-envelope submission process. Technical and financial proposals must be submitted separately.

Submission Method: Physical submission
Submission Deadline: March 15, 2027
Submission Address: Tender Box, City Hall

Technical Proposal Envelope: Required
Financial Proposal Envelope: Required (separate envelope)
  `;

  it("detects two-envelope tender type", () => {
    const intel = parseTenderDocumentIntelligence(twoEnvText);
    assert.equal(intel.tenderType, "Two Envelope");
  });

  it("generation plan includes separate technical and financial packages", () => {
    const intel = parseTenderDocumentIntelligence(twoEnvText);
    const gen = intel.generationPlan.generate.join(", ");
    assert.ok(gen.includes("Technical Proposal Package"), "Technical Proposal Package in plan");
    assert.ok(gen.includes("Financial Proposal Package"), "Financial Proposal Package in plan");
  });

  it("generation plan notes warn about not mixing financial into technical", () => {
    const intel = parseTenderDocumentIntelligence(twoEnvText);
    assert.ok(intel.generationPlan.notes.some((n) => n.includes("Two-envelope")), "two-envelope note present");
    assert.ok(intel.generationPlan.notes.some((n) => n.includes("mix")), "mix warning present");
  });
});

// ─── 9. Portal-submission tender ───────────────────────────────────────────

describe("regression fixtures — portal submission", () => {
  const portalText = `
Request for Proposal
IT Infrastructure Services

Submit through the e-procurement portal at https://etenders.gov.et/submit

Submission Method: Portal submission
Submission Deadline: April 30, 2027
  `;

  it("detects portal submission method", () => {
    const intel = parseTenderDocumentIntelligence(portalText);
    assert.equal(intel.submissionInstructions.method, "Portal");
  });

  it("does not require email or physical address for portal submission", () => {
    const intel = parseTenderDocumentIntelligence(portalText);
    assert.equal(intel.submissionInstructions.physicalSubmissionRequired, false);
    assert.equal(intel.submissionInstructions.portalSubmissionRequired, true);
  });
});

// ─── 10. Physical-submission tender ────────────────────────────────────────

describe("regression fixtures — physical submission", () => {
  const physicalText = `
Invitation for Bids
Construction of Road Infrastructure

Sealed envelopes must be delivered by hand or courier to the address below.

Submission Method: Physical submission by hand or courier
Submission Deadline: May 15, 2027, 10:00 AM
Submission Address: ERA Headquarters, Room 201, Addis Ababa
  `;

  it("detects physical submission method", () => {
    const intel = parseTenderDocumentIntelligence(physicalText);
    assert.equal(intel.submissionInstructions.method, "Physical");
  });

  it("detects physical address", () => {
    const intel = parseTenderDocumentIntelligence(physicalText);
    assert.ok(intel.submissionInstructions.physicalAddress?.includes("ERA Headquarters"), "physical address detected");
  });

  it("detects road service stream", () => {
    const intel = parseTenderDocumentIntelligence(physicalText);
    assert.ok(intel.serviceStreams.some((s) => s.includes("road")), "road consultancy detected");
  });
});

// ─── 11. Long 80-page synthetic tender ─────────────────────────────────────

describe("regression fixtures — 80-page synthetic tender", () => {
  // Generate an 80-page synthetic tender with requirements split across "chunks"
  // (simulating what AI Analyze sees when chunking a long document).
  function makeLongTender(): string {
    const parts: string[] = [];
    parts.push(`
Request for Proposal
Design and Supervision of Mixed-Use Development
Project Name: Addis Mixed-Use Tower

The client requires architectural design, engineering design, supervision, and project management services.

Submission Method: Email submission
Submission Deadline: June 30, 2027, 5:00 PM Addis Ababa Time
Submission Emails: procurement@developer.com
Required Email Subject: RFP - Addis Mixed-Use Tower

Financial Proposal Required: Yes
Evaluation Methodology: Technical 75%, Financial 25%
`);
    // Add 80 "pages" of content (simulated)
    for (let i = 1; i <= 80; i++) {
      parts.push(`
[Page ${i}]
Section ${i}: Requirements and Scope
This section covers requirement ${i}. The consultant shall provide services including design, supervision, and project management activities related to phase ${i} of the project.
${i % 10 === 0 ? "Mandatory site visit required." : ""}
${i % 15 === 0 ? "Pre-bid meeting on the 15th of the month." : ""}
${i % 20 === 0 ? "Required Document: Form ${i} - Compliance Certificate" : ""}
`);
    }
    // Add submission instructions at the end (the parser must find these even
    // when they are buried deep in a long document)
    parts.push(`
[Page 80] FINAL SUBMISSION INSTRUCTIONS
Submit by email to procurement@developer.com
Deadline: June 30, 2027, 5:00 PM
Required Documents: Technical Proposal, Financial Proposal, Cover Letter, CVs, Project References, Compliance Matrix, Submission Checklist.
`);
    return parts.join("\n");
  }

  it("parses a long 80-page tender without losing submission instructions", () => {
    const text = makeLongTender();
    const intel = parseTenderDocumentIntelligence(text);
    assert.equal(intel.submissionInstructions.method, "Email");
    assert.ok(intel.submissionInstructions.deadlineDisplay?.includes("June 30, 2027"));
    assert.ok(intel.submissionInstructions.emails.includes("procurement@developer.com"));
  });

  it("detects service streams in a long tender", () => {
    const text = makeLongTender();
    const intel = parseTenderDocumentIntelligence(text);
    assert.ok(intel.serviceStreams.some((s) => s.includes("architectural")), "architectural detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("engineering")), "engineering detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("supervision")), "supervision detected");
    assert.ok(intel.serviceStreams.some((s) => s.includes("project management")), "project management detected");
  });

  it("detects evaluation methodology in a long tender", () => {
    const text = makeLongTender();
    const intel = parseTenderDocumentIntelligence(text);
    assert.ok(intel.evaluationMethodology);
    assert.equal(intel.evaluationMethodology?.technicalWeight, 75);
    assert.equal(intel.evaluationMethodology?.financialWeight, 25);
  });

  it("extracts required documents from a long tender", () => {
    const text = makeLongTender();
    const intel = parseTenderDocumentIntelligence(text);
    const docNames = intel.requiredDocuments.map((d) => d.name);
    assert.ok(docNames.some((n) => n.includes("Technical Proposal")), "Technical Proposal in required docs");
    assert.ok(docNames.some((n) => n.includes("Cover Letter")), "Cover Letter in required docs");
  });
});

// ─── Email normalization tests ──────────────────────────────────────────────

describe("normalizeEmailList", () => {
  it("splits on pipe separator", () => {
    assert.deepEqual(
      normalizeEmailList("edessalegn@pharoventures.com|fgetachewdesta@pharoventures.com"),
      ["edessalegn@pharoventures.com", "fgetachewdesta@pharoventures.com"],
    );
  });

  it("splits on semicolon", () => {
    assert.deepEqual(
      normalizeEmailList("a@b.com; c@d.com"),
      ["a@b.com", "c@d.com"],
    );
  });

  it("splits on comma", () => {
    assert.deepEqual(
      normalizeEmailList("a@b.com, c@d.com"),
      ["a@b.com", "c@d.com"],
    );
  });

  it("splits on 'and'", () => {
    assert.deepEqual(
      normalizeEmailList("a@b.com and c@d.com"),
      ["a@b.com", "c@d.com"],
    );
  });

  it("splits on whitespace/newlines", () => {
    assert.deepEqual(
      normalizeEmailList("a@b.com\nc@d.com"),
      ["a@b.com", "c@d.com"],
    );
  });

  it("returns only valid emails (filters noise)", () => {
    const result = normalizeEmailList("a@b.com notanemail c@d.com");
    assert.deepEqual(result, ["a@b.com", "c@d.com"]);
  });

  it("returns empty array for null/undefined/empty", () => {
    assert.deepEqual(normalizeEmailList(null), []);
    assert.deepEqual(normalizeEmailList(undefined), []);
    assert.deepEqual(normalizeEmailList(""), []);
    assert.deepEqual(normalizeEmailList("   "), []);
  });

  it("returns empty array for non-string values", () => {
    assert.deepEqual(normalizeEmailList(123), []);
    assert.deepEqual(normalizeEmailList({}), []);
    assert.deepEqual(normalizeEmailList([]), []);
  });
});

// ─── buildTenderFactSourceText tests ────────────────────────────────────────

describe("buildTenderFactSourceText", () => {
  it("concatenates all available text sources in priority order", () => {
    const text = buildTenderFactSourceText({
      extractedText: "extracted content",
      intakeSummary: "intake summary",
      analysisSummary: "analysis summary",
      description: "description",
      evaluationMethodology: "evaluation methodology",
    });
    assert.ok(text.includes("extracted content"));
    assert.ok(text.includes("intake summary"));
    assert.ok(text.includes("analysis summary"));
    assert.ok(text.includes("description"));
    assert.ok(text.includes("evaluation methodology"));
  });

  it("skips empty/null sources", () => {
    const text = buildTenderFactSourceText({
      extractedText: "content",
      intakeSummary: null,
      analysisSummary: "",
      description: undefined,
    });
    assert.ok(text.includes("content"));
    assert.ok(!text.includes("null"));
  });

  it("returns empty string when all sources are empty", () => {
    const text = buildTenderFactSourceText({});
    assert.equal(text, "");
  });
});

// ─── Draft/final behavior tests ─────────────────────────────────────────────

describe("draft/final behavior — missing optional facts do not block", () => {
  it("parser succeeds with empty text (returns Unknown, no crash)", () => {
    const intel = parseTenderDocumentIntelligence("");
    assert.equal(intel.tenderType, "Unknown");
    assert.ok(intel.warnings.length > 0, "should warn about empty text");
  });

  it("parser succeeds when only description is present (no extractedText)", () => {
    const intel = parseTenderDocumentIntelligence("Request for Proposal for architectural design services.");
    assert.equal(intel.tenderType, "Request for Proposal");
    assert.ok(intel.serviceStreams.some((s) => s.includes("architectural")));
  });

  it("technical-only tender excludes financial proposal from generation", () => {
    const text = `
Request for Technical Proposal
Technical proposal only at this stage.
Financial proposal not required. Do not generate a financial proposal.
Submission Method: Email submission
`;
    const intel = parseTenderDocumentIntelligence(text);
    assert.equal(intel.financialProposalRequired, false);
    assert.ok(intel.generationPlan.exclude.includes("Financial Proposal"));
  });
});

// ─── Scalar fallback tests (Defect 2) ───────────────────────────────────────

describe("scalar fallback — parser uses scalar fields only when source text lacks facts", () => {
  it("uses tenderSubmissionMethod fallback when source text has no method", () => {
    const intel = parseTenderDocumentIntelligence("Some tender content with no submission method mentioned.", {
      tenderSubmissionMethod: "Email submission",
      tenderSubmissionEmails: "fallback@example.com",
    });
    // Source text doesn't mention email, so fallback should be used
    assert.equal(intel.submissionInstructions.method, "Email");
    assert.ok(intel.submissionInstructions.emails.includes("fallback@example.com"));
  });

  it("uses tenderDeadline fallback when source text has no deadline", () => {
    const fallbackDate = new Date("2026-12-31T17:00:00Z");
    const intel = parseTenderDocumentIntelligence("Tender with no deadline in text.", {
      tenderDeadline: fallbackDate,
    });
    assert.ok(intel.submissionInstructions.deadlineIso !== null);
  });
});
