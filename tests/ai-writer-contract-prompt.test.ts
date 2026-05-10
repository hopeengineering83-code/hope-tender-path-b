import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { AIBidWriterInput } from "../lib/ai";
import { augmentAIWriterInputWithContract, buildAIWriterContractPrompt } from "../lib/engine/ai-writer-contract-prompt";

const contractInput = {
  tenderTitle: "RFP for Hospital Design, Interior Design, Supervision and Contract Administration Services",
  clientName: "Health Client",
  requirements: [
    "[page 4] Technical and financial proposals must be submitted separately in two envelopes.",
    "[page 8] Bidders must provide similar hospital project references and completion certificates.",
    "[page 11] Provide CVs for key professional staff for design, supervision and contract administration.",
  ],
  expertLines: ["Reviewed expert: Senior architect with hospital design and supervision CV."],
  projectLines: [
    "Reviewed project: Hospital and specialty clinic design, interior design, supervision and handover for healthcare client.",
    "Reviewed project: Warehouse and logistics park design for distribution operator.",
  ],
  companyEvidenceLines: ["Company evidence: valid registration certificate and tax clearance."],
  projectEvidenceLines: ["Project evidence: completion certificate for hospital facility assignment."],
  complianceLines: ["Submit separate technical and financial proposal envelopes before the deadline."],
  differentiators: ["Healthcare workflow and multidisciplinary design-supervision capability."],
  evaluationCriteria: ["Relevant hospital experience", "Strength of professional team", "Methodology and work plan"],
  submissionRules: ["Technical and financial proposals must be separate."],
  selectedExpertCount: 1,
  selectedProjectCount: 2,
  reviewedExpertCount: 1,
  reviewedProjectCount: 2,
  tenderSources: [
    {
      id: "tender-file-1",
      name: "hospital-rfp.pdf",
      text: [
        "[page 4] Technical and financial proposals must be submitted separately in two envelopes.",
        "[page 8] Bidders must provide similar hospital project references and completion certificates.",
        "[page 11] Provide CVs for key professional staff for design, supervision and contract administration.",
      ].join("\n\n"),
    },
  ],
};

const aiInput: AIBidWriterInput = {
  tenderTitle: contractInput.tenderTitle,
  clientName: contractInput.clientName,
  tenderText: "Hospital RFP tender text",
  analysisSummary: "Existing analysis summary",
  evaluationMethodology: "Existing evaluation method",
  submissionNotes: "Existing submission notes",
  requirements: "Existing extracted requirements",
  companyProfile: "Existing company profile",
  experts: "Existing expert lines",
  projects: "Existing project lines",
  compliance: "Existing compliance lines",
  differentiators: "Existing differentiators",
  criterionEvidenceMap: "Existing criterion map",
};

describe("AI writer contract prompt", () => {
  it("renders full Proposal Intelligence Contract detail before drafting", () => {
    const prompt = buildAIWriterContractPrompt(contractInput);

    assert.match(prompt, /NON-NEGOTIABLE PROPOSAL INTELLIGENCE CONTRACT/);
    assert.match(prompt, /FULL CONTRACT DETAIL FOR DRAFTING/);
    assert.match(prompt, /Source-Grounded Requirement Map/);
    assert.match(prompt, /Evidence Graph Selection Model/);
    assert.match(prompt, /Contract Export Gates/);
    assert.match(prompt, /hospital-rfp\.pdf/);
    assert.match(prompt, /Never use UNFIT nodes as proposal evidence/);
    assert.match(prompt, /Do not invent project names, expert credentials, certificate numbers, page references/);
  });

  it("prepends contract controls to all AI writer control fields without dropping existing content", () => {
    const augmented = augmentAIWriterInputWithContract(aiInput, contractInput);

    assert.match(augmented.analysisSummary, /CONTRACT-FIRST ANALYSIS CONTROLS/);
    assert.match(augmented.analysisSummary, /Existing analysis summary/);
    assert.match(augmented.evaluationMethodology, /CONTRACT-FIRST EVALUATION CONTROLS/);
    assert.match(augmented.evaluationMethodology, /Existing evaluation method/);
    assert.match(augmented.requirements, /CONTRACT-FIRST REQUIREMENT CONTROLS/);
    assert.match(augmented.requirements, /Existing extracted requirements/);
    assert.match(augmented.compliance, /CONTRACT-FIRST COMPLIANCE CONTROLS/);
    assert.match(augmented.compliance, /Existing compliance lines/);
    assert.match(augmented.criterionEvidenceMap ?? "", /CONTRACT-FIRST CRITERION \/ EVIDENCE CONTROLS/);
    assert.match(augmented.criterionEvidenceMap ?? "", /Existing criterion map/);
  });
});
