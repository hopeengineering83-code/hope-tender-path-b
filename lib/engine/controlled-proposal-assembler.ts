export type ControlledProposalInput = {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  requirementLines: string[];
  expertLines: string[];
  projectLines: string[];
  companyEvidenceLines: string[];
  projectEvidenceLines: string[];
  differentiators: string[];
  submissionRules: string[];
  complianceLines: string[];
};

function clean(value?: string | null): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/=+\s*PAGE\s+\d+\s*=+/gi, " ")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, " ")
    .replace(/\bSenior-level requirement bundle consolidating \d+ extracted tender instruction\(s\)\.?/gi, "")
    .replace(/\bKey evidence interpreted:\s*/gi, "")
    .replace(/\bBid-team confirmation:\s*/gi, "")
    .replace(/\bbid-team\b/gi, "proposal team")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(lines: string[], limit: number, maxLen = 360): string[] {
  return lines
    .map(clean)
    .filter(Boolean)
    .filter((line) => !/as an ai|chatgpt|openai|lorem ipsum|placeholder|sample text/i.test(line))
    .slice(0, limit)
    .map((line) => line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line);
}

function bullets(lines: string[], fallback: string, limit: number, maxLen = 360): string[] {
  const selected = compact(lines, limit, maxLen);
  return selected.length ? selected.map((line) => `- ${line}`) : [`- ${fallback}`];
}

function sectorLabel(primarySector: string, title: string): string {
  const text = `${primarySector} ${title}`;
  if (/health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|specialty|OPD|emergency/i.test(text)) return "healthcare / medical facility consultancy";
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|reservoir/i.test(text)) return "water, hydraulic and infrastructure consultancy";
  if (/road|bridge|transport|pavement|traffic|culvert|drainage/i.test(text)) return "transport infrastructure consultancy";
  if (/urban|master plan|land use|municipal|spatial|settlement|GIS/i.test(text)) return "urban planning and municipal consultancy";
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste|EHS|ESG/i.test(text)) return "environmental and social safeguards consultancy";
  // Word boundaries on bare abbreviations — bare /ICT/i matched
  // "distrICT" / "predICT" / "verdICT"; bare /MIS/i matched
  // "optimISation" / "subMISsion" / "comMISsion"; bare /ERP/i matched
  // "supERPower". Every tender with "submission" in its body used to
  // misclassify as ICT.
  if (/\bICT\b|software|system|digital|database|platform|network|cyber|telecom|\bERP\b|\bMIS\b/i.test(text)) return "ICT and digital transformation consultancy";
  if (/building|architecture|structural|\bMEP\b|residential|commercial|office|warehouse|school|university|facility|supervision|renovation/i.test(text)) return "building design and supervision consultancy";
  if (/energy|power.*plant|\bsolar\b|wind.*farm|grid.*connect|generation|transmission.*line|substation|\bhydropower\b|\belectrification\b|\brenewable.*energy\b/i.test(text)) return "energy and power infrastructure consultancy";
  if (/agri|irrigation.*scheme|crop|farm.*develop|livestock|rural.*develop/i.test(text)) return "agriculture, irrigation, and rural development consultancy";
  if (/mining|mineral.*extract|quarry.*design|tailings|ore.*body|blast.*design/i.test(text)) return "mining and extractive industries consultancy";
  if (/\bport.*design|\bport.*master.*plan|berth.*design|quay.*design|harbour.*develop|dredging|container.*terminal|maritime/i.test(text)) return "port and maritime infrastructure consultancy";
  if (/pipeline.*design|oil.*facilit|gas.*facilit|HAZOP|P&ID|refinery|petrochemical|upstream.*petroleum/i.test(text)) return "oil and gas / petroleum engineering consultancy";
  if (/KYC|AML|core.*banking|microfinance.*system|credit.*risk.*model|IFRS.*implement|Basel|prudential.*regul|capital.*adequacy/i.test(text)) return "financial services and banking consultancy";
  return primarySector || "technical consultancy";
}

function methodologyForSector(primarySector: string, title: string): string[] {
  const text = `${primarySector} ${title}`;
  if (/health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|specialty|OPD|emergency/i.test(text)) {
    return [
      "Confirm facility objectives, target services, catchment, clinical operating model, licensing path and approval responsibilities before committing to layouts.",
      "Assess shortlisted premises or site conditions using structural, utilities, access, expansion, patient-flow, ambulance-flow, clinical-zoning and operational-readiness criteria.",
      "Develop functional layouts for relevant clinical departments such as Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy and specialty services with clean/dirty separation and IPC controls.",
      "Coordinate architectural, structural, MEP, medical gas where required, electrical loads, ICT/telehealth, equipment clearances, fire/life safety and radiation-shielding requirements.",
      "Prepare staged deliverables, design review gates, authority submission support, renovation/supervision controls, commissioning support and close-out documentation.",
    ];
  }
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|reservoir/i.test(text)) {
    return [
      "Confirm demand, service area, source conditions, hydraulic basis, power/solar assumptions, utility constraints, existing assets and stakeholder requirements.",
      "Undertake field assessment, survey, source verification, flow/head verification, water-quality considerations and design-basis confirmation before final sizing.",
      "Develop technical options for source, conveyance, pumping, storage, distribution, drainage/sanitary interfaces, power resilience and system operation.",
      "Prepare drawings, specifications, BOQ, equipment selection criteria, testing/commissioning plan and O&M handover requirements.",
      "Support supervision, quality testing, progress reporting, commissioning, handover and defects follow-up.",
    ];
  }
  if (/road|bridge|transport|pavement|traffic|culvert|drainage/i.test(text)) {
    return [
      "Confirm route/site context, traffic/service requirements, survey controls, environmental/social constraints, safety risks and applicable design standards.",
      "Assess geotechnical, hydrological, drainage, pavement/structural and traffic conditions before final technical options are selected.",
      "Develop alignment, drainage, pavement/structure, traffic-management and safety proposals supported by quantities, specifications and construction sequencing.",
      "Implement QA/QC through design reviews, material/testing requirements, site supervision procedures, inspection records and variation control.",
      "Prepare reporting, stakeholder coordination, commissioning/handover documentation and close-out controls.",
    ];
  }
  if (/urban|master plan|land use|municipal|spatial|settlement|GIS/i.test(text)) {
    return [
      "Establish baseline conditions using document review, spatial/GIS analysis, field verification and stakeholder consultation.",
      "Define planning objectives, constraints, development scenarios, infrastructure/service needs and environmental/social considerations.",
      "Prepare land-use, mobility, infrastructure, phasing and implementation proposals supported by maps, schedules and decision criteria.",
      "Validate proposals with stakeholders and align outputs with applicable regulations, standards and client priorities.",
      "Deliver clear implementation, monitoring and institutional responsibility recommendations.",
    ];
  }
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste|EHS|ESG/i.test(text)) {
    return [
      "Confirm the legal, safeguard, donor and institutional framework applicable to the assignment.",
      "Undertake baseline environmental/social assessment, stakeholder mapping, consultation planning and impact/risk screening.",
      "Develop mitigation measures using the mitigation hierarchy, ESMP/monitoring actions, reporting templates and responsibility matrix.",
      "Support consultation, disclosure, grievance arrangements, client review cycles and evidence-based approval records.",
      "Prepare final reports, annexes, monitoring tools and implementation controls.",
    ];
  }
  if (/ICT|software|system|digital|database|platform|network|cyber|telecom|ERP|MIS/i.test(text)) {
    return [
      "Confirm users, workflows, data requirements, integrations, service levels, security requirements and acceptance criteria.",
      "Design the solution architecture, data model, implementation roadmap, governance model, security controls and support model.",
      "Configure/build, test and validate the solution using staged acceptance gates, issue tracking and user feedback loops.",
      "Train users, provide documentation, transition support, service continuity controls and handover materials.",
      "Report progress, risks, changes and acceptance evidence throughout delivery.",
    ];
  }
  if (/energy|power.*plant|\bsolar\b|wind.*farm|grid.*connect|generation|transmission.*line|substation|\bhydropower\b|\belectrification\b|\brenewable.*energy\b/i.test(text)) {
    return [
      "Confirm energy demand, load-growth scenario, grid interconnection requirements, grid-code obligations, and stakeholder and environmental constraints before design commencement.",
      "Complete load-flow analysis, generation-mix options (including renewable feasibility), equipment sizing, and demand-forecast modelling using a minimum 5-year consumption data set.",
      "Develop single-line diagram, protection and relay coordination, SCADA architecture, civil and structural design, and environmental and social management plan.",
      "Prepare tender BOQ, equipment specifications with procurement schedule, grid-code compliance documentation, and independent peer review by power-systems specialist.",
      "Support commissioning, energisation, protection-relay testing, SCADA commissioning, and handover with O&M manual and operator training.",
    ];
  }
  if (/agri|irrigation.*scheme|crop|farm.*develop|livestock|rural.*develop/i.test(text)) {
    return [
      "Confirm command area, beneficiary needs, source availability, cropping calendar, water-user association status, and donor/client requirements before design.",
      "Complete hydrological analysis (minimum 20-year flow record), soil classification, FAO Penman-Monteith crop-water-requirement calculation, and willingness-to-pay survey.",
      "Develop irrigation network (canal or pressurised pipe) design, structure drawings, drainage management, water-use efficiency targets, and agronomy recommendations.",
      "Prepare BOQ, O&M manual, WUA governance structure, and farmer training programme; confirm local-language clarity of handover materials.",
      "Support construction supervision, commissioning, WUA establishment, operator training, and project close-out with lessons-learned memo.",
    ];
  }
  if (/mining|mineral.*extract|quarry.*design|tailings|ore.*body|blast.*design/i.test(text)) {
    return [
      "Confirm resource model confidence, regulatory context, JORC reporting obligations, environmental baseline, and community engagement requirements before study commencement.",
      "Complete geological mapping, block-model resource estimation with independent competent-person review, geotechnical investigation, and infrastructure siting assessment.",
      "Develop mine plan (pit design or underground), production schedule, tailings storage facility (TSF) design per MAC/ANCOLD guidelines, slope-stability analysis using three methods, and environmental and social management plan.",
      "Prepare JORC-compliant resource report, mine-plan drawings, BOQ, regulatory submission package, and closure plan with financial provision estimate.",
      "Support pre-feasibility or feasibility gate review, permit lodgement, and handover with monitoring and instrumentation programme.",
    ];
  }
  if (/\bport.*design|\bport.*master.*plan|berth.*design|quay.*design|harbour.*develop|dredging|container.*terminal|maritime/i.test(text)) {
    return [
      "Confirm vessel-class parameters with port authority, met-ocean data set, throughput projections, ISPS compliance requirements, and environmental baseline before design.",
      "Complete bathymetric and geotechnical survey, sediment characterisation, vessel-traffic survey, and fast-time nautical simulation to validate berth layout and turning basin.",
      "Develop berth structural design, dredge volume and disposal plan, shore-power and utilities layout, port operations manual, and environmental and social management plan.",
      "Prepare BOQ, equipment specifications (fenders, bollards, crane rails), ISPS compliance documentation, and regulatory submission package.",
      "Support construction supervision, commissioning, nautical-safety pre-opening review, ISPS certification, and handover with O&M and emergency procedures.",
    ];
  }
  if (/pipeline.*design|oil.*facilit|gas.*facilit|HAZOP|P&ID|refinery|petrochemical|upstream.*petroleum/i.test(text)) {
    return [
      "Confirm design basis, applicable codes (API, ASME, ISO), process data, grid-code or pipeline-code obligations, and HAZOP preparation requirements before detailed engineering.",
      "Complete process flow diagram, P&ID development, HAZOP study with all action items tracked to close-out, and LOPA for high-severity nodes.",
      "Develop detailed P&ID, pipeline stress analysis (Caesar II or equivalent), equipment layout, structural and civil design, and environmental and social management plan.",
      "Prepare vendor data requirements matrix, procurement support documents, BOQ, cathodic-protection design, and in-line inspection (ILI) programme specification.",
      "Support pre-commissioning, commissioning, safety system testing, handover with as-built documentation, and pipeline integrity management plan.",
    ];
  }
  if (/KYC|AML|core.*banking|microfinance.*system|credit.*risk.*model|IFRS.*implement|Basel|prudential.*regul|capital.*adequacy/i.test(text)) {
    return [
      "Confirm regulatory framework, gap analysis priorities, system architecture constraints, stakeholder change-readiness, and project governance before design.",
      "Complete business process mapping, data-quality assessment, regulatory-gap analysis reviewed by licensed local legal counsel, and target operating model design.",
      "Develop system architecture, integration design, data-migration plan, UAT protocol, and change-management plan with train-the-trainer model.",
      "Execute parallel-run cutover, data reconciliation (signed off before go-live), rollback plan documentation, and staff training; confirm RBAC, encryption, and audit-log configuration.",
      "Deliver post-go-live hypercare, SLA monitoring, and handover with source code, data, and documentation under exit-clause provisions.",
    ];
  }
  return [
    "Confirm the client objective, scope, deliverables, constraints, standards and evaluation priorities.",
    "Review source documents and evidence, then translate requirements into a controlled work plan and responsibility matrix.",
    "Deliver scope-by-scope tasks with defined inputs, activities, outputs, QA gates and client review points.",
    "Manage communication, progress reporting, risk, document control, compliance and change control.",
    "Submit final deliverables with evidence-based appendices and client acceptance controls.",
  ];
}

function openingProof(company: string, client: string, title: string, sector: string, topProjects: string[], topExperts: string[], differentiators: string[]): string[] {
  const out = [
    `${company} submits this proposal as an evidence-led response to ${client}'s ${title}. The proposal is structured around the evaluator's core questions: whether we understand the assignment, whether our comparable evidence is relevant, whether the proposed team can control the technical risks, and whether the submission is compliant and complete.`,
    `For this ${sector} assignment, our response links methodology, team roles, project evidence, submission controls and appendices into a single delivery argument rather than a checklist of disconnected documents.`,
  ];
  if (topProjects.length) out.push("Comparable proof carried into the proposal:", ...topProjects.slice(0, 3).map((line) => `- ${line}`));
  if (topExperts.length) out.push("Team proof carried into the proposal:", ...topExperts.slice(0, 3).map((line) => `- ${line}`));
  if (differentiators.length) out.push("Differentiators used to reduce evaluator uncertainty:", ...differentiators.slice(0, 4).map((line) => `- ${line}`));
  return out;
}

export function buildControlledProposalMarkdown(input: ControlledProposalInput): string {
  const title = clean(input.tenderTitle) || "Technical Proposal";
  const client = clean(input.clientName) || "Client";
  const company = clean(input.companyName) || "Our Company";
  const sector = sectorLabel(clean(input.primarySector) || "Consultancy Services", title);
  const topProjects = compact(input.projectLines, 5, 560);
  const topExperts = compact(input.expertLines, 8, 450);
  const requirements = compact(input.requirementLines, 14, 440);
  const differentiators = compact(input.differentiators, 8, 420);
  const companyEvidence = compact(input.companyEvidenceLines, 8, 420);
  const projectEvidence = compact(input.projectEvidenceLines, 8, 420);
  const submissionRules = compact(input.submissionRules, 8, 320);
  const compliance = compact(input.complianceLines, 10, 360);
  const methodology = methodologyForSector(sector, title);

  return [
    "# Cover Letter",
    `To: ${client}`,
    `Subject: Technical Proposal for ${title}`,
    ...openingProof(company, client, title, sector, topProjects, topExperts, differentiators),
    ...bullets(submissionRules, "Submission instructions will be confirmed against the tender before final submission.", 6, 280),

    "# Technical Proposal",
    title,
    `Client: ${client}`,
    `Prepared by: ${company}`,
    `Primary sector: ${sector}`,

    "# Table of Contents",
    "1. Executive Summary",
    "2. Section A: Company Profile",
    "3. Section B: Relevant Experience",
    "4. Section C: Technical Approach",
    "5. Section D: Additional Information",
    "6. Appendix Register",
    "7. Declaration",

    "# Executive Summary",
    `${company} understands the assignment as a ${sector} opportunity requiring more than a compliant document package. The evaluator needs a clear line of proof from tender requirements to relevant experience, proposed personnel, technical methodology, quality controls and appendix evidence.`,
    ...bullets(topProjects, "Supporting evidence: strongest comparable project reference to be included once verified.", 4, 560),
    ...bullets(differentiators, "Supporting evidence: differentiators to be drawn from reviewed company records and project evidence.", 5, 400),

    "# SECTION A: COMPANY PROFILE",
    "## A.1 Company Background",
    `${company} is presented through reviewed company records, project evidence, expert/CV records and compliance documents available in the tender knowledge base. The final proposal should retain only evidence-backed claims and attach the supporting records required by the tender.`,
    "## A.2 Core Areas of Expertise",
    ...bullets(companyEvidence, "Supporting evidence: company profile, registration, licences, certificates and policy/manual records as required.", 6, 380),
    "## A.3 Proposed Team and CV Evidence",
    ...bullets(topExperts, "Supporting evidence: reviewed CVs mapped to role, qualification, comparable experience and assignment responsibility.", 8, 420),

    "# SECTION B: RELEVANT EXPERIENCE",
    "## B.1 Comparable Project Evidence",
    ...bullets(topProjects, "Supporting evidence: relevant project cards showing client, scope, services, value/scale where supported and relevance to this tender.", 6, 520),
    "## B.2 Project Evidence to Attach",
    ...bullets(projectEvidence, "Supporting evidence: photos/drawings, testimony, completion evidence, contracts or certificates where required by the tender.", 8, 420),

    "# SECTION C: TECHNICAL APPROACH",
    "## C.1 Understanding of the Assignment",
    ...bullets(requirements, "Supporting evidence: scope, deliverables, evaluation criteria and submission rules confirmed from the tender source documents.", 10, 380),
    "## C.2 Scope-by-Scope Methodology",
    ...methodology.map((line) => `- ${line}`),
    "## C.3 Quality Assurance and Submission Control",
    "- Apply document control, senior technical review, evidence verification, compliance check, appendix check, file-name/order verification and final submission approval before release.",
    "- Remove or soften unsupported claims before submission; do not invent proof to fill evidence gaps.",

    "# SECTION D: ADDITIONAL INFORMATION",
    "## D.1 Value to the Client",
    "- Evidence-led delivery reduces evaluator uncertainty and shows that the proposed team, methodology and appendices are tied to real company capability.",
    "- Sector-specific methodology reduces delivery risk by addressing the technical risks most relevant to the assignment type.",
    "## D.2 Compliance and Bid Review Strategy",
    ...bullets(compliance, "Supporting evidence: final compliance check against every mandatory tender requirement.", 8, 360),

    "# Appendix Register",
    "- Company profile / registration / licence / tax or legal evidence as required",
    "- Proposed team CVs and professional credentials",
    "- Comparable project references and evidence attachments",
    "- Certificates, testimony, completion evidence, photos/drawings and forms where required",
    "- Tender-specific declarations, schedules, annexes and submission forms",

    "# Declaration",
    `${company} confirms that this technical proposal is prepared against the original tender documents and supporting source evidence for submission to ${client}.`,
  ].join("\n\n");
}
