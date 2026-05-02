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

function sectorMethodology(input: ProposalStrengtheningInput): string[] {
  const text = `${input.tenderTitle}\n${input.projectLines.join("\n")}\n${input.companyEvidenceLines.join("\n")}`;
  if (input.isHealthcare || /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|OPD|emergency|in-patient|specialty/i.test(text)) {
    return [
      "The methodology must be written as a healthcare design response, not a generic consultancy plan. It should follow the tender scope from facility identification through close-out.",
      "Facility identification and technical assessment: use a scored property-assessment matrix covering structural suitability, department zoning potential, clinical floor loading, patient access, ambulance access, utilities, drainage, power resilience, expansion potential and licensing feasibility.",
      "Conceptual and detailed design: define Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy and specialty service zones; separate patient, staff, clean supply, dirty utility and waste flows; embed IPC principles before layouts are frozen.",
      "Engineering coordination: coordinate structural, MEP, medical equipment loads, medical gas where required, electrical load planning, backup power, ICT/telehealth systems, water/sanitary systems, ventilation, fire/life safety and maintainability.",
      "Healthcare compliance and approvals: show how drawings, specifications and technical notes will support Ethiopian healthcare regulatory review, licensing, accessibility, patient safety, radiation shielding for imaging areas and infection-control compliance.",
      "Renovation and supervision: include renovation drawings, technical specifications, BOQ/cost support where requested, work sequencing, quality inspection, progress reporting, change control, commissioning and handover readiness.",
    ];
  }
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|well|reservoir/i.test(text)) {
    return [
      "The methodology should address source investigation, demand assessment, hydraulic design, pumping/storage, water-quality considerations, sanitary/drainage interfaces, geotechnical conditions, BOQ/specifications, construction supervision, commissioning, O&M handover and resilience of the proposed system.",
    ];
  }
  if (/road|bridge|transport|drainage|pavement|traffic|culvert/i.test(text)) {
    return [
      "The methodology should address route/site assessment, survey control, geotechnical and drainage review, pavement/structural design basis, traffic and safety management, environmental/social controls, quantities, specifications, supervision methodology, quality testing and handover documentation.",
    ];
  }
  if (/building|architecture|structural|MEP|residential|commercial|office|warehouse|school|university|facility|supervision/i.test(text)) {
    return [
      "The methodology should address site verification, architectural/functional planning, structural concept, MEP coordination, accessibility, life-safety/fire strategy, material specifications, BOQ/cost support where requested, permit/approval support, construction supervision, QA/QC, progress reporting, variation control and close-out.",
    ];
  }
  return [
    "The methodology should address understanding of the assignment, scope-by-scope tasks, inputs, outputs, work plan, team responsibilities, QA/QC gates, communication/reporting, risk management, compliance with submission instructions and evidence-based appendix control.",
  ];
}

function benchmarkOpeningProof(input: ProposalStrengtheningInput, leadProjects: string[], leadExperts: string[]): string[] {
  const rows = [
    `${input.companyName} should open with a client-ready proof statement: why this firm, why this team, and why the evidence directly reduces ${input.clientName}'s delivery risk.`,
  ];
  if (leadProjects.length > 0) {
    rows.push("The first page should name the strongest comparable assignments and carry those same references through the Executive Summary, Relevant Experience and Technical Approach.");
    rows.push(...leadProjects.map((project) => `- Comparable assignment proof: ${project}`));
  } else {
    rows.push("- Source-evidence action: insert the strongest verified comparable healthcare/facility project references before final submission; do not leave this as a generic portfolio statement.");
  }
  if (leadExperts.length > 0) {
    rows.push("The first page should also prove that the proposed team is already capable of controlling the assignment's technical risks.");
    rows.push(...leadExperts.slice(0, 4).map((expert) => `- Proposed team proof: ${expert}`));
  }
  return rows;
}

export function buildClientProposalStrengtheningSections(input: ProposalStrengtheningInput): string {
  const sections: string[] = [];
  const leadProjects = take(input.projectLines, 4, 620);
  const leadExperts = take(input.expertLines, 8, 460);
  const companyEvidence = take(input.companyEvidenceLines, 8, 420);
  const projectEvidence = take(input.projectEvidenceLines, 8, 420);

  pushSection(sections, input, "Benchmark Opening Proof Strategy", benchmarkOpeningProof(input, leadProjects, leadExperts));

  pushSection(sections, input, "Evaluator-Facing Team-to-Assignment Mapping", leadExperts.length > 0
    ? [
      "The proposal should present the team as a delivery system, not only as CV attachments. Each named expert should be tied to a role, comparable assignment evidence, and a technical risk controlled for this tender.",
      ...leadExperts.map((expert) => `- ${expert}`),
    ]
    : ["- Source-evidence action: select reviewed CVs and map each expert to role, qualification, previous comparable work and delivery responsibility."]);

  pushSection(sections, input, "Healthcare / Sector Methodology Depth", sectorMethodology(input).map((line) => `- ${line}`));

  pushSection(sections, input, "Client-Ready Appendix Register", companyEvidence.length === 0 && projectEvidence.length === 0
    ? ["- Source-evidence action: attach verified company registration, licences, legal/tax records, CVs, project references, photos/drawings, testimony, completion evidence, certificates and tender forms as required."]
    : [
      ...companyEvidence.map((line) => `- Company evidence to attach: ${line}`),
      ...projectEvidence.map((line) => `- Project evidence to attach: ${line}`),
    ]);

  pushSection(sections, input, "Final Claim and Evidence Control", [
    "Every major claim in the final proposal should be supported by reviewed source evidence. Unsupported claims should be removed or softened before final submission. Do not invent projects, experts, certifications, awards, values, client names, dates, photos, drawings, references or licences.",
  ]);

  return sections.join("\n\n");
}
