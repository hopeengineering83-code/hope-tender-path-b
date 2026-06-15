import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyAIWriterContractPrompt, buildAIWriterContractPromptBlock } from "../lib/engine/generation/ai-writer-contract-prompt";

const contractInput = {
  tenderTitle: "RFP for Hospital Design and Supervision Services",
  clientName: "Health Client",
  requirements: [
    "Technical and financial proposals shall be submitted in separate envelopes.",
    "Provide at least two comparable hospital projects with completion evidence.",
  ],
  expertLines: ["Reviewed expert: Senior architect with hospital supervision experience."],
  projectLines: ["Reviewed project: Hospital architectural design and supervision with completion certificate."],
  companyEvidenceLines: ["Company evidence: valid registration certificate."],
  projectEvidenceLines: ["Project evidence: completion certificate and client acceptance."],
  complianceLines: ["Submission by sealed envelopes before deadline."],
  differentiators: ["Healthcare-specialized multidisciplinary team."],
};

describe("ai writer contract prompt", () => {
  it("renders a non-negotiable proposal intelligence contract block", () => {
    const block = buildAIWriterContractPromptBlock(contractInput);
    assert.match(block, /PROPOSAL INTELLIGENCE CONTRACT/i);
    assert.match(block, /Use DIRECT evidence/i);
    assert.match(block, /UNFIT nodes must not be used/i);
  });

  it("prepends the contract block to requirements, compliance, and criterion evidence map", () => {
    const aiInput = applyAIWriterContractPrompt({
      aiInput: {
        requirements: "REQ-LINE",
        compliance: "COMP-LINE",
        criterionEvidenceMap: "CRITERION-MAP",
      },
      contractInput,
    });

    assert.match(aiInput.requirements, /PROPOSAL INTELLIGENCE CONTRACT/i);
    assert.match(aiInput.compliance, /PROPOSAL INTELLIGENCE CONTRACT/i);
    assert.match(aiInput.criterionEvidenceMap ?? "", /PROPOSAL INTELLIGENCE CONTRACT/i);
    assert.ok(aiInput.requirements.endsWith("REQ-LINE"));
    assert.ok(aiInput.compliance.endsWith("COMP-LINE"));
    assert.ok((aiInput.criterionEvidenceMap ?? "").endsWith("CRITERION-MAP"));
  });
});
