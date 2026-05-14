export type TenderRequirementLite = { title: string; description: string; priority: string; requirementType: string };
export type TenderLite = { title: string; reference?: string | null; clientName?: string | null; country?: string | null; description?: string | null; intakeSummary?: string | null; analysisSummary?: string | null; evaluationMethodology?: string | null; deadline?: Date | string | null; submissionMethod?: string | null; submissionAddress?: string | null };
export type CompanyLite = { name: string; legalName?: string | null; description?: string | null; profileSummary?: string | null; serviceLines: string; sectors: string; email?: string | null; phone?: string | null; website?: string | null; address?: string | null };
export type ExpertLite = { fullName: string; title?: string | null; yearsExperience?: number | null; disciplines: string; sectors: string; certifications: string; profile?: string | null };
export type ProjectLite = { name: string; clientName?: string | null; country?: string | null; sector?: string | null; serviceAreas: string; contractValue?: number | null; currency?: string | null; summary?: string | null };
export type ProposalTheme = { code: string; label: string; triggers: RegExp[]; proofTerms: RegExp[]; methodologyBullets: string[] };
export type EvaluationWeight = { criterion: string; weight: string; rawMatch: string };
export type CommercialTerms = {
  bidBond: string | null;
  performanceGuarantee: string | null;
  bidValidityDays: number | null;
  clarificationDeadline: string | null;
  preBidMeeting: string | null;
  contractDuration: string | null;
  consortiaRules: string | null;
  localContent: string | null;
};
export type ProposalIntelligence = {
  tenderText: string;
  clientName: string;
  assignmentName: string;
  primarySector: string;
  requiredSections: string[];
  evaluationCriteria: string[];
  evaluationWeights: EvaluationWeight[];
  commercialTerms: CommercialTerms;
  submissionRules: string[];
  differentiators: string[];
  themes: ProposalTheme[];
  topProjects: ProjectLite[];
  topExperts: ExpertLite[];
  gapsToAddressInNarrative: string[];
  appendixList: string[];
  noFinancialProposal: boolean;
  exactEmails: string[];
  exactSubjectLine: string | null;
};

export const BENCHMARK_CONTEXT_LINES: string[] = [
  "MANDATORY BENCHMARK STRUCTURE: Cover Letter; Technical Proposal; Table of Contents; Executive Summary; Company Profile; Proposed Team; Relevant Experience; Technical Approach; Compliance and Bid Review Strategy; Additional Information; Appendix Register; Declaration.",
  "FIRST-DRAFT QUALITY RULE: The first AI draft must contain the benchmark structure, evaluator-facing narrative, evidence mapping, methodology depth, compliance strategy, appendix register, and final declaration.",
  "EVIDENCE RULE: Use only provided experts, projects, company documents, legal records, financial records, compliance records, project evidence, compliance rows, and tender text. If evidence is missing, state it as a bid-team confirmation item, not as a fake claim.",
  "CLIENT-READY RULE: Do not write internal benchmark review, auto-repair, debug, AI fallback, or quality-score sections inside the client proposal document.",
  "FORBIDDEN PHRASES: Never write 'extensive experience' without a project name; 'committed to excellence/quality'; 'leading firm in the region'; 'team of qualified professionals'; 'we look forward to the opportunity'; 'as an AI'; 'certainly'; or any [square bracket] placeholder.",
  "EVIDENCE DENSITY RULE: Every strong claim must cite a specific project name, ETB/contract value, expert name + licence, or client reference. No paragraph may be purely generic without one verifiable fact.",
  "NARRATIVE THROUGHLINE RULE: The same two strongest project names MUST appear in the Cover Letter opening, Executive Summary first paragraph, AND Section B. This is not optional.",
  "EXECUTIVE SUMMARY LEAD RULE: Executive Summary must open with: 'We have already delivered this assignment. [Company] designed/supervised/assessed [Project Name] (ETB X, Client Y) — a [parallel description].' This is the single most important sentence in the proposal.",
  "TEAM-TO-PROJECT RULE: Each proposed expert must be linked in a table showing: Expert Name | Proposed Role | Previous Comparable Project | Role on That Project | Key Technical Contribution.",
  "SECTION LENGTH RULE: Cover Letter ≥ 4 paragraphs; Executive Summary ≥ 3 paragraphs; each Section A/B/C ≥ 5 paragraphs with sub-sections. Do not truncate or summarise — write the full content.",
];

export function safeParseArr(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textOf(...values: Array<string | null | undefined>): string {
  return values.map(clean).filter(Boolean).join("\n");
}

function money(value?: number | null, currency?: string | null): string | null {
  if (!value) return null;
  const label = currency || "ETB";
  if (value >= 1_000_000_000) return `${label} ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${label} ${(value / 1_000_000).toFixed(1)}M`;
  return `${label} ${value.toLocaleString()}`;
}

// ─── Proposal themes ──────────────────────────────────────────────────────────

export const PROPOSAL_THEMES: ProposalTheme[] = [
  {
    code: "HEALTHCARE",
    label: "Healthcare facility design and clinical workflow",
    triggers: [/health/i, /hospital/i, /medical/i, /clinic/i, /pharmacy/i, /radiology/i, /laboratory/i, /in[- ]?patient/i, /out[- ]?patient/i, /emergency/i, /specialty.*cent/i, /medical.*cent/i],
    proofTerms: [/hospital/i, /health/i, /medical/i, /clinic/i, /radiology/i, /laboratory/i, /pharmacy/i, /patient/i, /clinical/i, /ward/i, /ICU/i, /OPD/i],
    methodologyBullets: [
      "clinical zone segregation: Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, and Pharmacy — with explicit patient/staff/supply flow separation",
      "IPC-compliant layout: clean/dirty flow segregation, airborne infection isolation, hand-hygiene point placement, and surface material specification",
      "radiation shielding design for imaging rooms: shielding calculations, material specification, and regulatory sign-off documentation",
      "medical gas system coordination: oxygen, medical air, vacuum, nitrous oxide, and AGSS layout integrated with MEP from schematic stage",
      "medical-grade electrical design: UPS/generator for life-critical loads, isolated power systems for theatres/ICU, nurse call, BMS, and fire alarm",
      "Ethiopian Health Authority licensing documentation: design drawings, specifications, and compliance evidence package",
    ],
  },
  {
    code: "FACILITY_ASSESSMENT",
    label: "Facility identification, site assessment and selection advisory",
    triggers: [/facility identification/i, /shortlisted propert/i, /premises/i, /suitable.*space/i, /site.*selection/i, /assess.*suitability/i, /technical.*evaluation.*propert/i],
    proofTerms: [/assessment/i, /suitability/i, /structural.*adequacy/i, /feasibility/i, /premises/i, /property/i, /shortlist/i],
    methodologyBullets: [
      "structured assessment matrix for each shortlisted property: structural adequacy, spatial flexibility, utility availability, accessibility, patient flow potential, safety, and expansion capacity",
      "technical due-diligence report for each shortlisted property with a clear recommended/not-recommended conclusion and supporting evidence",
      "written technical recommendation report delivered to client before design commitment — avoids committing to a building that cannot serve the clinical function",
    ],
  },
  {
    code: "RENOVATION_ADAPTATION",
    label: "Building renovation, modification and adaptive reuse",
    triggers: [/renovation/i, /modification/i, /retrofit/i, /adapt/i, /convert/i, /refurb/i, /upgrade/i, /existing building/i, /existing facility/i, /existing structure/i],
    proofTerms: [/renovation/i, /modification/i, /retrofit/i, /existing/i, /heritage/i, /adaptive/i, /refurb/i],
    methodologyBullets: [
      "pre-design structural and services condition survey: identify hidden defects, load constraints, and code-compliance gaps before design begins",
      "phased renovation strategy that maintains operational continuity during construction — critical for live facilities",
      "detailed renovation drawings, specifications, BOQ, cost estimates and contractor-supervision plan",
    ],
  },
  {
    code: "MEP_BIOMEDICAL",
    label: "MEP, biomedical engineering and equipment integration",
    triggers: [/MEP/i, /biomedical/i, /bio-medical/i, /medical gas/i, /electrical.*load/i, /IT system/i, /telehealth/i, /HVAC/i, /electromechanical/i, /building services/i],
    proofTerms: [/MEP/i, /electrical/i, /sanitary/i, /mechanical/i, /medical gas/i, /HVAC/i, /power/i, /biomedical/i, /equipment/i],
    methodologyBullets: [
      "medical-grade electrical load schedule: equipment power demands, UPS sizing, generator capacity, and emergency power discrimination",
      "medical gas system: pipe sizing, outlet locations, alarm panels, and pressure testing protocol",
      "ICT infrastructure: nurse-call, PACS-ready data cabling, telehealth endpoints, BMS integration, and fire-alarm zoning",
    ],
  },
  {
    code: "WATER_INFRASTRUCTURE",
    label: "Water supply, hydraulics and infrastructure engineering",
    triggers: [/water supply/i, /pump/i, /borehole/i, /sanitary/i, /hydraulic/i, /irrigation/i, /pipeline/i, /water.*system/i, /WASH/i],
    proofTerms: [/water/i, /sanitary/i, /hydraulic/i, /borehole/i, /pump/i, /pipeline/i, /reservoir/i, /WASH/i],
    methodologyBullets: [
      "hydraulic modelling: demand projections, pipe network analysis using WaterCAD/EPANET, and pressure-zone definition",
      "borehole siting, drilling supervision, pump selection, and yield testing",
      "water supply, drainage, fire suppression and operational resilience planning with BOQ and construction supervision",
    ],
  },
  {
    code: "STRUCTURAL_GEOTECHNICAL",
    label: "Structural engineering and geotechnical investigation",
    triggers: [/structural/i, /foundation/i, /geotechnical/i, /soil.*investigation/i, /borehole.*investigation/i, /seismic/i, /EBCS/i],
    proofTerms: [/structural/i, /foundation/i, /geotechnical/i, /soil/i, /ETABS/i, /SAP2000/i, /seismic/i, /EBCS/i],
    methodologyBullets: [
      "geotechnical investigation: borehole drilling, soil sampling, laboratory testing (EBCS/ASTM compliant), and bearing capacity recommendation",
      "structural analysis using ETABS/SAP2000/SAFE: seismic detailing to EBCS-8, foundation engineering for site-specific soil conditions",
      "staged design review from schematic to working-drawing level with independent peer check before construction-document issue",
    ],
  },
  {
    code: "DONOR_COMPLIANCE",
    label: "Donor compliance, ESG, quality and institutional standards",
    triggers: [/World Bank/i, /UNDP/i, /ESF/i, /environmental.*social/i, /safeguard/i, /ISO/i, /FIDIC/i, /procurement.*rule/i, /donor/i, /grant/i],
    proofTerms: [/World Bank/i, /UNDP/i, /ESF/i, /British Council/i, /ISO/i, /FIDIC/i, /ESG/i, /environmental/i, /social/i],
    methodologyBullets: [
      "project-specific Quality Management Plan aligned to ISO 9001:2015, with document control, design-review gates, and audit trail",
      "Environmental and Social Management Plan (ESMP) prepared to World Bank ESF or equivalent donor standard",
      "FIDIC-compliant contract administration: progress reporting, variation management, payment certification, and defects-liability oversight",
    ],
  },
  {
    code: "URBAN_MASTER_PLANNING",
    label: "Urban planning, master planning and landscape architecture",
    triggers: [/urban/i, /master plan/i, /city plan/i, /municipal/i, /landscape/i, /park/i, /eco-park/i, /public.*space/i, /mixed.use/i, /spatial.*plan/i],
    proofTerms: [/urban/i, /master plan/i, /landscape/i, /park/i, /zoning/i, /planning/i, /municipal/i, /GIS/i],
    methodologyBullets: [
      "GIS-based spatial analysis and land-use zoning: site assessment, catchment analysis, demographic projections, and regulatory compliance review",
      "master plan with phasing strategy, infrastructure integration, green space design, stakeholder engagement plan, and investment roadmap",
      "detailed landscape drawings, planting schedules, lighting design, public-realm specifications, and implementation manual",
    ],
  },
  {
    code: "ROAD_TRANSPORT",
    label: "Road design, bridge engineering and transport infrastructure",
    triggers: [/road.*design/i, /road.*rehab/i, /bridge.*design/i, /highway/i, /pavement/i, /transport.*infra/i, /culvert/i, /road.*supervision/i],
    proofTerms: [/road/i, /bridge/i, /pavement/i, /highway/i, /culvert/i, /drainage/i, /transport/i, /ERA/i, /AASHTO/i],
    methodologyBullets: [
      "route survey and alignment design: topographic survey, geotechnical investigation (CBR, proctor, borehole/test pit), traffic count and ESAL design traffic calculation",
      "pavement design per ERA/AASHTO standard: layer thicknesses, surfacing specification, drainage design (culverts, side drains), bridge/structure design and safety audit",
      "construction supervision: materials testing programme (CBR, compaction, aggregate quality), progress reporting, variation control, payment certification, as-built documentation",
    ],
  },
  {
    code: "ENVIRONMENTAL_SOCIAL",
    label: "Environmental and social impact assessment, safeguards and ESMP",
    triggers: [/ESIA/i, /ESMP/i, /environmental.*impact/i, /social.*safeguard/i, /environmental.*assess/i, /EHS/i, /resettlement/i, /biodiversity/i],
    proofTerms: [/ESIA/i, /ESMP/i, /environmental/i, /social/i, /safeguard/i, /mitigation/i, /stakeholder/i, /baseline/i, /ESF/i],
    methodologyBullets: [
      "baseline data collection: physical environment survey, biological/ecological survey, socioeconomic baseline — all primary field data, not desktop-only",
      "impact identification and assessment matrix: impact significance rating, mitigation hierarchy (avoid → minimise → restore → offset) for each impact pathway",
      "ESMP: management measures, monitoring indicators, institutional responsibilities, reporting schedule, grievance mechanism, and donor-standard (World Bank ESF/IFC PS) compliance package",
    ],
  },
  {
    code: "ICT_DIGITAL",
    label: "ICT systems, digital platforms and information management",
    triggers: [/ICT/i, /information.*system/i, /software.*develop/i, /digital.*platform/i, /database/i, /MIS/i, /ERP/i, /network.*design/i, /cyber/i],
    proofTerms: [/ICT/i, /software/i, /system/i, /database/i, /platform/i, /network/i, /data/i, /MIS/i, /ERP/i, /deployment/i],
    methodologyBullets: [
      "requirements analysis and system architecture: business process review, functional specification, application/database/infrastructure layer design, security controls (access management, encryption, audit trail)",
      "phased implementation: agile/iterative delivery, integration with existing systems (APIs, data migration), acceptance testing (unit/integration/UAT), training programme and change management",
      "go-live and post-deployment: deployment checklist, parallel-run, SLA definition, support model, documentation set, source code and data handover",
    ],
  },
  {
    code: "EDUCATION_FACILITY",
    label: "Education facility design, school and campus development",
    triggers: [/school.*design/i, /university.*design/i, /campus.*develop/i, /education.*facilit/i, /training.*cent/i, /vocational.*facilit/i],
    proofTerms: [/school/i, /university/i, /campus/i, /education/i, /classroom/i, /laboratory/i, /training/i, /faculty/i],
    methodologyBullets: [
      "functional brief and space schedule: classrooms, laboratories, library, administration, sanitation (pupil-ratio compliance), sports/recreation — with climate-responsive and accessible design",
      "MEP coordination: power supply, backup solar/generator, water and sanitation, ICT cabling, fire detection and emergency systems",
      "construction supervision and regulatory sign-off: materials testing, progress reporting, defects register, education authority functional approval, fire certificate, handover documentation",
    ],
  },
  {
    code: "SOCIAL_ADVISORY",
    label: "Social development, advisory services and institutional strengthening",
    triggers: [/social.*develop/i, /advisory.*service/i, /institutional.*strength/i, /capacity.*build/i, /livelihood/i, /community.*develop/i, /NGO/i, /welfare/i],
    proofTerms: [/social/i, /advisory/i, /capacity/i, /stakeholder/i, /community/i, /governance/i, /livelihood/i, /training/i],
    methodologyBullets: [
      "situational analysis and needs assessment: participatory methodology, stakeholder mapping, baseline data collection, gap analysis against target outcomes",
      "programme design: theory of change, activity schedule, indicator framework (output/outcome/impact), M&E plan, risk register",
      "implementation: community mobilisation, capacity building workshops, institutional partnerships, progress reporting, adaptive management, and final evaluation methodology",
    ],
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreTextAgainstTheme(text: string, theme: ProposalTheme): number {
  let score = 0;
  for (const p of theme.proofTerms) if (p.test(text)) score += 2;
  for (const p of theme.triggers) if (p.test(text)) score += 1;
  return score;
}

function projectScore(project: ProjectLite, themes: ProposalTheme[], tenderText: string): number {
  const text = textOf(project.name, project.clientName, project.country, project.sector, project.summary, ...safeParseArr(project.serviceAreas));
  let score = 0;
  for (const t of themes) score += scoreTextAgainstTheme(text, t);
  // Sector-match bonuses — direct sector overlap is the strongest relevance signal
  if (/hospital|health|medical|clinic/i.test(text) && /hospital|health|medical|clinic/i.test(tenderText)) score += 15;
  if (/renovation|modification|retrofit|existing/i.test(text) && /renovation|premises|existing|assessment/i.test(tenderText)) score += 8;
  if (/water|borehole|pump|hydraulic|WASH|irrigation/i.test(text) && /water|borehole|pump|hydraulic|WASH|irrigation/i.test(tenderText)) score += 12;
  if (/road|bridge|highway|pavement|transport.*infra/i.test(text) && /road|bridge|highway|pavement|transport.*infra/i.test(tenderText)) score += 12;
  if (/structural|foundation|geotechnical/i.test(text) && /structural|foundation|geotechnical/i.test(tenderText)) score += 8;
  if (/ESIA|ESMP|environmental.*impact|social.*safeguard/i.test(text) && /ESIA|ESMP|environmental.*impact|social.*safeguard/i.test(tenderText)) score += 12;
  if (/ICT|software|information.*system|MIS|ERP|digital.*platform/i.test(text) && /ICT|software|information.*system|MIS|ERP|digital/i.test(tenderText)) score += 12;
  if (/urban|master plan|municipal|spatial.*plan/i.test(text) && /urban|master plan|municipal|spatial.*plan/i.test(tenderText)) score += 10;
  if (/school|university|campus|education/i.test(text) && /school|university|campus|education/i.test(tenderText)) score += 10;
  if (/social.*develop|advisory|capacity.*build|community/i.test(text) && /social.*develop|advisory|capacity.*build|community/i.test(tenderText)) score += 8;
  if (/World Bank|UNDP|donor.*fund/i.test(text) && /World Bank|UNDP|donor.*fund/i.test(tenderText)) score += 6;
  // Contract value bonus (bigger projects = stronger institutional evidence).
  // Guard against contractValue < 1 — log10 returns negative for sub-unit
  // values, which would penalise projects stored in fractional units.
  if (project.contractValue && project.contractValue >= 1) score += Math.min(6, Math.log10(project.contractValue));
  // Country match bonus
  if (project.country && tenderText.toLowerCase().includes(project.country.toLowerCase())) score += 3;
  return score;
}

function expertScore(expert: ExpertLite, themes: ProposalTheme[], tenderText: string): number {
  const text = textOf(expert.fullName, expert.title, expert.profile, ...safeParseArr(expert.disciplines), ...safeParseArr(expert.sectors), ...safeParseArr(expert.certifications));
  let score = 0;
  for (const t of themes) score += scoreTextAgainstTheme(text, t);
  // Role-match bonuses — discipline relevance to the detected tender scope
  if (/architect/i.test(text) && /architect|design|layout|space|building/i.test(tenderText)) score += 10;
  if (/MEP|electrical|mechanical|sanitary/i.test(text) && /MEP|electrical|medical gas|equipment|sanitary|building.*service/i.test(tenderText)) score += 8;
  if (/biomedical|bio-medical/i.test(text) && /biomedical|bio-medical|medical equipment/i.test(tenderText)) score += 12;
  if (/structural/i.test(text) && /structural|adequacy|seismic|building|bridge/i.test(tenderText)) score += 8;
  if (/project manager|team leader|principal|director|programme.*manager/i.test(text)) score += 4;
  if (/geotechnical|hydrogeol|drilling/i.test(text) && /geotechnical|drilling|borehole|soil|foundation/i.test(tenderText)) score += 10;
  if (/environmental|social|safeguard|ESIA|ESMP/i.test(text) && /environmental|ESIA|ESMP|ESF|World Bank|safeguard/i.test(tenderText)) score += 10;
  if (/hydraulic|water.*engineer|civil.*engineer.*water|hydrologist/i.test(text) && /water supply|hydraulic|borehole|WASH|irrigation/i.test(tenderText)) score += 10;
  if (/road.*engineer|highway|transport.*engineer|pavement/i.test(text) && /road|bridge|highway|pavement|transport/i.test(tenderText)) score += 10;
  if (/ICT|software|system.*analyst|database|network.*engineer|developer/i.test(text) && /ICT|software|system|MIS|ERP|digital/i.test(tenderText)) score += 10;
  if (/urban.*planner|town.*planner|spatial.*planner|GIS/i.test(text) && /urban|master plan|spatial.*plan|GIS/i.test(tenderText)) score += 8;
  if (/social.*specialist|community.*develop|livelihoods/i.test(text) && /social|community|stakeholder|livelihood/i.test(tenderText)) score += 8;
  if (/education.*specialist|school.*designer|campus.*architect/i.test(text) && /school|university|campus|education/i.test(tenderText)) score += 8;
  if (expert.yearsExperience) score += Math.min(6, expert.yearsExperience / 4);
  return score;
}

// ─── Section / criteria / submission detection ────────────────────────────────

function detectRequiredSections(tenderText: string): string[] {
  // Try to extract the actual lettered section structure from the tender
  const lettered: string[] = [];
  const sectionMatches = tenderText.matchAll(/\b([A-D])\.\s+(Company Profile|Relevant Experience|Technical Approach|Additional Information|Proposed Team|Financial Information|Value[- ]Added)[^\n]*/gi);
  for (const m of sectionMatches) {
    const label = `SECTION ${m[1].toUpperCase()}: ${m[2].trim().toUpperCase()}`;
    if (!lettered.includes(label)) lettered.push(label);
  }
  if (lettered.length >= 2) return lettered.slice(0, 6);

  // Fall back to keyword detection
  const detected: string[] = [];
  if (/company profile|company background|about us|organisat/i.test(tenderText)) detected.push("SECTION A: COMPANY PROFILE");
  if (/relevant experience|similar.*project|portfolio|project reference/i.test(tenderText)) detected.push("SECTION B: RELEVANT EXPERIENCE");
  if (/technical approach|methodology|understanding of.*assignment|work plan/i.test(tenderText)) detected.push("SECTION C: TECHNICAL APPROACH");
  if (/additional information|value[- ]?added|certifications|awards|recognition/i.test(tenderText)) detected.push("SECTION D: ADDITIONAL INFORMATION");
  return detected.length >= 2 ? detected : ["Cover Letter", "Executive Summary", "Company Profile", "Relevant Experience", "Technical Approach", "Compliance and Declaration"];
}

function detectEvaluationCriteria(tenderText: string): string[] {
  const criteria: string[] = [];
  const evalSection = tenderText.match(/evaluation criteria[\s\S]{0,2000}/i)?.[0] ?? tenderText;

  // Healthcare
  if (/healthcare.*experience|similar.*hospital|medical.*facility.*experience/i.test(evalSection)) criteria.push("Relevant healthcare / similar medical facility project experience — lead with named hospitals, values, and client references");
  if (/technical understanding|facility design|clinical|healthcare.*design/i.test(evalSection)) criteria.push("Technical understanding of healthcare facility design — demonstrate clinical workflow, IPC, MEP integration knowledge");

  // Water/Infrastructure
  if (/water.*experience|water.*project|hydraulic|WASH|sanitation.*experience/i.test(evalSection)) criteria.push("Relevant water supply / sanitation / hydraulic engineering project experience — lead with named schemes, capacities, and client references");
  if (/borehole|groundwater|hydrogeol/i.test(evalSection)) criteria.push("Hydrogeological and borehole investigation expertise — show yield, depth, and field supervision evidence");

  // Road/Bridge
  if (/road.*experience|bridge.*experience|transport.*experience|pavement.*design/i.test(evalSection)) criteria.push("Relevant road / bridge / transport infrastructure experience — lead with route length, contract value, and supervision outcomes");
  if (/traffic.*study|pavement.*design|highway.*design/i.test(evalSection)) criteria.push("Technical depth in road design — demonstrate pavement design, drainage, and safety audit capability");

  // Environmental/Social
  if (/ESIA|environmental.*experience|social.*assessment|safeguard.*experience/i.test(evalSection)) criteria.push("ESIA/ESMP experience — show accepted reports, donor compliance, and stakeholder engagement track record");
  if (/World Bank|UNDP|donor.*standard|safeguard.*framework/i.test(evalSection)) criteria.push("Donor compliance track record (World Bank ESF, IFC PS, or equivalent) — position as risk reduction advantage");

  // ICT
  if (/ICT.*experience|system.*develop|software.*experience|MIS|ERP/i.test(evalSection)) criteria.push("Relevant ICT / system development experience — show deployed systems, user counts, and client references");
  if (/data.*security|cyber|network.*design/i.test(evalSection)) criteria.push("Technical depth in data security, network architecture, and system resilience");

  // Urban Planning
  if (/urban.*experience|master.*plan.*experience|planning.*experience|GIS/i.test(evalSection)) criteria.push("Urban / master planning experience — show plans delivered, scale, and regulatory alignment outcomes");

  // Education
  if (/school.*design|university.*design|education.*facility.*experience/i.test(evalSection)) criteria.push("Education facility design experience — show comparable school/campus projects with functional approval outcomes");

  // Universal criteria
  if (/portfolio|quality.*portfolio|relevance.*portfolio/i.test(evalSection)) criteria.push("Quality and relevance of project portfolio — include photos, drawings, and project outcome evidence");
  if (/professional team|multidisciplinary|strength.*team|key.*personnel|team.*composition/i.test(evalSection)) criteria.push("Strength of professional team — show each expert's role on a comparable previous project");
  if (/company.*profile|firm.*profile|organisational.*capacity/i.test(evalSection)) criteria.push("Company profile and organisational capacity — licence grade, staff count, registrations, certifications");
  if (/submission.*requirement|compliance.*submission|format.*requirement/i.test(evalSection)) criteria.push("Compliance with all submission requirements — section structure, file format, subject line, deadline");
  if (/value.*added|additional.*service|added.*value/i.test(evalSection)) criteria.push("Value-added services and in-house capabilities beyond minimum scope");
  if (/methodology|technical.*approach|work.*plan/i.test(evalSection)) criteria.push("Quality of technical methodology — demonstrate structured, deliverable-linked work plan with QA gates");

  return criteria.length > 0 ? criteria : [
    "Relevant project experience — lead with highest-value comparable projects by sector",
    "Team qualifications and comparable previous roles — show licences and specific project assignments",
    "Technical approach and methodology — demonstrate scope understanding, deliverables, and QA process",
    "Company capacity — licence grade, completed projects, institutional certifications",
    "Compliance with all submission format and document requirements",
  ];
}

function detectSubmissionRules(tender: TenderLite, tenderText: string): string[] {
  const rules: string[] = [];

  // No financial proposal
  if (/financial proposal.*not|technical proposal only|no financial proposal|do not.*financial|financial.*not.*required/i.test(tenderText)) {
    rules.push("Technical proposal ONLY — do not include any financial offer, rates, or pricing.");
  }

  // Exact email recipients
  const emails = Array.from(tenderText.matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi))
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i);
  if (emails.length) rules.push(`Submit to ALL email recipients: ${emails.join(", ")}.`);

  // Exact subject line
  const subjectMatch =
    tenderText.match(/[Ss]ubject\s+[Ll]ine\s*[:\-]\s*[""]([^""]{5,150})[""]/i) ??
    tenderText.match(/[Ss]ubject\s*[:\-]\s*[""]([^""]{5,150})[""]/i) ??
    tenderText.match(/[Ss]ubject\s*[:\-]\s*(Technical Proposal[^\n]{0,80})/i);
  if (subjectMatch?.[1]) rules.push(`Exact subject line (verbatim): "${subjectMatch[1].trim()}".`);

  // Deadline
  if (tender.deadline) {
    rules.push(`Submission deadline: ${new Date(tender.deadline).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}.`);
  } else {
    const deadlineMatch = tenderText.match(/[Dd]eadline\s*[:\-]\s*([^\n]{5,60})/);
    if (deadlineMatch?.[1]) rules.push(`Deadline: ${deadlineMatch[1].trim()}.`);
  }

  // Submission method/address
  if (tender.submissionMethod) rules.push(`Submission method: ${tender.submissionMethod}.`);
  if (tender.submissionAddress) rules.push(`Submission portal / address: ${tender.submissionAddress}.`);

  // File format
  if (/PDF only|submit.*PDF|electronic.*PDF/i.test(tenderText)) rules.push("File format: PDF (electronic submission only).");

  // Shortlisting note
  if (/shortlist|only shortlisted/i.test(tenderText)) rules.push("Only shortlisted firms will be contacted for the next stage.");

  return Array.from(new Set(rules));
}

function detectThemes(tenderText: string): ProposalTheme[] {
  const scored = PROPOSAL_THEMES.map((t) => ({ theme: t, score: t.triggers.filter((p) => p.test(tenderText)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  // Return only matched themes. An empty array is correct when no themes
  // trigger — forcing donor-compliance on an unrelated tender (e.g. road
  // design) injects irrelevant methodology bullets and hurts quality.
  return scored.map((s) => s.theme);
}

export function inferSector(tenderText: string): string {
  if (/health|hospital|medical|clinic|specialty.*cent/i.test(tenderText)) return "Healthcare / Medical Facility Design";
  if (/water supply|borehole|pump|hydraulic|irrigation|WASH|sanitation|wastewater/i.test(tenderText)) return "Water & Sanitation Infrastructure";
  if (/road.*design|road.*rehab|bridge.*design|highway|pavement.*design/i.test(tenderText)) return "Road / Bridge / Transport Infrastructure";
  if (/ESIA|ESMP|environmental.*impact|social.*safeguard|resettlement|biodiversity.*assess/i.test(tenderText)) return "Environmental & Social Impact Assessment";
  if (/ICT|software.*develop|information.*system|digital.*platform|MIS|ERP|database.*system/i.test(tenderText)) return "ICT / Digital Systems";
  if (/urban|master plan|municipal.*develop|eco.?park|spatial.*plan/i.test(tenderText)) return "Urban / Master Planning";
  if (/school.*design|university.*design|campus.*develop|education.*facilit/i.test(tenderText)) return "Education Facility Design";
  if (/social.*develop|advisory.*service|institutional.*strength|capacity.*build|community.*develop/i.test(tenderText)) return "Social Development & Advisory";
  if (/hotel|hospitality|resort/i.test(tenderText)) return "Hospitality & Tourism";
  if (/factory|industrial|manufacturing/i.test(tenderText)) return "Industrial / Manufacturing";
  if (/geotechnical|soil.*investigation|foundation.*design|seismic/i.test(tenderText)) return "Geotechnical & Structural Engineering";
  if (/renovation|modification|retrofit|existing building/i.test(tenderText)) return "Building Renovation & Adaptation";
  if (/architecture|building.*design|construction.*supervision|structural.*design/i.test(tenderText)) return "Building Design & Construction Supervision";
  return "General Consultancy / Engineering";
}

function detectAppendixList(tenderText: string): string[] {
  const appendices: string[] = [];
  const matches = tenderText.matchAll(/(?:[Aa]ppendi[cx]|[Aa]nnex)\s+([A-Z]|\d{1,2})\s*[:\-–]\s*([^\n]{5,120})/g);
  for (const m of matches) {
    const label = /^\d/.test(m[1]) ? m[1] : m[1].toUpperCase();
    appendices.push(`Appendix ${label}: ${m[2].trim()}`);
  }
  if (appendices.length === 0) {
    // Generate standard appendix list from context
    if (/registration|license|licence|TIN|VAT|business.*reg/i.test(tenderText)) appendices.push("Appendix A: Company Profile and Registration Documents");
    if (/contract.*letter|testimony|reference.*letter|client.*reference/i.test(tenderText)) appendices.push("Appendix B: Client Reference Letters and Contracts");
    if (/CV|curriculum vitae|staff|expert/i.test(tenderText)) appendices.push("Appendix C: Curricula Vitae and Professional Credentials");
    if (/photo|drawing|floor plan|image/i.test(tenderText)) appendices.push("Appendix D: Project Photos, Floor Plans and Drawings");
    if (/audited|financial statement|audit report/i.test(tenderText)) appendices.push("Appendix E: Audited Financial Statements and Company Manuals");
  }
  return appendices;
}

function detectExactEmails(tenderText: string): string[] {
  return Array.from(tenderText.matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi))
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i);
}

function detectExactSubjectLine(tenderText: string): string | null {
  const m =
    tenderText.match(/[Ss]ubject\s+[Ll]ine\s*[:\-]\s*[""]([^""]{5,150})[""]/i) ??
    tenderText.match(/[Ss]ubject\s*[:\-]\s*[""]([^""]{5,150})[""]/i) ??
    tenderText.match(/[Ss]ubject\s*[:\-]\s*(Technical Proposal[^\n]{0,80})/i);
  return m?.[1]?.trim() ?? null;
}

// ─── Differentiators ──────────────────────────────────────────────────────────

function makeDifferentiators(
  company: CompanyLite,
  projects: ProjectLite[],
  experts: ExpertLite[],
  themes: ProposalTheme[],
  tenderText: string,
): string[] {
  const allProjectText = projects.map((p) => textOf(p.name, p.summary, p.sector, p.clientName, ...safeParseArr(p.serviceAreas))).join("\n");
  const allExpertText = experts.map((e) => textOf(e.fullName, e.title, e.profile, ...safeParseArr(e.disciplines), ...safeParseArr(e.certifications))).join("\n");
  const companyText = textOf(company.profileSummary, company.description, safeParseArr(company.serviceLines).join(", "));
  const items: string[] = [];

  // The strings below are CLIENT-FACING differentiator claims — they appear
  // verbatim in the Cover Letter / Why Us / Executive Summary as bullets.
  // They MUST read as statements about the firm, not as instructions to a
  // writer. Avoid imperative verbs ("Show", "Map", "Describe", "Position",
  // "LEAD WITH", "Frame as"), AI-prompt language ("Proposal must address",
  // "Create a Team-to-Project table"), and meta-commentary about the
  // proposal itself ("position it as", "should be framed as").

  // Healthcare positioning — claim, not instruction.
  if (themes.some((t) => t.code === "HEALTHCARE")) {
    if (/hospital|health.*facilit|medical.*cent/i.test(allProjectText)) {
      items.push("Direct healthcare facility delivery experience: prior hospital and medical-centre projects in the firm's reviewed portfolio give this engagement a same-team continuity advantage.");
    }
    items.push("Healthcare-specific design depth: IPC compliance, clinical zone segregation, radiation shielding for imaging, medical gas coordination, and Health Authority licensing are core deliverables, not afterthoughts.");
    items.push("Each proposed lead has performed a comparable role on a previous reviewed project — credentials matched to actual delivery, not just discipline.");
  }

  // Facility assessment — claim, not instruction.
  if (themes.some((t) => t.code === "FACILITY_ASSESSMENT")) {
    items.push("Structured property assessment methodology covering structural adequacy, spatial feasibility, utility availability, accessibility, and expansion potential, backed by in-house geotechnical capability for due-diligence speed.");
  }

  // Donor compliance — claim, not instruction.
  if (/World Bank|ESF|UNDP|British Council/i.test(companyText + allProjectText)) {
    items.push("Donor-grade documentation track record (World Bank ESF, British Council, equivalent): documentation discipline exceeds typical regulatory requirements, reducing approval risk.");
  }

  // In-house geotechnical — claim.
  if (/geotechnical|drilling rig|soil.*machine|laboratory/i.test(companyText)) {
    items.push("In-house geotechnical capability (drilling rigs, soil testing laboratory) removes sub-contractor coordination from the site-assessment phase and protects acquisition timelines.");
  }

  // MEP in-house — claim.
  if (/MEP|electrical.*engineer|sanitary.*engineer|mechanical/i.test(allExpertText)) {
    items.push("Single-source multidisciplinary MEP team (electrical, sanitary, mechanical) under one firm — coordination is internal, not contractual.");
  }

  // Large project scale — already a claim, kept.
  const bigProjects = projects.filter((p) => (p.contractValue ?? 0) >= 100_000_000);
  if (bigProjects.length > 0) {
    const biggest = bigProjects.sort((a, b) => (b.contractValue ?? 0) - (a.contractValue ?? 0))[0];
    const val = money(biggest.contractValue, biggest.currency);
    items.push(`High-value institutional project track record (${val ?? "large scale"} — ${biggest.name}): documented delivery at the scale this engagement requires.`);
  }

  // PhD / senior credentials — claim.
  if (/PhD|doctorate|Eindhoven|Oxford|imperial/i.test(allExpertText)) {
    items.push("Team includes PhD-qualified specialists — deep technical capability supported by international academic credentials.");
  }

  // Pharo-specific — claim, not instruction.
  if (/pharo/i.test(tenderText)) {
    items.push("Engagement model tuned to private-sector investor expectations: schedule certainty, audit-ready documentation, and institutional delivery discipline alongside technical depth.");
  }

  return Array.from(new Set(items)).slice(0, 8);
}

// ─── Gap detection ────────────────────────────────────────────────────────────

function detectGaps(themes: ProposalTheme[], topProjects: ProjectLite[], topExperts: ExpertLite[], tenderText: string): string[] {
  const gaps: string[] = [];

  if (themes.some((t) => t.code === "HEALTHCARE") && !topProjects.some((p) => /hospital|health|medical|clinic/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Healthcare tender detected but no clearly healthcare-specific reviewed project is selected. Use the closest renovation/MEP/hospital-adjacent project and explicitly flag the evidence gap as a senior bid-review action.");
  }

  if (/biomedical|bio-medical/i.test(tenderText) && !topExperts.some((e) => /biomedical|bio-medical/i.test(textOf(e.title, e.profile, ...safeParseArr(e.disciplines))))) {
    gaps.push("Tender requires a biomedical engineering specialist. No biomedical expert is currently selected. Proposal must include a named specialist (or a credible engagement plan) with their integration role described.");
  }

  if (/photo|drawing|floor plan/i.test(tenderText) && topProjects.length > 0) {
    gaps.push("Tender requests project photos and/or drawings. Proposal should list them explicitly in appendices (e.g., 'Appendix D: Project Photos and Floor Plans') — not only describe projects in text.");
  }

  if (/3 expert|three expert|minimum.*expert|at least.*expert/i.test(tenderText) && topExperts.length < 3) {
    gaps.push(`Tender may require minimum 3 experts; only ${topExperts.length} reviewed expert(s) are selected. Add or review additional experts before final submission.`);
  }

  if (/client reference|reference letter|testimony/i.test(tenderText) && !topProjects.some((p) => p.clientName)) {
    gaps.push("Tender asks for client references. Ensure selected projects have client names and reference letters available for appendix inclusion.");
  }

  return gaps;
}

// ─── Evaluation weight extraction ─────────────────────────────────────────────

/**
 * Detect numeric evaluation weights in the tender text. Tenders state weights
 * in many shapes:
 *   "Technical 70%, Financial 30%"
 *   "Relevant Experience — 25 points"
 *   "Methodology Approach — 20 marks"
 *   "Quality of Proposed Team: 15%"
 *   "(weight 30)"
 *
 * Returns each detected criterion with its weight verbatim. Used downstream to
 * populate the EVALUATION CRITERIA RESPONSE MIRROR table in the proposal so
 * the bid writer can echo the evaluator's own language back at them.
 */
function detectEvaluationWeights(tenderText: string): EvaluationWeight[] {
  // Anchor on the evaluation-criteria zone if we can find one — otherwise scan whole text.
  const evalZone = tenderText.match(/(evaluation criteria|scoring|technical evaluation|points allocation)[\s\S]{0,3500}/i)?.[0] ?? tenderText;

  const weights: EvaluationWeight[] = [];
  const seen = new Set<string>();

  // Patterns that work well across real tenders:
  //   "Criterion name 25%"
  //   "Criterion name — 25 points"
  //   "Criterion name: 25 marks"
  //   "Criterion name (30)"
  //   "Criterion name 25 pts (sub1 10, sub2 8, sub3 7)" — sub-criterion hierarchies
  const patterns = [
    /([A-Z][A-Za-z &/(),'\-]{8,80}?)\s*[—\-:]\s*(\d{1,2})\s*(?:%|percent|points|marks|pts)/g,
    /([A-Z][A-Za-z &/(),'\-]{8,80}?)\s*\((\d{1,2})\s*(?:%|points|marks|pts)?\)/g,
    /([A-Z][A-Za-z &/(),'\-]{8,80}?)\s+(\d{1,2})\s*%/g,
    // Sub-criterion hierarchy: "Criterion Name 25 pts (sub1 10, sub2 8)"
    /([A-Z][A-Za-z &/(),'\-]{5,70}?)\s+(\d{1,2})\s*(?:pts|points|marks|%)\s*\([^)]{5,120}\)/g,
    // Numbered list criterion: "1. Criterion Name: 30 marks"
    /(?:^\s*\d+[.)]\s*)([A-Z][A-Za-z &/(),'\-]{5,70}?)\s*[:\-—]\s*(\d{1,2})\s*(?:%|points|marks|pts)/gm,
    // Criterion with weight in brackets then colon: "Relevant Experience (30 marks):"
    /([A-Z][A-Za-z &/(),'\-]{5,70}?)\s*\((\d{1,2})\s*(?:%|marks|points|pts)\)\s*[:\-]?/g,
  ];

  for (const pattern of patterns) {
    for (const match of evalZone.matchAll(pattern)) {
      const criterion = clean(match[1]).replace(/^[•\-*\d.]+\s*/, "");
      const weight = match[2];
      const numeric = Number(weight);
      // Reject obvious noise: years, page numbers, years-experience, percentages on technical content
      if (!Number.isFinite(numeric) || numeric < 5 || numeric > 100) continue;
      // Reject criterion strings that look like prose, year mentions, or addresses
      if (/^(in|of|the|to|and|for|with|by|at|on|from)\s/i.test(criterion)) continue;
      if (/\bpage\b|\byear\b|\bcopy\b|\bcopies\b/i.test(criterion)) continue;
      if (criterion.length < 8 || criterion.length > 80) continue;
      const key = `${criterion.toLowerCase()}|${weight}`;
      if (seen.has(key)) continue;
      seen.add(key);
      weights.push({ criterion, weight: `${weight}${match[0].includes("%") ? "%" : match[0].includes("points") || match[0].includes("pts") ? " points" : match[0].includes("marks") ? " marks" : "%"}`, rawMatch: match[0].trim() });
    }
  }

  // Secondary dedup: merge entries where criterion text differs only by trailing
  // punctuation or minor whitespace variation — pattern overlap can produce
  // "Relevant Experience" and "Relevant Experience " as separate keys.
  const criterionSeen = new Map<string, boolean>();
  const deduped = weights.filter((w) => {
    const normKey = w.criterion.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (criterionSeen.has(normKey)) return false;
    criterionSeen.set(normKey, true);
    return true;
  });
  return deduped.slice(0, 12);
}

// ─── Commercial terms extraction ──────────────────────────────────────────────

/**
 * Detect commercial terms scattered through tender text:
 *   - bid bond / earnest money deposit (EMD)
 *   - performance guarantee
 *   - bid validity period
 *   - clarification / pre-bid question deadline
 *   - pre-bid meeting / site visit
 *   - contract duration
 *   - joint-venture / consortia rules
 *   - local-content requirement
 *
 * These are CRITICAL for go/no-go decisions and contract-risk assessment but
 * have historically been buried in tender prose. Surfacing them lets the
 * proposal narrative explicitly confirm compliance and lets the bid manager
 * size up commercial risk.
 */
function detectCommercialTerms(tenderText: string): CommercialTerms {
  const text = tenderText.replace(/\s+/g, " ");

  const bidBondMatch =
    text.match(/(?:bid bond|earnest money|EMD|bid security)[^.]*?(?:USD|ETB|EUR|GBP|\$|£|€|ETB|Birr|NGN|KES|ZAR)\s*[\d,.]+(?:\s*(?:million|m|thousand|k))?/i) ??
    text.match(/(?:bid bond|earnest money|EMD|bid security)[^.]*?(\d+(?:\.\d+)?\s*(?:%|percent))/i) ??
    text.match(/(?:bid bond|earnest money|EMD|bid security)[^.]{5,150}/i);

  const performanceGuaranteeMatch =
    text.match(/performance (?:guarantee|bond|security)[^.]*?(\d+(?:\.\d+)?\s*(?:%|percent))/i) ??
    text.match(/performance (?:guarantee|bond|security)[^.]*?(?:USD|ETB|EUR|GBP|\$|£|€)\s*[\d,.]+/i) ??
    text.match(/performance (?:guarantee|bond|security)[^.]{5,150}/i);

  const validityMatch =
    text.match(/(?:bid|proposal|offer)\s+(?:shall\s+)?(?:remain\s+)?valid[^.]*?(\d{2,3})\s*(?:calendar\s+)?days/i) ??
    text.match(/validity\s+(?:period\s+)?(?:of\s+)?(\d{2,3})\s*(?:calendar\s+)?days/i);

  const clarificationMatch =
    text.match(/(?:clarification|question|pre[- ]bid\s+question)\s+(?:request|submission)?\s*(?:deadline|by|before|no later than)[^.]{5,200}/i) ??
    text.match(/(?:clarifications?|questions?)\s+(?:must|should|shall)\s+(?:be\s+)?(?:received|submitted)[^.]{5,200}/i);

  const preBidMatch =
    text.match(/(?:pre[- ]?bid\s+(?:meeting|conference)|site\s+visit|bidders?\s+conference)[^.]{5,250}/i);

  const contractDurationMatch =
    text.match(/(?:contract|assignment|consultancy)\s+(?:duration|period)\s*(?:of|is|shall be|:)\s*(\d{1,3}\s*(?:days|weeks|months|years))/i) ??
    text.match(/(?:duration|period)\s+(?:of\s+)?(\d{1,3}\s*(?:weeks|months|years))/i);

  const consortiaMatch =
    text.match(/(?:joint\s+venture|JV|consort(?:ium|ia))[^.]{5,300}/i) ??
    text.match(/(?:lead\s+firm|associate\s+firm|sub[- ]?consultant)[^.]{5,200}/i);

  const localContentMatch =
    text.match(/(?:local\s+content|domestic\s+content|local\s+(?:firm|consultant|engineer))[^.]{5,250}/i) ??
    text.match(/\b(\d{1,3})\s*%[^.]{0,40}(?:local|domestic|national|in[- ]country)/i);

  return {
    bidBond: bidBondMatch ? clean(bidBondMatch[0]).slice(0, 240) : null,
    performanceGuarantee: performanceGuaranteeMatch ? clean(performanceGuaranteeMatch[0]).slice(0, 240) : null,
    bidValidityDays: validityMatch ? Number(validityMatch[1]) : null,
    clarificationDeadline: clarificationMatch ? clean(clarificationMatch[0]).slice(0, 280) : null,
    preBidMeeting: preBidMatch ? clean(preBidMatch[0]).slice(0, 280) : null,
    contractDuration: contractDurationMatch ? clean(contractDurationMatch[0]).slice(0, 200) : null,
    consortiaRules: consortiaMatch ? clean(consortiaMatch[0]).slice(0, 320) : null,
    localContent: localContentMatch ? clean(localContentMatch[0]).slice(0, 240) : null,
  };
}

// ─── Public interface ─────────────────────────────────────────────────────────

import { cleanClientName, cleanTenderTitle } from "./proposal-labels";

export function buildProposalIntelligence(params: {
  tender: TenderLite;
  company: CompanyLite;
  requirements: TenderRequirementLite[];
  experts: ExpertLite[];
  projects: ProjectLite[];
}): ProposalIntelligence {
  const { tender, company, requirements, experts, projects } = params;

  // PR T FIX — Defensive: if tender.intakeSummary or tender.analysisSummary
  // contains content that looks like a previously generated proposal
  // (a feedback-loop bug now patched at the write side, but still
  // possible for tenders saved before PR T deploy), strip them out
  // before they pollute downstream matching/scoring.
  const looksLikeGeneratedProposal = (text: string | null | undefined): boolean => {
    if (!text || text.length < 200) return false;
    // Heuristics for generated-proposal artefacts:
    // - explicit Section A/B/C/D/E headings in close proximity
    // - Cover Letter heading
    // - Executive Summary heading
    // - "We submit this Technical Proposal"
    const t = text.slice(0, 4_000);
    if (/^#\s+(Cover Letter|Executive Summary|Section [A-H])/im.test(t)) return true;
    if (/##\s+A\.\d.*##\s+B\.\d/s.test(t)) return true;
    if (/We submit this Technical Proposal|We hereby declare|RACI Matrix|Win Themes/i.test(t)) return true;
    return false;
  };
  const cleanIntake = looksLikeGeneratedProposal(tender.intakeSummary) ? null : tender.intakeSummary;
  const cleanAnalysis = looksLikeGeneratedProposal(tender.analysisSummary) ? null : tender.analysisSummary;
  if (cleanIntake !== tender.intakeSummary || cleanAnalysis !== tender.analysisSummary) {
    console.warn("[proposal-intelligence] Stripped stale proposal-text from intakeSummary/analysisSummary (feedback-loop guard).");
  }

  const tenderText = textOf(
    tender.title, tender.reference, tender.clientName, tender.country,
    tender.description, cleanIntake, cleanAnalysis,
    tender.evaluationMethodology, tender.submissionAddress, tender.submissionMethod,
    ...requirements.map((r) => `${r.title} ${r.description} ${r.requirementType} ${r.priority}`),
  );

  const themes = detectThemes(tenderText);

  // PR Q FIX — Hard sector filter. When the tender text yields a
  // distinctive sector (healthcare / water / road / urban / education
  // / environmental / ICT), projects whose own sector or summary
  // shows ZERO relevance to that sector are filtered out before
  // ranking. Without this, a healthcare tender surfaces residential /
  // warehouse projects when the lexical scoring degrades to "biggest
  // contract value wins". The benchmark gap analysis showed exactly
  // this on the Pharo tender — Warehouse & Landscaping was anchoring
  // the cover letter for a hospital bid.
  //
  // Multi-sector fix: tenders can trigger multiple sectors simultaneously
  // (e.g., "hospital water supply" = Healthcare + Water). We now detect
  // ALL matching sectors and include a project when it matches ANY of
  // them. Previously inferSector() returned only the first matching
  // sector, silently excluding multi-sector-relevant projects.
  const SECTOR_PATTERNS: Array<{ label: RegExp; keywords: RegExp }> = [
    { label: /Healthcare/, keywords: /health|hospital|medical|clinic|patient|specialty.*cent|pharma|biomedical|MoH|emergency|outpatient|in-?patient|imaging|laboratory/i },
    { label: /Water/, keywords: /water|borehole|pump|hydraulic|irrigation|WASH|sanitation|wastewater|sewer|drainage|hydrogeo/i },
    { label: /Road|Bridge|Transport/, keywords: /road|bridge|highway|pavement|transport|drainage|culvert|alignment|corridor/i },
    { label: /Urban|Master Plan/, keywords: /urban|master plan|municipal|spatial.*plan|land.?use|zoning|GIS|eco.?park|city/i },
    { label: /Education/, keywords: /school|university|campus|education|classroom|library|lab/i },
    { label: /Environmental|Social.*Impact/, keywords: /ESIA|ESMP|environmental|social.*safeguard|resettlement|biodiversity|impact.*assess/i },
    { label: /ICT|Digital/, keywords: /ICT|software|digital|MIS|ERP|database|web|app|cloud|server|network/i },
    { label: /Geotechnical|Structural/, keywords: /geotechnical|soil|foundation|seismic|borehole|drilling|structural/i },
    { label: /Hospitality|Tourism/, keywords: /hotel|hospitality|resort|tourism|lodge/i },
    { label: /Industrial|Manufacturing/, keywords: /factory|industrial|manufacturing|plant|warehouse/i },
    { label: /Renovation|Adaptation/, keywords: /renovation|modification|retrofit|existing|adaptation|interior/i },
    { label: /Building Design/, keywords: /architecture|building|design|construction|residential|commercial|interior/i },
  ];
  const detectedSector = inferSector(tenderText);
  // Multi-sector fix: collect ALL sector keyword sets triggered by the tender
  // text. A hospital-water project, for example, triggers both the Healthcare
  // and Water keyword sets. When the tender also mentions water supply (e.g.,
  // "hospital with borehole water system"), a water-supply project correctly
  // passes the filter because it matches the Water set — even though the
  // PRIMARY sector is Healthcare. Previously inferSector() returned only one
  // sector, silently excluding cross-sector relevant projects.
  const activeTenderKeywords = SECTOR_PATTERNS.filter(({ keywords }) => keywords.test(tenderText)).map(({ keywords }) => keywords);

  const sectorFilter = (text: string): boolean => {
    if (detectedSector === "General Consultancy / Engineering") return true; // no filter
    // Multi-sector: pass if the item matches ANY sector keyword set active in the tender
    if (activeTenderKeywords.length > 0) return activeTenderKeywords.some((kw) => kw.test(text));
    return true;
  };

  const projectIsRelevant = (p: ProjectLite): boolean => {
    const t = textOf(p.name, p.summary, p.sector, p.clientName, ...safeParseArr(p.serviceAreas));
    return sectorFilter(t);
  };
  const expertIsRelevant = (e: ExpertLite): boolean => {
    const t = textOf(e.fullName, e.title, e.profile, ...safeParseArr(e.disciplines), ...safeParseArr(e.sectors), ...safeParseArr(e.certifications));
    return sectorFilter(t);
  };

  // Hard-conflict predicate: items from a clearly DIFFERENT sector group
  // are excluded from the backfill pool entirely. Unlike the binary
  // sectorFilter above (which only tests for presence of positive
  // keywords), this predicate tests for the PRESENCE of conflicting
  // keywords — so a "General Infrastructure" project (no conflict keywords)
  // still qualifies for backfill, but a "Warehouse & Logistics" project
  // never backs up a healthcare tender.
  const SECTOR_HARD_CONFLICTS: Array<{ tender: RegExp; exclude: RegExp }> = [
    { tender: /Healthcare/, exclude: /warehouse|logistics|cargo|freight|storage|supply.?chain|distribution.?cent|industrial|manufacturing|factory/i },
    { tender: /Water/, exclude: /warehouse|logistics|cargo|freight|storage|industrial|manufacturing|factory/i },
    { tender: /Road|Bridge|Transport/, exclude: /warehouse|logistics|cargo|freight|storage|industrial|manufacturing|factory/i },
    { tender: /Education/, exclude: /warehouse|logistics|cargo|freight|storage|industrial|manufacturing|factory/i },
    { tender: /ICT|Digital/, exclude: /warehouse|logistics|cargo|freight|storage|industrial|manufacturing|factory/i },
  ];
  const isHardConflict = (text: string): boolean => {
    if (detectedSector === "General Consultancy / Engineering") return false;
    return SECTOR_HARD_CONFLICTS.some(
      ({ tender: t, exclude: e }) => t.test(detectedSector) && e.test(text),
    );
  };

  const projectsRelevant = projects.filter(projectIsRelevant);
  const expertsRelevant = experts.filter(expertIsRelevant);
  const PROJECT_MIN_POOL = 5;
  const EXPERT_MIN_POOL = 8;

  const projectsRelevantSorted = [...projectsRelevant]
    .sort((a, b) => projectScore(b, themes, tenderText) - projectScore(a, themes, tenderText));
  const expertsRelevantSorted = [...expertsRelevant]
    .sort((a, b) => expertScore(b, themes, tenderText) - expertScore(a, themes, tenderText));

  // Top-up from non-relevant list only when relevant pool is too small.
  // Hard-conflict items (e.g. warehouse projects for a healthcare tender)
  // are excluded even from backfill — a thinner pool is better than one
  // polluted with off-sector anchors.
  const projectsBackfill = [...projects.filter((p) => !projectsRelevant.includes(p))]
    .filter((p) => {
      const t = textOf(p.name, p.summary, p.sector, p.clientName, ...safeParseArr(p.serviceAreas));
      return !isHardConflict(t);
    })
    .sort((a, b) => projectScore(b, themes, tenderText) - projectScore(a, themes, tenderText))
    .slice(0, Math.max(0, PROJECT_MIN_POOL - projectsRelevantSorted.length));
  const expertsBackfill = [...experts.filter((e) => !expertsRelevant.includes(e))]
    .filter((e) => {
      const t = textOf(e.fullName, e.title, e.profile, ...safeParseArr(e.disciplines), ...safeParseArr(e.sectors), ...safeParseArr(e.certifications));
      return !isHardConflict(t);
    })
    .sort((a, b) => expertScore(b, themes, tenderText) - expertScore(a, themes, tenderText))
    .slice(0, Math.max(0, EXPERT_MIN_POOL - expertsRelevantSorted.length));

  const projectPool = [...projectsRelevantSorted, ...projectsBackfill];
  const expertPool = [...expertsRelevantSorted, ...expertsBackfill];

  const topProjects = projectPool.slice(0, 10);
  const topExperts = expertPool.slice(0, 14);

  if (detectedSector !== "General Consultancy / Engineering") {
    console.info(`[proposal-intelligence] Sector filter (${detectedSector}): kept ${projectPool.length}/${projects.length} projects, ${expertPool.length}/${experts.length} experts.`);
  }

  const exactEmails = detectExactEmails(tenderText);
  const exactSubjectLine = detectExactSubjectLine(tenderText);
  const noFinancialProposal = /financial proposal.*not|technical proposal only|no financial proposal|financial.*not.*required/i.test(tenderText);

  // Sanitize the tender title and client name. When the intake stage extracts
  // garbage from the tender PDF (multi-line body text containing markers
  // like "Headquarters:", "Photos or drawings", "Relationship:"), these
  // values propagate to every section of the generated proposal — Cover
  // Letter, Cover Page, Executive Summary, Why Us, Value Framework, support
  // doc boilerplate. cleanTenderTitle / cleanClientName already detect and
  // reject the garbage patterns; we just need to apply them here.
  // PR Q FIX — removed hardcoded "if mentions pharo → Pharo Ventures"
  // fallback. That string match fired on ANY tender whose text or
  // requirements (or stale prior-tender intelligence) mentioned the
  // word "pharo" — including projects in the company vault. Result:
  // Path tenders generated proposals addressed to Pharo Ventures.
  // Now: trust the cleanClientName output. When the client cannot be
  // determined, use a neutral placeholder the bid team must fill in.
  const detectedClient = cleanClientName(tender.clientName, tender.description);
  const finalClientName = detectedClient !== "Client"
    ? detectedClient
    : "The Client";
  const finalAssignmentName = cleanTenderTitle(tender.title, {
    clientName: finalClientName,
    description: tender.description,
  });

  return {
    tenderText,
    clientName: finalClientName,
    assignmentName: finalAssignmentName,
    primarySector: inferSector(tenderText),
    requiredSections: detectRequiredSections(tenderText),
    evaluationCriteria: detectEvaluationCriteria(tenderText),
    evaluationWeights: detectEvaluationWeights(tenderText),
    commercialTerms: detectCommercialTerms(tenderText),
    submissionRules: detectSubmissionRules(tender, tenderText),
    differentiators: makeDifferentiators(company, topProjects, topExperts, themes, tenderText),
    themes,
    topProjects,
    topExperts,
    gapsToAddressInNarrative: detectGaps(themes, topProjects, topExperts, tenderText),
    appendixList: detectAppendixList(tenderText),
    noFinancialProposal,
    exactEmails,
    exactSubjectLine,
  };
}

export function projectProofLine(project: ProjectLite): string {
  const value = money(project.contractValue, project.currency);
  const parts = [project.clientName, project.country, project.sector, value].filter(Boolean);
  const summary = clean(project.summary).slice(0, 600);
  return `${project.name}${parts.length ? ` — ${parts.join(" | ")}` : ""}${summary ? `. ${summary}` : ""}`;
}

export function expertProofLine(expert: ExpertLite): string {
  const disciplines = safeParseArr(expert.disciplines).slice(0, 6).join(", ");
  const certs = safeParseArr(expert.certifications).slice(0, 6).join(", ");
  const sectors = safeParseArr(expert.sectors).slice(0, 4).join(", ");
  const profile = clean(expert.profile).slice(0, 600);
  return [
    `${expert.fullName}${expert.title ? ` — ${expert.title}` : ""}`,
    expert.yearsExperience ? `${expert.yearsExperience}+ years experience` : null,
    disciplines ? `Disciplines: ${disciplines}` : null,
    sectors ? `Sectors: ${sectors}` : null,
    certs ? `Certifications/Licences: ${certs}` : null,
    profile || null,
  ].filter(Boolean).join(" | ");
}

/**
 * Build a per-criterion evidence map — for each evaluation criterion (with its
 * numeric weight), find the best-matching projects and experts from the firm's
 * vault and return a structured block for injection into the Section C prompt.
 *
 * This tells the AI exactly which evidence to use for each weighted criterion
 * instead of leaving it to guess from a flat list. The AI can then allocate
 * prose depth proportionally: a 35%-weight methodology criterion gets 3×
 * the depth of a 10%-weight compliance criterion.
 */
function parseWeightNumber(weight: string): number {
  const m = weight.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

export function buildCriterionEvidenceMap(
  weights: EvaluationWeight[],
  topProjects: ProjectLite[],
  topExperts: ExpertLite[],
): string {
  if (weights.length === 0) return "";

  // Calculate prose allocation from numeric weights.
  // Total is the sum of all parsed weights — used to derive
  // proportional word-count targets assuming ~3000 total words
  // of evidence-linked prose across all criteria.
  const TOTAL_WORDS = 3000;
  const parsedWeights = weights.map((w) => parseWeightNumber(w.weight));
  const weightSum = parsedWeights.reduce((s, v) => s + v, 0);

  const lines: string[] = [
    "EVALUATION CRITERION → EVIDENCE & PROSE ALLOCATION MAP",
    "RULE: Allocate prose depth PROPORTIONALLY to each weight. PRIMARY evidence must appear in the section with the stated word-count target. Never spread evidence evenly — the highest-weight criterion MUST have the most words.",
    "",
  ];

  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    const parsedW = parsedWeights[i];
    const targetWords = weightSum > 0 && parsedW > 0
      ? Math.round((parsedW / weightSum) * TOTAL_WORDS / 100) * 100
      : 0;
    const wordTarget = targetWords > 0 ? `→ WRITE ~${targetWords} WORDS` : "";

    const criterionLower = w.criterion.toLowerCase();
    const keywords = criterionLower
      .split(/\s+/)
      .filter((k) => k.length > 3 && !/^(the|and|for|with|that|this|from|into|have|been|will|shall|must|only|also|when|where|which|their|each|both)$/.test(k));

    if (keywords.length === 0) continue;

    const scoredProjects = topProjects
      .map((p) => {
        const t = textOf(p.name, p.summary, p.sector, p.clientName, ...safeParseArr(p.serviceAreas)).toLowerCase();
        const hits = keywords.filter((k) => t.includes(k)).length;
        return { project: p, hits };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits || (b.project.contractValue ?? 0) - (a.project.contractValue ?? 0))
      .slice(0, 3);

    const scoredExperts = topExperts
      .map((e) => {
        const t = textOf(e.fullName, e.title, e.profile, ...safeParseArr(e.disciplines), ...safeParseArr(e.sectors)).toLowerCase();
        const hits = keywords.filter((k) => t.includes(k)).length;
        return { expert: e, hits };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3);

    if (scoredProjects.length === 0 && scoredExperts.length === 0) continue;

    lines.push(`━━━ [${w.weight}] ${w.criterion} ${wordTarget} ━━━`);

    if (scoredProjects.length > 0) {
      lines.push("  CITE THESE PROJECTS (most comparable first):");
      for (let pi = 0; pi < scoredProjects.length; pi++) {
        const { project } = scoredProjects[pi];
        const val = project.contractValue
          ? ` | ${project.currency ?? "ETB"} ${(project.contractValue / 1_000_000).toFixed(1)}M`
          : "";
        const services = safeParseArr(project.serviceAreas).slice(0, 3).join(", ");
        const rank = pi === 0 ? "PRIMARY" : "SUPPORTING";
        lines.push(`    [${rank}] ${project.name}${project.clientName ? ` — ${project.clientName}` : ""}${project.country ? `, ${project.country}` : ""}${val}${services ? ` | ${services}` : ""}`);
      }
    }

    if (scoredExperts.length > 0) {
      lines.push("  ASSIGN THESE EXPERTS (highest relevance first):");
      for (let ei = 0; ei < scoredExperts.length; ei++) {
        const { expert } = scoredExperts[ei];
        const yrs = expert.yearsExperience ? ` | ${expert.yearsExperience}yr exp` : "";
        const certs = safeParseArr(expert.certifications).slice(0, 2).join(", ");
        const rank = ei === 0 ? "LEAD" : "SUPPORT";
        lines.push(`    [${rank}] ${expert.fullName}${expert.title ? ` — ${expert.title}` : ""}${yrs}${certs ? ` | ${certs}` : ""}`);
      }
    }

    lines.push("");
  }

  return lines.length > 3 ? lines.join("\n") : "";
}
