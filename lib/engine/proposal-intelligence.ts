export type TenderRequirementLite = { title: string; description: string; priority: string; requirementType: string };
export type TenderLite = { title: string; reference?: string | null; clientName?: string | null; country?: string | null; description?: string | null; intakeSummary?: string | null; analysisSummary?: string | null; evaluationMethodology?: string | null; deadline?: Date | string | null; submissionMethod?: string | null; submissionAddress?: string | null };
export type CompanyLite = { name: string; legalName?: string | null; description?: string | null; profileSummary?: string | null; serviceLines: string; sectors: string; email?: string | null; phone?: string | null; website?: string | null; address?: string | null };
export type ExpertLite = { fullName: string; title?: string | null; yearsExperience?: number | null; disciplines: string; sectors: string; certifications: string; profile?: string | null };
export type ProjectLite = { name: string; clientName?: string | null; country?: string | null; sector?: string | null; serviceAreas: string; contractValue?: number | null; currency?: string | null; summary?: string | null };
export type ProposalTheme = { code: string; label: string; triggers: RegExp[]; proofTerms: RegExp[]; methodologyBullets: string[] };
export type ProposalIntelligence = {
  tenderText: string;
  clientName: string;
  assignmentName: string;
  primarySector: string;
  requiredSections: string[];
  evaluationCriteria: string[];
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
  // Contract value bonus (bigger projects = stronger institutional evidence)
  if (project.contractValue) score += Math.min(6, Math.log10(project.contractValue));
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
  return scored.length ? scored.map((s) => s.theme) : [PROPOSAL_THEMES[6]]; // default: donor compliance
}

function inferSector(tenderText: string): string {
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
  const matches = tenderText.matchAll(/[Aa]ppendi[cx]\s+([A-F])\s*[:\-–]\s*([^\n]{5,120})/g);
  for (const m of matches) {
    appendices.push(`Appendix ${m[1].toUpperCase()}: ${m[2].trim()}`);
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

  // Healthcare positioning
  if (themes.some((t) => t.code === "HEALTHCARE")) {
    if (/hospital|health.*facilit|medical.*cent/i.test(allProjectText)) {
      items.push("LEAD WITH DIRECT HOSPITAL EXPERIENCE: name the specific hospitals designed/renovated, their contract values (ETB), and the client. Position it as 'we have already done this exact project — here is the evidence.'");
    }
    items.push("Show clinical depth — not just architecture. Proposal must address IPC compliance, clinical zone segregation, radiation shielding, medical gas, and Ethiopian Health Authority licensing explicitly.");
    items.push("Map each proposed expert to their ROLE on a previous hospital project (not just qualifications). Create a Team-to-Project mapping table.");
  }

  // Facility assessment
  if (themes.some((t) => t.code === "FACILITY_ASSESSMENT")) {
    items.push("Describe the structured assessment methodology for shortlisted properties: structural adequacy, spatial feasibility, utilities, accessibility, expansion. Position in-house geotechnical capability as a due-diligence advantage.");
  }

  // Donor compliance
  if (/World Bank|ESF|UNDP|British Council/i.test(companyText + allProjectText)) {
    items.push("Donor compliance track record (World Bank ESF, British Council) should be positioned as a risk-reduction advantage — it means documentation already exceeds what the client's regulator requires.");
  }

  // In-house geotechnical
  if (/geotechnical|drilling rig|soil.*machine|laboratory/i.test(companyText)) {
    items.push("In-house geotechnical capability (drilling rigs, soil lab) eliminates sub-contractor delays at the site-assessment stage. Frame as schedule protection.");
  }

  // MEP in-house
  if (/MEP|electrical.*engineer|sanitary.*engineer|mechanical/i.test(allExpertText)) {
    items.push("Multidisciplinary in-house MEP team (electrical, sanitary, mechanical) — positions the firm as a single-source solution. Reduces coordination risk and response time.");
  }

  // Large project scale
  const bigProjects = projects.filter((p) => (p.contractValue ?? 0) >= 100_000_000);
  if (bigProjects.length > 0) {
    const biggest = bigProjects.sort((a, b) => (b.contractValue ?? 0) - (a.contractValue ?? 0))[0];
    const val = money(biggest.contractValue, biggest.currency);
    items.push(`High-value project track record (${val ?? "large scale"} — ${biggest.name}): demonstrates institutional capacity and financial accountability at the scale this tender requires.`);
  }

  // PhD / senior credentials
  if (/PhD|doctorate|Eindhoven|Oxford|imperial/i.test(allExpertText)) {
    items.push("Team includes PhD-qualified specialists — position as evidence of deep technical capability, not just practical experience.");
  }

  // Pharo-specific
  if (/pharo/i.test(tenderText)) {
    items.push("Pharo Ventures is a private-sector investor — proposal tone should emphasise schedule certainty, documentation quality, and institutional discipline, not just technical competence.");
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

// ─── Public interface ─────────────────────────────────────────────────────────

export function buildProposalIntelligence(params: {
  tender: TenderLite;
  company: CompanyLite;
  requirements: TenderRequirementLite[];
  experts: ExpertLite[];
  projects: ProjectLite[];
}): ProposalIntelligence {
  const { tender, company, requirements, experts, projects } = params;

  const tenderText = textOf(
    tender.title, tender.reference, tender.clientName, tender.country,
    tender.description, tender.intakeSummary, tender.analysisSummary,
    tender.evaluationMethodology, tender.submissionAddress, tender.submissionMethod,
    ...requirements.map((r) => `${r.title} ${r.description} ${r.requirementType} ${r.priority}`),
  );

  const themes = detectThemes(tenderText);
  const topProjects = [...projects]
    .sort((a, b) => projectScore(b, themes, tenderText) - projectScore(a, themes, tenderText))
    .slice(0, 10);
  const topExperts = [...experts]
    .sort((a, b) => expertScore(b, themes, tenderText) - expertScore(a, themes, tenderText))
    .slice(0, 14);

  const exactEmails = detectExactEmails(tenderText);
  const exactSubjectLine = detectExactSubjectLine(tenderText);
  const noFinancialProposal = /financial proposal.*not|technical proposal only|no financial proposal|financial.*not.*required/i.test(tenderText);

  return {
    tenderText,
    clientName: tender.clientName || (/pharo/i.test(tenderText) ? "Pharo Ventures" : "The Client"),
    assignmentName: tender.title,
    primarySector: inferSector(tenderText),
    requiredSections: detectRequiredSections(tenderText),
    evaluationCriteria: detectEvaluationCriteria(tenderText),
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
