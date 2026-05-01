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

function sectorMethodology(input: ProposalStrengtheningInput): string {
  const text = `${input.tenderTitle}\n${input.projectLines.join("\n")}\n${input.companyEvidenceLines.join("\n")}`;
  if (input.isHealthcare || /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|OPD|emergency|in-patient/i.test(text)) {
    return "Healthcare / medical facility tenders should explicitly address Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, clinical zoning, patient/staff/supply and waste flows, IPC, medical equipment loads, radiation shielding, medical gas, ICT/telehealth, MEP coordination, regulatory approval, renovation oversight, close-out and operational readiness.";
  }
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|well|reservoir/i.test(text)) {
    return "Water and infrastructure tenders should explicitly address source investigation, demand assessment, hydraulic design, pumping/storage, water-quality considerations, sanitary/drainage interfaces, geotechnical conditions, BOQ/specifications, construction supervision, commissioning, operation and maintenance handover, and resilience of the proposed system.";
  }
  if (/road|bridge|transport|drainage|pavement|traffic|culvert/i.test(text)) {
    return "Road, bridge and transport tenders should explicitly address route/site assessment, survey control, geotechnical and drainage review, pavement/structural design basis, traffic and safety management, environmental/social controls, quantities, specifications, supervision methodology, quality testing and handover documentation.";
  }
  if (/building|architecture|structural|MEP|residential|commercial|office|warehouse|school|university|facility|supervision/i.test(text)) {
    return "Building design and supervision tenders should explicitly address site verification, architectural/functional planning, structural concept, MEP coordination, accessibility, life-safety/fire strategy, material specifications, BOQ/cost support where requested, permit/approval support, construction supervision, QA/QC, progress reporting, variation control and close-out.";
  }
  if (/urban|master plan|land use|municipal|planning|settlement|spatial/i.test(text)) {
    return "Urban planning and municipal tenders should explicitly address baseline assessment, stakeholder consultation, spatial analysis, land-use scenarios, infrastructure/service demand, environmental and social constraints, implementation phasing, regulatory alignment, GIS/mapping outputs and decision-ready reporting.";
  }
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste/i.test(text)) {
    return "Environmental and social tenders should explicitly address baseline studies, legal and safeguard framework, stakeholder engagement, impact/risk assessment, mitigation hierarchy, ESMP/monitoring plan, grievance and disclosure arrangements, institutional responsibilities and evidence-based reporting.";
  }
  if (/ICT|software|system|digital|database|platform|telecom|network|cyber/i.test(text)) {
    return "ICT and digital-service tenders should explicitly address user requirements, system architecture, data/security controls, integration, implementation roadmap, testing and acceptance, training, support model, documentation, risk controls and service continuity.";
  }
  return "General consultancy tenders should explicitly address understanding of the assignment, scope-by-scope tasks, inputs, outputs, work plan, team responsibilities, QA/QC gates, communication/reporting, risk management, compliance with submission instructions and evidence-based appendix control.";
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

  pushSection(sections, input, "Sector-Specific Methodology Depth", [sectorMethodology(input)]);

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
