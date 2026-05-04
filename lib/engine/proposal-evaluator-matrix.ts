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

function pickEvidence(requirement: string, input: EvaluatorMatrixInput, index: number): string {
  const pool = [
    ...take(input.projectLines, 4, 260),
    ...take(input.expertLines, 4, 240),
    ...take(input.companyEvidenceLines, 3, 240),
    ...take(input.projectEvidenceLines, 3, 240),
  ];
  if (pool.length === 0) return "Bid-team confirmation: attach verified supporting evidence before final submission.";
  const reqWords = requirement.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (reqWords.length > 0) {
    const scored = pool.map((line) => {
      const lower = line.toLowerCase();
      return { line, score: reqWords.filter((w) => lower.includes(w)).length };
    });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].line;
  }
  return pool[index % pool.length];
}

function proofItems(input: EvaluatorMatrixInput): string[] {
  return [
    ...take(input.expertLines, 10, 260).map((line) => `Expert/CV evidence: ${line}`),
    ...take(input.projectLines, 10, 320).map((line) => `Project reference evidence: ${line}`),
    ...take(input.companyEvidenceLines, 12, 360).map((line) => `Company record evidence: ${line}`),
    ...take(input.projectEvidenceLines, 8, 360).map((line) => `Project attachment evidence: ${line}`),
  ];
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
    output += `\n- **Mapped evidence:** ${pickEvidence(requirement, input, index)}`;
    output += "\n- **Bid-review action:** Confirm attachment, file name, signature/stamp status and compliance before final submission.";
  });

  output += "\n\n## Claim-to-Evidence Proof Map";
  output += "\nThe bid team should use this proof map to verify that proposal claims are backed by reviewed records before final submission.";
  const proof = proofItems(input);
  if (proof.length > 0) {
    for (const line of proof.slice(0, 28)) output += `\n- ${line}`;
  } else {
    output += "\n- Source proof must be confirmed before final submission.";
  }

  output += "\n\n## Unsupported Claim Control";
  output += "\nClaims about staff, projects, certifications, contract values, legal status, financial capacity, photos, drawings, or client approvals should be removed, softened, or marked for bid-team confirmation when no source record is available.";

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
