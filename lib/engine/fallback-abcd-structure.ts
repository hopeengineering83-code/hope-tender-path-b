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
