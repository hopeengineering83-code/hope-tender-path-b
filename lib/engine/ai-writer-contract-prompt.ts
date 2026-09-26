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

/**
 * The writer input with the contract block taken back out.
 *
 * applyAIWriterContractPrompt prepends the contract to `requirements`,
 * `compliance` and `criterionEvidenceMap` because the model must read it
 * first. The deterministic section writer reads the same fields as DATA:
 * it took every line of `requirements` for a tender requirement, and run
 * 36049851073 delivered "C.3.1 PROPOSAL INTELLIGENCE CONTRACT — obey before
 * drafting:", "Criterion graph: 10 criteria; 0 critical" and "Evidence
 * graph: directProjects=1" as methodology headings and work-plan stages.
 */
export function withoutAIWriterContractPrompt<T extends { requirements: string; compliance: string; criterionEvidenceMap?: string }>(aiInput: T): T {
  return {
    ...aiInput,
    requirements: stripAIWriterContractPromptBlock(aiInput.requirements),
    compliance: stripAIWriterContractPromptBlock(aiInput.compliance),
    ...(aiInput.criterionEvidenceMap !== undefined ? { criterionEvidenceMap: stripAIWriterContractPromptBlock(aiInput.criterionEvidenceMap) } : {}),
  };
}

const CONTRACT_BLOCK_HEADER = "PROPOSAL INTELLIGENCE CONTRACT — obey before drafting:";

/** Removes a leading contract block: its lines run to the first blank line. */
export function stripAIWriterContractPromptBlock(text: string | undefined): string {
  const value = text ?? "";
  if (!value.trimStart().startsWith(CONTRACT_BLOCK_HEADER)) return value;
  const body = value.trimStart();
  const end = body.search(/\n[ \t]*\n/);
  return end < 0 ? "" : body.slice(end).replace(/^\s+/, "");
}
