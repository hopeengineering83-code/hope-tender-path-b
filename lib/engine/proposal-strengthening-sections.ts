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
  if (input.isHealthcare || /health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|OPD|emergency|in-patient|specialty/i.test(text)) return ["Healthcare / medical facility tenders: write a healthcare design response, not a generic consultancy plan. Cover facility identification, clinical zoning, patient/staff/supply/waste flows, infection prevention and control, MEP/biomedical coordination, approvals, renovation sequencing, supervision and operational readiness.", "Facility identification and technical assessment should use a scored property/site matrix covering structural suitability, space planning, clinical loading, access, utilities, power resilience, expansion potential, licensing feasibility and conversion risk.", "Design methodology should address Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy and specialty service zones where relevant, with clean/dirty separation and coordinated medical equipment requirements."];
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|well|reservoir|solar pumping/i.test(text)) return ["Water / hydraulic / solar-pumping tenders: address source investigation, demand assessment, hydrology or groundwater basis, pumping head and flow assumptions, storage, water quality, power/solar sizing, sanitary/drainage interfaces, BOQ/specifications, supervision, testing, commissioning and operation/maintenance handover.", "Methodology should show field survey, design calculations, equipment selection criteria, constructability, resilience, safety, quality testing and handover documentation."];
  if (/road|bridge|transport|drainage|pavement|traffic|culvert|highway/i.test(text)) return ["Road / bridge / transport tenders: address route and site assessment, survey control, traffic conditions, geotechnical and drainage review, pavement or structural design basis, safety management, environmental/social controls, quantity take-off, specifications, supervision methodology, materials testing and handover documentation.", "Methodology should link design assumptions, construction sequencing, QA/QC testing, progress reporting, variation control and acceptance criteria."];
  if (/building|architecture|structural|MEP|residential|commercial|office|warehouse|school|university|facility|supervision|renovation/i.test(text)) return ["Building / architecture / supervision tenders: address site verification, functional planning, architectural concept, structural adequacy, MEP coordination, accessibility, life-safety/fire strategy, material specifications, BOQ/cost support where requested, permit/approval support, construction supervision, QA/QC, progress reporting, variation control and close-out.", "Methodology should convert the client's scope into work stages, deliverables, review gates, responsibilities, decision points and final handover requirements."];
  if (/urban|master plan|land use|municipal|planning|settlement|spatial|GIS/i.test(text)) return ["Urban planning / municipal tenders: address baseline studies, stakeholder consultation, spatial/GIS analysis, land-use and infrastructure scenarios, service-demand assessment, environmental/social constraints, regulatory alignment, phasing, implementation roadmap and decision-ready reporting.", "Methodology should show how evidence, maps, consultations and options analysis lead to practical plans that authorities and communities can implement."];
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste|EHS|ESG/i.test(text)) return ["Environmental / social / safeguards tenders: address baseline data collection, legal and safeguard framework, stakeholder engagement, impact and risk assessment, mitigation hierarchy, ESMP/monitoring plan, grievance/disclosure arrangements, institutional responsibilities and evidence-based reporting.", "Methodology should make compliance, field evidence, consultation records, risk controls and monitoring indicators clear to the evaluator."];
  if (/ICT|software|system|digital|database|platform|telecom|network|cyber|ERP|MIS/i.test(text)) return ["ICT / digital-service tenders: address user requirements, business process review, system architecture, data/security controls, integrations, implementation roadmap, testing and acceptance, training, support model, documentation, risk controls, service continuity and handover.", "Methodology should map requirements to modules, deliverables, acceptance criteria, implementation phases, governance and support responsibilities."];
  return ["General consultancy tenders: address understanding of the assignment, scope-by-scope tasks, inputs, outputs, work plan, team responsibilities, QA/QC gates, communication/reporting, risk management, compliance with submission instructions and evidence-based appendix control.", "Methodology should be tailored to the tender sector, avoiding generic statements unless they are tied to a specific requirement, deliverable, risk or evidence item."];
}

function benchmarkOpeningProof(input: ProposalStrengtheningInput, leadProjects: string[], leadExperts: string[]): string[] {
  const rows = [`${input.companyName} should open with a client-ready proof statement: why this firm, why this team, and why the evidence directly reduces ${input.clientName}'s delivery risk for this specific tender.`];
  if (leadProjects.length > 0) rows.push("The first page should name the strongest comparable assignments and carry those same references through the Executive Summary, Relevant Experience and Technical Approach.", ...leadProjects.map((project) => `- Comparable assignment proof: ${project}`));
  else rows.push("- Supporting evidence: insert the strongest verified comparable project references for the tender sector before final submission; do not leave this as a generic portfolio statement.");
  if (leadExperts.length > 0) rows.push("The first page should also prove that the proposed team is already capable of controlling the assignment's technical, compliance and delivery risks.", ...leadExperts.slice(0, 4).map((expert) => `- Proposed team proof: ${expert}`));
  return rows;
}

function evaluatorDecisionNarrative(input: ProposalStrengtheningInput, leadProjects: string[], leadExperts: string[]): string[] {
  return [
    `Evaluator question: Does ${input.companyName} understand ${input.clientName}'s assignment? Response: the technical approach must explicitly map the tender scope to sector-specific tasks, deliverables, quality gates and submission controls.`,
    `Evaluator question: Is the experience relevant? Response: the proposal should lead with ${leadProjects.length ? "the named comparable assignments listed below" : "verified comparable assignments from the evidence vault"} and explain why each reference reduces delivery risk for this tender.`,
    ...leadProjects.slice(0, 4).map((project) => `- Relevance proof: ${project}`),
    `Evaluator question: Is the team credible? Response: the proposal should connect ${leadExperts.length ? "the named experts below" : "reviewed CVs"} to the assignment's technical risks, not merely list CVs in an appendix.`,
    ...leadExperts.slice(0, 5).map((expert) => `- Team risk-control proof: ${expert}`),
    "Evaluator question: Is the submission safe to award? Response: the package should show compliance discipline, document control, evidence-backed claims, appendix traceability and final verification against mandatory tender requirements.",
  ];
}

export function buildClientProposalStrengtheningSections(input: ProposalStrengtheningInput): string {
  const sections: string[] = [];
  const leadProjects = take(input.projectLines, 4, 620);
  const leadExperts = take(input.expertLines, 8, 460);
  const companyEvidence = take(input.companyEvidenceLines, 8, 420);
  const projectEvidence = take(input.projectEvidenceLines, 8, 420);

  pushSection(sections, input, "Benchmark Opening Proof Strategy", benchmarkOpeningProof(input, leadProjects, leadExperts));
  pushSection(sections, input, "Evaluator Decision Narrative", evaluatorDecisionNarrative(input, leadProjects, leadExperts));

  pushSection(sections, input, "Evaluator-Facing Team-to-Assignment Mapping", leadExperts.length > 0
    ? ["The proposal should present the team as a delivery system, not only as CV attachments. Each named expert should be tied to a role, comparable assignment evidence, and a technical or delivery risk controlled for this tender.", ...leadExperts.map((expert) => `- ${expert}`)]
    : ["- Supporting evidence: select reviewed CVs and map each expert to role, qualification, previous comparable work and delivery responsibility."]);

  pushSection(sections, input, "Sector-Specific Methodology Depth", sectorMethodology(input).map((line) => `- ${line}`));

  pushSection(sections, input, "Client-Ready Appendix Register", companyEvidence.length === 0 && projectEvidence.length === 0
    ? ["- Supporting evidence: attach verified company registration, licences, legal/tax records, CVs, project references, photos/drawings, testimony, completion evidence, certificates and tender forms as required."]
    : [...companyEvidence.map((line) => `- Company evidence to attach: ${line}`), ...projectEvidence.map((line) => `- Project evidence to attach: ${line}`)]);

  pushSection(sections, input, "Final Claim and Evidence Control", ["Every major claim in the final proposal should be supported by reviewed source evidence. Unsupported claims should be removed or softened before final submission. Do not invent projects, experts, certifications, awards, values, client names, dates, photos, drawings, references or licences."]);

  return sections.join("\n\n");
}
