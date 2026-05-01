export type ProposalStrengtheningInput = {
  clientName: string;
  tenderTitle: string;
  companyName: string;
  projectLines: string[];
  expertLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  isHealthcare: boolean;
  existingMarkdown?: string;
};

function take(lines: string[], count: number, maxLen = 420): string[] {
  return lines
    .filter(Boolean)
    .slice(0, count)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

function hasHeading(markdown: string | undefined, heading: string): boolean {
  if (!markdown) return false;
  const normalized = heading.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return markdown
    .split(/\n+/)
    .some((line) => line.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalized);
}

function pushSection(sections: string[], input: ProposalStrengtheningInput, heading: string, body: string[]) {
  if (hasHeading(input.existingMarkdown, heading)) return;
  sections.push(`## ${heading}`);
  sections.push(...body);
}

export function buildClientProposalStrengtheningSections(input: ProposalStrengtheningInput): string {
  const sections: string[] = [];
  const leadProjects = take(input.projectLines, 3, 560);
  const leadExperts = take(input.expertLines, 6, 420);
  const companyEvidence = take(input.companyEvidenceLines, 8, 420);
  const projectEvidence = take(input.projectEvidenceLines, 8, 420);

  pushSection(sections, input, "Lead Comparable Proof to the Client", leadProjects.length > 0
    ? [
      `${input.companyName} should lead the proposal for ${input.clientName} with the following reviewed comparable assignment evidence and carry it consistently through the cover letter, executive summary, relevant experience, and methodology.`,
      ...leadProjects.map((project) => `- ${project}`),
    ]
    : ["- Bid-team confirmation: add the strongest reviewed comparable project reference before final submission."]);

  pushSection(sections, input, "Expert Capability Mapped to Assignment Risk", leadExperts.length > 0
    ? [
      ...leadExperts.map((expert) => `- ${expert}`),
      "Each named expert should be tied to a proposed role, previous comparable work, tender-specific responsibility, and the technical risk they control.",
    ]
    : ["- Bid-team confirmation: select reviewed CVs and map each expert to role, qualification, previous comparable work, and delivery responsibility."]);

  if (input.isHealthcare) {
    pushSection(sections, input, "Healthcare Facility Methodology Depth", [
      "For healthcare assignments, the methodology should explicitly address Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, clinical zoning, patient/staff/supply and waste flows, IPC, medical equipment loads, radiation shielding, medical gas, ICT/telehealth, MEP coordination, regulatory approval, renovation oversight, close-out and operational readiness.",
    ]);
  }

  pushSection(sections, input, "Evidence-Based Appendix Register", companyEvidence.length === 0 && projectEvidence.length === 0
    ? ["- Bid-team confirmation: attach verified company registration, licences, legal/tax records, CVs, project references, photos/drawings, testimony, completion evidence, certificates and tender forms as required."]
    : [
      ...companyEvidence.map((line) => `- Company evidence: ${line}`),
      ...projectEvidence.map((line) => `- Project evidence: ${line}`),
    ]);

  pushSection(sections, input, "Unsupported Claim Control", [
    "Every claim in the final proposal should be supported by reviewed source evidence or converted into a bid-team confirmation action. Do not invent projects, experts, certifications, awards, values, client names, dates, photos, drawings, references or licences.",
  ]);

  return sections.join("\n\n");
}
