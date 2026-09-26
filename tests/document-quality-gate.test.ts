// Generated-document quality gate — the rule layer that decides whether
// a generated document can be marked PASSED/APPROVED/READY_FOR_EXPORT or
// must instead be QUALITY_FAILED/NEEDS_REWRITE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

function technicalDoc(overrides: Partial<Parameters<typeof assessGeneratedDocumentQuality>[0]>) {
  return assessGeneratedDocumentQuality({
    doc: { id: "x", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" },
    ...overrides,
  });
}

describe("document quality gate — extreme regressions from the screenshots", () => {
  it("fails an empty document", () => {
    const r = technicalDoc({ visibleText: "" });
    assert.ok(r.score <= 20, `expected ≤20, got ${r.score}`);
    assert.ok(["QUALITY_FAILED", "DRAFT_ONLY"].includes(r.recommendedStatus));
  });

  it("fails a one-paragraph technical proposal", () => {
    const r = technicalDoc({ visibleText: "Our firm has extensive experience in this field. We will deliver excellent results using our holistic approach to project management." });
    assert.equal(r.recommendedStatus, "QUALITY_FAILED");
    assert.ok(r.issues.some((i) => i.code === "TOO_SHORT"));
  });

  it("fails when Bid-Team to confirm appears in the body", () => {
    const longBody = "Methodology section. " + "We will follow international standards and proven practices. ".repeat(100) +
      "Project director: Bid-Team to confirm. Schedule: TBD.";
    const r = technicalDoc({ visibleText: longBody });
    assert.equal(r.recommendedStatus, "QUALITY_FAILED");
    assert.ok(r.issues.some((i) => i.code === "BID_TEAM_TO_CONFIRM"));
  });

  it("fails when AI/meta trace appears in the body", () => {
    const body = "Technical Proposal\n" + "We have extensive expertise across all relevant sectors. ".repeat(80) +
      "As an AI language model, I recommend reviewing this section.";
    const r = technicalDoc({ visibleText: body });
    assert.equal(r.recommendedStatus, "QUALITY_FAILED");
    assert.ok(r.issues.some((i) => i.code === "AI_TRACE"));
  });

  it("fails when internal traceability (source-id / evidence-id / win probability) appears", () => {
    const body = "Technical Proposal\n" + "Our team will deliver the work in three phases. ".repeat(80) +
      "Source-id: req-007. Win probability: 78. Match-score: 0.87.";
    const r = technicalDoc({ visibleText: body });
    assert.ok(r.issues.some((i) => i.code === "INTERNAL_TRACEABILITY"));
    assert.notEqual(r.recommendedStatus, "PASSED");
  });

  it("does not flag ordinary QA-process prose as internal traceability", () => {
    // A real technical proposal was failed at HIGH severity for the sentence
    // below. "internal review" describes how the firm assures quality; it is
    // not a working note that leaked into the submission. The refusal was one
    // the owner could not act on, because nothing was wrong with the text.
    const body = "Technical Proposal\n"
      + "Quality assurance is applied through independent internal review before any deliverable is issued. ".repeat(40)
      + "Every calculation set is checked by an engineer who did not prepare it. ".repeat(40);
    const r = technicalDoc({ visibleText: body });
    assert.ok(
      !r.issues.some((i) => i.code === "INTERNAL_TRACEABILITY"),
      `QA-process prose must not be reported as internal traceability: ${JSON.stringify(r.issues)}`,
    );
  });

  it("still flags genuine internal annotation markers", () => {
    for (const marker of [
      "Internal use only.",
      "Internal note: confirm the deadline with the client.",
      "For internal review before issue.",
      "Reviewer note: rewrite this paragraph.",
    ]) {
      const body = "Technical Proposal\n" + "Our team will deliver the work in three phases. ".repeat(80) + marker;
      const r = technicalDoc({ visibleText: body });
      assert.ok(
        r.issues.some((i) => i.code === "INTERNAL_TRACEABILITY"),
        `"${marker}" must still be caught as internal traceability`,
      );
    }
  });

  it("detects generic marketing filler", () => {
    const body = "Technical Proposal. " + "We bring a state-of-the-art, holistic approach with cutting-edge methodologies. ".repeat(80);
    const r = technicalDoc({ visibleText: body });
    assert.ok(r.issues.some((i) => i.code === "GENERIC_FILLER"));
  });

  it("detects duplicated sections (heading repeated ≥3 times)", () => {
    const heading = "# Methodology and Work Plan";
    const body = `${heading}\nContent A\n${heading}\nContent B\n${heading}\nContent C\n`;
    const r = technicalDoc({ visibleText: body + "lorem ipsum ".repeat(200) });
    assert.ok(r.issues.some((i) => i.code === "DUPLICATED_SECTIONS"));
  });
});

describe("document quality gate — official-original placeholder risk", () => {
  it("flags an official original (Bid Bond) that contains placeholder language", () => {
    const r = assessGeneratedDocumentQuality({
      doc: { name: "Bid Bond", exactFileName: "Bid-Bond.docx", documentType: "FORM", format: "DOCX" },
      visibleText: "Bid Bond. Issued by: Bid-Team to confirm. Amount: TBD.",
    });
    assert.ok(r.issues.some((i) => i.code === "OFFICIAL_ORIGINAL_PLACEHOLDER_RISK"));
    assert.equal(r.recommendedStatus, "QUALITY_FAILED");
  });
});

describe("document quality gate — methodology document with strong content", () => {
  it("does NOT fail a methodology doc that mentions phases, tasks, deliverables, qa, risk", () => {
    const body = `Methodology and Work Plan

We will deliver this engagement in five phases.

Phase 1 covers inception. Tasks include kick-off, stakeholder mapping, and baseline review.

Phase 2 covers diagnostics. Deliverables include a draft assessment and a list of priority interventions.

Phase 3 covers detailed design. We will produce the schedule and the qa/qc plan.

Phase 4 covers implementation oversight, with monthly reporting against the schedule.

Phase 5 covers handover. Risk register and mitigation owners are maintained throughout.

Schedule: indicative duration is 24 weeks across the five phases.

` + "Each phase concludes with a structured review against the relevant tender requirements. ".repeat(80);
    const r = assessGeneratedDocumentQuality({
      doc: { name: "Methodology and Work Plan", exactFileName: "Methodology-and-Work-Plan.docx", documentType: "METHODOLOGY", format: "DOCX" },
      visibleText: body,
    });
    assert.notEqual(r.recommendedStatus, "QUALITY_FAILED");
    assert.ok(r.wordCount >= 800, `expected ≥800 words, got ${r.wordCount}`);
  });
});
