import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { stripInternalReviewSections } from "../lib/engine/internal-review-stripper";

// ─── What this file proves ───────────────────────────────────────────────────
//
// A real client-facing Technical Proposal shipped a top-level section titled
// "Compliance and Bid Review Notes" whose bullets were the engine's own
// working context, printed verbatim to the evaluator:
//
//   - the internal support levels and record identifiers
//     ("PARTIAL: Cover Letter | PROPOSAL_RESPONSE from Company evidence
//       available for drafting | ref: Key-Experts-1.txt");
//   - a serialized automatic-requirement-evidence:v1 payload with content
//     hashes and linkage scores;
//   - Company Vault FILE NAMES and raw extracted vault text, including a
//     named employee's date of birth and personal phone number;
//   - and, under "Senior Bid-Review Items (gaps to address before
//     submission)", the bid team's own instructions to itself.
//
// The deterministic builder no longer emits that section — it emits a
// Compliance Statement pointing at the evidence-mapped matrix. This file pins
// the second line of defence: whatever path produces such a heading, it must
// not reach the rendered document.

const PROPOSAL = [
  "# Section D: Additional Information",
  "",
  "Additional certifications are provided in the appendices.",
  "",
  "# Compliance and Bid Review Notes",
  "",
  "This proposal is submitted in strict compliance with the tender instructions.",
  "",
  "- PARTIAL: Cover Letter | PROPOSAL_RESPONSE from Company evidence available for drafting | ref: Key-Experts-1.txt",
  "- FULL: Submission Format | PACKAGE_CONFORMANCE from AUTO_PACKAGE_CONFORMANCE | ref: Current submission package — automatic-requirement-evidence:v1:{\"linkageScore\":100}",
  "- Company document: Key-Experts-1.txt | category: EXPERT | evidence: Date of Birth March 19, 1990 Phone +251 911 169930",
  "",
  "## Senior Bid-Review Items (gaps to address before submission)",
  "",
  "- Tender requires a biomedical engineering specialist. No biomedical expert is currently selected.",
  "",
  "# Appendix Register",
  "",
  "- Appendix A: Company Profile and Registration Documents",
].join("\n");

describe("bid-review working notes never reach the client document", () => {
  const { markdown, removedSections } = stripInternalReviewSections(PROPOSAL);

  it("removes the bid-review sections and everything under them", () => {
    assert.doesNotMatch(markdown, /Compliance and Bid Review Notes/i);
    assert.doesNotMatch(markdown, /Senior Bid-Review Items/i);
    assert.doesNotMatch(markdown, /PROPOSAL_RESPONSE|PACKAGE_CONFORMANCE/, "engine support records survived");
    assert.doesNotMatch(markdown, /automatic-requirement-evidence:v1/, "the serialized evidence payload survived");
    assert.doesNotMatch(markdown, /Key-Experts-1\.txt/, "a vault file name survived");
    assert.doesNotMatch(markdown, /Date of Birth|\+251 911/, "an employee's personal details survived");
    assert.doesNotMatch(markdown, /No biomedical expert is currently selected/, "an internal review action survived");
  });

  it("keeps preceding client content but removes a phantom appendix register", () => {
    assert.match(markdown, /# Section D: Additional Information/);
    assert.match(markdown, /Additional certifications are provided in the appendices\./);
    assert.doesNotMatch(markdown, /# Appendix Register/);
    assert.doesNotMatch(markdown, /Appendix A: Company Profile and Registration Documents/);
  });

  it("reports what it removed, for audit", () => {
    assert.ok(removedSections.some((section) => /Compliance and Bid Review Notes/i.test(section)));
  });
});

// ─── Section F must not invent an evaluation weight ──────────────────────────
//
// The "Weight / priority" column printed `100 - index * 5` as "N% relative
// attention". That figure is the requirement's position in a list, not
// anything the tender said: the shipped proposal told the evaluator their own
// criteria carried "100%", "80%", "75%" and "65% relative attention". An
// invented weight in the column an evaluator uses to check their own scoring
// is a fabricated fact, and the phrase itself is internal jargon.

import { applyProposalQualityRepairAddenda } from "../lib/engine/proposal-quality-repair";

const MATRIX_INPUT = {
  tenderTitle: "Architectural Consultancy Services for a Specialty Medical Centre",
  clientName: "Northern Health Trust",
  requirements: [
    "Company Profile and Legal Registration — provide a company profile and a valid business licence.",
    "Healthcare Compliance and Workflow Planning Approach — describe the approach to healthcare compliance.",
    "Relevant Healthcare Project Experience & Portfolio — present proven healthcare design experience.",
    "Proposed Professional Team & Expertise — submit details of the proposed multidisciplinary team.",
  ],
  expertLines: ["A. Okonjo — Senior Architect"],
  projectLines: ["Regional Referral Hospital — Regional Health Bureau"],
  companyEvidenceLines: ["Company document: Company-Profile.txt"],
  projectEvidenceLines: ["Project evidence: Regional Referral Hospital"],
  complianceLines: ["SUBSTANTIAL: Company Profile and Legal Registration | COMPANY_DOCUMENT from Company profile"],
  differentiators: ["Healthcare-specific design depth."],
};

describe("the evaluator mirror never invents a weight the tender did not state", () => {
  const output = applyProposalQualityRepairAddenda("# Technical Proposal\n\nBody.\n", MATRIX_INPUT as never);

  it("prints no fabricated percentage weight", () => {
    assert.doesNotMatch(output, /relative attention/i, "the internal weight phrase is still printed");
    assert.doesNotMatch(output, /\|\s*\d{1,3}%\s*\|/, "a percentage weight the tender never stated is still printed");
  });

  it("prints no internal trace label", () => {
    assert.doesNotMatch(output, /\bTRB-\d+/, "an internal trace label is still printed");
  });

  it("still states the priority it can support", () => {
    assert.match(output, /Mandatory \/ pass-fail|Scored criterion \(no weight stated in tender\)/);
  });
});

// ─── One Section H, not two contradictory ones ───────────────────────────────
//
// The AI writer is prompted to produce Section H, and the quality-repair
// addenda insert their own whenever none is present. The deterministic builder
// is meant to be the single owner, but the strip ran only over the raw AI
// markdown — so the repair pass refilled the hole and the deterministic
// section was appended beside it. A real client proposal shipped two
// self-score tables back to back: "Predicted overall technical score: 45/100"
// followed by "Predicted overall technical score: 69 / 100".

import { stripSelfScoreSections } from "../lib/engine/self-score-builder";

const TWO_SELF_SCORES = [
  "# Technical Proposal",
  "",
  "Body text.",
  "",
  "## Section H: Proposal Self-Score",
  "",
  "| Self-score axis | Score |",
  "|---|---|",
  "| Tender requirement coverage | 9/10 |",
  "",
  "Predicted overall technical score: 45/100.",
  "",
  "## SECTION H: PROPOSAL SELF-SCORE",
  "",
  "**Predicted overall technical score: 69 / 100.**",
  "",
  "## Annex & Appendix Readiness Register",
  "",
  "- Annex A",
].join("\n");

describe("the proposal carries exactly one self-score section", () => {
  it("removes every upstream self-score section, whatever its casing", () => {
    const stripped = stripSelfScoreSections(TWO_SELF_SCORES);
    assert.doesNotMatch(stripped, /self.?score/i, `a self-score section survived:\n${stripped}`);
    assert.doesNotMatch(stripped, /Predicted overall technical score/i, "a predicted score survived");
  });

  it("leaves the surrounding document intact", () => {
    const stripped = stripSelfScoreSections(TWO_SELF_SCORES);
    assert.match(stripped, /# Technical Proposal/);
    assert.match(stripped, /Body text\./);
    assert.match(stripped, /## Annex & Appendix Readiness Register/);
    assert.match(stripped, /- Annex A/);
  });

  it("is a no-op on a document that has none", () => {
    const clean = "# Technical Proposal\n\nBody text.\n";
    assert.equal(stripSelfScoreSections(clean), clean);
  });
});
