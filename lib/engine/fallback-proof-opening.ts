export type FallbackProofOpeningInput = {
  companyName: string;
  clientName: string;
  tenderTitle: string;
  primarySector: string;
  projectLines: string[];
  expertLines: string[];
  differentiators: string[];
};

function pick(lines: string[], count: number, maxLen: number): string[] {
  return lines
    .filter(Boolean)
    .slice(0, count)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

export function buildFallbackProofOpening(input: FallbackProofOpeningInput): string[] {
  const leadProjects = pick(input.projectLines, 2, 520);
  const leadExperts = pick(input.expertLines, 4, 360);
  const differentiators = pick(input.differentiators, 4, 360);
  const lines: string[] = [];

  lines.push(
    `${input.companyName} submits this technical proposal for ${input.tenderTitle} with an evidence-first response tailored to ${input.clientName}. The response is structured to show comparable delivery proof, relevant expert capability, technical methodology depth, and submission compliance before relying on general company description.`,
  );

  if (leadProjects.length > 0) {
    lines.push("The proposal should lead with the following reviewed comparable project proof:");
    for (const project of leadProjects) lines.push(`- Lead comparable project proof: ${project}`);
  } else {
    lines.push("- Bid-team confirmation: add at least one reviewed comparable project reference to the opening pages before final submission.");
  }

  if (leadExperts.length > 0) {
    lines.push("The proposed team should be presented as evaluator-facing proof, not only as CV attachments:");
    for (const expert of leadExperts) lines.push(`- Lead expert proof: ${expert}`);
  } else {
    lines.push("- Bid-team confirmation: select reviewed CVs and map them to assignment responsibilities before final submission.");
  }

  if (differentiators.length > 0) {
    lines.push("The opening narrative should carry these win themes consistently through the executive summary, relevant experience and methodology:");
    for (const item of differentiators) lines.push(`- ${item}`);
  }

  lines.push(
    `For a ${input.primarySector.toLowerCase()} assignment, the evaluator should see from the opening pages that the proposal is built from source evidence, direct project relevance, named expert capability, and controlled bid-review actions.`,
  );

  return lines;
}
