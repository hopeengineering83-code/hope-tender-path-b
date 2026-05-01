export type EvaluatorMatrixInput = {
  tenderTitle: string;
  clientName: string;
  requirements: string[];
  expertLines: string[];
  projectLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  complianceLines: string[];
  differentiators: string[];
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/\bSenior-level requirement bundle consolidating \d+ extracted tender instruction\(s\)\.?/gi, "")
    .replace(/\bKey evidence interpreted:\s*/gi, "")
    .replace(/\bCompany evidence available:\s*/gi, "")
    .replace(/\bProject evidence available:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function take(lines: string[], count: number, maxLen = 260): string[] {
  return lines
    .map(clean)
    .filter(Boolean)
    .filter((line) => !/as an ai|chatgpt|openai|lorem ipsum|placeholder|sample text|parsed text for page/i.test(line))
    .slice(0, count)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

function pickEvidence(input: EvaluatorMatrixInput, index: number): string {
  const pool = [
    ...take(input.projectLines, 4, 260),
    ...take(input.expertLines, 4, 240),
    ...take(input.companyEvidenceLines, 3, 240),
    ...take(input.projectEvidenceLines, 3, 240),
  ];
  return pool[index % Math.max(pool.length, 1)] || "Bid-team confirmation: attach verified supporting evidence before final submission.";
}

export function appendEvaluatorResponseMatrix(markdown: string, input: EvaluatorMatrixInput): string {
  let output = markdown.trim();
  output += "\n\n## Evaluator Response Matrix";
  output += `\nThis section summarises how the proposal responds to the evaluator's main concerns for ${clean(input.clientName)} / ${clean(input.tenderTitle)}.`;

  const reqs = take(input.requirements, 8, 220);
  const finalReqs = reqs.length > 0 ? reqs : [
    "Technical understanding and methodology",
    "Relevant company experience",
    "Professional team and CV strength",
    "Compliance with submission requirements",
  ];

  finalReqs.forEach((requirement, index) => {
    output += `\n\n### Evaluation Point ${index + 1}`;
    output += `\n- **Evaluator concern:** ${requirement}`;
    output += "\n- **Response strategy:** Address the requirement directly, show how the method reduces delivery risk, and connect the response to verified evidence.";
    output += `\n- **Mapped evidence:** ${pickEvidence(input, index)}`;
    output += "\n- **Bid-review action:** Confirm attachment, file name, signature/stamp status and compliance before final submission.";
  });

  output += "\n\n## Win Themes and Differentiators";
  const differentiators = take(input.differentiators, 5, 280);
  const finalDifferentiators = differentiators.length > 0 ? differentiators : [
    "Evidence-led proposal built from reviewed company records.",
    "Senior bid-review approach that separates true blockers from manageable evidence actions.",
    "Technical methodology aligned to tender risks, deliverables, QA/QC, coordination, and submission controls.",
  ];
  for (const item of finalDifferentiators) output += `\n- ${item}`;

  output += "\n\n## Delivery Methodology Work Plan";
  for (const phase of [
    "Inception, tender confirmation and document-control setup.",
    "Requirement review, evidence mapping and scope-by-scope response planning.",
    "Technical methodology development with discipline coordination, deliverables, QA/QC and risk controls.",
    "Senior review against evaluator logic, compliance matrix, appendix register and submission rules.",
    "Final verification of signatures, stamps, CVs, references, file names, submission method and deadline.",
  ]) output += `\n- ${phase}`;

  output += "\n\n## Evidence-Based Appendix Register";
  const appendixLines = [
    ...take(input.companyEvidenceLines, 5, 240),
    ...take(input.projectEvidenceLines, 5, 240),
    ...take(input.expertLines, 5, 220).map((line) => `CV / Expert evidence: ${line}`),
    ...take(input.projectLines, 5, 240).map((line) => `Project reference evidence: ${line}`),
  ];
  if (appendixLines.length > 0) {
    for (const line of appendixLines.slice(0, 14)) output += `\n- ${line}`;
  } else {
    output += "\n- Appendix evidence to be confirmed by bid team before final submission.";
  }

  output += "\n\n## Final Submission Control Checklist";
  const checklist = take(input.complianceLines, 8, 260);
  for (const line of checklist) output += `\n- ${line}`;
  output += "\n- Confirm no unsupported claim, placeholder text, AI disclaimer, prohibited financial content or wrong file name remains in the final package.";

  return output;
}
