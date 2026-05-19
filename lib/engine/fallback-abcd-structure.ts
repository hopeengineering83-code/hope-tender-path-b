export type FallbackAbcdInput = {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  expertCount: number;
  projectCount: number;
  isHealthcare: boolean;
};

const BASE_ABCD_SECTIONS = [
  "SECTION A: COMPANY PROFILE",
  "A.1 Company Background",
  "A.2 Corporate Information",
  "A.3 Core Areas of Expertise",
  "A.4 Proposed Project Team",
  "A.5 Team-to-Project Experience Mapping",
  "SECTION B: RELEVANT EXPERIENCE",
  "B.1 Client References",
  "B.2 Project Portfolio",
  "SECTION C: TECHNICAL APPROACH",
  "C.1 Understanding of the Assignment",
  "C.2 Technical Methodology Aligned to the Tender Scope",
  "C.3 Quality Assurance and Design Review",
  "SECTION D: ADDITIONAL INFORMATION",
  "D.1 Value to the Client",
  "D.2 Value-Added Services",
  "D.3 Professional Certifications",
  "D.4 Declaration of Eligibility",
];

const HEALTHCARE_SCOPE_SECTIONS = [
  "3.1 Facility Identification and Technical Assessment",
  "3.2 Conceptual and Detailed Design",
  "3.3 Engineering / MEP Coordination",
  "3.4 Regulatory Compliance and Approvals",
  "3.5 Renovation Planning and Implementation Oversight",
  "3.6 Project Close-Out Support",
  "A.6 Specialist / Biomedical Engineering Integration",
];

export function fallbackAbcdTableOfContents(input: FallbackAbcdInput): string[] {
  const sections = input.isHealthcare
    ? [...BASE_ABCD_SECTIONS.slice(0, 6), "A.6 Specialist / Biomedical Engineering Integration", ...BASE_ABCD_SECTIONS.slice(6, 12), ...HEALTHCARE_SCOPE_SECTIONS.slice(0, 6), ...BASE_ABCD_SECTIONS.slice(12)]
    : BASE_ABCD_SECTIONS;
  return ["# Table of Contents", ...sections.map((section, index) => `${index + 1}. ${section}`)];
}

export function fallbackAbcdSections(input: FallbackAbcdInput): string[] {
  const lines: string[] = [];

  lines.push("# SECTION A: COMPANY PROFILE");
  lines.push("## A.1 Company Background");
  lines.push(`${input.companyName} is presented through uploaded company profile evidence, reviewed support documents, legal/compliance records, and selected project/expert evidence relevant to ${input.tenderTitle}.`);
  lines.push("## A.2 Corporate Information");
  lines.push("Corporate registration, licence, tax, legal, financial and contact details should be verified against uploaded source records before final submission.");
  lines.push("## A.3 Core Areas of Expertise");
  lines.push(`The proposal should frame core expertise around ${input.primarySector}, tender-specific deliverables, quality control, coordination, reporting, and compliance.`);
  lines.push("## A.4 Proposed Project Team");
  lines.push(`${input.expertCount} reviewed expert record(s) are available for this tender response. Each named expert should be tied to role, discipline, qualification and tender responsibility.`);
  lines.push("## A.5 Team-to-Project Experience Mapping");
  lines.push("Each expert should be mapped to prior comparable assignments, previous role, and the technical risk they will control in this tender. Unsupported mappings must remain bid-team confirmation items.");

  if (input.isHealthcare) {
    lines.push("## A.6 Specialist / Biomedical Engineering Integration");
    lines.push("Healthcare proposals must show how architectural, structural, MEP and biomedical requirements are integrated: medical equipment clearances, diagnostic electrical loads, radiation shielding, medical gas, ICT/telehealth, infection-prevention zoning, and clinical workflow coordination.");
  }

  lines.push("# SECTION B: RELEVANT EXPERIENCE");
  lines.push("## B.1 Client References");
  lines.push("Client references should identify comparable assignments, client names, services, completion/testimony evidence and relevance to the evaluator's concerns.");
  lines.push("## B.2 Project Portfolio");
  lines.push(`${input.projectCount} reviewed project reference(s) are available. Project cards should show client, location, scope, value where evidenced, services, photos/drawings where required, and direct relevance to ${input.clientName}.`);

  lines.push("# SECTION C: TECHNICAL APPROACH");
  lines.push("## C.1 Understanding of the Assignment");
  lines.push(`The assignment is understood as an evidence-led technical proposal for ${input.clientName}, requiring exact tender compliance, relevant proof, and a delivery method tailored to the scope.`);
  lines.push("## C.2 Technical Methodology Aligned to the Tender Scope");
  lines.push("The methodology must be written as a scope-by-scope response, not a generic process description. It should define inputs, activities, outputs, responsible experts, quality controls and client decisions for every major tender task.");

  if (input.isHealthcare) {
    lines.push("### 3.1 Facility Identification and Technical Assessment");
    lines.push("Assess shortlisted premises for structural adequacy, spatial feasibility, utilities, accessibility, patient/service flows, safety, expansion potential and suitability for the intended healthcare functions.");
    lines.push("### 3.2 Conceptual and Detailed Design");
    lines.push("Prepare workflow-led healthcare layouts for Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy and support areas, embedding IPC, patient-centred design, medical equipment and telehealth requirements.");
    lines.push("### 3.3 Engineering / MEP Coordination");
    lines.push("Coordinate electrical, mechanical, sanitary/plumbing, HVAC, fire protection, ICT, nurse call, medical gas, equipment loads and radiation shielding through interdisciplinary design review.");
    lines.push("### 3.4 Regulatory Compliance and Approvals");
    lines.push("Prepare approval-ready drawings, specifications and documentation aligned with healthcare standards, building-permit requirements and client document-control expectations.");
    lines.push("### 3.5 Renovation Planning and Implementation Oversight");
    lines.push("Support renovation planning with drawings, specifications, BOQ/cost-estimate support where required, supervision controls, progress reporting and quality monitoring.");
    lines.push("### 3.6 Project Close-Out Support");
    lines.push("Support inspection, design-compliance verification, snag tracking, handover documentation and operational-readiness confirmation.");
  } else if (/energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification|generation|transmission/i.test(input.primarySector)) {
    lines.push("### C.2.1 Load Forecast and Demand Analysis");
    lines.push("Develop load-forecast memo and P50/P90 yield estimate using minimum 10 years of validated resource data; confirm grid-code obligations before design commences.");
    lines.push("### C.2.2 Power Systems Engineering");
    lines.push("Perform load-flow and short-circuit analysis using SKM/ETAP; prepare single-line diagram, protection relay coordination study, and SCADA architecture before detailed civil/structural design.");
    lines.push("### C.2.3 Procurement and Construction Supervision");
    lines.push("Supervise equipment procurement (FAT hold-point), civil installation, and energisation sequence; execute SAT protocol and confirm SCADA acceptance before grid connection.");
    lines.push("### C.2.4 Commissioning and Handover");
    lines.push("Execute commissioning procedures, produce O&M manual, complete operator training, and obtain regulatory commissioning certificate before handover.");
  } else if (/agri|irrigation|WUA|command.*area|FAO.*Penman|crop.*water/i.test(input.primarySector)) {
    lines.push("### C.2.1 Hydrological and Agronomic Baseline");
    lines.push("Analyse minimum 20-year flow record; calculate FAO Penman-Monteith crop-water requirement; map command-area boundaries with land-use classification.");
    lines.push("### C.2.2 Irrigation Network Design");
    lines.push("Design canal or pressurised pipe network with diversion/weir structures; prepare preliminary BOQ and WUA governance draft framework.");
    lines.push("### C.2.3 Construction Supervision and Commissioning");
    lines.push("Supervise construction with hydraulic commissioning tests, canal seepage tests, and distribution efficiency measurement before handover.");
    lines.push("### C.2.4 WUA Establishment and O&M Handover");
    lines.push("Establish WUA with agreed governance structure; issue O&M manual with operator training records and agronomic follow-up memo.");
  } else if (/mining|JORC|tailings|ore.*body|mine.*plan|mineral.*resource/i.test(input.primarySector)) {
    lines.push("### C.2.1 Resource Assessment");
    lines.push("Prepare JORC-compliant resource estimate with independent competent-person review; develop block model and scope geotechnical investigation.");
    lines.push("### C.2.2 Mine Plan and Feasibility");
    lines.push("Design pit or underground workings; conduct slope-stability analysis (three methods); design TSF per MAC/ANCOLD; prepare preliminary BOQ and environmental and social management plan.");
    lines.push("### C.2.3 Detailed Engineering and Permitting");
    lines.push("Prepare regulatory submission package, ESIA, and detailed design drawings; obtain environmental permit as a formal schedule gate.");
    lines.push("### C.2.4 Closure Planning");
    lines.push("Integrate progressive rehabilitation plan from feasibility stage; confirm closure cost estimate with financial provision before construction release.");
  } else if (/port|berth|quay|maritime|dredging|harbour|nautical/i.test(input.primarySector)) {
    lines.push("### C.2.1 Met-Ocean and Site Investigation");
    lines.push("Complete minimum 20-year met-ocean analysis, bathymetric survey and geotechnical investigation (seabed borings) before any structural design commences.");
    lines.push("### C.2.2 Design Development");
    lines.push("Confirm berth layout through fast-time nautical simulation before structural design freeze; prepare dredge volume and disposal plan with sediment characterisation.");
    lines.push("### C.2.3 ISPS Compliance and Environmental Management");
    lines.push("Prepare ISPS compliance documentation and environmental and social management plan; obtain disposal site approval from environmental authority before dredging.");
    lines.push("### C.2.4 Commissioning and Handover");
    lines.push("Execute commissioning tests, support ISPS certification, issue O&M manual, and complete nautical acceptance trial before handover.");
  } else if (/HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|petrochemical|upstream.*petroleum/i.test(input.primarySector)) {
    lines.push("### C.2.1 Design Basis and HAZOP");
    lines.push("Prepare design basis memorandum and P&ID; conduct HAZOP study with full action register; complete LOPA for high-severity nodes before detailed engineering.");
    lines.push("### C.2.2 Detailed Engineering");
    lines.push("Execute pipeline stress analysis (Caesar II or equivalent), cathodic-protection design, civil/structural drawings, and equipment layout; close HAZOP action register before construction release.");
    lines.push("### C.2.3 Construction Supervision and Integrity Testing");
    lines.push("Supervise construction with NDE hold-points at each weld; witness and record hydrotest per ASME B31 before commissioning.");
    lines.push("### C.2.4 Commissioning and ILI Programme");
    lines.push("Execute commissioning procedures; document process safety information (PSI); specify ILI programme; issue O&M manual with operator training before handover.");
  } else if (/KYC|AML|core.*banking|microfinance|IFRS|Basel|fintech|payment.*system/i.test(input.primarySector)) {
    lines.push("### C.2.1 Regulatory Gap Analysis");
    lines.push("Complete regulatory gap analysis reviewed by licensed local legal counsel; design target operating model; assess data quality before system architecture commences.");
    lines.push("### C.2.2 System Architecture and Build");
    lines.push("Design system architecture with RBAC, encryption, and audit-log controls; prepare integration plan and UAT protocol.");
    lines.push("### C.2.3 Data Migration and UAT");
    lines.push("Execute UAT with formal sign-off; complete data migration with three-way reconciliation; obtain legal counsel regulatory compliance confirmation before go-live.");
    lines.push("### C.2.4 Parallel-Run and Hypercare");
    lines.push("Execute parallel-run with data reconciliation signed off before cutover; conduct post-go-live hypercare; hand over knowledge-base wiki and support documentation.");
  } else if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(input.primarySector)) {
    lines.push("### C.2.1 Traffic Demand and Coverage Modelling");
    lines.push("Develop traffic demand model; run calibrated RF coverage simulation with field-measured correction factors; prepare spectrum licensing roadmap before site engineering commences.");
    lines.push("### C.2.2 Network Design");
    lines.push("Plan base-station siting; design backhaul with path availability calculations (microwave/fibre); prepare site acquisition list and EMR compliance dossier.");
    lines.push("### C.2.3 Procurement and Site Works");
    lines.push("Confirm in-principle spectrum approval before site engineering; supervise installation; complete drive-test acceptance against coverage KPIs.");
    lines.push("### C.2.4 Commissioning and O&M Handover");
    lines.push("Execute SAT protocol; complete EMR compliance measurements; issue O&M manual with operator training and live network monitoring dashboard.");
  }

  lines.push("## C.3 Quality Assurance and Design Review");
  lines.push("Apply staged review gates, interdisciplinary coordination checks, evidence verification, drawing revision control, QA/QC review, risk tracking and final bid-submission control.");

  lines.push("# SECTION D: ADDITIONAL INFORMATION");
  lines.push("## D.1 Value to the Client");
  lines.push("Value should be framed around reduced selection risk, better technical due diligence, regulatory readiness, evidence-backed team capability and clearer implementation control.");
  lines.push("## D.2 Value-Added Services");
  lines.push("Value-added services should be limited to supported capabilities such as site assessment, document control, coordination meetings, reporting, approval support and evidence-backed technical advisory.");
  lines.push("## D.3 Professional Certifications");
  lines.push("Professional certifications, licences, awards and memberships should be included only when supported by uploaded evidence.");
  lines.push("## D.4 Declaration of Eligibility");
  lines.push("Declare eligibility, evidence accuracy subject to final bid-team verification, technical-only submission compliance where applicable, and absence of unsupported financial offer.");

  return lines;
}
