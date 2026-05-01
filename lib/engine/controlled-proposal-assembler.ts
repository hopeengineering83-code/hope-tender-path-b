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

function methodologyForSector(primarySector: string, title: string): string[] {
  const text = `${primarySector} ${title}`;
  if (/health|hospital|medical|clinic|radiology|laboratory|pharmacy|patient|specialty|OPD|emergency/i.test(text)) {
    return [
      "Confirm facility objectives, target services, catchment, clinical operating model and approval pathway before committing to layouts.",
      "Assess shortlisted premises or site conditions for structure, utilities, access, expansion capacity, patient flow and service zoning.",
      "Develop clinical layouts for Emergency, OPD, In-patient, Laboratory, Imaging/Radiology and Pharmacy with clean/dirty flow and IPC controls.",
      "Coordinate architectural, structural, MEP, medical gas, electrical loads, ICT/telehealth, equipment clearances and radiation-shielding requirements.",
      "Prepare staged deliverables, QA reviews, authority submission support, renovation/supervision controls and close-out documentation.",
    ];
  }
  if (/water|borehole|pump|sanitary|hydraulic|irrigation|pipeline|reservoir/i.test(text)) {
    return [
      "Confirm demand, service area, source conditions, utility constraints, existing assets and stakeholder requirements.",
      "Undertake field assessment, survey, hydraulic verification and design-basis confirmation before final sizing.",
      "Develop technical options for source, conveyance, pumping, storage, distribution, drainage/sanitary interfaces and system resilience.",
      "Prepare drawings, specifications, BOQ, cost support where requested, construction methodology and testing/commissioning controls.",
      "Support supervision, quality testing, progress reporting, commissioning, O&M handover and defects follow-up.",
    ];
  }
  if (/road|bridge|transport|pavement|traffic|culvert|drainage/i.test(text)) {
    return [
      "Confirm route/site context, traffic/service requirements, survey controls, environmental/social constraints and design standards.",
      "Assess geotechnical, hydrological, drainage, pavement/structural and safety conditions before final technical options.",
      "Develop alignment, drainage, pavement/structure, traffic management and safety proposals with quantities and specifications.",
      "Implement QA/QC through design reviews, material/testing requirements, site supervision procedures and variation control.",
      "Prepare reporting, stakeholder coordination, handover documentation and close-out controls.",
    ];
  }
  if (/urban|master plan|land use|municipal|spatial|settlement/i.test(text)) {
    return [
      "Establish baseline conditions using document review, spatial analysis, field verification and stakeholder consultation.",
      "Define planning objectives, constraints, development scenarios, infrastructure/service needs and environmental/social considerations.",
      "Prepare land-use, mobility, infrastructure, phasing and implementation proposals supported by maps, schedules and decision criteria.",
      "Validate proposals with stakeholders and align outputs with applicable regulations, standards and client priorities.",
      "Deliver clear implementation, monitoring and institutional responsibility recommendations.",
    ];
  }
  if (/environment|ESIA|ESMP|safeguard|social|resettlement|climate|waste/i.test(text)) {
    return [
      "Confirm the legal, safeguard and institutional framework applicable to the assignment.",
      "Undertake baseline environmental/social assessment, stakeholder mapping and impact/risk screening.",
      "Develop mitigation measures using the mitigation hierarchy, ESMP/monitoring actions, reporting templates and responsibility matrix.",
      "Support consultation, disclosure, grievance arrangements and client review cycles.",
      "Prepare final evidence-based reports, annexes and implementation controls.",
    ];
  }
  if (/ICT|software|system|digital|database|platform|network|cyber|telecom/i.test(text)) {
    return [
      "Confirm users, workflows, data requirements, integrations, service levels and acceptance criteria.",
      "Design the solution architecture, data model, security controls, implementation roadmap and support model.",
      "Configure/build, test and validate the solution using staged acceptance gates and issue tracking.",
      "Train users, provide documentation, transition support and continuity controls.",
      "Report progress, risks, changes and acceptance evidence throughout delivery.",
    ];
  }
  return [
    "Confirm the client objective, scope, deliverables, constraints, standards and evaluation priorities.",
    "Review source documents and evidence, then translate requirements into a controlled work plan and responsibility matrix.",
    "Deliver scope-by-scope tasks with defined inputs, activities, outputs, QA gates and client review points.",
    "Manage communication, progress reporting, risk, document control, compliance and change control.",
    "Submit final deliverables with evidence-based appendices and bid-team/client acceptance controls.",
  ];
}

export function buildControlledProposalMarkdown(input: ControlledProposalInput): string {
  const title = clean(input.tenderTitle) || "Technical Proposal";
  const client = clean(input.clientName) || "Client";
  const company = clean(input.companyName) || "Our Company";
  const sector = clean(input.primarySector) || "Consultancy Services";
  const topProjects = compact(input.projectLines, 4, 520);
  const topExperts = compact(input.expertLines, 8, 420);
  const requirements = compact(input.requirementLines, 12, 420);
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
    `${company} is pleased to submit this technical proposal for ${title}. The response is structured to give the evaluator a clear view of our understanding, relevant evidence, proposed team, methodology, compliance controls and appendix evidence.`,
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
    `${company} understands the assignment as a ${sector.toLowerCase()} opportunity requiring a clear technical response, proven delivery capability and disciplined compliance with submission instructions. Our proposal leads with verified company evidence, selected project references and a practical delivery methodology tailored to the tender scope.`,
    ...bullets(topProjects, "Bid-team confirmation: add the strongest reviewed comparable project reference before final submission.", 3, 520),
    ...bullets(differentiators, "Bid-team confirmation: confirm differentiators from reviewed company evidence.", 5, 360),

    "# SECTION A: COMPANY PROFILE",
    "## A.1 Company Background",
    `${company} is presented through reviewed company records, project evidence, expert/CV records and compliance documents available in the tender knowledge base. The final proposal should retain only evidence-backed claims and attach the supporting records required by the tender.`,
    "## A.2 Core Areas of Expertise",
    ...bullets(companyEvidence, "Bid-team confirmation: attach company profile, registration, licences, certificates and policy/manual evidence as required.", 6, 380),
    "## A.3 Proposed Team and CV Evidence",
    ...bullets(topExperts, "Bid-team confirmation: select reviewed CVs and map each expert to role, qualification, comparable experience and assignment responsibility.", 8, 420),

    "# SECTION B: RELEVANT EXPERIENCE",
    "## B.1 Comparable Project Evidence",
    ...bullets(topProjects, "Bid-team confirmation: select relevant project cards with client, scope, services, value/scale where supported and relevance to this tender.", 6, 520),
    "## B.2 Project Evidence to Attach",
    ...bullets(projectEvidence, "Bid-team confirmation: attach photos/drawings, testimony, completion evidence, contracts or certificates where required by the tender.", 8, 420),

    "# SECTION C: TECHNICAL APPROACH",
    "## C.1 Understanding of the Assignment",
    ...bullets(requirements, "Bid-team confirmation: run tender analysis and confirm scope, deliverables, evaluation criteria and submission rules.", 8, 360),
    "## C.2 Scope-by-Scope Methodology",
    ...methodology.map((line) => `- ${line}`),
    "## C.3 Quality Assurance and Submission Control",
    "- Apply document control, senior technical review, evidence verification, compliance check, appendix check, file-name/order verification and final submission approval before release.",
    "- Convert unsupported or weak claims into bid-team confirmation actions instead of inventing proof.",

    "# SECTION D: ADDITIONAL INFORMATION",
    "## D.1 Value to the Client",
    "- Evidence-led delivery reduces evaluator uncertainty and shows that the proposed team, methodology and appendices are tied to real company capability.",
    "- Sector-specific methodology reduces delivery risk by addressing the technical risks most relevant to the assignment type.",
    "## D.2 Compliance and Bid Review Strategy",
    ...bullets(compliance, "Bid-team confirmation: complete final compliance check against every mandatory tender requirement.", 8, 360),

    "# Appendix Register",
    "- Company profile / registration / licence / tax or legal evidence as required",
    "- Proposed team CVs and professional credentials",
    "- Comparable project references and evidence attachments",
    "- Certificates, testimony, completion evidence, photos/drawings and forms where required",
    "- Tender-specific declarations, schedules, annexes and submission forms",

    "# Declaration",
    `${company} confirms that this technical proposal must be reviewed against the original tender documents and supporting source evidence before final submission to ${client}.`,
  ].join("\n\n");
}
