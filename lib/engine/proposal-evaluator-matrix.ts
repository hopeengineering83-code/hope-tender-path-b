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

function take(lines: string[], count: number, maxLen = 420): string[] {
  return lines
    .filter(Boolean)
    .slice(0, count)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

function unique(lines: string[]): string[] {
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
}

function pickEvidence(input: EvaluatorMatrixInput, index: number): string {
  const pool = [
    ...take(input.expertLines, 6, 300),
    ...take(input.projectLines, 6, 360),
    ...take(input.companyEvidenceLines, 6, 360),
    ...take(input.projectEvidenceLines, 4, 360),
  ];
  return pool[index % Math.max(pool.length, 1)] || "Evidence to be confirmed by bid team before final submission.";
}

function evidenceBucket(input: EvaluatorMatrixInput): string[] {
  return unique([
    ...take(input.expertLines, 12, 260).map((line) => `Expert/CV: ${line}`),
    ...take(input.projectLines, 12, 320).map((line) => `Project reference: ${line}`),
    ...take(input.companyEvidenceLines, 18, 360).map((line) => `Company evidence: ${line}`),
    ...take(input.projectEvidenceLines, 12, 360).map((line) => `Project attachment: ${line}`),
  ]);
}

export function appendEvaluatorResponseMatrix(markdown: string, input: EvaluatorMatrixInput): string {
  let output = markdown.trim();
  output += "\n\n## Evaluator Response Matrix";
  output += `\nThis section converts the tender requirements for ${input.clientName} / ${input.tenderTitle} into a bid-evaluator-facing response plan. It is designed to make the proposal read like a senior bid team response rather than a generic company profile.`;

  const reqs = input.requirements.length > 0 ? input.requirements.slice(0, 16) : [
    "Technical understanding and methodology",
    "Relevant company experience",
    "Professional team and CV strength",
    "Compliance with submission requirements",
  ];

  reqs.forEach((requirement, index) => {
    output += `\n\n### Evaluation Point ${index + 1}: ${requirement.slice(0, 120)}`;
    output += `\n- **Tender requirement / evaluator concern:** ${requirement}`;
    output += `\n- **Proposal response strategy:** Address this point directly in the narrative, show how the proposed approach reduces client risk, and link it to available reviewed evidence.`;
    output += `\n- **Mapped evidence:** ${pickEvidence(input, index)}`;
    output += `\n- **Bid-review action:** Verify that the mapped evidence is attached, correctly named, and aligned with the tender's submission rules before final export.`;
  });

  output += "\n\n## Claim-to-Evidence Proof Map";
  output += "\nThis proof map helps the bid team verify that proposal claims are backed by available records before submission.";
  const proofLines = evidenceBucket(input);
  if (proofLines.length > 0) {
    proofLines.slice(0, 28).forEach((line, index) => {
      output += `\n- **Proof item ${index + 1}:** ${line}`;
    });
  } else {
    output += "\n- No source proof was available in the proposal context; bid team must attach reviewed CVs, project references, legal/financial records, and company documents before final submission.";
  }

  output += "\n\n## Unsupported-Claim Control";
  output += "\nThe final bid team should check each narrative claim against the proof map. Claims about staff, projects, certifications, values, legal status, financial capacity, photos, drawings, or client approvals must be removed, softened, or marked for confirmation when no source record is available.";

  output += "\n\n## Win Themes and Differentiators";
  const differentiators = input.differentiators.length > 0 ? input.differentiators : [
    "Evidence-led proposal built from reviewed company records.",
    "Senior bid-review approach that separates true blockers from manageable evidence actions.",
    "Technical methodology aligned to tender risks, deliverables, QA/QC, coordination, and submission controls.",
  ];
  for (const item of take(differentiators, 8, 360)) output += `\n- ${item}`;

  output += "\n\n## Delivery Methodology Work Plan";
  output += "\nThe proposed delivery method should be evaluated as an end-to-end technical control process:";
  const phases = [
    "Inception, tender confirmation, and document-control setup.",
    "Review of tender scope, eligibility, evaluation criteria, appendices, and exact submission rules.",
    "Evidence mapping from reviewed experts, project references, legal/financial/compliance records, and company documents.",
    "Technical approach development with discipline coordination, deliverables, QA/QC, and risk controls.",
    "Draft proposal review against evaluator logic, compliance matrix, page/file constraints, and appendix register.",
    "Final bid-team verification of signatures, stamps, CVs, project references, forms, file names, submission method, and deadline.",
  ];
  for (const phase of phases) output += `\n- ${phase}`;

  output += "\n\n## Evidence-Based Appendix Register";
  const appendixLines = [
    ...take(input.companyEvidenceLines, 10, 340),
    ...take(input.projectEvidenceLines, 8, 340),
    ...take(input.expertLines, 8, 260).map((line) => `CV / Expert evidence: ${line}`),
    ...take(input.projectLines, 8, 300).map((line) => `Project reference evidence: ${line}`),
  ];
  if (appendixLines.length > 0) {
    for (const line of appendixLines.slice(0, 24)) output += `\n- ${line}`;
  } else {
    output += "\n- Appendix evidence to be confirmed by bid team before final submission.";
  }

  output += "\n\n## Final Submission Control Checklist";
  for (const line of take(input.complianceLines, 14, 360)) output += `\n- ${line}`;
  output += "\n- Confirm that the final proposal package contains no unsupported claim, no placeholder text, no AI disclaimer, and no prohibited financial content.";

  return output;
}
