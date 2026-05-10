import type { AIBidWriterInput } from "../ai";
import {
  renderProposalIntelligenceContract,
  renderProposalIntelligencePromptBlock,
  type ProposalIntelligenceContractInput,
} from "./proposal-intelligence-contract";

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function section(title: string, body?: string | null): string {
  const value = (body ?? "").trim();
  return value ? `${title}\n${value}` : title;
}

function prependControlBlock(title: string, contractPrompt: string, existing?: string | null): string {
  return [
    section(title, contractPrompt),
    section("=== EXISTING FIELD CONTENT ===", existing),
  ].join("\n\n");
}

export function buildAIWriterContractPrompt(input: ProposalIntelligenceContractInput): string {
  const compactDirective = renderProposalIntelligencePromptBlock(input);
  const fullContract = renderProposalIntelligenceContract(input);

  return [
    "=== NON-NEGOTIABLE PROPOSAL INTELLIGENCE CONTRACT ===",
    "Use this contract before drafting. It overrides generic proposal-writing habits. Do not treat it as an appendix or postscript.",
    "",
    "Writer application rules:",
    "- Use DIRECT Evidence Graph nodes as primary proof points.",
    "- Use TRANSFERABLE Evidence Graph nodes only with explicit caveats about what matches and what differs.",
    "- Do not use SUPPORTING nodes as main proof points.",
    "- Never use UNFIT nodes as proposal evidence.",
    "- Address BLOCK export gates as bid-team actions, not as unsupported claims.",
    "- Source-grounded tender requirements control the compliance matrix, response structure, and mandatory-claims discipline.",
    "- Tender-form strategy controls the document shape before prose style.",
    "- Do not invent project names, expert credentials, certificate numbers, page references, submission rules, or client requirements.",
    "",
    "=== CONTRACT SNAPSHOT FOR FAST PROMPT READING ===",
    compactDirective,
    "",
    "=== FULL CONTRACT DETAIL FOR DRAFTING ===",
    fullContract,
    "=== END PROPOSAL INTELLIGENCE CONTRACT ===",
  ].join("\n");
}

export function augmentAIWriterInputWithContract(input: AIBidWriterInput, contractInput: ProposalIntelligenceContractInput): AIBidWriterInput {
  const contractPrompt = buildAIWriterContractPrompt(contractInput);
  const existingCriterionMap = clean(input.criterionEvidenceMap);

  return {
    ...input,
    analysisSummary: prependControlBlock("=== CONTRACT-FIRST ANALYSIS CONTROLS ===", contractPrompt, input.analysisSummary),
    evaluationMethodology: prependControlBlock("=== CONTRACT-FIRST EVALUATION CONTROLS ===", contractPrompt, input.evaluationMethodology),
    requirements: prependControlBlock("=== CONTRACT-FIRST REQUIREMENT CONTROLS ===", contractPrompt, input.requirements),
    compliance: prependControlBlock("=== CONTRACT-FIRST COMPLIANCE CONTROLS ===", contractPrompt, input.compliance),
    criterionEvidenceMap: existingCriterionMap
      ? [
          section("=== CONTRACT-FIRST CRITERION / EVIDENCE CONTROLS ===", contractPrompt),
          section("=== EXISTING CRITERION EVIDENCE MAP ===", existingCriterionMap),
        ].join("\n\n")
      : contractPrompt,
  };
}
