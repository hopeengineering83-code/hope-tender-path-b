import { buildProposalIntelligenceContract, type ProposalExportGate, type ProposalIntelligenceContractInput } from "../generation/proposal-intelligence-contract";

export type ProposalEvaluatorLoopIssue = {
  axis: string;
  severity: "PASS" | "WARN" | "BLOCK";
  finding: string;
  repairAction: string;
};

export type ProposalEvaluatorLoopResult = {
  status: "PASS" | "WARN" | "BLOCK";
  score: number;
  issues: ProposalEvaluatorLoopIssue[];
  repairAddendum: string;
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !/^(proposal|tender|shall|must|required|provide|submit|include|client|consultant|services|technical|financial)$/.test(word));
}

function hasRequirementCoverage(markdown: string, requirement: string): boolean {
  const reqTokens = tokens(requirement);
  if (reqTokens.length === 0) return true;
  const lower = markdown.toLowerCase();
  const hits = reqTokens.filter((token) => lower.includes(token)).length;
  return hits / reqTokens.length >= 0.35;
}

function gateSeverity(gates: ProposalExportGate[]): "PASS" | "WARN" | "BLOCK" {
  if (gates.some((gate) => gate.status === "BLOCK")) return "BLOCK";
  if (gates.some((gate) => gate.status === "WARN")) return "WARN";
  return "PASS";
}

function worse(a: "PASS" | "WARN" | "BLOCK", b: "PASS" | "WARN" | "BLOCK"): "PASS" | "WARN" | "BLOCK" {
  if (a === "BLOCK" || b === "BLOCK") return "BLOCK";
  if (a === "WARN" || b === "WARN") return "WARN";
  return "PASS";
}

function issue(axis: string, severity: "PASS" | "WARN" | "BLOCK", finding: string, repairAction: string): ProposalEvaluatorLoopIssue {
  return { axis, severity, finding, repairAction };
}

export function evaluateProposalAgainstContract(input: {
  markdown: string;
  contractInput: ProposalIntelligenceContractInput;
  minimumSafeScore?: number;
}): ProposalEvaluatorLoopResult {
  const contract = buildProposalIntelligenceContract(input.contractInput);
  const markdown = clean(input.markdown);
  const issues: ProposalEvaluatorLoopIssue[] = [];
  const minimumSafeScore = input.minimumSafeScore ?? 75;

  const coveredRequirements = contract.requirements.filter((req) => hasRequirementCoverage(markdown, req.requirement));
  const uncoveredMandatory = contract.requirements.filter((req) => req.mandatory && !hasRequirementCoverage(markdown, req.requirement));
  const coverageRatio = contract.requirements.length === 0 ? 1 : coveredRequirements.length / contract.requirements.length;
  issues.push(issue(
    "Source-grounded requirement response coverage",
    uncoveredMandatory.length > 0 ? "BLOCK" : coverageRatio < 0.75 ? "WARN" : "PASS",
    `${coveredRequirements.length}/${contract.requirements.length} contract requirement(s) are visibly addressed; ${uncoveredMandatory.length} mandatory item(s) are weak or missing.`,
    uncoveredMandatory.length > 0
      ? "Repair before finalization: add explicit response paragraphs or compliance matrix rows for each missing mandatory source-grounded requirement."
      : coverageRatio < 0.75
        ? "Strengthen the draft by adding requirement-by-requirement coverage for weak criteria."
        : "No requirement-coverage repair needed.",
  ));

  const groundingGate = contract.exportGates.find((gate) => gate.gate === "Tender source grounding control");
  if (groundingGate) {
    issues.push(issue(
      "Tender source grounding",
      groundingGate.status,
      groundingGate.rationale,
      groundingGate.action,
    ));
  }

  const evidenceGate = contract.exportGates.find((gate) => gate.gate === "Evidence graph fit control");
  if (evidenceGate) {
    issues.push(issue(
      "Evidence graph fit",
      evidenceGate.status,
      evidenceGate.rationale,
      evidenceGate.action,
    ));
  }

  const sectionHits = contract.sectionPlan.filter((section) => new RegExp(section.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(markdown));
  const sectionRatio = contract.sectionPlan.length === 0 ? 1 : sectionHits.length / contract.sectionPlan.length;
  issues.push(issue(
    "Contract section plan coverage",
    sectionRatio < 0.6 ? "WARN" : "PASS",
    `${sectionHits.length}/${contract.sectionPlan.length} planned contract section(s) are visible in the draft.`,
    sectionRatio < 0.6 ? "Repair by adding missing planned sections using the contract section plan writing instructions." : "No section-plan repair needed.",
  ));

  const commercialGate = contract.exportGates.find((gate) => gate.gate === "Commercial / technical separation");
  if (commercialGate) {
    issues.push(issue(
      "Tender form and envelope control",
      commercialGate.status,
      commercialGate.rationale,
      commercialGate.action,
    ));
  }

  const placeholders = /(\bTODO\b|\bTBD\b|\[INSERT[^\]]*\]|\[PLACEHOLDER[^\]]*\]|as an ai|language model|chatgpt)/i.test(markdown);
  issues.push(issue(
    "Final prose safety",
    placeholders ? "BLOCK" : "PASS",
    placeholders ? "Placeholder, TODO, or AI-trace language was detected." : "No placeholder or AI-trace language detected by the evaluator loop.",
    placeholders ? "Remove placeholder/AI-trace language before final export." : "No prose-safety repair needed.",
  ));

  let status: "PASS" | "WARN" | "BLOCK" = gateSeverity(contract.exportGates);
  for (const item of issues) status = worse(status, item.severity);

  const blockPenalty = issues.filter((item) => item.severity === "BLOCK").length * 18;
  const warnPenalty = issues.filter((item) => item.severity === "WARN").length * 7;
  const coveragePenalty = Math.round((1 - coverageRatio) * 22 + (1 - sectionRatio) * 10);
  const score = Math.max(0, Math.min(100, 100 - blockPenalty - warnPenalty - coveragePenalty));
  if (score < minimumSafeScore && status === "PASS") status = "WARN";

  return {
    status,
    score,
    issues,
    repairAddendum: renderProposalEvaluatorLoop({ status, score, issues, contractInput: input.contractInput }),
  };
}

export function renderProposalEvaluatorLoop(input: {
  status: "PASS" | "WARN" | "BLOCK";
  score: number;
  issues: ProposalEvaluatorLoopIssue[];
  contractInput: ProposalIntelligenceContractInput;
}): string {
  const rows = [
    "| Axis | Severity | Finding | Repair action |",
    "|---|---|---|---|",
    ...input.issues.map((item) => `| ${item.axis} | ${item.severity} | ${item.finding} | ${item.repairAction} |`),
  ];
  const blockers = input.issues.filter((item) => item.severity === "BLOCK");
  const warnings = input.issues.filter((item) => item.severity === "WARN");

  return [
    "## Proposal Evaluator Loop",
    `Evaluator-loop status: **${input.status}**. Contract score: **${input.score}/100**. This loop evaluates the proposal against source-grounded requirements, Evidence Graph fit, tender-form strategy, contract section plan and export gates before finalization.`,
    rows.join("\n"),
    "### Evaluator Loop Repair Pass",
    blockers.length > 0
      ? "The proposal must not be treated as final until the BLOCK items below are resolved or formally waived by the bid lead."
      : warnings.length > 0
        ? "The proposal can continue to senior review, but the WARN items below should be repaired before submission."
        : "No evaluator-loop repair blockers detected.",
    ...blockers.map((item) => `- BLOCK — ${item.axis}: ${item.repairAction}`),
    ...warnings.map((item) => `- WARN — ${item.axis}: ${item.repairAction}`),
  ].join("\n\n");
}

export function applyProposalEvaluatorLoop(markdown: string, contractInput: ProposalIntelligenceContractInput): string {
  const result = evaluateProposalAgainstContract({ markdown, contractInput });
  return `${markdown.trim()}\n\n${result.repairAddendum}`;
}
