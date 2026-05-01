export type ProposalStrengtheningInput = {
  clientName: string;
  tenderTitle: string;
  companyName: string;
  projectLines: string[];
  expertLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  isHealthcare: boolean;
};

function take(lines: string[], count: number, maxLen = 420): string[] {
  return lines
    .filter(Boolean)
    .slice(0, count)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

export function buildClientProposalStrengtheningSections(input: ProposalStrengtheningInput): string {
  const sections: string[] = [];
  const leadProjects = take(input.projectLines, 3, 560);
  const leadExperts = take(input.expertLines, 6, 420);
  const companyEvidence = take(input.companyEvidenceLines, 8, 420);
  const projectEvidence = take(input.projectEvidenceLines, 8, 420);

  sections.push("## Lead Comparable Proof to the Client");
  if (leadProjects.length > 0) {
    sections.push(`${input.companyName} should lead the proposal for ${input.clientName} with the following reviewed comparable assignment evidence and carry it consistently through the cover letter, executive summary, relevant experience, and methodology.`);
    for (const project of leadProjects) sections.push(`- ${project}`);
  } else {
    sections.push("- Bid-team confirmation: add the strongest reviewed comparable project reference before final submission.");
  }

  sections.push("## Expert Capability Mapped to Assignment Risk");
  if (leadExperts.length > 0) {
    for (const expert of leadExperts) sections.push(`- ${expert}`);
    sections.push("Each named expert should be tied to a proposed role, previous comparable work, tender-specific responsibility, and the technical risk they control.");
  } else {
    sections.push("- Bid-team confirmation: select reviewed CVs and map each expert to role, qualification, previous comparable work, and delivery responsibility.");
  }

  if (input.isHealthcare) {
    sections.push("## Healthcare Facility Methodology Depth");
    sections.push("For healthcare assignments, the methodology should explicitly address Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, clinical zoning, patient/staff/supply and waste flows, IPC, medical equipment loads, radiation shielding, medical gas, ICT/telehealth, MEP coordination, regulatory approval, renovation oversight, close-out and operational readiness.");
  }

  sections.push("## Evidence-Based Appendix Register");
  if (companyEvidence.length === 0 && projectEvidence.length === 0) {
    sections.push("- Bid-team confirmation: attach verified company registration, licences, legal/tax records, CVs, project references, photos/drawings, testimony, completion evidence, certificates and tender forms as required.");
  } else {
    for (const line of companyEvidence) sections.push(`- Company evidence: ${line}`);
    for (const line of projectEvidence) sections.push(`- Project evidence: ${line}`);
  }

  sections.push("## Unsupported Claim Control");
  sections.push("Every claim in the final proposal should be supported by reviewed source evidence or converted into a bid-team confirmation action. Do not invent projects, experts, certifications, awards, values, client names, dates, photos, drawings, references or licences.");

  return sections.join("\n\n");
}
