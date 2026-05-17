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
  if (/facility identification|facility assessment|site shortlist|suitable.*propert|shortlisted.*propert|propert.*suitabilit|site.*suitabilit/i.test(text)) return ["Facility identification / property assessment tenders: address the property shortlisting methodology, scored evaluation matrix (structural suitability, space planning, clinical or functional loading, access, utilities, power resilience, expansion potential, licensing feasibility and conversion risk), due-diligence inspection protocol, options comparison and client recommendation report.", "Methodology should show how site data, scoring criteria, inspection checklists and risk assessments feed a defensible shortlist recommendation, with clear ranking, assumptions and sign-off."];
  if (/geotechnical|soil.*investigation|bored.*pile|ground.*condition|foundation.*design|pile.*test|sub-surface|sub surface/i.test(text)) return ["Structural / geotechnical tenders: address site investigation scope (borings, test pits, laboratory analysis), soil/rock classification, foundation design criteria, bearing capacity and settlement analysis, slope stability, seismicity, groundwater conditions, pile or foundation type selection, design standards compliance and supervision/testing during construction.", "Methodology should map investigation stages, design calculation inputs, code references (EBCS, Eurocode, AASHTO), construction tolerances, testing programme and quality hold-points."];
  if (/renovation|refurbishm|adaptive reuse|retrofitting|existing.*building.*assess|conversion.*exist|upgrade.*existing.*facilit/i.test(text)) return ["Renovation / adaptation / retrofitting tenders: address existing conditions assessment (structural, MEP, architectural), hazardous materials check, design options for adaptation, phasing to keep operations running, structural upgrades, MEP replacement, accessibility compliance, fire-safety, material specifications, cost/programme estimates, permit support, site supervision, QA/QC and commissioning.", "Methodology should quantify existing deficiencies, link design interventions to client objectives, show phasing logic that protects ongoing activities and define acceptance tests for each stage."];
  if (/social.*advisory|capacity.*build|institutional.*strength|community.*develop|livelihood|beneficiary.*support|civil society|governance.*support/i.test(text)) return ["Social advisory / capacity-building / institutional strengthening tenders: address stakeholder analysis, baseline assessment, gap analysis, intervention design (training, institutional reform, community engagement, livelihood support), monitoring and evaluation framework, grievance and feedback mechanism, knowledge-transfer plan and sustainability strategy.", "Methodology should show how the advisory approach builds local ownership, tracks change through quantifiable indicators and leaves durable institutional capacity rather than dependency on the consultant."];
  if (/building|architecture|structural|MEP|residential|commercial|office|warehouse|school|university|facility|supervision|renovation/i.test(text)) return ["Building / architecture / supervision tenders: address site verification, functional planning, architectural concept, structural adequacy, MEP coordination, accessibility, life-safety/fire strategy, material specifications, BOQ/cost support where requested, permit/approval support, construction supervision, QA/QC, progress reporting, variation control and close-out.", "Methodology should convert the client's scope into work stages, deliverables, review gates, responsibilities, decision points and final handover requirements."];
  if (/urban|master plan|land use|municipal|planning|settlement|spatial|GIS/i.test(text)) return ["Urban planning / municipal tenders: address baseline studies, stakeholder consultation, spatial/GIS analysis, land-use and infrastructure scenarios, service-demand assessment, environmental/social constraints, regulatory alignment, phasing, implementation roadmap and decision-ready reporting.", "Methodology should show how evidence, maps, consultations and options analysis lead to practical plans that authorities and communities can implement."];
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste|EHS|ESG/i.test(text)) return ["Environmental / social / safeguards tenders: address baseline data collection, legal and safeguard framework, stakeholder engagement, impact and risk assessment, mitigation hierarchy, ESMP/monitoring plan, grievance/disclosure arrangements, institutional responsibilities and evidence-based reporting.", "Methodology should make compliance, field evidence, consultation records, risk controls and monitoring indicators clear to the evaluator."];
  if (/ICT|software|system|digital|database|platform|telecom|network|cyber|ERP|MIS/i.test(text)) return ["ICT / digital-service tenders: address user requirements, business process review, system architecture, data/security controls, integrations, implementation roadmap, testing and acceptance, training, support model, documentation, risk controls, service continuity and handover.", "Methodology should map requirements to modules, deliverables, acceptance criteria, implementation phases, governance and support responsibilities."];
  if (/energy|power.*plant|solar.*farm|wind.*farm|grid.*connect|generation.*capacity|transmission.*line|substation/i.test(text)) return ["Energy / power infrastructure tenders: address load forecasting, generation-mix options (renewable vs. diesel), grid-code compliance obligations, single-line diagram design, protection and relay coordination, SCADA architecture, environmental compliance, grid interconnection documentation, commissioning plan and operator training.", "Methodology should show the load-flow analysis, renewable feasibility screening, grid-code review, equipment procurement schedule, independent peer review, and energisation protocol linked to the client's schedule milestones."];
  if (/agri|irrigation.*scheme|crop|farm.*develop|livestock|rural.*develop/i.test(text)) return ["Agriculture / irrigation / rural development tenders: address hydrological analysis (minimum 20-year record), crop-water-requirement using FAO Penman-Monteith, irrigation network design (canal or pressurised pipe), drainage and salinity management, water-user association governance, farmer training, O&M manual, and willingness-to-pay analysis.", "Methodology should link hydrological evidence to design assumptions, show FAO 56 calculation sheets, WUA governance structure, and handover pack contents in the language of the community."];
  if (/mining|mineral.*extract|quarry.*design|tailings|ore.*body|blast.*design/i.test(text)) return ["Mining / extractive-industry tenders: address JORC resource estimation with independent competent-person review, geotechnical investigation, slope-stability analysis (LEM + numerical + empirical), mine-plan design, tailings storage facility design (MAC/ANCOLD), ESIA baseline, closure plan with financial provision estimate, and regulatory approval pathway.", "Methodology should show the data sources, JORC confidence classification, slope stability outputs (minimum Factor of Safety), TSF design basis, monitoring instrumentation layout, and community engagement approach."];
  if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal|container.*terminal|dredging/i.test(text)) return ["Port / maritime infrastructure tenders: address vessel-class parameter confirmation with port authority, fast-time nautical simulation, met-ocean data source, bathymetric and geotechnical survey, berth structural design (PIANC standards), dredging plan with sediment characterisation, ISPS compliance, shore-power provision, port operations manual, and handover.", "Methodology should show how met-ocean evidence, vessel simulation, dredge volumes, and ISPS compliance are sequenced — with regulator pre-approval built into the programme before any construction start."];
  if (/pipeline.*design|oil.*facilit|gas.*facilit|HAZOP|P&ID|refinery|petrochemical|upstream.*petroleum/i.test(text)) return ["Oil & gas / petroleum engineering tenders: address design-basis confirmation (applicable codes: API, ASME, ISO), P&ID development, HAZOP study with all action items tracked to close-out, LOPA for high-severity nodes, pipeline stress analysis, cathodic-protection design, ILI programme, vendor data requirements, environmental compliance, and pre-startup safety review.", "Methodology should make the P&ID freeze protocol, HAZOP action-item tracker, management-of-change procedure, and energisation/commissioning sequence visible to the evaluator — this is what distinguishes a process-safety-literate submission."];
  if (/KYC|AML|core.*banking|microfinance.*system|credit.*risk.*model|IFRS.*implement|Basel|prudential.*regul|capital.*adequacy/i.test(text)) return ["Financial services / banking tenders: address regulatory gap analysis (reviewed by licensed local legal counsel), business process mapping, data-quality assessment, system architecture design, integration plan, data-migration strategy (test migration + reconciliation sign-off), UAT protocol, change-management plan (train-the-trainer), RBAC and encryption configuration, and parallel-run cutover.", "Methodology should show the regulatory compliance chain from gap analysis → remediation plan → system configuration → UAT acceptance → go-live — with rollback path documented before any production data is touched."];
  if (/telecom|broadband|spectrum.*licen|base.*station|backhaul.*design|last.?mile.*access|LTE.*deploy|5G.*rollout/i.test(text)) return ["Telecoms / broadband infrastructure tenders: address spectrum licensing pathway (with alternative frequency fallback), RF propagation modelling (Atoll or equivalent), site acquisition (two alternative locations per target), backhaul link budget, core network dimensioning, integration testing, NOC KPI dashboard, hypercare optimisation period, and SLA breach protocol.", "Methodology should make the spectrum-to-coverage chain explicit — showing how spectrum plan, site design, link budget, and KPI targets connect — and name the regulatory liaison timeline so the evaluator sees the licensing risk is managed."];
  return ["General consultancy tenders: address understanding of the assignment, scope-by-scope tasks, inputs, outputs, work plan, team responsibilities, QA/QC gates, communication/reporting, risk management, compliance with submission instructions and evidence-based appendix control.", "Methodology should be tailored to the tender sector, avoiding generic statements unless they are tied to a specific requirement, deliverable, risk or evidence item."];
}

function benchmarkOpeningProof(input: ProposalStrengtheningInput, leadProjects: string[], leadExperts: string[]): string[] {
  const rows = [`${input.companyName} should open with a client-ready proof statement: why this firm, why this team, and why the evidence directly reduces ${input.clientName}'s delivery risk for this specific tender.`];
  if (leadProjects.length > 0) rows.push("The first page should name the strongest comparable assignments and carry those same references through the Executive Summary, Relevant Experience and Technical Approach.", ...leadProjects.map((project) => `- Comparable assignment proof: ${project}`));
  else rows.push("- Source-evidence action: insert the strongest verified comparable project references for the tender sector before final submission; do not leave this as a generic portfolio statement.");
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
    : ["- Source-evidence action: select reviewed CVs and map each expert to role, qualification, previous comparable work and delivery responsibility."]);

  pushSection(sections, input, "Sector-Specific Methodology Depth", sectorMethodology(input).map((line) => `- ${line}`));

  pushSection(sections, input, "Client-Ready Appendix Register", companyEvidence.length === 0 && projectEvidence.length === 0
    ? ["- Source-evidence action: attach verified company registration, licences, legal/tax records, CVs, project references, photos/drawings, testimony, completion evidence, certificates and tender forms as required."]
    : [...companyEvidence.map((line) => `- Company evidence to attach: ${line}`), ...projectEvidence.map((line) => `- Project evidence to attach: ${line}`)]);

  pushSection(sections, input, "Final Claim and Evidence Control", ["Every major claim in the final proposal should be supported by reviewed source evidence. Unsupported claims should be removed or softened before final submission. Do not invent projects, experts, certifications, awards, values, client names, dates, photos, drawings, references or licences."]);

  return sections.join("\n\n");
}
