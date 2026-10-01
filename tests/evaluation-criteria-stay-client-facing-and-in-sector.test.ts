import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildProposalIntelligence, splitEvaluationCriterion } from "../lib/engine/proposal-intelligence";

// ─── What this file proves ───────────────────────────────────────────────────
//
// Two defects observed in a real generated Technical Proposal, both traced to
// detectEvaluationCriteria():
//
// 1. CROSS-SENTENCE MATCHING. textOf()/clean() collapse every newline before
//    the detector runs, so the 2,000-character "evaluation criteria" window is
//    one long line. `/compliance.*experience/i` then matched the span
//    "Compliance with submission requirements … focus on <sector> project
//    experience" — two unrelated list items — and a FINANCIAL SERVICES /
//    Basel-IFRS criterion was written into a hospital proposal. Bare `/GIS/`
//    matched the "gis" inside "registration" and added urban master planning
//    beside it. The shipped document carried both as sub-sections C.6 and C.7.
//
// 2. WRITER INSTRUCTIONS USED AS CLIENT-FACING HEADINGS. Catalogue entries are
//    authored as "<criterion> — <how to answer it>", and the whole string was
//    used as a heading and as a self-score table row. The evaluator read
//    "C.7 Financial services / regulatory compliance experience — lead with
//    named institutions, regulatory standard met (Basel/IFRS), and go-live
//    outcomes", i.e. the bid team's own instructions to itself.
//
// The fixtures below are a hospital assignment and a water assignment; nothing
// here encodes any particular client, company or export.

const company = {
  name: "Meridian Consulting Engineers",
  profileSummary: "Architectural and engineering design.",
  serviceLines: JSON.stringify(["Architecture", "MEP design"]),
  sectors: JSON.stringify(["Healthcare", "Water"]),
};
const experts = [{
  fullName: "A. Okonjo",
  title: "Senior Architect",
  disciplines: JSON.stringify(["Architecture"]),
  sectors: JSON.stringify(["Healthcare"]),
  certifications: JSON.stringify([]),
  profile: "Hospital design.",
}];
const projects = [{
  name: "Regional Referral Hospital",
  clientName: "Regional Health Bureau",
  sector: "Healthcare",
  serviceAreas: JSON.stringify(["Design"]),
  summary: "Design of a referral hospital.",
}];

function intelligenceFor(description: string, requirements: Array<Record<string, string>> = []) {
  return buildProposalIntelligence({
    tender: {
      title: "Architectural Consultancy Services for a Specialty Medical Centre",
      clientName: "Northern Health Trust",
      procuringEntityName: "Northern Health Trust",
      country: "Kenya",
      description,
      submissionMethod: "Email",
    },
    company,
    requirements: requirements as never,
    experts,
    projects,
  });
}

// The shape that produced the defect: separate list items, each ending in a
// full stop, collapsed onto one line before the detector sees them.
const HOSPITAL_EVALUATION_SECTION = [
  "Evaluation Criteria.",
  "Relevant healthcare project experience.",
  "Technical understanding of healthcare facility design.",
  "Compliance with submission requirements.",
  "Valid business licence and registration documents for local operation.",
  "Quality and relevance of project portfolio.",
].join("\n");

describe("evaluation criteria are detected per phrase, not across the whole window", () => {
  it("does not import an unrelated sector from two unrelated phrases", () => {
    const intel = intelligenceFor(HOSPITAL_EVALUATION_SECTION);
    const joined = intel.evaluationCriteria.join(" | ");

    assert.doesNotMatch(joined, /financial services/i, `financial-services criterion leaked into a healthcare tender: ${joined}`);
    assert.doesNotMatch(joined, /Basel|IFRS/i, `banking-regulation criterion leaked into a healthcare tender: ${joined}`);
    assert.doesNotMatch(joined, /master planning/i, `urban-planning criterion leaked into a healthcare tender: ${joined}`);
  });

  it("still detects the criteria the tender genuinely states", () => {
    // The precision fix must not have been achieved by making the detector
    // inert.
    const intel = intelligenceFor(HOSPITAL_EVALUATION_SECTION);
    const joined = intel.evaluationCriteria.join(" | ");
    assert.match(joined, /healthcare/i, `no healthcare criterion detected from a healthcare tender: ${joined}`);
  });

  it("does not read an acronym out of the middle of an ordinary word", () => {
    // "registration" contains "gis"; a bare /GIS/ matched it.
    const intel = intelligenceFor("Evaluation Criteria. Valid business registration documents are mandatory.");
    assert.doesNotMatch(intel.evaluationCriteria.join(" | "), /master planning/i);
  });
});

describe("criterion labels shown to the client carry no writer instructions", () => {
  it("keeps the in-house guidance out of every client-facing label", () => {
    const intel = intelligenceFor(HOSPITAL_EVALUATION_SECTION);
    assert.ok(intel.evaluationCriteria.length > 0, "no criteria detected — fixture is not exercising the catalogue");
    for (const criterion of intel.evaluationCriteria) {
      assert.doesNotMatch(
        criterion,
        / — /,
        `a client-facing criterion still carries its writer guidance: ${criterion}`,
      );
      assert.doesNotMatch(
        criterion,
        /\b(lead with|show |demonstrate |include |echo )/i,
        `a client-facing criterion still reads as an instruction to the bid team: ${criterion}`,
      );
    }
  });

  it("keeps that guidance available for the writer", () => {
    const intel = intelligenceFor(HOSPITAL_EVALUATION_SECTION);
    assert.equal(intel.evaluationCriteriaWriterNotes.length, intel.evaluationCriteria.length);
    assert.ok(
      intel.evaluationCriteriaWriterNotes.some((note) => / — /.test(note)),
      "the guidance half was dropped instead of being routed to the writer",
    );
    for (const [index, note] of intel.evaluationCriteriaWriterNotes.entries()) {
      assert.ok(note.startsWith(intel.evaluationCriteria[index]), "writer note and label describe different criteria");
    }
  });

  it("splits an entry into its label and its guidance", () => {
    const split = splitEvaluationCriterion("Relevant healthcare experience — lead with named hospitals");
    assert.equal(split.label, "Relevant healthcare experience");
    assert.equal(split.guidance, "lead with named hospitals");
    assert.deepEqual(splitEvaluationCriterion("Compliance with all submission requirements"), {
      label: "Compliance with all submission requirements",
      guidance: null,
    });
  });
});
