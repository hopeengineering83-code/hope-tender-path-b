import type { AIBidWriterInput } from "../ai";
import { renderProposalIntelligencePromptBlock, type ProposalIntelligenceContractInput } from "./proposal-intelligence-contract";

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function section(title: string, body: string): string {
  const value = body.trim();
  return value ? `${title}\n${value}` : title;
}

export function buildAIWriterContractPrompt(input: ProposalIntelligenceContractInput): string {
  const prompt = renderProposalIntelligencePromptBlock(input);
  return [
    "=== NON-NEGOTIABLE PROPOSAL INTELLIGENCE CONTRACT ===",
    "Use this contract before drafting. It overrides generic proposal-writing habits. Do not treat it as an appendix or postscript.",
    prompt,
    "Writer application rules:",
    "- Use DIRECT Evidence Graph nodes as primary proof points.",
    "- Use TRANSFERABLE Evidence Graph nodes only with explicit caveats about what matches and what differs.",
    "- Do not use UNFIT nodes as proposal evidence.",
    "- Address BLOCK export gates as bid-team actions, not as unsupported claims.",
    "- Source-grounded tender requirements control the compliance matrix and section plan.",
    "- Tender-form strategy controls the document shape before prose style.",
    "=== END PROPOSAL INTELLIGENCE CONTRACT ===",
  ].join("\n");
}

export function augmentAIWriterInputWithContract(input: AIBidWriterInput, contractInput: ProposalIntelligenceContractInput): AIBidWriterInput {
  const contractPrompt = buildAIWriterContractPrompt(contractInput);
  const existingCriterionMap = clean(input.criterionEvidenceMap);
  return {
    ...input,
    requirements: [
      contractPrompt,
      section("=== EXTRACTED TENDER REQUIREMENTS ===", input.requirements),
    ].join("\n\n"),
    compliance: [
      section("=== CONTRACT-DRIVEN COMPLIANCE CONTROLS ===", contractPrompt),
      section("=== EXISTING COMPLIANCE / GAP EVIDENCE ===", input.compliance),
    ].join("\n\n"),
    criterionEvidenceMap: existingCriterionMap
      ? [contractPrompt, section("=== EXISTING CRITERION EVIDENCE MAP ===", existingCriterionMap)].join("\n\n")
      : contractPrompt,
  };
}
