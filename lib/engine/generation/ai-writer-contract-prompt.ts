import { renderProposalIntelligencePromptBlock, type ProposalIntelligenceContractInput } from "./proposal-intelligence-contract";


function clean(value?: string | null): string {
  return (value ?? "").trim();
}

export function buildAIWriterContractPromptBlock(contractInput: ProposalIntelligenceContractInput): string {
  return renderProposalIntelligencePromptBlock(contractInput);
}

export function applyAIWriterContractPrompt<T extends { requirements: string; compliance: string; criterionEvidenceMap?: string }>(params: {
  aiInput: T;
  contractInput: ProposalIntelligenceContractInput;
}): T {
  const block = buildAIWriterContractPromptBlock(params.contractInput);
  const prepend = (text?: string) => (clean(text) ? `${block}\n\n${clean(text)}` : block);

  return {
    ...params.aiInput,
    requirements: prepend(params.aiInput.requirements),
    compliance: prepend(params.aiInput.compliance),
    criterionEvidenceMap: prepend(params.aiInput.criterionEvidenceMap),
  };
}
