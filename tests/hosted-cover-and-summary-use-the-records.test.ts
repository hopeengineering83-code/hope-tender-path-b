// The Cover Letter and Executive Summary are composed from the records on
// every path, including a hosted run whose cover-and-summary section falls
// back while the other sections are model-written.
//
// That section's deterministic text (proposal-sections.ts
// buildSectionFallback) sees only the writer's flattened text fields, and a
// hosted run opened with "The closest comparable project in <firm>'s record is
// ..." and one more sentence, while the whole-document fallback built from the
// same records printed a full summary. generate-elite.ts now composes both
// sections once (recordBasedOpeningSections) and hands them to the writer.
// Fixtures are a school, not the tender that exposed the gap.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { recordBasedOpeningSections } from "../lib/engine/generate-elite";
import { buildSectionFallback } from "../lib/engine/proposal-sections";
import { scopePlan } from "../lib/engine/scope-delivery-plan";
import type { AIBidWriterInput } from "../lib/ai";
import type { ProposalSectionSpec } from "../lib/engine/proposal-sections";
import type { ExpertRecord, ProjectRecord } from "../lib/engine/benchmark-tables";

const TENDER = [
  "[Page 3] SCOPE OF SERVICES",
  "1. Site Assessment",
  "The consultant shall assess the existing school buildings for structural adequacy.",
  "2. Architectural Design",
  "The consultant shall prepare concept and detailed architectural design for six classrooms.",
  "3. Construction Supervision",
  "The consultant shall supervise the construction works for compliance with the approved design.",
  "[Page 4] EVALUATION CRITERIA",
].join("\n");

const EXPERTS = [
  { fullName: "G. Principal", title: "General Manager & Structural Engineer", certifications: JSON.stringify(["Registered Structural Engineer (RSE/77)"]) },
  { fullName: "A. Design", title: "Senior Architect", certifications: JSON.stringify(["Registered Architect (RA/101)"]) },
  { fullName: "S. Site", title: "Resident Engineer" },
] as ExpertRecord[];

const PROJECTS = [
  { name: "District School", country: "Rwanda", summary: "A 1,500 m² school.", serviceAreas: JSON.stringify(["Structural assessment", "Architectural design"]) },
  { name: "County Clinic", country: "Rwanda", summary: "A 900 m² clinic.", serviceAreas: JSON.stringify(["Construction supervision"]) },
] as ProjectRecord[];

function openers() {
  return recordBasedOpeningSections({
    companyName: "Example Consulting",
    clientName: "Ministry of Education",
    tenderTitle: "Design of Six Classrooms",
    primarySector: "Education",
    location: "Kigali",
    scopePlan: scopePlan({ tenderText: TENDER, experts: EXPERTS }),
    projects: PROJECTS,
    experts: EXPERTS,
    evaluationCriteria: ["Experience", "Team"],
    companyDescription: "multidisciplinary engineering consultancy",
    companyComplianceRecords: [{ title: "Quality Management System Manual", complianceType: "QMS", status: "ACTIVE", referenceNumber: "QM/01" }],
    recipients: "procurement@example.test",
    subject: "Technical Proposal for Design of Six Classrooms",
    technicalOnly: true,
    salutation: "Dear Evaluation Committee,",
    signOff: ["Sincerely,", "**G. Principal**", "General Manager & Structural Engineer"],
  });
}

describe("record-based Cover Letter and Executive Summary", () => {
  it("the letter states the assignment, the evidence and the team from the records, concisely", () => {
    const md = openers();
    const letter = md.slice(md.indexOf("# Cover Letter"), md.indexOf("# Executive Summary"));
    assert.match(letter, /To: procurement@example\.test/);
    assert.match(letter, /TECHNICAL PROPOSAL ONLY/);
    assert.match(letter, /in Kigali, in response to the invitation issued by Ministry of Education/);
    assert.match(letter, /3 linked services, from site assessment to construction supervision/);
    assert.match(letter, /\*\*Comparable experience\.\*\* District School \(Rwanda, 1,500 m²\) and County Clinic \(Rwanda, 900 m²\), whose recorded services cover 3 of the 3 scope items/);
    assert.match(letter, /\*\*A named, registered team\.\*\* 3 experts led by G\. Principal/);
    assert.match(letter, /Quality Management System Manual \(QM\/01\)/);
    assert.match(letter, /\*\*G\. Principal\*\*/);
    // Concise: the letter introduces; the summary argues.
    assert.ok(letter.split(/\s+/).length < 260, `${letter.split(/\s+/).length} words`);
  });

  it("the summary names the need, each reference's services once, the coverage and the team", () => {
    const md = openers();
    const summary = md.slice(md.indexOf("# Executive Summary"));
    assert.match(summary, /Ministry of Education has invited proposals for Design of Six Classrooms in Kigali/);
    assert.match(summary, /On District School \(Rwanda, 1,500 m²\), the firm's recorded services included structural assessment and architectural design\./);
    assert.match(summary, /these services already cover 3 of the 3 scope items: site assessment, architectural design and construction supervision/);
    assert.match(summary, /led by G\. Principal/);
  });

  it("invents nothing: no figure, standard or claim that is not in the fixtures", () => {
    const md = openers();
    assert.doesNotMatch(md, /\b(?:ISO|years of experience|award|leading|best-in-class|USD|ETB)\b/i);
  });

  it("is empty when the tender's scope could not be read, so the caller keeps its own text", () => {
    const empty = recordBasedOpeningSections({
      companyName: "X", clientName: "Y", tenderTitle: "Z", primarySector: "S", scopePlan: [],
      recipients: "r", subject: "s", technicalOnly: false, salutation: "Dear,", signOff: [],
    });
    assert.equal(empty, "");
  });
});

describe("the per-section writer's cover-and-summary fallback uses them", () => {
  const spec = { id: "cover-and-summary" } as unknown as ProposalSectionSpec;
  const base = {
    tenderTitle: "Design of Six Classrooms", clientName: "Ministry of Education", tenderText: TENDER,
    analysisSummary: "", evaluationMethodology: "", submissionNotes: "", requirements: "", companyProfile: "",
    experts: "", projects: "", compliance: "", differentiators: "", companyVault: { name: "Example Consulting" },
  } as unknown as AIBidWriterInput;

  it("returns the record-based sections when the caller composed them", () => {
    const md = buildSectionFallback(spec, { ...base, recordBasedOpeners: openers() });
    assert.equal(md, openers());
  });

  it("keeps its own text for a caller that could not", () => {
    const md = buildSectionFallback(spec, base);
    assert.match(md, /# Cover Letter/);
    assert.match(md, /# Executive Summary/);
  });

  it("generate-elite hands the composed sections to the writer", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.match(src, /recordBasedOpeners: recordBasedOpeningSections\(\{/);
  });
});
