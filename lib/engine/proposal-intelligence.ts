import { logger } from "../observability";
import { tidyTruncation, withoutSourceProvenance } from "./vault-prose";
import { detectFinancialProposalRequiredFromText, buildTenderDocumentTypeAdvisory, type TenderDocumentTypeAdvisory } from "../document-generation/generation-integration";
export type TenderRequirementLite = { title: string; description: string; priority: string; requirementType: string };
export type TenderLite = { title: string; reference?: string | null; clientName?: string | null; procuringEntityName?: string | null; country?: string | null; description?: string | null; intakeSummary?: string | null; analysisSummary?: string | null; evaluationMethodology?: string | null; deadline?: Date | string | null; submissionMethod?: string | null; submissionAddress?: string | null; clientContactName?: string | null };
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
  clientContactName: string | null;
  assignmentName: string;
  primarySector: string;
  requiredSections: string[];
  /**
   * Evaluator-facing criterion labels ONLY. These are rendered as client-visible
   * headings and table rows (Section C dynamic sub-sections, Section F mirror,
   * Section H self-score), so they must never carry writer instructions.
   */
  evaluationCriteria: string[];
  /**
   * The same criteria with their in-house writing guidance attached
   * ("<label> — lead with named hospitals, values, and client references").
   * For AI/writer context only — never render this in a document.
   */
  evaluationCriteriaWriterNotes: string[];
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
  /**
   * Tender-type-aware document advisory produced by the new
   * lib/document-generation/ modules. Provides the detected tender
   * type (EOI / RFQ / RFP / etc.), a suggested document title, and
   * advisory notes for the generation pipeline. Non-binding — callers
   * log and use it to tweak document title / cover-letter language.
   */
  documentTypeAdvisory: TenderDocumentTypeAdvisory;
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
    logger.warn("[safeParseArr] Non-JSON value split as CSV:", { detail: value.slice(0, 80) });
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
    // Word boundaries on ICU and OPD — 3-letter abbreviations.
    proofTerms: [/hospital/i, /health/i, /medical/i, /clinic/i, /radiology/i, /laboratory/i, /pharmacy/i, /patient/i, /clinical/i, /ward/i, /\bICU\b/i, /\bOPD\b/i],
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
    // Word boundaries on MEP / HVAC (3-4 char abbreviations).
    triggers: [/\bMEP\b/i, /biomedical/i, /bio-medical/i, /medical gas/i, /electrical.*load/i, /\bIT system/i, /telehealth/i, /\bHVAC\b/i, /electromechanical/i, /building services/i],
    proofTerms: [/\bMEP\b/i, /electrical/i, /sanitary/i, /mechanical/i, /medical gas/i, /\bHVAC\b/i, /power/i, /biomedical/i, /equipment/i],
    methodologyBullets: [
      "medical-grade electrical load schedule: equipment power demands, UPS sizing, generator capacity, and emergency power discrimination",
      "medical gas system: pipe sizing, outlet locations, alarm panels, and pressure testing protocol",
      "ICT infrastructure: nurse-call, PACS-ready data cabling, telehealth endpoints, BMS integration, and fire-alarm zoning",
    ],
  },
  {
    code: "WATER_INFRASTRUCTURE",
    label: "Water supply, hydraulics and infrastructure engineering",
    // Word boundary on WASH — bare /WASH/i matched "Washington".
    triggers: [/water supply/i, /pump/i, /borehole/i, /sanitary/i, /hydraulic/i, /irrigation/i, /pipeline/i, /water.*system/i, /\bWASH\b/i],
    proofTerms: [/water/i, /sanitary/i, /hydraulic/i, /borehole/i, /pump/i, /pipeline/i, /reservoir/i, /\bWASH\b/i],
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
    // Word boundary on GIS — bare /GIS/i matched "GISt" / "GIStt" etc.
    proofTerms: [/urban/i, /master plan/i, /landscape/i, /park/i, /zoning/i, /planning/i, /municipal/i, /\bGIS\b/i],
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
    // Word boundaries on bare abbreviations (\bICT\b, \bMIS\b, \bERP\b)
    // — otherwise "ICT" matches "ICT" inside "predICT", "verdICT",
    // "depICT", "distrICT", "conflICT"; "MIS" matches "mis" inside
    // "optimISation", "subMISsion", "comMISsion", "perMISsion"; "ERP"
    // matches "erp" inside "supERPower", "tERPene", "hypERPlanet".
    // Every tender mentioning "submission" or "optimisation" was being
    // misclassified as ICT before this fix.
    triggers: [/\bICT\b/i, /information.*system/i, /software.*develop/i, /digital.*platform/i, /database/i, /\bMIS\b/i, /\bERP\b/i, /network.*design/i, /cyber/i],
    proofTerms: [/\bICT\b/i, /software/i, /system/i, /database/i, /platform/i, /network/i, /data/i, /\bMIS\b/i, /\bERP\b/i, /deployment/i],
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
  {
    code: "ENERGY_POWER",
    label: "Energy, power generation and grid infrastructure",
    triggers: [/\benergy\b/i, /power.*plant/i, /\bsolar\b/i, /wind.*farm/i, /grid.*connect/i, /generation/i, /transmission.*line/i, /substation/i, /\bhydropower\b/i, /\belectrification\b/i, /renewable.*energy/i, /power.*system/i, /\bSCADA\b/i, /off.?grid/i],
    proofTerms: [/energy/i, /solar/i, /wind/i, /hydropower/i, /substation/i, /transmission/i, /grid/i, /generation/i, /SCADA/i, /electrification/i, /renewable/i, /load.*flow/i, /ETAP/i, /SKM/i],
    methodologyBullets: [
      "load forecast and demand analysis: load-growth scenario modelling using minimum 5-year consumption data set, P50/P90 yield estimates (solar/wind), and grid-code compliance review",
      "engineering design: single-line diagram, load-flow and short-circuit analysis (SKM/ETAP), protection relay coordination study, SCADA architecture, civil/structural integration, and environmental management plan",
      "procurement and commissioning: vendor data requirements matrix, factory acceptance test (FAT) + site acceptance test (SAT) protocols, energisation plan, protection-relay testing, SCADA commissioning, and O&M manual with operator training",
    ],
  },
  {
    code: "AGRICULTURE_IRRIGATION",
    label: "Agriculture, irrigation scheme design and rural development",
    triggers: [/\birrigation\b/i, /agronomic/i, /crop.*water/i, /water.*user.*assoc/i, /\bWUA\b/i, /command.*area/i, /farm.*scheme/i, /agri.*develop/i, /\bagricultural\b/i, /rural.*develop/i, /livestock/i, /food.*security/i],
    proofTerms: [/irrigation/i, /canal/i, /agronomy/i, /crop/i, /WUA/i, /command.*area/i, /FAO/i, /Penman/i, /hydrological/i, /scheme/i, /agricultural/i, /rural/i],
    methodologyBullets: [
      "hydrological and agronomic baseline: minimum 20-year flow record analysis, FAO Penman-Monteith crop water requirement calculation, soil classification (USDA/FAO), and WUA readiness assessment",
      "irrigation scheme design: canal or pressurised pipe network design, structure drawings, drainage management plan, water-use efficiency targets, and agronomy recommendations with post-harvest value chain analysis",
      "construction, commissioning, and institutional support: construction supervision, WUA governance structure, farmer training programme, O&M manual, and project close-out with lessons-learned memo",
    ],
  },
  {
    code: "MINING_EXTRACTIVE",
    label: "Mining, mineral resource assessment and extractive industries",
    triggers: [/mining/i, /mineral.*resource/i, /\bJORC\b/i, /tailings/i, /ore.*body/i, /pit.*design/i, /slope.*stability/i, /mine.*plan/i, /quarry.*design/i, /blast.*design/i, /geotechnical.*mine/i, /mine.*feasibility/i],
    proofTerms: [/mining/i, /JORC/i, /tailings/i, /ore/i, /mineral/i, /pit/i, /geotechnical/i, /resource.*estimate/i, /slope/i, /TSF/i, /ANCOLD/i, /MAC/i, /closure/i],
    methodologyBullets: [
      "resource assessment and regulatory setup: geological mapping, block-model resource estimation with independent competent-person review (JORC compliant), geotechnical investigation, environmental baseline, and community engagement plan",
      "mine plan and infrastructure design: pit design or underground plan, production schedule, tailings storage facility (TSF) per MAC/ANCOLD guidelines, slope-stability analysis (three methods), and environmental and social management plan",
      "feasibility, permitting, and handover: JORC-compliant resource report, mine-plan drawings, regulatory submission package, financial provision estimate for closure, and monitoring and instrumentation programme",
    ],
  },
  {
    code: "PORT_MARITIME",
    label: "Port design, maritime infrastructure and logistics terminals",
    triggers: [/\bport\b/i, /maritime/i, /berth.*design/i, /quay.*design/i, /harbour.*develop/i, /dredging/i, /container.*terminal/i, /\bISPS\b/i, /\bnautical\b/i, /shipping.*terminal/i, /met.?ocean/i],
    proofTerms: [/port/i, /berth/i, /quay/i, /dredging/i, /maritime/i, /ISPS/i, /nautical/i, /harbour/i, /fender/i, /bollard/i, /bathymetric/i, /vessel/i],
    methodologyBullets: [
      "met-ocean and site characterisation: bathymetric and geotechnical survey, sediment characterisation, vessel-traffic survey, fast-time nautical simulation to validate berth layout and turning basin",
      "engineering design: berth structural design, dredge volume and disposal plan, shore-power and utilities layout, ISPS compliance documentation, and environmental and social management plan",
      "procurement, commissioning, and handover: BOQ and equipment specifications (fenders, bollards, crane rails), pre-opening nautical-safety review, ISPS certification process, and O&M manual with emergency procedures",
    ],
  },
  {
    code: "OIL_GAS",
    label: "Oil and gas, pipeline engineering and process facilities",
    triggers: [/\bHAZOP\b/i, /\bP&ID\b/i, /pipeline.*design/i, /upstream.*petroleum/i, /oil.*facilit/i, /gas.*facilit/i, /refinery/i, /petrochemical/i, /wellhead/i, /\bLNG\b/i, /\bFEED\b/i, /process.*safety/i, /pipeline.*integrity/i],
    proofTerms: [/HAZOP/i, /P&ID/i, /pipeline/i, /oil/i, /gas/i, /refinery/i, /API/i, /ASME/i, /LOPA/i, /cathodic/i, /ILI/i, /wellhead/i, /petrochemical/i, /FEED/i],
    methodologyBullets: [
      "design basis and HAZOP: process flow diagram, P&ID development, HAZOP study (all action items tracked to close-out), LOPA for high-severity nodes, and applicable code selection (API, ASME, ISO)",
      "detailed engineering: pipeline stress analysis (Caesar II or equivalent), equipment layout, structural and civil design, cathodic-protection design, and environmental and social management plan",
      "commissioning and integrity: pre-commissioning and commissioning procedures, safety system testing (PSV, ESD), handover with as-built documentation, in-line inspection (ILI) programme specification, and pipeline integrity management plan",
    ],
  },
  {
    code: "FINANCIAL_SERVICES",
    label: "Financial services regulation, core banking and fintech systems",
    triggers: [/\bKYC\b/i, /\bAML\b/i, /core.*banking/i, /microfinance.*(?:system|platform)/i, /credit.*risk.*model/i, /\bIFRS\b/i, /\bBasel\b/i, /prudential.*regul/i, /capital.*adequacy/i, /\bfintech\b/i, /payment.*system/i],
    proofTerms: [/KYC/i, /AML/i, /Basel/i, /IFRS/i, /core.*banking/i, /microfinance/i, /credit.*risk/i, /prudential/i, /capital.*adequacy/i, /regulatory.*compliance/i, /fintech/i],
    methodologyBullets: [
      "regulatory gap analysis and design: business process mapping, regulatory-gap analysis reviewed by licensed local legal counsel, target operating model design, and data-quality assessment",
      "system implementation: architecture design, integration plan (APIs, data migration), UAT protocol, parallel-run cutover with data reconciliation signed off before go-live, RBAC/encryption/audit-log configuration",
      "post-implementation: hypercare and SLA monitoring, staff training with train-the-trainer model, and handover with source code, data, and documentation under exit-clause provisions",
    ],
  },
  {
    code: "TELECOMS_BROADBAND",
    label: "Telecommunications, broadband networks and spectrum planning",
    triggers: [/spectrum.*licen/i, /spectrum.*plan/i, /broadband.*infrastruc/i, /base.*station/i, /\bLTE\b/i, /\b5G\b/i, /mobile.*network/i, /broadband.*rollout/i, /backhaul.*network/i, /\bISP\b.*develop/i, /last.?mile/i, /telecoms.*develop/i],
    proofTerms: [/spectrum/i, /broadband/i, /base.*station/i, /LTE/i, /5G/i, /backhaul/i, /fibre/i, /fiber/i, /antenna/i, /telecom/i, /network.*rollout/i, /coverage/i],
    methodologyBullets: [
      "demand and coverage analysis: traffic demand modelling, coverage simulation, spectrum allocation review, and regulatory licensing pathway confirmation",
      "network design: base station siting (LTE/5G), backhaul design (fibre/microwave), last-mile access technology selection, network architecture, and security controls",
      "rollout and commissioning: site acquisition support, equipment procurement specifications, installation supervision, drive-test and acceptance protocol, SLA definition, and O&M handover with operator training",
    ],
  },
  {
    code: "INTERIOR_DESIGN",
    label: "Interior design, fit-out and space planning",
    triggers: [/interior design/i, /fit[-\s]?out/i, /space planning/i, /joinery/i, /ceiling.*design/i, /flooring/i, /finishes/i, /furniture.*layout/i, /partition/i, /workplace design/i, /interior.*architect/i, /FF&E/i, /MEP.*interior/i],
    proofTerms: [/interior/i, /fit[- ]?out/i, /space planning/i, /finishes/i, /joinery/i, /partition/i, /ceiling/i, /flooring/i, /furniture/i, /FF&E/i, /lighting.*design/i, /\bCAD\b/i, /Revit/i, /SketchUp/i],
    methodologyBullets: [
      "space programming and functional brief: occupant count, activity zones, adjacency matrix, and area schedule before any design begins",
      "concept design with mood boards, material palette, and lighting concept — client approval before schematic development",
      "schematic design: space layout plans, reflected ceiling plans, partition and flooring schedules, joinery elevations",
      "detailed design and FF&E specification: full furniture, fixture, and equipment schedule with supplier options and lead times",
      "construction documentation: detailed drawings, specifications, BOQ, and room data sheets for contractor tender",
      "construction administration: shop drawing review, material sample approval, site inspections, and defects-liability management",
    ],
  },
  {
    code: "SUPERVISION_CONSULTANCY",
    label: "Construction supervision and resident engineer services",
    triggers: [/construction supervision/i, /resident engineer/i, /site supervision/i, /supervision.*contract/i, /site.*management/i, /quality.*contractor/i, /engineer.*supervision/i, /supervision.*consultancy/i, /oversight.*construction/i],
    proofTerms: [/supervision/i, /resident engineer/i, /site inspection/i, /quality control/i, /hold[- ]?point/i, /payment certificate/i, /variation/i, /progress report/i, /defects/i, /DLP/i, /commissioning/i, /punch list/i, /snag/i],
    methodologyBullets: [
      "pre-construction review: check contractor's programme, method statements, ITP, HSMP, and resource mobilisation plan before site start",
      "hold-point inspection regime: mandatory W (Witness) and H (Hold) points for critical activities — foundations, pre-pour, structural welds, pressure tests",
      "quality assurance: third-party lab testing, test certification review, non-conformance report (NCR) issuance and closeout tracking",
      "payment certification: monthly interim payment certificates (IPC) based on measured quantities and approved rates",
      "variation order management: evaluate contractor claims, issue Variation Order (VO) instructions, and maintain cost register",
      "defects-liability period (DLP) inspection: systematic snag list, contractor response tracking, and performance bond release recommendation",
    ],
  },
  {
    code: "CONTRACT_ADMINISTRATION",
    label: "Contract administration, cost control and claims management",
    triggers: [/contract administration/i, /contract.*admin/i, /FIDIC/i, /variation order/i, /payment certificate/i, /claims management/i, /cost control/i, /quantity survey/i, /procurement.*advisory/i, /bid.*management/i, /tender.*management/i],
    proofTerms: [/FIDIC/i, /variation/i, /claim/i, /payment certificate/i, /BOQ/i, /quantity/i, /cost.*report/i, /cash.*flow/i, /extension.*time/i, /EOT/i, /final.*account/i, /contract.*sum/i, /retention/i, /bond/i],
    methodologyBullets: [
      "contract document review at award: identify ambiguities, prepare contract administration manual, and issue Employer's notification of contract start",
      "cost-control reporting: monthly cost report against contract sum, forecast final cost, cash-flow projection, and contingency drawdown register",
      "variation order administration: evaluate contractor VO submissions, negotiate quantum, issue Engineer's Instructions, and update contract sum",
      "claim evaluation: time-impact analysis for extension-of-time (EOT) claims, disruption cost assessment, and formal determinations under the contract",
      "final account preparation: measurement reconciliation, agreed final BOQ, settlement of outstanding claims, and certificate of substantial completion",
      "contract closeout: release of retention, performance bond discharge recommendation, and lessons-learned report",
    ],
  },
  {
    code: "HERITAGE_CONSERVATION",
    label: "Heritage Conservation & Adaptive Reuse",
    triggers: [/heritage/i, /conservation/i, /museum/i, /historic building/i, /adaptive reuse/i, /restoration/i, /historic fabric/i],
    proofTerms: [/ICOMOS/i, /lime mortar/i, /conservation plan/i, /significance/i, /heritage authority/i, /photogrammetry/i, /reversible/i, /listed building/i],
    methodologyBullets: [
      "Condition survey & significance assessment using ICOMOS principles — structural, fabric, and services condition rated and mapped",
      "Conservation philosophy statement aligning proposed interventions with reversibility and minimum-intervention doctrine",
      "Material-compatibility testing (XRF / petrographic) before specification of repair mortars and consolidants",
      "Three-gate design review with heritage authority: conservation plan → tender documents → construction phase supervision",
      "Post-conservation documentation: photogrammetric 3D archive, updated condition report, maintenance manual, handover to cultural authority",
    ],
  },
  {
    code: "INDUSTRIAL_MANUFACTURING",
    label: "Industrial & Manufacturing Facilities",
    triggers: [/industrial/i, /manufactur/i, /factory/i, /abattoir/i, /processing plant/i, /production facilit/i, /warehouse.*industrial/i],
    proofTerms: [/process flow/i, /FAT/i, /effluent/i, /EHS/i, /OHSAS/i, /lean/i, /VSM/i, /commissioning/i, /cleaner production/i],
    methodologyBullets: [
      "Process brief and production-flow analysis (value-stream mapping) before layout design — lean principles embedded in material-flow corridors",
      "Integrated design package: industrial structural design, HVAC/exhaust ventilation, industrial flooring, fire suppression, effluent treatment",
      "Regulatory and environmental approvals: EIA/ESIA, effluent treatment design to Ethiopian EPA/WHO standards, occupational safety assessment",
      "Factory acceptance test (FAT) protocol for all production equipment; commissioning sequencing plan; operator training programme",
      "Digital 3D plant model for clash detection and installation sequencing; as-built drawings for O&M manual",
    ],
  },
  {
    code: "HIGH_RISE_BUILDINGS",
    label: "High-Rise & Multi-Storey Buildings",
    triggers: [/high.rise/i, /high_rise/i, /multi.stor/i, /tower.*building/i, /mixed.use.*tower/i, /G\+\d{2,}/i, /basement.*podium/i, /tall building/i],
    proofTerms: [/ETABS/i, /SAP2000/i, /shear wall/i, /seismic/i, /curtain wall/i, /post.tension/i, /BIM/i, /LOD 300/i, /pile foundation/i, /mat foundation/i],
    methodologyBullets: [
      "Structural system selection (shear wall / core-frame / hybrid) with ETABS/SAP2000 analysis incorporating Ethiopian seismic zone and wind loads per EBCS/ES EN 1998",
      "BIM-coordinated design at LOD 300+: architecture, structure, and MEP clash detection eliminates field RFIs for riser routing and structural penetrations",
      "Independent structural peer review before construction documents; structural calculation package formatted to AA City Authority checklist",
      "Specialist systems integration: aluminium curtain wall specification, lift/car-lift design, BMS, fire alarm and suppression, generator/UPS sizing",
      "Construction supervision with hold-point inspections at foundation, shear walls, and curtain wall installation; concrete cube tests and rebar pull-out at every pour",
    ],
  },
  {
    code: "HOSPITALITY_TOURISM",
    label: "Hospitality & Tourism Facilities",
    triggers: [/hotel/i, /hospitality/i, /resort/i, /lodge/i, /guesthouse/i, /five.star/i, /luxury.*accommodat/i, /tourism.*facilit/i],
    proofTerms: [/FF&E/i, /brand standard/i, /RevPAR/i, /guestroom/i, /back.of.house/i, /BOH/i, /mock.*room/i, /pre.opening/i, /GSTC/i, /Green Globe/i],
    methodologyBullets: [
      "Feasibility and development programme: room mix, F&B concept, BOH efficiency analysis, RevPAR market benchmarking, preliminary BOQ",
      "Brand-standard compliance matrix embedded from concept design; mock guestroom constructed and approved before full roll-out of room finishes",
      "Interior design and FF&E specification: finishes schedule, lighting design, furniture layouts, brand procurement schedule with lead-time tracking",
      "MEP specialist systems: VRF/fan-coil guestroom HVAC, kitchen ventilation, pool/spa mechanical, AV and guest-technology design, access control",
      "Pre-opening supervision: room-by-room snagging protocol, MEP commissioning tests, brand-operator punch list clearance, handover pack",
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
  // Word boundaries on WASH (4-char abbreviation; matches "Washington" /
  // "washable" / "wash-up" without \b). Same fix for ICT / MIS / ERP /
  // MEP / HVAC throughout this file — see PR root-cause-fix comment in
  // ICT_DIGITAL theme triggers above.
  if (/water|borehole|pump|hydraulic|\bWASH\b|irrigation/i.test(text) && /water|borehole|pump|hydraulic|\bWASH\b|irrigation/i.test(tenderText)) score += 12;
  if (/road|bridge|highway|pavement|transport.*infra/i.test(text) && /road|bridge|highway|pavement|transport.*infra/i.test(tenderText)) score += 12;
  if (/structural|foundation|geotechnical/i.test(text) && /structural|foundation|geotechnical/i.test(tenderText)) score += 8;
  if (/\bESIA\b|\bESMP\b|environmental.*impact|social.*safeguard/i.test(text) && /\bESIA\b|\bESMP\b|environmental.*impact|social.*safeguard/i.test(tenderText)) score += 12;
  if (/\bICT\b|software|information.*system|\bMIS\b|\bERP\b|digital.*platform/i.test(text) && /\bICT\b|software|information.*system|\bMIS\b|\bERP\b|digital/i.test(tenderText)) score += 12;
  if (/urban|master plan|municipal|spatial.*plan/i.test(text) && /urban|master plan|municipal|spatial.*plan/i.test(tenderText)) score += 10;
  if (/school|university|campus|education/i.test(text) && /school|university|campus|education/i.test(tenderText)) score += 10;
  if (/social.*develop|advisory|capacity.*build|community/i.test(text) && /social.*develop|advisory|capacity.*build|community/i.test(tenderText)) score += 8;
  if (/World Bank|UNDP|donor.*fund/i.test(text) && /World Bank|UNDP|donor.*fund/i.test(tenderText)) score += 6;
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|SCADA/i.test(text) && /energy|solar|hydropower|substation|transmission|generation|electrification|SCADA/i.test(tenderText)) score += 12;
  if (/irrigation.*scheme|agri|WUA|command.*area|crop.*water|rural.*develop.*agri/i.test(text) && /irrigation|agri|WUA|command.*area|rural.*develop/i.test(tenderText)) score += 12;
  if (/mining|mineral.*resource|JORC|tailings|ore|mine.*plan|pit.*design/i.test(text) && /mining|mineral.*resource|JORC|tailings|ore/i.test(tenderText)) score += 12;
  if (/port|berth|quay|dredging|maritime|ISPS|harbour/i.test(text) && /port|berth|quay|dredging|maritime|ISPS|harbour/i.test(tenderText)) score += 12;
  if (/HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|refinery|petrochemical/i.test(text) && /HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|refinery|petrochemical/i.test(tenderText)) score += 12;
  if (/KYC|AML|core.*banking|microfinance|IFRS|Basel|prudential.*regul|fintech/i.test(text) && /KYC|AML|core.*banking|microfinance|IFRS|Basel|prudential.*regul|fintech/i.test(tenderText)) score += 12;
  if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(text) && /spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(tenderText)) score += 12;
  if (/interior design|fit[- ]?out|space planning|finishes|joinery/i.test(text) && /interior design|fit[- ]?out|space planning|finishes|joinery/i.test(tenderText)) score += 10;
  if (/construction supervision|resident engineer|site supervision/i.test(text) && /supervision|resident engineer|site.*management/i.test(tenderText)) score += 10;
  if (/contract administration|FIDIC|variation order|payment certificate/i.test(text) && /contract administration|FIDIC|variation/i.test(tenderText)) score += 10;
  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(text) && /heritage|conservation|museum|historic|adaptive.*reuse/i.test(tenderText)) score += 15;
  if (/industrial|manufactur|factory|abattoir|processing.*plant/i.test(text) && /industrial|manufactur|factory|abattoir|processing.*plant/i.test(tenderText)) score += 15;
  if (/high.rise|multi.stor|tower.*building|basement.*podium/i.test(text) && /high.rise|multi.stor|tower.*building|basement.*podium/i.test(tenderText)) score += 15;
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star/i.test(text) && /hotel|hospitality|resort|lodge|guesthouse/i.test(tenderText)) score += 15;
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
  if (/\bMEP\b|electrical|mechanical|sanitary/i.test(text) && /\bMEP\b|electrical|medical gas|equipment|sanitary|building.*service/i.test(tenderText)) score += 8;
  if (/biomedical|bio-medical/i.test(text) && /biomedical|bio-medical|medical equipment/i.test(tenderText)) score += 12;
  if (/structural/i.test(text) && /structural|adequacy|seismic|building|bridge/i.test(tenderText)) score += 8;
  if (/project manager|team leader|principal|director|programme.*manager/i.test(text)) score += 4;
  if (/geotechnical|hydrogeol|drilling/i.test(text) && /geotechnical|drilling|borehole|soil|foundation/i.test(tenderText)) score += 10;
  if (/environmental|social|safeguard|\bESIA\b|\bESMP\b/i.test(text) && /environmental|\bESIA\b|\bESMP\b|\bESF\b|World Bank|safeguard/i.test(tenderText)) score += 10;
  if (/hydraulic|water.*engineer|civil.*engineer.*water|hydrologist/i.test(text) && /water supply|hydraulic|borehole|\bWASH\b|irrigation/i.test(tenderText)) score += 10;
  if (/road.*engineer|highway|transport.*engineer|pavement/i.test(text) && /road|bridge|highway|pavement|transport/i.test(tenderText)) score += 10;
  if (/\bICT\b|software|system.*analyst|database|network.*engineer|developer/i.test(text) && /\bICT\b|software|system|\bMIS\b|\bERP\b|digital/i.test(tenderText)) score += 10;
  if (/urban.*planner|town.*planner|spatial.*planner|GIS/i.test(text) && /urban|master plan|spatial.*plan|GIS/i.test(tenderText)) score += 8;
  if (/social.*specialist|community.*develop|livelihoods/i.test(text) && /social|community|stakeholder|livelihood/i.test(tenderText)) score += 8;
  if (/education.*specialist|school.*designer|campus.*architect/i.test(text) && /school|university|campus|education/i.test(tenderText)) score += 8;
  if (/power.*engineer|electrical.*engineer|energy.*engineer|renewable.*engineer|SCADA.*engineer|substation.*engineer/i.test(text) && /energy|solar|hydropower|substation|transmission|generation|electrification/i.test(tenderText)) score += 10;
  if (/irrigation.*engineer|agri.*specialist|agronomi|WUA.*specialist|rural.*develop.*specialist/i.test(text) && /irrigation|agri|WUA|command.*area|rural.*develop/i.test(tenderText)) score += 10;
  if (/mining.*engineer|geological.*engineer|geolog|mine.*design|resource.*geolog/i.test(text) && /mining|mineral.*resource|JORC|tailings|ore/i.test(tenderText)) score += 10;
  if (/port.*engineer|maritime.*engineer|coastal.*engineer|harbour.*engineer|marine.*engineer/i.test(text) && /port|berth|quay|dredging|maritime/i.test(tenderText)) score += 10;
  if (/process.*engineer|pipeline.*engineer|HAZOP.*facilitator|oil.*gas.*engineer|petroleum.*engineer/i.test(text) && /HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|refinery/i.test(tenderText)) score += 10;
  if (/compliance.*officer|risk.*analyst|financial.*specialist|banking.*specialist|fintech.*specialist/i.test(text) && /KYC|AML|core.*banking|microfinance|IFRS|Basel|prudential/i.test(tenderText)) score += 10;
  if (/telecom.*engineer|network.*engineer|RF.*engineer|spectrum.*specialist|broadband.*specialist/i.test(text) && /spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(tenderText)) score += 10;
  if (/interior designer|interior architect|space planner|fit[- ]?out.*lead/i.test(text) && /interior design|fit[- ]?out|space planning/i.test(tenderText)) score += 10;
  if (/resident engineer|supervising engineer|site engineer|quality inspector/i.test(text) && /supervision|resident engineer|site.*management/i.test(tenderText)) score += 10;
  if (/contract administrator|FIDIC.*engineer|claims.*manager|quantity surveyor/i.test(text) && /contract administration|FIDIC|variation|claim/i.test(tenderText)) score += 10;
  if (/heritage.*specialist|conservation.*specialist|historic.*buildings|restoration.*architect/i.test(text) && /heritage|conservation|museum|historic/i.test(tenderText)) score += 15;
  if (/industrial.*engineer|process.*engineer|factory.*engineer|manufacturing.*engineer/i.test(text) && /industrial|manufactur|factory|abattoir|processing/i.test(tenderText)) score += 15;
  if (/high.rise|structural.*tower|tall.*building|seismic.*design/i.test(text) && /high.rise|multi.stor|tower.*building/i.test(tenderText)) score += 15;
  if (/hotel.*design|hospitality.*design|interior.*hotel|resort.*architect/i.test(text) && /hotel|hospitality|resort|lodge/i.test(tenderText)) score += 15;
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

// The evaluation-criteria window is one long line: textOf/clean() collapse
// every newline in the tender before this runs. An unanchored `X.*experience`
// pattern therefore matches across completely unrelated sentences. Measured on
// a real hospital tender, `/compliance.*experience/i` matched the span
// "Compliance with submission requirements ... focus on healthcare project
// experience" and put a Financial Services / Basel-IFRS criterion into a
// hospital proposal; `/GIS/` matched the "gis" inside "registration" and added
// an urban master-planning criterion beside it.
//
// Splitting the window back into phrases and requiring each pattern to match
// inside ONE phrase restores the sentence boundary the collapse removed. It
// fixes every pattern in this catalogue at once, rather than rewriting forty
// literals and leaving the next one to be added with the same defect.
function evaluationPhrases(evalSection: string): string[] {
  return evalSection
    .split(/[.;:|\u2022\n]+|\s[-\u2013\u2014]\s/g)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}

/**
 * Split a catalogue entry into the evaluator-facing label and the in-house
 * writing guidance that follows it.
 *
 * Entries in this catalogue are authored as "<criterion> — <how to answer it>".
 * The guidance half is writing direction for the proposal author; a real
 * hospital proposal shipped with the heading "C.7 Financial services /
 * regulatory compliance experience — lead with named institutions, regulatory
 * standard met (Basel/IFRS), and go-live outcomes" and repeated that sentence
 * as its own body text, because the whole string was used as a heading. Keep
 * the two halves apart at the source so no consumer has to know the convention.
 */
export function splitEvaluationCriterion(entry: string): { label: string; guidance: string | null } {
  const separator = entry.indexOf(" \u2014 ");
  if (separator < 0) return { label: entry.trim(), guidance: null };
  return {
    label: entry.slice(0, separator).trim(),
    guidance: entry.slice(separator + 3).trim() || null,
  };
}

function detectEvaluationCriteria(tenderText: string): string[] {
  const criteria: string[] = [];
  const evalSection = tenderText.match(/evaluation criteria[\s\S]{0,2000}/i)?.[0] ?? tenderText;
  const phrases = evaluationPhrases(evalSection);
  const mentions = (pattern: RegExp): boolean => phrases.some((phrase) => pattern.test(phrase));

  // Healthcare
  if (mentions(/healthcare.*experience|similar.*hospital|medical.*facility.*experience/i)) criteria.push("Relevant healthcare / similar medical facility project experience — lead with named hospitals, values, and client references");
  if (mentions(/technical understanding|facility design|clinical|healthcare.*design/i)) criteria.push("Technical understanding of healthcare facility design — demonstrate clinical workflow, IPC, MEP integration knowledge");

  // Water/Infrastructure
  if (mentions(/water.*experience|water.*project|hydraulic|\bWASH\b|sanitation.*experience/i)) criteria.push("Relevant water supply / sanitation / hydraulic engineering project experience — lead with named schemes, capacities, and client references");
  if (mentions(/borehole|groundwater|hydrogeol/i)) criteria.push("Hydrogeological and borehole investigation expertise — show yield, depth, and field supervision evidence");

  // Road/Bridge
  if (mentions(/road.*experience|bridge.*experience|transport.*experience|pavement.*design/i)) criteria.push("Relevant road / bridge / transport infrastructure experience — lead with route length, contract value, and supervision outcomes");
  if (mentions(/traffic.*study|pavement.*design|highway.*design/i)) criteria.push("Technical depth in road design — demonstrate pavement design, drainage, and safety audit capability");

  // Environmental/Social
  if (mentions(/ESIA|environmental.*experience|social.*assessment|safeguard.*experience/i)) criteria.push("ESIA/ESMP experience — show accepted reports, donor compliance, and stakeholder engagement track record");
  if (mentions(/World Bank|UNDP|donor.*standard|safeguard.*framework/i)) criteria.push("Donor compliance track record (World Bank ESF, IFC PS, or equivalent) — position as risk reduction advantage");

  // ICT
  if (mentions(/\bICT\b.*experience|system.*develop|software.*experience|\bMIS\b|\bERP\b/i)) criteria.push("Relevant ICT / system development experience — show deployed systems, user counts, and client references");
  if (mentions(/data.*security|cyber|network.*design/i)) criteria.push("Technical depth in data security, network architecture, and system resilience");

  // Urban Planning
  if (mentions(/urban.*experience|master.*plan.*experience|planning.*experience|\bGIS\b/i)) criteria.push("Urban / master planning experience — show plans delivered, scale, and regulatory alignment outcomes");

  // Education
  if (mentions(/school.*design|university.*design|education.*facility.*experience/i)) criteria.push("Education facility design experience — show comparable school/campus projects with functional approval outcomes");

  // Energy / Power
  if (mentions(/energy.*experience|power.*experience|renewable.*experience|solar.*experience|grid.*experience|electrification.*experience/i)) criteria.push("Relevant energy / power infrastructure experience — lead with named schemes, installed capacity (MW), and grid-code compliance outcomes");
  if (mentions(/load.*forecast|generation.*design|protection.*relay|SCADA|grid.*integration/i)) criteria.push("Technical depth in power systems design — demonstrate load-flow analysis, protection coordination, and SCADA integration capability");

  // Agriculture / Irrigation
  if (mentions(/irrigation.*experience|agri.*experience|rural.*develop.*experience|WUA.*experience/i)) criteria.push("Irrigation / agricultural development experience — lead with named schemes, command area (ha), and WUA establishment outcomes");
  if (mentions(/crop.*water|agronomy|hydrological.*analysis|Penman/i)) criteria.push("Technical depth in irrigation design — demonstrate FAO Penman-Monteith crop water calculations and hydraulic network design capability");

  // Mining / Extractive
  if (mentions(/mining.*experience|mineral.*experience|JORC.*experience|resource.*assess.*experience/i)) criteria.push("Mining / mineral resource assessment experience — lead with JORC-compliant reports delivered and competent-person credentials");
  if (mentions(/slope.*stability|tailings|mine.*plan|geotechnical.*mining/i)) criteria.push("Technical depth in mine geotechnics and TSF design — demonstrate slope-stability analyses and MAC/ANCOLD-compliant designs");

  // Port / Maritime
  if (mentions(/port.*experience|maritime.*experience|harbour.*experience|berth.*design.*experience/i)) criteria.push("Port / maritime infrastructure experience — lead with named terminals, berth length, and ISPS certification outcomes");
  if (mentions(/dredging|nautical.*simulation|met.?ocean|bathymetric/i)) criteria.push("Technical depth in port engineering — demonstrate met-ocean analysis, fast-time simulation, and dredge design capability");

  // Oil & Gas
  if (mentions(/oil.*gas.*experience|pipeline.*experience|HAZOP.*experience|process.*safety.*experience/i)) criteria.push("Oil & gas / pipeline engineering experience — lead with named projects, pipeline diameter/length, and HAZOP study completions");
  if (mentions(/P&ID|LOPA|cathodic.*protection|pipeline.*integrity|commissioning.*procedure/i)) criteria.push("Technical depth in process safety and pipeline design — demonstrate HAZOP facilitation, P&ID development, and integrity management capability");

  // Financial Services
  if (mentions(/financial.*experience|banking.*experience|compliance.*experience|regulatory.*experience/i)) criteria.push("Financial services / regulatory compliance experience — lead with named institutions, regulatory standard met (Basel/IFRS), and go-live outcomes");
  if (mentions(/KYC|AML|core.*banking|IFRS|Basel.*compliance|prudential/i)) criteria.push("Technical depth in banking regulation — demonstrate KYC/AML programme design, IFRS implementation, and prudential regulatory advisory");

  // Telecoms / Broadband
  if (mentions(/telecom.*experience|broadband.*experience|spectrum.*experience|network.*rollout.*experience/i)) criteria.push("Telecoms / broadband network experience — lead with named projects, network reach (km), and spectrum licensing outcomes");
  if (mentions(/\bLTE\b|\b5G\b|base.*station.*design|backhaul.*design|broadband.*rollout/i)) criteria.push("Technical depth in mobile and broadband network design — demonstrate RF planning, backhaul design, and commissioning protocol capability");

  // Interior Design / Fit-Out / Construction Supervision / Contract Administration
  if (mentions(/interior.*experience|fit[- ]?out.*experience|space.*planning.*experience/i)) criteria.push("Interior design / fit-out experience — lead with named projects, area (m²), and client references");
  if (mentions(/supervision.*experience|resident engineer.*experience|site.*management.*experience/i)) criteria.push("Construction supervision experience — show named contracts supervised, contract value, and IPC/hold-point outcomes");
  if (mentions(/contract.*admin.*experience|FIDIC.*experience|claims.*experience|quantity.*survey.*experience/i)) criteria.push("Contract administration / FIDIC experience — show named contracts, final account settlements, and EOT determinations");

  // Heritage Conservation
  if (mentions(/heritage.*experience|conservation.*experience|historic.*building.*experience|restoration.*experience/i)) criteria.push("Heritage conservation / restoration experience — lead with named historic buildings conserved, heritage authority approvals obtained, and conservation methods applied");
  if (mentions(/ICOMOS|lime mortar|conservation.*plan|significance.*assessment|reversib/i)) criteria.push("Technical depth in heritage conservation — demonstrate ICOMOS-aligned methodology, material-compatibility testing, and conservation plan preparation");

  // Industrial & Manufacturing
  if (mentions(/industrial.*experience|manufactur.*experience|factory.*experience|abattoir.*experience|processing.*plant.*experience/i)) criteria.push("Industrial / manufacturing facility experience — lead with named facilities delivered, production capacity, and commissioning outcomes");
  if (mentions(/process.*flow|effluent.*treatment|\bEHS\b|\bFAT\b|cleaner.*production|lean.*design/i)) criteria.push("Technical depth in industrial design — demonstrate process-flow analysis, effluent treatment design, and FAT commissioning protocol capability");

  // High-Rise Buildings
  if (mentions(/high.rise.*experience|multi.stor.*experience|tower.*building.*experience|tall.*building.*experience/i)) criteria.push("High-rise / multi-storey building experience — lead with named towers designed, height/storeys, structural system, and authority approval outcomes");
  if (mentions(/ETABS|SAP2000|shear.*wall|seismic.*design|curtain.*wall|post.tension/i)) criteria.push("Technical depth in high-rise structural design — demonstrate ETABS/SAP2000 analysis, seismic compliance, and independent peer review protocol");

  // Hospitality & Tourism
  if (mentions(/hotel.*experience|hospitality.*experience|resort.*experience|lodge.*experience/i)) criteria.push("Hospitality / hotel design experience — lead with named hotels or resorts designed, star rating, room count, and brand operator sign-off outcomes");
  if (mentions(/FF&E|brand.*standard|RevPAR|guestroom.*HVAC|mock.*room|pre.opening/i)) criteria.push("Technical depth in hospitality design — demonstrate brand-standard compliance methodology, FF&E procurement schedule, and pre-opening punch list capability");

  // Universal criteria
  if (mentions(/portfolio|quality.*portfolio|relevance.*portfolio/i)) criteria.push("Quality and relevance of project portfolio — include photos, drawings, and project outcome evidence");
  if (mentions(/professional team|multidisciplinary|strength.*team|key.*personnel|team.*composition/i)) criteria.push("Strength of professional team — show each expert's role on a comparable previous project");
  if (mentions(/company.*profile|firm.*profile|organisational.*capacity/i)) criteria.push("Company profile and organisational capacity — licence grade, staff count, registrations, certifications");
  if (mentions(/submission.*requirement|compliance.*submission|format.*requirement/i)) criteria.push("Compliance with all submission requirements — section structure, file format, subject line, deadline");
  if (mentions(/value.*added|additional.*service|added.*value/i)) criteria.push("Value-added services and in-house capabilities beyond minimum scope");
  if (mentions(/methodology|technical.*approach|work.*plan/i)) criteria.push("Quality of technical methodology — demonstrate structured, deliverable-linked work plan with QA gates");

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
  const groundedDeadline = tenderText.match(/Submission\s+Deadline\s*:\s*([^\n]{5,100})/i)?.[1]?.trim();
  if (groundedDeadline) {
    const boundedDeadline = groundedDeadline
      .split(/\s+(?=(?:Submission\s+Email|Submission\s+Method|Email\s*\(|Subject|Submission\s+Address|Portal)\b)/i)[0]
      .trim();
    rules.push(`Submission deadline: ${boundedDeadline.replace(/\.$/, "")}.`);
  } else if (tender.deadline) {
    rules.push(`Submission deadline: ${new Date(tender.deadline).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}.`);
  } else {
    const deadlineMatch = tenderText.match(/[Dd]eadline\s*[:\-]\s*([^\n]{5,60})/);
    if (deadlineMatch?.[1]) rules.push(`Deadline: ${deadlineMatch[1].trim()}.`);
  }

  // Submission method/address
  if (tender.submissionMethod) rules.push(`Submission method: ${tender.submissionMethod}.`);
  if (tender.submissionAddress && !/email/i.test(tender.submissionMethod ?? "")) rules.push(`Submission portal / address: ${tender.submissionAddress}.`);

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
  // ─── Agriculture BEFORE water ──────────────────────────────────────
  // "irrigation scheme" + "crop production" = agriculture; the water
  // pattern below also has "irrigation" but a pure agriculture tender
  // should match here first.
  if (/agricultur|livestock|crop\s+(production|management)|fishery|agribusiness|food\s+security|smallholder|farmer\s+(field|training)|value.chain/i.test(tenderText)) return "Agriculture & Rural Development";
  // Word boundaries on WASH (4 chars) — otherwise "Washington" matches.
  if (/water supply|borehole|pump|hydraulic|irrigation|\bWASH\b|sanitation|wastewater/i.test(tenderText)) return "Water & Sanitation Infrastructure";
  if (/road.*design|road.*rehab|bridge.*design|highway|pavement.*design/i.test(tenderText)) return "Road / Bridge / Transport Infrastructure";
  // Word boundaries on ESIA/ESMP — short abbreviations would otherwise
  // match inside larger words.
  if (/\bESIA\b|\bESMP\b|environmental.*impact|social.*safeguard|resettlement|biodiversity.*assess/i.test(tenderText)) return "Environmental & Social Impact Assessment";
  // CRITICAL FIX: word boundaries on ICT / MIS / ERP. Before this:
  //   • bare "ICT" matched "ICT" inside "predICT", "verdICT", "depICT",
  //     "distrICT", "conflICT", "evICT", "restrICT" — every tender
  //     mentioning "district health services" classified as ICT.
  //   • bare "MIS" matched "mis" inside "optimISation", "subMISsion",
  //     "comMISsion", "perMISsion" — every tender mentioning
  //     "submission rules" or "optimisation" misclassified.
  //   • bare "ERP" matched "erp" inside "supERPower", "tERPene".
  // The proposal generator was producing ICT-flavored methodology for
  // tenders that were actually water/education/agriculture/supply.
  if (/\bICT\b|software.*develop|information.*system|digital.*platform|\bMIS\b|\bERP\b|database.*system/i.test(tenderText)) return "ICT / Digital Systems";
  if (/urban|master plan|municipal.*develop|eco.?park|spatial.*plan/i.test(tenderText)) return "Urban / Master Planning";
  if (/school.*design|university.*design|campus.*develop|education.*facilit/i.test(tenderText)) return "Education Facility Design";
  // Financial / Audit Advisory BEFORE Social Development / Advisory —
  // financial advisory IS a form of advisory services; the more specific
  // pattern must win. Without this ordering "Financial advisory services
  // for treasury optimisation" misclassified as the generic advisory bucket.
  if (/financial\s+advisory|economic\s+analysis|due\s+diligence|valuation|audit\s+services|tax\s+consult/i.test(tenderText)) return "Financial / Audit Advisory";
  if (/supply\s+of|procurement\s+of\s+(goods|equipment|materials)|equipment\s+supply|goods\s+procurement/i.test(tenderText)) return "Supply / Goods Procurement";
  if (/capacity\s+build|training\s+services|institutional\s+strength|technical\s+assistance|trainer.of.trainers/i.test(tenderText)) return "Capacity Building / Advisory";
  if (/solar\s+(power|farm|pv)|wind\s+(power|farm)|hydropower|grid\s+(connect|extension)|renewable\s+energy|power\s+(generation|transmission|distribution)|energy|power.*plant|grid.*connect|generation.*capacity|transmission.*line|substation.*design/i.test(tenderText)) return "Energy / Power Infrastructure";
  if (/social.*develop|advisory.*service|institutional.*strength|capacity.*build|community.*develop/i.test(tenderText)) return "Social Development & Advisory";
  if (/hotel|hospitality|resort/i.test(tenderText)) return "Hospitality & Tourism";
  if (/factory|industrial|manufacturing/i.test(tenderText)) return "Industrial / Manufacturing";
  if (/geotechnical|soil.*investigation|foundation.*design|seismic/i.test(tenderText)) return "Geotechnical & Structural Engineering";
  if (/renovation|modification|retrofit|existing building/i.test(tenderText)) return "Building Renovation & Adaptation";
  if (/agri|irrigation.*scheme|crop.*yield|farm.*develop|value.?chain.*agri|livestock.*develop/i.test(tenderText)) return "Agriculture & Rural Development";
  if (/mining|mineral.*extract|quarry.*design|pit.*design|tailings|ore.*body|blast.*design/i.test(tenderText)) return "Mining & Extractive Industries";
  if (/\bport.*design|\bport.*master.*plan|berth.*design|quay.*design|harbour.*develop|dredging.*scheme|container.*terminal/i.test(tenderText)) return "Port / Maritime Infrastructure";
  if (/pipeline.*design|oil.*facilit|gas.*facilit|upstream.*petroleum|HAZOP|P&ID|refinery|petrochemical/i.test(tenderText)) return "Oil & Gas / Petroleum";
  if (/KYC|AML.*framework|core.*banking|microfinance.*system|credit.*risk.*model|IFRS.*implement|Basel|prudential.*regul/i.test(tenderText)) return "Financial Services / Banking";
  if (/spectrum.*licen|base.*station.*design|backhaul.*design|last.?mile.*access|broadband.*network|telecoms.*infra|LTE.*deploy|5G.*rollout/i.test(tenderText)) return "Telecoms / Broadband Infrastructure";
  if (/architecture|building.*design|construction.*supervision|structural.*design/i.test(tenderText)) return "Building Design & Construction Supervision";
  if (/\benergy\b|power.*plant|\bsolar\b|wind.*farm|grid.*connect|generation|transmission.*line|substation|\bhydropower\b|\belectrification\b|renewable.*energy|power.*system|\bSCADA\b/i.test(tenderText)) return "Energy & Power Infrastructure";
  if (/irrigation.*scheme|command.*area|\bWUA\b|agri.*develop|\bagricultural\b|crop.*water|rural.*develop.*agri|livestock.*develop/i.test(tenderText)) return "Agriculture, Irrigation & Rural Development";
  if (/\bJORC\b|mine.*plan|pit.*design|tailings|ore.*body|blast.*design|geotechnical.*mine|mine.*feasibility|mining.*project/i.test(tenderText)) return "Mining & Extractive Industries";
  if (/\bport\b.*\b(design|master.*plan|infrastructure|facilit|terminal|study)\b|berth.*design|quay.*design|harbour.*develop|dredging|container.*terminal|\bISPS\b/i.test(tenderText)) return "Port & Maritime Infrastructure";
  if (/pipeline.*design|oil.*facilit|gas.*facilit|\bHAZOP\b|\bP&ID\b|refinery|petrochemical|upstream.*petroleum|\bLNG\b|\bFEED\b.*\b(oil|gas|process)\b/i.test(tenderText)) return "Oil & Gas / Petroleum Engineering";
  if (/\bKYC\b|\bAML\b|core.*banking|microfinance.*(?:system|platform)|credit.*risk.*model|\bIFRS\b.*implement|\bBasel\b|prudential.*regul|capital.*adequacy/i.test(tenderText)) return "Financial Services & Banking";
  if (/spectrum.*licen|spectrum.*plan|broadband.*infrastruc|base.*station.*design|\bLTE\b|\b5G\b|mobile.*network.*rollout|broadband.*rollout|backhaul.*network/i.test(tenderText)) return "Telecoms & Broadband";
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

/**
 * Differentiators are derived from SOURCE-DERIVED THEMES and the company's own
 * evidence — never from the identity of the client.
 *
 * This function used to take the raw tender text, and used it for exactly one
 * thing: `if (/pharo/i.test(tenderText))`, which pushed a claim about "private
 * -sector investor expectations" into the proposal whenever a particular
 * client's name appeared anywhere in the document. That is unfounded (a client
 * name implies nothing about their expectations), unearned (no evidence backs
 * the claim), and structurally wrong (every neighbouring branch keys on a
 * theme code, not a customer). It also could not generalise: no other client
 * could ever receive the behaviour, and any unrelated tender containing that
 * token received a differentiator it had not earned.
 *
 * The parameter is removed along with the branch, deliberately. Dropping only
 * the regex would leave the capability in place for the next such shortcut;
 * without the raw text this function cannot key on a client identity at all.
 * A claim of this kind must come from a theme code derived from the source.
 */
function makeDifferentiators(
  company: CompanyLite,
  projects: ProjectLite[],
  experts: ExpertLite[],
  themes: ProposalTheme[],
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
      items.push("Reviewed hospital and medical-centre records inform the healthcare-specific delivery approach described in this proposal.");
    }
    items.push("Healthcare-specific methodology addresses IPC, clinical zone segregation and medical-gas coordination; radiation shielding and licensing activities are included only where the confirmed equipment brief and applicable authority require them.");
    items.push("The proposed disciplines are mapped to the tender's healthcare scope; individual experience claims remain limited to each reviewed specialist record.");
  }

  // Facility assessment — claim, not instruction.
  if (themes.some((t) => t.code === "FACILITY_ASSESSMENT")) {
    items.push("Structured property assessment methodology covering structural adequacy, spatial feasibility, utility availability, accessibility, and expansion potential, backed by in-house geotechnical capability for due-diligence speed.");
  }

  // Donor compliance — claim, not instruction.
  if (/World Bank|ESF|UNDP|British Council/i.test(companyText + allProjectText)) {
    items.push("Reviewed World Bank ESF and British Council records inform the proposal's documentation and review controls; each applicable standard remains subject to the tender and authority requirements.");
  }

  // In-house geotechnical — claim.
  if (/geotechnical|drilling rig|soil.*machine|laboratory/i.test(companyText)) {
    items.push("In-house geotechnical capability (drilling rigs, soil testing laboratory) removes sub-contractor coordination from the site-assessment phase and protects acquisition timelines.");
  }

  // MEP in-house — claim. Word boundary on MEP (3-char abbreviation).
  if (/\bMEP\b|electrical.*engineer|sanitary.*engineer|mechanical/i.test(allExpertText)) {
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
    // Individual source-backed qualifications belong in the relevant CV entry;
    // do not turn them into a proposal-wide specialist capability claim.
  }

  // Energy / Power
  if (themes.some((t) => t.code === "ENERGY_POWER")) {
    if (/energy|solar|hydropower|substation|transmission|generation|electrification/i.test(allProjectText)) {
      items.push("Energy infrastructure delivery track record: prior power generation, transmission, or electrification projects give this engagement design-standard and grid-code continuity advantage.");
    }
    items.push("Integrated power-systems design capability: load-flow analysis, protection relay coordination, SCADA architecture, and environmental compliance delivered under one technical team — reducing coordination risk.");
  }

  // Agriculture / Irrigation
  if (themes.some((t) => t.code === "AGRICULTURE_IRRIGATION")) {
    if (/irrigation|agri|WUA|command.*area/i.test(allProjectText)) {
      items.push("Irrigation scheme delivery track record: prior command-area development and WUA establishment projects provide beneficiary-engagement and hydraulic-design continuity.");
    }
    items.push("FAO Penman-Monteith crop-water-requirement rigour combined with in-house hydrological analysis capability — design basis confirmed from primary field data, not desktop estimates.");
  }

  // Mining / Extractive
  if (themes.some((t) => t.code === "MINING_EXTRACTIVE")) {
    if (/mining|JORC|tailings|ore|mine.*plan/i.test(allProjectText)) {
      items.push("JORC-compliant resource reporting experience with competent-person credentials: independent peer review and regulatory submission capability built into the project workflow.");
    }
    items.push("Integrated geotechnical and mine-design capability: slope-stability analysis, TSF design per MAC/ANCOLD guidelines, and closure-cost estimation under one technical team.");
  }

  // Port / Maritime
  if (themes.some((t) => t.code === "PORT_MARITIME")) {
    if (/port|berth|quay|dredging|maritime/i.test(allProjectText)) {
      items.push("Port infrastructure delivery track record: prior berth design, dredging, and ISPS certification projects provide met-ocean and regulatory continuity for this engagement.");
    }
    items.push("Integrated port engineering capability: fast-time nautical simulation, bathymetric survey, structural berth design, and ISPS compliance documentation in a single delivery workflow.");
  }

  // Oil & Gas
  if (themes.some((t) => t.code === "OIL_GAS")) {
    if (/HAZOP|P&ID|pipeline|oil.*facilit|gas.*facilit|refinery/i.test(allProjectText)) {
      items.push("Oil & gas process-safety track record: HAZOP studies with fully tracked close-out, LOPA for high-severity nodes, and pipeline integrity management plans from completed projects.");
    }
    items.push("Integrated process engineering capability: P&ID development, pipeline stress analysis (Caesar II), cathodic-protection design, and pre-commissioning procedures under one technical team.");
  }

  // Financial Services
  if (themes.some((t) => t.code === "FINANCIAL_SERVICES")) {
    if (/KYC|AML|core.*banking|microfinance|IFRS|Basel/i.test(allProjectText)) {
      items.push("Regulatory compliance delivery track record: prior KYC/AML programme design, IFRS implementation, or Basel compliance projects demonstrate working knowledge of the regulatory environment.");
    }
    items.push("Gap-analysis-first approach: regulatory-gap analysis reviewed by licensed legal counsel before system design commences — avoids costly redesign after regulatory review.");
  }

  // Telecoms / Broadband
  if (themes.some((t) => t.code === "TELECOMS_BROADBAND")) {
    if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(allProjectText)) {
      items.push("Broadband and mobile network delivery track record: prior LTE/5G base-station or fibre-backhaul projects provide RF-planning and commissioning-protocol continuity.");
    }
    items.push("End-to-end network design capability: coverage simulation, backhaul design, base-station siting, and site-acceptance test (SAT) protocol managed under one technical team.");
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

  if (themes.some((t) => t.code === "ENERGY_POWER") && !topProjects.some((p) => /energy|power|solar|wind|grid|generation|substation/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Energy / power tender detected but no energy-specific reviewed project is selected. Use the closest electromechanical or infrastructure project and flag the sector gap as a senior bid-review action.");
  }

  if (themes.some((t) => t.code === "AGRICULTURE_IRRIGATION") && !topProjects.some((p) => /agri|irrigation|farm|crop|WUA/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Agriculture / irrigation tender detected but no sector-matching project is in the portfolio. Select the closest water or rural-infrastructure project and note the gap for the bid team.");
  }

  if (themes.some((t) => t.code === "MINING_EXTRACTIVE") && !topProjects.some((p) => /mining|mineral|tailings|jorc|quarry/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Mining tender detected but no mining or extractive-industry project is selected. Flag this as a critical evidence gap — JORC / geotechnical experience is typically a mandatory eligibility criterion.");
  }

  if (themes.some((t) => t.code === "PORT_MARITIME") && !topProjects.some((p) => /port|berth|dredging|maritime|harbour|quay/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Port / maritime tender detected but no port-specific project is selected. Use the closest coastal civil or infrastructure project and flag the sector gap as a senior bid-review action.");
  }

  if (themes.some((t) => t.code === "OIL_GAS") && !topProjects.some((p) => /oil|gas|pipeline|hazop|p&id|refinery|petrochemical/i.test(textOf(p.name, p.summary, p.sector, p.clientName)))) {
    gaps.push("Oil & gas tender detected but no process-engineering or pipeline project is selected. HAZOP experience is typically a mandatory criterion — flag this gap for senior review before submission.");
  }

  if (themes.some((t) => t.code === "FINANCIAL_SERVICES") && !topExperts.some((e) => /banking|finance|kyc|aml|ifrs|basel|risk.*model/i.test(textOf(e.title, e.profile, ...safeParseArr(e.disciplines))))) {
    gaps.push("Financial services tender detected but no financial-sector expert is selected. Propose a named financial-systems or regulatory specialist and describe their integration role in the proposal.");
  }

  if (themes.some((t) => t.code === "TELECOMS_BROADBAND") && !topExperts.some((e) => /telecom|RF.*plan|spectrum|backhaul|network.*architect|LTE|5G/i.test(textOf(e.title, e.profile, ...safeParseArr(e.disciplines))))) {
    gaps.push("Telecoms / broadband tender detected but no RF planning or telecoms network expert is selected. Name a qualified RF / network specialist and include their role in the proposal.");
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
    logger.warn("[proposal-intelligence] Stripped stale proposal-text from intakeSummary/analysisSummary (feedback-loop guard).");
  }

  const tenderText = textOf(
    tender.title, tender.reference, tender.clientName || tender.procuringEntityName, tender.country,
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
    { label: /Urban|Master Plan/, keywords: /urban|master plan|municipal|spatial.*plan|land.?use|zoning|\bGIS\b|eco.?park|\bcity\b/i },
    { label: /Education/, keywords: /school|university|campus|education|classroom|library|\blab\b/i },
    { label: /Environmental|Social.*Impact/, keywords: /ESIA|ESMP|environmental|social.*safeguard|resettlement|biodiversity|impact.*assess/i },
    // Kept in sync with inferSector() triggers: ICT|software.*develop|information.*system|digital.*platform|MIS|ERP|database.*system
    { label: /ICT|Digital/, keywords: /\bICT\b|software|digital|\bMIS\b|\bERP\b|database|web|\bapp\b|cloud|server|network|information.*system/i },
    { label: /Geotechnical|Structural/, keywords: /geotechnical|soil|foundation|seismic|borehole|drilling|structural/i },
    { label: /Hospitality|Tourism/, keywords: /hotel|hospitality|resort|tourism|lodge/i },
    // "plant" removed — matches "water treatment plant", "pumping plant" in unrelated sectors
    { label: /Industrial|Manufacturing/, keywords: /factory|industrial|manufacturing|warehouse/i },
    // "existing" and "interior" narrowed — bare forms match almost every tender
    { label: /Renovation|Adaptation/, keywords: /renovation|modification|retrofit|existing\s+(?:building|facilit|struct)|adaptation|interior\s+(?:renovati|remodel|refurb)/i },
    // Keywords kept in sync with the inferSector() triggers for "Social Development & Advisory":
    // social.*develop | advisory.*service | institutional.*strength | capacity.*build | community.*develop
    { label: /Social Advisory|Community/, keywords: /social.*advisor|advisory.*service|institutional.*strength|capacity.*build|community.*develop|social.*develop|livelihoods|social.*mobiliz|community.*mobiliz|resettlement.*action|poverty|civil.*society|participatory.*develop/i },
    // Kept in sync with inferSector() triggers: architecture|building.*design|construction.*supervision|structural.*design
    { label: /Building Design/, keywords: /architectural.*design|building.*design|construction.*supervision|residential.*develop|commercial.*develop|architectural.*supervision|\barchitecture\b|structural.*design/i },
    // New 7 sectors — kept in sync with inferSector() additions above
    { label: /Energy|Power/, keywords: /\benergy\b|power.*plant|\bsolar\b|wind.*farm|grid.*connect|generation|transmission.*line|substation|\bhydropower\b|\belectrification\b|renewable.*energy|\bSCADA\b/i },
    { label: /Agriculture|Irrigation/, keywords: /irrigation.*scheme|command.*area|\bWUA\b|agri.*develop|\bagricultural\b|crop.*water|rural.*develop.*agri|livestock.*develop|\bagronomic\b/i },
    { label: /Mining|Extractive/, keywords: /\bJORC\b|mine.*plan|pit.*design|tailings|ore.*body|blast.*design|geotechnical.*mine|mine.*feasibility|mining.*project|\bquarry\b/i },
    { label: /Port|Maritime/, keywords: /\bport\b.*\b(design|master.*plan|infrastructure|facilit|terminal|study)\b|berth.*design|quay.*design|harbour.*develop|dredging|container.*terminal|\bISPS\b/i },
    { label: /Oil|Gas|Petroleum/, keywords: /pipeline.*design|oil.*facilit|gas.*facilit|\bHAZOP\b|\bP&ID\b|refinery|petrochemical|upstream.*petroleum|\bLNG\b|\bFEED\b.*\b(oil|gas|process)\b/i },
    { label: /Financial|Banking/, keywords: /\bKYC\b|\bAML\b|core.*banking|microfinance.*(?:system|platform)|credit.*risk.*model|\bIFRS\b|\bBasel\b|prudential.*regul|capital.*adequacy|\bfintech\b/i },
    { label: /Telecoms|Broadband/, keywords: /spectrum.*licen|spectrum.*plan|broadband.*infrastruc|base.*station.*design|\bLTE\b|\b5G\b|mobile.*network|broadband.*rollout|backhaul.*network/i },
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
    { tender: /Port|Maritime/, exclude: /warehouse.*inland|dry.*store|inland.*logistics|distribution.?cent|manufacturing|factory/i },
    { tender: /Oil|Gas|Petroleum/, exclude: /school|university|campus|education|social.*develop|community.*develop/i },
    { tender: /Financial|Banking/, exclude: /warehouse|logistics|cargo|road|bridge|highway|mining|port|maritime/i },
    { tender: /Mining|Extractive/, exclude: /school|university|campus|education|social.*develop|financial.*service|banking/i },
    { tender: /Energy|Power/, exclude: /school|university|campus|education|financial.*service|banking|port|maritime/i },
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
    logger.info(`[proposal-intelligence] Sector filter (${detectedSector}): kept ${projectPool.length}/${projects.length} projects, ${expertPool.length}/${experts.length} experts.`);
  }

  const exactEmails = detectExactEmails(tenderText);
  const exactSubjectLine = detectExactSubjectLine(tenderText);
  // Use the canonical detectFinancialProposalRequiredFromText() from
  // lib/document-generation/generation-integration.ts — single source of
  // truth for "should this tender have a financial proposal?". Supersedes
  // the inline regex that lived here before PR fix/generated-document-content-quality.
  const noFinancialProposal = !detectFinancialProposalRequiredFromText(tenderText);
  const documentTypeAdvisory = buildTenderDocumentTypeAdvisory(tenderText);
  if (documentTypeAdvisory.notes.length > 0) {
    logger.info(`[proposal-intelligence] document-type advisory (type=${documentTypeAdvisory.tenderType}, financial=${documentTypeAdvisory.financialProposalRequired}): ${documentTypeAdvisory.notes.join(" | ")}`);
  }

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
  const detectedClient = cleanClientName(tender.clientName || tender.procuringEntityName, tender.description);
  const finalClientName = detectedClient !== "Client"
    ? detectedClient
    : "The Client";
  const finalAssignmentName = cleanTenderTitle(tender.title, {
    clientName: finalClientName,
    description: tender.description,
  });

  const detectedCriteria = detectEvaluationCriteria(tenderText);

  return {
    tenderText,
    clientName: finalClientName,
    clientContactName: tender.clientContactName ?? null,
    assignmentName: finalAssignmentName,
    primarySector: inferSector(tenderText),
    requiredSections: detectRequiredSections(tenderText),
    evaluationCriteria: detectedCriteria.map((entry) => splitEvaluationCriterion(entry).label),
    evaluationCriteriaWriterNotes: detectedCriteria,
    evaluationWeights: detectEvaluationWeights(tenderText),
    commercialTerms: detectCommercialTerms(tenderText),
    submissionRules: detectSubmissionRules(tender, tenderText),
    differentiators: makeDifferentiators(company, topProjects, topExperts, themes),
    themes,
    topProjects,
    topExperts,
    gapsToAddressInNarrative: detectGaps(themes, topProjects, topExperts, tenderText),
    appendixList: detectAppendixList(tenderText),
    noFinancialProposal,
    exactEmails,
    exactSubjectLine,
    documentTypeAdvisory,
  };
}

export function projectProofLine(project: ProjectLite): string {
  const value = money(project.contractValue, project.currency);
  const parts = [project.clientName, project.country, project.sector, value].filter(Boolean);
  const summary = truncateAtWordBoundary(clean(project.summary), 600);
  return `${project.name}${parts.length ? ` — ${parts.join(" | ")}` : ""}${summary ? `. ${summary}` : ""}`;
}

/**
 * A stored field, made fit to sit inside a sentence.
 *
 * Evidence values are interpolated straight into prose — "delivered X (client)"
 * and "X for client." — so whatever punctuation the field ends with collides
 * with the sentence's own. A real Company Vault project carries the client
 * "Gimba City, South Wollo Zone, Amhara Region," — a location string that ends
 * in a comma — and the client-facing Technical Proposal therefore read:
 *
 *   … G+6 General Hospital – Dr Abdul Seid (Gimba City, South Wollo Zone,
 *   Amhara Region,) and Moyale Abattoir Rehabilitation …
 *   … G+6 General Hospital – Dr Abdul Seid for Gimba City, South Wollo
 *   Zone, Amhara Region,. The same team is proposed …
 *
 * ",)" and ",." three times over in the document an evaluator reads.
 *
 * The data is not edited to fix this: the vault keeps exactly what its source
 * says, and only the rendering trims the separator that the sentence is about
 * to supply itself.
 */
export function inlineEvidenceValue(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s,;:.\u2013\u2014-]+/, "")
    .replace(/[\s,;:\u2013\u2014-]+$/, "")
    .trim();
}

/**
 * The CV form fields a proposal may quote, and the ones it may not.
 *
 * An expert's stored `profile` is the text extracted from their CV, and the
 * standard consultancy CV opens with a personnel form whose labels and values
 * run together with no punctuation:
 *
 *   1. PERSONNEL INFORMATION Proposed Position Architect Name of Firm Hope
 *   Urban Planning … Name of Expert Habib Ahmed Date of Birth 1997 G.C.
 *   (Approx) Nationality Ethiopian Education B.Sc. in Architecture
 *
 * expertProofLine hands that text to the writer, and the writer copied it into
 * the team table of a real client-facing Technical Proposal — so the submitted
 * document stated an employee's date of birth and nationality. Neither is
 * evidence of capability, and neither belongs in a document that leaves the
 * company.
 *
 * This is a privacy classifier, not a contaminant list: the categories are
 * enumerated because personal data IS enumerated (birth, origin, civil status,
 * identity numbers, personal contact details). The professional fields beside
 * them — position, firm, education, registration — are exactly what an
 * evaluator is meant to read and are kept.
 *
 * Removal is by FORM FIELD, not by blind deletion: a personal label consumes
 * text only up to the next known label, so the professional field that follows
 * it survives intact.
 */
const CV_FORM_LABELS = [
  "Proposed Position", "Name of Firm", "Name of Expert", "Name of Staff",
  "Date of Birth", "Place of Birth", "Nationality", "Citizenship",
  "Marital Status", "Gender", "Sex", "Religion",
  "Passport Number", "Passport No", "National ID", "ID Number", "ID No",
  "Telephone", "Mobile", "Phone", "Email", "Address",
  "Education", "Languages", "Membership in Professional Associations",
  "Membership", "Years with Firm", "Key Qualifications", "Employment Record",
] as const;

const PERSONAL_CV_LABELS = new Set<string>([
  "Date of Birth", "Place of Birth", "Nationality", "Citizenship",
  "Marital Status", "Gender", "Sex", "Religion",
  "Passport Number", "Passport No", "National ID", "ID Number", "ID No",
  "Telephone", "Mobile", "Phone", "Email", "Address",
]);

export function withoutPersonalCvFields(profile: string): string {
  if (!profile) return profile;
  // Longest label first so "Passport Number" is not matched as "Passport No".
  const labels = [...CV_FORM_LABELS].sort((a, b) => b.length - a.length);
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const boundary = new RegExp(`\\b(${labelPattern})\\b`, "g");

  const segments: Array<{ label: string | null; text: string }> = [];
  let lastIndex = 0;
  let lastLabel: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(profile)) !== null) {
    segments.push({ label: lastLabel, text: profile.slice(lastIndex, match.index) });
    lastLabel = match[1];
    lastIndex = match.index + match[0].length;
  }
  segments.push({ label: lastLabel, text: profile.slice(lastIndex) });

  return segments
    .filter((segment) => !(segment.label && PERSONAL_CV_LABELS.has(segment.label)))
    .map((segment) => (segment.label ? `${segment.label}${segment.text}` : segment.text))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Strip the furniture of a CV *document* from a stored expert profile.
 *
 * `withoutPersonalCvFields` removes the personal data. What it leaves is still
 * the raw text of a file, and the Principal Qualifications bios print it to the
 * client verbatim. A real submitted proposal therefore read:
 *
 *   Profile. HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC
 *   CURRICULUM VITAE ENG. AHMED KEBEDE TEKAW General Manager & Practicing
 *   Professional Engineer … 1. PERSONNEL INFORMATION Proposed Position General
 *   Manager … Name of Firm Hope Urban Planning Architectural and Engineering
 *   Consultan
 *
 * An evaluator reads that as the bidder having pasted a file into the proposal.
 * Three families of furniture are removed: the shouty letterhead banner a CV
 * opens with, the document titles ("CURRICULUM VITAE", "PROFESSIONAL PROFILE"),
 * and the numbered form-section headings with their bare labels. The narrative
 * itself is untouched — this only removes text that describes the document
 * rather than the person.
 */
const CV_DOCUMENT_FURNITURE: RegExp[] = [
  /\b\d+\s*\.\s*PERSONNEL\s+INFORMATION\b/gi,
  /\bCURRICULUM\s+VITAE\b/gi,
  /\bPROFESSIONAL\s+PROFILE\b/gi,
  /\bPERSONNEL\s+INFORMATION\b/gi,
  /\b(?:Proposed Position|Current Position|Name of Firm|Name of Expert|Name of Staff|Full Name|Employer)\s*[:\-]?\s*/gi,
];

export function withoutCvDocumentFurniture(profile: string): string {
  if (!profile) return profile;
  let text = profile.replace(/\s+/g, " ").trim();
  // A CV usually opens with the firm's name in capitals, sometimes twice, then
  // the holder's name in capitals. Drop a leading run of shouty words before
  // any ordinary prose starts; stop at the first token that is not upper-case
  // furniture so a real sentence is never eaten.
  text = text.replace(/^(?:(?:[A-Z][A-Z&.()À-ɏ]{1,}|\d+\.)\s+){4,}/, "");
  for (const pattern of CV_DOCUMENT_FURNITURE) text = text.replace(pattern, " ");
  return text.replace(/\s{2,}/g, " ").replace(/^[\s,;:.\-–—]+/, "").trim();
}

/**
 * Cut long evidence text at a WORD boundary, not mid-word.
 *
 * These proof lines are writer context, and the writer copies them into the
 * team and experience tables. A raw `.slice(0, 600)` therefore shipped, in a
 * real client-facing Technical Proposal:
 *
 *   … SELAMAWIT MESFIN ARCHITECT HOPE URBAN PLANNING ARCHI
 *   … Name of Firm Hope Urban Planning Architectural and Engineering Consultan
 *
 * A proposal that stops mid-word reads as broken to an evaluator, and it is the
 * kind of defect no amount of prompt quality can fix because the damage is done
 * before the writer sees the text.
 *
 * The budget is unchanged — the same amount of evidence reaches the writer —
 * only the cut moves back to the last space, and the ellipsis marks it as
 * shortened. A single token longer than the whole budget still gets a hard cut,
 * because there is no word boundary to find.
 */
export function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > Math.floor(max * 0.5) ? window.slice(0, lastSpace) : window;
  // Cutting on a word boundary is not enough on its own. A delivered proposal
  // ended cells at "(Building Officer, Gimba…", "2. EDUCATION, TRAINING &…" and
  // "Sectors: …" — each cut is between words, and each still reads as a broken
  // document rather than a shortened one.
  return tidyTruncation(cut.replace(/[\s,;:—–-]+$/, ""));
}

export function expertProofLine(expert: ExpertLite): string {
  const disciplines = safeParseArr(expert.disciplines).slice(0, 6).join(", ");
  const certs = safeParseArr(expert.certifications).slice(0, 6).join(", ");
  const sectors = safeParseArr(expert.sectors).slice(0, 4).join(", ");
  // Also strip the CV document's own furniture. This line reaches the client
  // through "Proposed Team and Expert Contributions", where it was printing
  // "… CURRICULUM VITAE ENG. AHMED KEBEDE TEKAW … 1. PERSONNEL INFORMATION
  // Proposed Position … Name of Firm …" verbatim from the source file.
  // Stripping the CV's named fields and headings was not enough: run
  // 34038487418 still printed the letterhead card — "HOPE URBAN PLANNING
  // ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC ENG. AHMED KEBEDE TEKAW …
  // Major Projects | 5 International | 11+ Years Experience … Languages Amharic
  // (Excellent), English…" — into the client-facing team table. A stored value
  // that is the source document's furniture rather than a profile is dropped;
  // the structured fields on either side of it carry the same facts.
  const profile = truncateAtWordBoundary(
    withoutSourceProvenance(withoutCvDocumentFurniture(withoutPersonalCvFields(clean(expert.profile)))),
    600,
  );
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
  evaluationCriteriaText?: string,
): string {
  if (weights.length === 0) {
    // Tenders without numeric weights still need criterion-evidence guidance.
    // Infer criteria names from the evaluation methodology text and assign
    // equal word-count targets (~500 words each, up to 5 criteria).
    if (!evaluationCriteriaText || evaluationCriteriaText.trim().length < 10) {
      logger.warn("[buildCriterionEvidenceMap] No numeric weights and no evaluation text — Section C will use unweighted methodology.");
      return "";
    }
    const inferredCriteria = evaluationCriteriaText
      .split(/\n/)
      .map((l) => l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
      .filter((l) => l.length >= 8 && l.length < 200 && !/^[A-Z\s]{10,}$/.test(l))
      .slice(0, 6);
    if (inferredCriteria.length === 0) return "";

    const equalWords = Math.round(3000 / inferredCriteria.length / 100) * 100;
    const lines: string[] = [
      "EVALUATION CRITERION → EVIDENCE & PROSE ALLOCATION MAP (equal-weight inference — no numeric weights detected)",
      "RULE: Allocate equal prose depth to each criterion. Treat every criterion as equally important unless context implies otherwise.",
      "",
    ];
    for (let i = 0; i < inferredCriteria.length; i++) {
      const criterion = inferredCriteria[i];
      const keywords = criterion.toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 3 && !/^(the|and|for|with|that|this|from|into|have|been|will|shall|must|only|also|when|where|which|their|each|both)$/.test(k));

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
        .slice(0, 2);

      if (scoredProjects.length === 0 && scoredExperts.length === 0) continue;

      lines.push(`━━━ [equal] ${criterion} → WRITE ~${equalWords} WORDS ━━━`);
      if (scoredProjects.length > 0) {
        lines.push("  CITE THESE PROJECTS:");
        for (let pi = 0; pi < scoredProjects.length; pi++) {
          const { project } = scoredProjects[pi];
          const val = project.contractValue ? ` | ${project.currency ?? "ETB"} ${(project.contractValue / 1_000_000).toFixed(1)}M` : "";
          lines.push(`    [${pi === 0 ? "PRIMARY" : "SUPPORTING"}] ${project.name}${project.clientName ? ` — ${project.clientName}` : ""}${val}`);
        }
      }
      if (scoredExperts.length > 0) {
        lines.push("  ASSIGN THESE EXPERTS:");
        for (let ei = 0; ei < scoredExperts.length; ei++) {
          const { expert } = scoredExperts[ei];
          lines.push(`    [${ei === 0 ? "LEAD" : "SUPPORT"}] ${expert.fullName}${expert.title ? ` — ${expert.title}` : ""}`);
        }
      }
      lines.push("");
    }
    return lines.length > 3 ? lines.join("\n") : "";
  }

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

    if (keywords.length === 0) {
      logger.warn(`[criterion-evidence] Skipped criterion with no extractable keywords: "${w.criterion}"`);
      continue;
    }

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
