import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Exercises the REAL machine verdict the Document Validator panel renders
// (components/document-validator-panel.tsx → resolveCurrentDocumentVerdict).
//
// This file used to hold a hand-copied duplicate of the panel's regex lists and
// assert against the copy, so it passed no matter what the panel actually did —
// and it went on passing while the panel and the export gate diverged. It now
// calls the canonical resolver, so a regression in either the strict validator
// or the readiness quality gate fails here.

import { resolveCurrentDocumentVerdict } from "../lib/engine/current-document-quality";

// A realistic, full-length technical proposal the narrative quality gate scores
// as acceptable. Injecting a single bad line into this must flip the verdict —
// that is the property under test.
const CLEAN_TECHNICAL = `# Technical Proposal
Submitted by Hope Engineering PLC in response to the tender for the water supply scheme.

## Executive Summary
Hope Engineering PLC submits this technical proposal for the detailed design and
construction supervision of the water supply scheme. ${"Our team has delivered comparable schemes for regional water bureaux and municipal utilities. ".repeat(20)}

## Understanding of the Assignment
${"The assignment covers hydraulic modelling, detailed design, tender documentation and construction supervision of the distribution network. ".repeat(25)}

## Methodology
${"Our methodology follows a phased approach: inception, survey and data collection, hydraulic analysis, detailed design, and supervision, with a quality gate at each milestone. ".repeat(25)}

## Work Plan
${"The work plan sequences mobilisation, topographic survey, design development, client review, and construction supervision across the contract period. ".repeat(25)}

## Team and Organisation
${"The team is led by a chartered civil engineer supported by hydraulic, structural, electromechanical and environmental specialists. ".repeat(25)}

## Quality Assurance
${"Quality assurance is governed by ISO-aligned procedures with independent design review before each deliverable is issued. ".repeat(20)}

## Experience
${"Relevant experience includes water supply and sanitation schemes delivered on time and within budget for public clients. ".repeat(20)}
`;

function technicalDoc(content: string) {
  return {
    id: "doc-under-test",
    name: "Technical Proposal.docx",
    exactFileName: "Technical Proposal.docx",
    documentType: "TECHNICAL",
    format: "DOCX",
    fileContent: content,
    storagePath: null,
    generationStatus: "GENERATED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
  };
}

async function verdictFor(content: string) {
  return await resolveCurrentDocumentVerdict(technicalDoc(content));
}

function codes(verdict: Awaited<ReturnType<typeof verdictFor>>): string[] {
  return verdict.reasons.map((r) => r.code);
}

describe("Document validator — placeholder detection", () => {
  const cases: Array<[string, string]> = [
    ["[insert X] pattern", "Please [insert company name] here."],
    ["{FIELD_NAME} template slot", "Value is {TBD_VALUE}."],
    ["TODO marker", "TODO: add financial data"],
    ["XXX marker", "Amount: XXX ETB"],
    ["[TBD] bracket", "Budget: [TBD]"],
    ["'placeholder' word", "This is a placeholder section."],
    ["'Bid-Team to confirm'", "Client name: Bid-Team to confirm"],
    ["'Bid-Team Action'", "Bid-Team Action: insert final price"],
    ["MISSING_SOURCE marker", "Contact email: MISSING_SOURCE"],
    ["'Not extracted — confirm manually'", "Phone: Not extracted — confirm manually"],
    ["'Not extracted – confirm manually' (en-dash)", "Phone: Not extracted – confirm manually"],
    ["[CLIENT TO BE CONFIRMED]", "Dear [CLIENT TO BE CONFIRMED],"],
  ];

  for (const [label, line] of cases) {
    it(`blocks ${label}`, async () => {
      const verdict = await verdictFor(`${CLEAN_TECHNICAL}\n${line}\n`);
      assert.equal(verdict.score, "BLOCKED", `${label} must block the document`);
      assert.equal(verdict.validation.status, "BLOCKED");
      assert.ok(verdict.validation.placeholders.length > 0 || verdict.validation.aiTrace.length > 0,
        `${label} must be reported as a placeholder or AI trace, got: ${codes(verdict).join(",")}`);
    });
  }

  it("does NOT block clean proposal text", async () => {
    const verdict = await verdictFor(CLEAN_TECHNICAL);
    assert.equal(verdict.validation.placeholders.length, 0,
      `clean text flagged: ${verdict.validation.placeholders.join(" | ")}`);
    assert.equal(verdict.validation.status, "GOOD");
  });

  it("does NOT block a legitimate date string", async () => {
    const verdict = await verdictFor(`${CLEAN_TECHNICAL}\nSubmission deadline: 15 June 2026\n`);
    assert.equal(verdict.validation.placeholders.length, 0);
  });
});

describe("Document validator — AI-trace detection", () => {
  const traces: Array<[string, string]> = [
    ["'as an AI'", "As an AI, I must note the limits of this analysis."],
    ["bare 'language model'", "I am a language model."],
    ["'as a large language'", "As a large language model, I produced this section."],
    ["'I don't have access'", "I don't have access to the tender portal."],
  ];

  for (const [label, line] of traces) {
    it(`blocks ${label}`, async () => {
      const verdict = await verdictFor(`${CLEAN_TECHNICAL}\n${line}\n`);
      assert.equal(verdict.score, "BLOCKED");
      assert.ok(verdict.validation.aiTrace.length > 0,
        `${label} must be reported as an AI trace, got: ${codes(verdict).join(",")}`);
    });
  }

  it("does NOT flag 'is unable' without AI context", async () => {
    const verdict = await verdictFor(`${CLEAN_TECHNICAL}\nHope Engineering is unable to provide a fixed-price guarantee at this stage.\n`);
    assert.equal(verdict.validation.aiTrace.length, 0,
      `flagged: ${verdict.validation.aiTrace.join(" | ")}`);
  });
});

describe("Document validator — forbidden content in final docs", () => {
  it("an empty document can never be clean", async () => {
    const verdict = await verdictFor("");
    assert.equal(verdict.score, "BLOCKED");
    assert.ok(verdict.validation.isEmpty);
  });

  it("the panel verdict can never be clean while the readiness gate fails the document", async () => {
    // The exact contradiction reported on the live tender: Document Validator
    // said CLEAN / Warning 0 / Blocked 0 while Export Readiness said
    // GENERATED_DOCUMENT_QUALITY_FAILED. BLOCKED is defined to include the
    // readiness gate's QUALITY_FAILED verdict, so this cannot recur.
    const verdict = await verdictFor("Short.");
    assert.equal(verdict.report.recommendedStatus, "QUALITY_FAILED");
    assert.equal(verdict.score, "BLOCKED");
  });
});
