export type FallbackAbcdInput = {
  tenderTitle: string;
  clientName: string;
  companyName: string;
  primarySector: string;
  expertCount: number;
  projectCount: number;
  isHealthcare: boolean;
  isEnergy?: boolean;
  isMining?: boolean;
  isPort?: boolean;
  isOilGas?: boolean;
  isFinancial?: boolean;
  isTelecoms?: boolean;
  isAgriculture?: boolean;
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

  const sectorLabel = input.primarySector || "the relevant sector";

  lines.push("# SECTION A: COMPANY PROFILE");
  lines.push("## A.1 Company Background");
  lines.push(`${input.companyName} is a professional consultancy with ${input.expertCount > 0 ? `${input.expertCount} reviewed expert record(s)` : "specialist staff"} available for this engagement. The firm's capabilities in ${sectorLabel} are substantiated by reviewed project evidence, legal and compliance records, and professional certifications. Founding year, licence grade, headcount, TIN/VAT, and registered address are available in the company knowledge vault and should be quoted verbatim in the final submission.`);
  lines.push("## A.2 Corporate Information");
  lines.push("| Field | Detail |\n|---|---|\n| Legal name | Bid-Team Action: confirm |\n| Registration number | Bid-Team Action: confirm |\n| TIN | Bid-Team Action: confirm |\n| VAT | Bid-Team Action: confirm |\n| Registered address | Bid-Team Action: confirm |\n| General Manager | Bid-Team Action: confirm |\n| Founding year | Bid-Team Action: confirm |\n| Staff headcount | Bid-Team Action: confirm |\n| Licence grade | Bid-Team Action: confirm |");
  lines.push("## A.3 Core Areas of Expertise");
  lines.push(`${input.companyName} delivers ${sectorLabel} services including: (1) technical assessment and scope verification aligned to client requirements; (2) multi-discipline design and technical methodology matched to tender evaluation criteria; (3) quality-review programmes (30%/60%/100% gates) with internal peer review; (4) regulatory compliance and approval documentation; and (5) progress monitoring, reporting, and project close-out support.`);
  lines.push("## A.4 Proposed Project Team");
  lines.push(`${input.expertCount > 0 ? `${input.expertCount} reviewed expert record(s) are available in the firm's knowledge vault.` : "Proposed team members are drawn from the firm's reviewed expert pool."} Each expert's role, qualification, licence number, years of experience, and sector background should be verified and quoted in the A.4 Proposed Team table before final submission. Bid-Team Action: populate the following table from expert CVs.\n\n| # | Expert Name | Position | Qualifications & Licence | Experience | Role on This Assignment |\n|---|---|---|---|---|---|\n| 1 | Bid-Team Action | Lead Expert | Confirm qualifications | Confirm years | Confirm role |`);
  lines.push("## A.5 Team-to-Project Experience Mapping");
  lines.push(`Each proposed expert should be mapped to a prior comparable assignment in the ${sectorLabel} sector. The mapping demonstrates "same team — proven delivery" to evaluators. Bid-Team Action: populate the following table from project records.\n\n| Expert | Comparable Project | Role on That Project | Relevance to This Tender |\n|---|---|---|---|\n| Bid-Team Action | Confirm project | Confirm role | Confirm relevance |`);

  if (input.isHealthcare) {
    lines.push("## A.6 Specialist / Biomedical Engineering Integration");
    lines.push("Healthcare proposals must demonstrate integration across architecture, structure, MEP, and biomedical engineering: medical equipment clearances and electrical loads (UPS, isolated circuits for imaging), radiation shielding calculations for X-ray and CT rooms, medical gas distribution (O₂, N₂O, vacuum, compressed air), ICT/nurse-call/telehealth infrastructure, Infection Prevention and Control (IPC) zone segregation and airflow, and clinical workflow coordination at each phase gate. All engineering disciplines must coordinate through a single interdisciplinary BIM or drawing-set review before each design freeze.");
  }

  lines.push("# SECTION B: RELEVANT EXPERIENCE");
  lines.push("## B.1 Client References");
  lines.push(`${input.projectCount > 0 ? `${input.projectCount} reviewed project reference(s) are available.` : "Project references should be drawn from the firm's knowledge vault."} Featured project references should name the client organisation, contract value (ETB/USD amount), assignment duration, and the specific role the firm performed. Reference letters or attestation availability should be confirmed for the top two comparable projects before submission.`);
  lines.push("## B.2 Project Portfolio");
  lines.push(`The firm's comparable project portfolio includes assignments of comparable scope, sector, and complexity to ${input.tenderTitle}. The featured projects below demonstrate delivery capacity through named client, contract value, and scope relevance. Bid-Team Action: populate project cards with data from reviewed project records.\n\n| Project Name | Client | Country | Contract Value | Sector | Key Services |\n|---|---|---|---|---|---|\n| Bid-Team Action | Confirm | Confirm | Confirm ETB/USD | ${sectorLabel} | Confirm scope |`);

  lines.push("# SECTION C: TECHNICAL APPROACH");
  lines.push("## C.1 Understanding of the Assignment");
  lines.push(`${input.clientName} requires a ${sectorLabel} assignment through ${input.tenderTitle}. The three critical technical challenges identified are: (1) aligning the proposed methodology to ${input.clientName}'s stated scope items and applicable sector standards; (2) demonstrating the proposed team's qualifications against the highest-weighted evaluation criteria; and (3) maintaining schedule discipline through a staged delivery with explicit client approval milestones. ${input.companyName}'s comparable project portfolio in ${sectorLabel} provides direct precedent for each scope item — the same team is proposed for this engagement.\n\nThe evaluation criteria require the firm to demonstrate technical competence, relevant prior experience, and team capacity simultaneously. Our staged methodology addresses each scope item in sequence with a defined deliverable, responsible expert, quality-review gate, and timeline.`);
  lines.push("## C.2 Technical Methodology Aligned to the Tender Scope");
  lines.push(`The methodology for ${input.tenderTitle} is structured as a scope-by-scope response. Each scope item produces a defined deliverable reviewed at a 30%/60%/100% gate cycle. The lead expert coordinates cross-discipline inputs, manages client approval milestones, and ensures all deliverables comply with ${sectorLabel} standards and ${input.clientName}'s document-control requirements.`);
  lines.push("### C.2.1 Inception and Scope Review");
  lines.push(`The inception phase confirms the detailed scope against ${input.clientName}'s requirements, establishes the work plan and communication protocol, and produces an Inception Report approved by ${input.clientName} before subsequent phases begin.`);
  lines.push("### C.2.2 Data Collection and Investigation");
  lines.push(`Site investigation, data collection, and baseline assessment are conducted using sector-standard methods. All data is quality-checked and documented before analysis commences. Primary findings are shared with ${input.clientName} at the interim data review milestone.`);
  lines.push("### C.2.3 Technical Analysis and Assessment");
  lines.push("Technical analysis applies sector-specific modelling tools and standards to the collected data. Results are peer-reviewed internally before being incorporated into the design / planning output.");
  lines.push("### C.2.4 Concept and Schematic Design / Planning");
  lines.push(`Concept outputs are submitted to ${input.clientName} for review at the 30% milestone. Comments are captured in a comment-response register and resolved before advancing to detailed design.`);
  lines.push("### C.2.5 Detailed Design, Specifications and BOQ");
  lines.push("Detailed design documents are cross-discipline coordinated, internally peer-reviewed, and submitted at the 60% milestone for client review. Final detailed design is issued after the 100% gate sign-off by the Technical Director.");
  lines.push("### C.2.6 Final Documentation and Submission");
  lines.push(`All final deliverables are packaged, version-controlled, and submitted to ${input.clientName} with a transmittal letter, revision register, and as-built index.`);

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
  if (input.isEnergy) {
    lines.push("### C.2.7 Load-Flow and Grid-Code Analysis");
    lines.push("Load-flow study using certified power-systems software (PSS/E or equivalent); grid-code compliance verification against the utility's published interconnection requirements; protection relay coordination documented before energisation.");
    lines.push("### C.2.8 Generation and Renewable Integration");
    lines.push("Generation-mix analysis including solar, wind, and storage options; HOMER or equivalent modelling; demand forecast using minimum 5 years of metered data; renewable share target and least-cost expansion plan.");
    lines.push("### C.2.9 SCADA and Control System Design");
    lines.push("SCADA architecture aligned to IEC 61850 / DNP3; remote monitoring points defined at detailed design; operator interface design reviewed by client operations team before commissioning.");
  }
  if (input.isMining) {
    lines.push("### C.2.7 Resource Estimation and JORC Compliance");
    lines.push("Block-model resource estimation with JORC 2012 confidence classification (Inferred / Indicated / Measured); independent competent-person review; data quality QC programme documented.");
    lines.push("### C.2.8 Geotechnical and Slope Stability Analysis");
    lines.push("Slope stability analysis using LEM (Rocscience Slide), numerical modelling (Phase2), and empirical methods; monitoring instrumentation layout designed before construction; trigger-action-response plan (TARP) documented.");
    lines.push("### C.2.9 Mine Plan and Tailings Management");
    lines.push("Open-pit or underground mine plan with production scheduling; tailings storage facility (TSF) designed to MAC/ANCOLD guidelines; closure plan and financial provision estimate at feasibility stage.");
  }
  if (input.isPort) {
    lines.push("### C.2.7 Vessel Simulation and Berth Design");
    lines.push("Vessel-class parameters confirmed with port authority; fast-time nautical simulation at design stage; mooring analysis for design vessel in worst-case met-ocean conditions; berth structural design to PIANC standards.");
    lines.push("### C.2.8 Dredging and Environmental Management");
    lines.push("Sediment characterisation and contamination assessment before dredging; dredge volume and disposal-site selection; turbidity monitoring plan; regulatory approval sequence documented before construction start.");
    lines.push("### C.2.9 Port Operations and ISPS Compliance");
    lines.push("Port operations manual template prepared at design stage; ISPS compliance audit checklist; shore-power provision and green-port alignment to ESPO Green Guide; handover package includes O&M and emergency procedures.");
  }
  if (input.isOilGas) {
    lines.push("### C.2.7 HAZOP and Process Safety");
    lines.push("HAZOP study at detailed-design stage with P&ID freeze protocol; all action items tracked in a shared real-time register; LOPA for high-severity nodes; LockOut-TagOut and permit-to-work systems defined before start-up.");
    lines.push("### C.2.8 Pipeline Integrity and Stress Analysis");
    lines.push("Pipeline designed to API 1104 / ISO 3183; stress-isometric analysis; wall-thickness calculation for design pressure and temperature; in-line inspection (ILI) programme specified at handover; cathodic protection system designed and commissioned.");
    lines.push("### C.2.9 Vendor Data and Procurement Support");
    lines.push("Vendor data requirements matrix issued with purchase orders; weekly vendor data tracking; early LOI for long-lead items (major vessels, compressors, rotating equipment); databook compilation at mechanical completion.");
  }
  if (input.isFinancial) {
    lines.push("### C.2.7 Regulatory Gap Analysis and Compliance Framework");
    lines.push("Regulatory gap analysis at inception against current central bank / regulator requirements (KYC/AML, capital adequacy, IFRS 9); compliance framework design reviewed by licensed local legal counsel; regulatory liaison built into project plan.");
    lines.push("### C.2.8 Data Migration and System Integration");
    lines.push("Full data-quality assessment before migration; test migration on 10% extracted sample; reconciliation report signed off before cutover; integration architecture peer-reviewed; phased go-live with parallel-run period; rollback plan documented.");
    lines.push("### C.2.9 User Acceptance Testing and Training");
    lines.push("UAT protocol covering all critical business processes; defect triage and sign-off before go-live; train-the-trainer programme; user manuals in local language; change-readiness survey at 60% gate and post-go-live.");
  }
  if (input.isTelecoms) {
    lines.push("### C.2.7 RF Propagation and Coverage Design");
    lines.push("RF propagation modelling using industry-standard tools (Atoll, Planet, or equivalent); coverage targets and signal-strength thresholds defined with client; site-acquisition shortlist with two alternative locations per target site.");
    lines.push("### C.2.8 Backhaul and Core Network Dimensioning");
    lines.push("Backhaul dimensioned at 120% of peak throughput forecast; microwave link budget for each hop; core network capacity verified against busy-hour traffic model; upgrade path specified for 3-year growth.");
    lines.push("### C.2.9 Network Commissioning and KPI Baseline");
    lines.push("Commissioning test plan per site; RF optimisation drive-test after commissioning; KPI baseline established before commercial launch; NOC monitoring dashboard pre-configured; hypercare period of 4–6 weeks with SLA breach protocol.");
  }
  if (input.isAgriculture) {
    lines.push("### C.2.7 Hydrological and Irrigation Design");
    lines.push("Hydrological analysis using minimum 20-year flow record; FAO Penman-Monteith evapotranspiration calculation; irrigation scheduling tool prepared for water-user association; canal / pipe network detailed design with pressure calculations.");
    lines.push("### C.2.8 Agronomy and Soil Management");
    lines.push("Soil classification and fertility assessment; crop-water-requirement analysis per crop type and growth stage; salinity and drainage management design; agronomist sign-off on cropping calendar and rotation recommendations.");
    lines.push("### C.2.9 Water-User Association and Handover");
    lines.push("WUA governance structure designed and registered before handover; farmer training on operation and maintenance; O&M manual prepared in local language; willingness-to-pay survey and tariff model reviewed with client before adoption.");
  }

  lines.push("## C.3 Work Plan and Deliverables");
  lines.push(`The assignment is structured across six overlapping phases. The critical path runs through the detailed design phase; each earlier phase feeds into it and each later phase depends on approved outputs from the one before. Client approval milestones at 30%, 60%, and 100% gate the critical path — no phase proceeds without written acceptance of the prior deliverable.\n\n| Stage | Deliverable | Responsible Expert | Timeline | Quality Gate |\n|---|---|---|---|---|\n| 1 — Inception | Inception Report | Lead Expert | Week 1–2 | PM sign-off |\n| 2 — Investigation | Site Survey + Data Register | Technical Team | Week 2–4 | Senior Engineer |\n| 3 — Analysis | Technical Assessment Report | Lead Expert | Week 4–6 | QA peer review |\n| 4 — Concept Design | Concept Design Package | Lead Expert | Week 6–8 | 30% client review |\n| 5 — Detailed Design | Detailed Design + BOQ + Specs | Technical Team | Week 8–14 | 60%/100% gates |\n| 6 — Final Submission | Final Document Package | Lead Expert | Week 14–16 | Director sign-off |`);
  lines.push("## C.4 Quality Assurance");
  lines.push(`Quality assurance for ${input.tenderTitle} is managed through a three-gate internal review cycle: 30% gate (peer review by a senior engineer not on the primary design team), 60% gate (cross-discipline coordination check and client interim review), and 100% gate (Technical Director sign-off and final compliance check before issuance). All documents are version-controlled with a revision history. Client comments at each milestone are logged in a comment-response matrix and formally resolved before advancing to the next phase.\n\nRisk management is integrated into the QA programme: the top risks (scope ambiguity, specialist availability, regulatory approval timeline) are tracked on a live risk register updated at each gate and shared with ${input.clientName} at every interim submission.`);

  lines.push("# SECTION D: ADDITIONAL INFORMATION");
  lines.push("## D.1 Value to the Client");
  lines.push(`${input.companyName} delivers value beyond the minimum tender scope through: (1) integrated project management that eliminates coordination delays between disciplines; (2) in-house multi-discipline capacity that reduces sub-consultant risk; (3) a structured QA programme with 30%/60%/100% review gates that reduces client-review cycle time; and (4) a local presence and sector experience that ensures deliverables meet ${input.clientName}'s specific regulatory and document-control requirements.`);
  lines.push("## D.2 In-House Capabilities, ESG and Innovation");
  lines.push("### D.2.1 Environmental and Social Governance");
  lines.push(`${input.companyName} integrates ESG principles into all ${sectorLabel} assignments: site disturbance minimisation, community engagement protocols, local employment preference, gender equity in staffing, and compliance with applicable environmental regulations and donor safeguard policies.`);
  lines.push("### D.2.2 Health and Safety");
  lines.push("All site activities are governed by the firm's Health and Safety Management Plan. Site inductions, mandatory PPE, incident reporting, and emergency response procedures are enforced for all staff and subcontractors. H&S compliance is verified at each project gate.");
  lines.push("### D.2.3 Innovation");
  lines.push(`${input.companyName} deploys current-technology methods: GIS-based spatial analysis, digital project management dashboards for client transparency, and sector-specific modelling tools where applicable. These capabilities are available from in-house resources at no additional cost.`);
  lines.push("## D.3 Professional Certifications");
  lines.push("Professional certifications, licences, awards and memberships — including registration numbers, issuing authority, and validity dates — should be listed from uploaded company evidence records. Bid-Team Action: populate from knowledge vault compliance records.");
  lines.push("## D.4 Declaration of Eligibility");
  lines.push(`${input.companyName} declares that it meets all eligibility requirements stated in ${input.tenderTitle}. All information provided is accurate and supported by documentary evidence available on request. Bid-Team Action: obtain signature from General Manager with name, title, and licence number before submission.`);

  return lines;
}
