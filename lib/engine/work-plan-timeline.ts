/**
 * Work Plan with timeline phases — sector-aware, evaluator-friendly.
 *
 * Evaluators look for a deliverable-linked work plan. The benchmark uses
 * numbered methodology subsections (3.1 to 3.6). This module builds an
 * additive Work Plan and Schedule table that maps each phase to:
 * milestone(s), responsible expert role, deliverables, and indicative
 * duration. Sector-aware: design tenders get conceptual → schematic →
 * detailed phasing; advisory tenders get inception → analysis →
 * recommendations phasing; etc.
 *
 * Conditional: emitted only when no equivalent "Work Plan" or "Schedule"
 * heading is already present.
 */

type Phase = { phase: string; milestones: string; responsibleRole: string; deliverables: string; duration: string };

function escCell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim();
}

function phasesForSector(primarySector: string): Phase[] {
  const sector = primarySector.toLowerCase();

  if (/health|hospital|medical|clinic/.test(sector)) return [
    { phase: "Phase 1: Site / Premises Assessment", milestones: "Weighted assessment matrix scored; signed Technical Assessment Report submitted to client", responsibleRole: "Project Principal + Geotechnical Lead", deliverables: "Site Assessment Report; subsurface findings; recommendation memo", duration: "1 to 2 weeks" },
    { phase: "Phase 2: Conceptual Design", milestones: "Functional brief, clinical zoning, and structural grid agreed", responsibleRole: "Lead Architect + Project Principal", deliverables: "Department layouts; zoning drawings; MEP routing strategy; Stage-1 IPC gate sign-off", duration: "3 to 5 weeks" },
    { phase: "Phase 3: Detailed Design (3.1 to 3.4)", milestones: "All disciplines coordinated; specifications drafted; regulatory pre-check", responsibleRole: "MEP Lead + Structural Lead + Biomedical Specialist", deliverables: "Architectural / structural / MEP / medical-gas drawings; specifications; Stage-2 sign-off", duration: "8 to 12 weeks" },
    { phase: "Phase 4: Working Drawings and Quantity Schedules", milestones: "Construction-document package issued", responsibleRole: "Project Principal", deliverables: "Working drawings; technical specifications; quantity schedules; Stage-3 sign-off", duration: "4 to 6 weeks" },
    { phase: "Phase 5: Construction Supervision", milestones: "Three quality hold-points (foundation, MEP rough-in, pre-commissioning) observed", responsibleRole: "Senior Resident Engineer", deliverables: "Bi-weekly progress reports; QA hold-point certificates; payment certifications", duration: "Construction period" },
    { phase: "Phase 6: Close-Out", milestones: "As-built drawings, O&M, equipment commissioning, regulatory certificates", responsibleRole: "Project Principal + Project Manager", deliverables: "As-built package; O&M manuals; warranty register; Health Authority licensing pack", duration: "2 to 4 weeks" },
  ];

  if (/water|borehole|hydraulic|sanitary/.test(sector)) return [
    { phase: "Phase 1: Source Investigation", milestones: "Borehole siting / source survey complete; yield tested", responsibleRole: "Hydraulic Lead + Geotechnical Lead", deliverables: "Source identification report; yield test results; quality analysis", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Demand and System Sizing", milestones: "Demand projection, hydraulic model, pump and storage sizing", responsibleRole: "Hydraulic Lead", deliverables: "Hydraulic model (EPANET / WaterCAD); pump curve match; storage sizing memo", duration: "3 to 4 weeks" },
    { phase: "Phase 3: Detailed Design", milestones: "Distribution network, pump station, storage, treatment design coordinated", responsibleRole: "MEP / Sanitary Lead + Structural Lead", deliverables: "Network drawings; pump station drawings; treatment design; specifications", duration: "5 to 8 weeks" },
    { phase: "Phase 4: Tender Documents", milestones: "Quantity schedules, specifications, and tender drawings issued", responsibleRole: "Project Principal", deliverables: "Tender package; works program; design quantity and resource schedule", duration: "3 to 4 weeks" },
    { phase: "Phase 5: Construction Supervision", milestones: "Pipe pressure tests, pump commissioning, leakage check", responsibleRole: "Senior Resident Engineer", deliverables: "Bi-weekly progress reports; commissioning checklists; payment certifications", duration: "Construction period" },
    { phase: "Phase 6: Handover and O&M", milestones: "System commissioned, operator trained, O&M manual issued", responsibleRole: "Project Principal + Hydraulic Lead", deliverables: "Commissioning report; operator training records; O&M manual", duration: "2 to 4 weeks" },
  ];

  if (/road|bridge|highway|pavement|transport/.test(sector)) return [
    { phase: "Phase 1: Survey and Investigation", milestones: "Topographic, geotechnical, and traffic data collected", responsibleRole: "Survey Lead + Geotechnical Lead", deliverables: "Survey drawings; geotechnical report; traffic count and ESAL calculation", duration: "3 to 5 weeks" },
    { phase: "Phase 2: Design", milestones: "Alignment, pavement, drainage, and structures designed", responsibleRole: "Road Design Lead + Structural Lead", deliverables: "Alignment drawings; pavement design; drainage drawings; structures design", duration: "8 to 12 weeks" },
    { phase: "Phase 3: Tender Documents", milestones: "Quantity schedules, specifications, and safety audit complete", responsibleRole: "Project Principal", deliverables: "Tender package; safety audit report; design quantity and resource schedule", duration: "4 to 6 weeks" },
    { phase: "Phase 4: Construction Supervision", milestones: "Materials testing, hold-point inspections, payment certifications", responsibleRole: "Resident Engineer", deliverables: "Materials test reports; progress reports; variation orders; payment certifications", duration: "Construction period" },
    { phase: "Phase 5: Defects Liability", milestones: "Defects rectified; final acceptance certificate issued", responsibleRole: "Project Principal", deliverables: "Defects register; final acceptance report; as-built drawings", duration: "Defects-liability period" },
  ];

  if (/environmental|esia|esmp|safeguard/.test(sector)) return [
    { phase: "Phase 1: Inception and Scoping", milestones: "Inception report; scoping; stakeholder map; safeguard categorisation", responsibleRole: "ESIA Lead", deliverables: "Inception report; scoping document; stakeholder engagement plan", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Baseline Data Collection", milestones: "Physical, biological, and socio-economic baseline complete", responsibleRole: "ESIA Lead + Field Team", deliverables: "Baseline report; field data; consultation records", duration: "4 to 6 weeks" },
    { phase: "Phase 3: Impact Assessment and ESMP", milestones: "Impact matrix, mitigation hierarchy, ESMP, monitoring framework", responsibleRole: "ESIA Lead", deliverables: "Draft ESIA report; ESMP; grievance mechanism design", duration: "4 to 6 weeks" },
    { phase: "Phase 4: Disclosure and Submission", milestones: "Public disclosure; consultation feedback incorporated; final submission", responsibleRole: "ESIA Lead + Stakeholder Engagement Specialist", deliverables: "Final ESIA report; ESMP; donor-standard submission package", duration: "3 to 4 weeks" },
  ];

  if (/ict|software|digital|mis|erp/.test(sector)) return [
    { phase: "Phase 1: Requirements and Architecture", milestones: "Business process review; functional spec; system architecture", responsibleRole: "Solution Architect + Business Analyst", deliverables: "Requirements document; architecture document; security controls plan", duration: "3 to 5 weeks" },
    { phase: "Phase 2: Build and Integration", milestones: "Modules built; integrations developed; security controls implemented", responsibleRole: "Development Lead", deliverables: "Working modules; integration tests; security review", duration: "8 to 16 weeks" },
    { phase: "Phase 3: Testing and Acceptance", milestones: "UAT, security test, performance test all passed", responsibleRole: "Test Lead + Solution Architect", deliverables: "Test reports; defect register closed; UAT sign-off", duration: "3 to 5 weeks" },
    { phase: "Phase 4: Deployment and Go-Live", milestones: "Parallel-run, cutover, data migration validated", responsibleRole: "Implementation Lead", deliverables: "Cutover plan; data validation report; go-live notice", duration: "2 to 4 weeks" },
    { phase: "Phase 5: Stabilisation and Handover", milestones: "Hypercare period; documentation handover; training", responsibleRole: "Support Lead", deliverables: "Handover documentation; training records; SLA-defined support model", duration: "4 to 6 weeks" },
  ];

  if (/urban|master plan|municipal/.test(sector)) return [
    { phase: "Phase 1: Inception and Baseline", milestones: "Inception report; GIS baseline; stakeholder map; survey design", responsibleRole: "Urban Planner Lead", deliverables: "Inception report; GIS baseline layers; stakeholder engagement plan", duration: "3 to 4 weeks" },
    { phase: "Phase 2: Scenarios and Public Consultation", milestones: "Land-use scenarios developed; public consultation events held", responsibleRole: "Urban Planner Lead + Stakeholder Engagement Specialist", deliverables: "Scenario report; consultation records; preferred scenario memo", duration: "5 to 7 weeks" },
    { phase: "Phase 3: Draft Master Plan", milestones: "Strategic land-use map, infrastructure plan, phasing strategy", responsibleRole: "Urban Planner Lead + Infrastructure Lead", deliverables: "Draft master plan; investment framework; phasing schedule", duration: "6 to 9 weeks" },
    { phase: "Phase 4: Disclosure and Adoption", milestones: "Public disclosure; municipal council adoption", responsibleRole: "Urban Planner Lead", deliverables: "Final master plan; implementation roadmap; M&E framework", duration: "3 to 4 weeks" },
  ];

  if (/school|university|campus|education/.test(sector)) return [
    { phase: "Phase 1: Functional Brief", milestones: "Space schedule and pupil-ratio compliance verified", responsibleRole: "Lead Architect + Education Specialist", deliverables: "Functional brief; space schedule; pupil-ratio audit", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Conceptual Design", milestones: "Site plan, climate-responsive concept, accessibility audit", responsibleRole: "Lead Architect", deliverables: "Conceptual drawings; climate-responsive design memo; accessibility audit", duration: "3 to 5 weeks" },
    { phase: "Phase 3: Detailed Design", milestones: "MEP, structural, fire safety coordinated", responsibleRole: "MEP Lead + Structural Lead + Lead Architect", deliverables: "Working drawings; specifications; quantity schedules; Education Authority submission", duration: "6 to 10 weeks" },
    { phase: "Phase 4: Construction Supervision and Handover", milestones: "Materials testing, fire certificate, functional approval", responsibleRole: "Senior Resident Engineer", deliverables: "Progress reports; completion certificate; O&M manuals", duration: "Construction period + close-out" },
  ];

  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(sector)) return [
    { phase: "Phase 1: Demand Analysis and Design Basis", milestones: "Load forecast agreed; grid-code obligations confirmed; site resource data validated", responsibleRole: "Power Systems Lead", deliverables: "Load forecast report; grid-code compliance review; design-basis memorandum", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Engineering Design", milestones: "Load-flow and short-circuit analysis complete; single-line diagram and protection relay coordination signed off", responsibleRole: "Electrical Engineer + Civil/Structural Lead", deliverables: "SLD; load-flow report; protection relay coordination study; SCADA architecture; civil drawings", duration: "6 to 10 weeks" },
    { phase: "Phase 3: Procurement Package", milestones: "Quantity schedules, equipment specifications, and vendor data requirements issued", responsibleRole: "Power Systems Lead + Procurement Specialist", deliverables: "Tender quantity schedules; equipment specs; vendor data requirements matrix; environmental management plan", duration: "3 to 5 weeks" },
    { phase: "Phase 4: Construction Supervision", milestones: "Hold-point inspections at foundation, equipment installation, and pre-energisation", responsibleRole: "Resident Engineer", deliverables: "Progress reports; QA hold-point certificates; commissioning test records", duration: "Construction period" },
    { phase: "Phase 5: Commissioning and Handover", milestones: "Factory acceptance test (FAT); site acceptance test (SAT); energisation; SCADA live", responsibleRole: "Power Systems Lead + Resident Engineer", deliverables: "FAT/SAT protocols; energisation report; O&M manual; operator training records", duration: "4 to 6 weeks" },
  ];

  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(sector)) return [
    { phase: "Phase 1: Hydrological and Agronomic Baseline", milestones: "Flow data analysed; crop-water requirement calculated; WUA status confirmed", responsibleRole: "Hydraulic Engineer + Agronomist", deliverables: "Hydrology report; FAO Penman-Monteith crop-water calculation; WUA readiness memo", duration: "3 to 4 weeks" },
    { phase: "Phase 2: Irrigation Scheme Design", milestones: "Canal or pipe network sized; structure drawings completed; drainage plan prepared", responsibleRole: "Hydraulic Engineer + Structural Lead", deliverables: "Network drawings; structure design; drainage management plan; water-use efficiency targets", duration: "6 to 10 weeks" },
    { phase: "Phase 3: Tender Documents", milestones: "Quantity schedules, specifications, and O&M manual issued", responsibleRole: "Project Principal", deliverables: "Tender quantity schedules; technical specifications; O&M manual; WUA governance framework; farmer training outline", duration: "3 to 4 weeks" },
    { phase: "Phase 4: Construction Supervision and Commissioning", milestones: "Key quality checks: canal lining, structure finishing, gate testing", responsibleRole: "Resident Engineer", deliverables: "Progress reports; material test records; commissioning report; WUA establishment record", duration: "Construction period + 2 weeks close-out" },
  ];

  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(sector)) return [
    { phase: "Phase 1: Resource Assessment and Regulatory Setup", milestones: "Geological mapping and competent-person review complete; JORC reporting scope confirmed", responsibleRole: "Resource Geologist + Geotechnical Lead", deliverables: "Geological report; block-model resource estimate; JORC code compliance checklist; environmental baseline", duration: "4 to 8 weeks" },
    { phase: "Phase 2: Mine Plan and Infrastructure Design", milestones: "Pit design or underground plan prepared; TSF design at MAC/ANCOLD standard; slope-stability analysis complete", responsibleRole: "Mining Engineer + Geotechnical Lead", deliverables: "Mine plan drawings; production schedule; TSF design; slope-stability report (three methods); environmental management plan", duration: "8 to 12 weeks" },
    { phase: "Phase 3: Feasibility Report and Permitting", milestones: "JORC-compliant resource report issued; regulatory submission package prepared", responsibleRole: "Project Principal + Environmental Specialist", deliverables: "Feasibility report; JORC resource statement; quantity schedules; regulatory submission package; closure cost estimate", duration: "4 to 6 weeks" },
    { phase: "Phase 4: Permitting Support and Handover", milestones: "Permit lodgement confirmed; monitoring programme handed over", responsibleRole: "Project Principal", deliverables: "Permit application; geotechnical monitoring programme; instrumentation plan; handover documentation", duration: "4 to 8 weeks" },
  ];

  if (/port|berth|quay|maritime|dredging|harbour/.test(sector)) return [
    { phase: "Phase 1: Met-Ocean and Site Investigation", milestones: "Bathymetric survey, geotechnical investigation, met-ocean data set, and vessel-traffic survey complete", responsibleRole: "Port Engineer + Geotechnical Lead", deliverables: "Bathymetric survey; geotechnical report; met-ocean analysis; vessel-traffic report; nautical simulation summary", duration: "4 to 6 weeks" },
    { phase: "Phase 2: Engineering Design", milestones: "Berth structural design, dredge volume, utilities layout, and ISPS compliance framework prepared", responsibleRole: "Structural Lead + Port Engineer", deliverables: "Berth design drawings; dredge volume and disposal plan; utilities layout; ISPS compliance documentation", duration: "8 to 12 weeks" },
    { phase: "Phase 3: Procurement Package", milestones: "Quantity schedules and equipment specifications (fenders, bollards, crane rails) issued", responsibleRole: "Project Principal", deliverables: "Tender quantity schedules; equipment specifications; environmental management plan; regulatory submission package", duration: "3 to 5 weeks" },
    { phase: "Phase 4: Construction Supervision and Commissioning", milestones: "Hold-points at piling, superstructure, and pre-operations nautical safety review", responsibleRole: "Resident Engineer", deliverables: "Progress reports; QA certificates; ISPS certification support; pre-operations nautical safety review", duration: "Construction period + 2 weeks" },
    { phase: "Phase 5: Handover", milestones: "ISPS certification; O&M manual and emergency procedures issued", responsibleRole: "Project Principal + Port Engineer", deliverables: "O&M manual; emergency procedures; ISPS certificate; as-built drawings", duration: "2 to 4 weeks" },
  ];

  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(sector)) return [
    { phase: "Phase 1: Design Basis and HAZOP", milestones: "Design basis memorandum agreed; P&ID development complete; HAZOP study all action items tracked to close-out", responsibleRole: "Process Lead + HAZOP Facilitator", deliverables: "Design basis memorandum; PFD; P&ID; HAZOP report with action register; LOPA for high-severity nodes", duration: "4 to 8 weeks" },
    { phase: "Phase 2: Detailed Engineering", milestones: "Pipeline stress analysis, equipment layout, civil/structural design complete", responsibleRole: "Process Lead + Civil/Structural Lead", deliverables: "Stress analysis report (Caesar II); equipment layout; civil/structural drawings; cathodic-protection design; environmental management plan", duration: "8 to 14 weeks" },
    { phase: "Phase 3: Procurement Documents", milestones: "Vendor data requirements matrix and quantity schedules issued", responsibleRole: "Project Principal + Procurement Specialist", deliverables: "Vendor data requirements matrix; quantity schedules; technical specifications; regulatory submission package", duration: "3 to 5 weeks" },
    { phase: "Phase 4: Construction Supervision", milestones: "Hold-points at weld inspection, hydrotest, cathodic protection commissioning, and SCADA loop checks", responsibleRole: "Resident Engineer + Process Lead", deliverables: "Progress reports; non-destructive test records; hydrotest report; cathodic-protection commissioning record", duration: "Construction period" },
    { phase: "Phase 5: Commissioning and Handover", milestones: "Pre-commissioning, commissioning, safety system testing, energisation sign-off", responsibleRole: "Process Lead + Resident Engineer", deliverables: "Commissioning procedures; safety system test records; as-built package; ILI programme specification; integrity management plan", duration: "3 to 6 weeks" },
  ];

  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(sector)) return [
    { phase: "Phase 1: Regulatory Gap Analysis and Design", milestones: "Regulatory-gap analysis reviewed by licensed legal counsel; target operating model designed", responsibleRole: "Compliance Lead + Business Analyst", deliverables: "Regulatory gap report; business process maps; target operating model; data-quality assessment", duration: "3 to 5 weeks" },
    { phase: "Phase 2: System Architecture and Integration", milestones: "System architecture and integration design approved; UAT protocol agreed", responsibleRole: "Solution Architect + Development Lead", deliverables: "Architecture document; integration plan (APIs/data migration); UAT protocol; RBAC/encryption/audit-log configuration", duration: "6 to 12 weeks" },
    { phase: "Phase 3: Build and Test", milestones: "Modules built; integration tested; security review passed; UAT completed", responsibleRole: "Development Lead + Test Lead", deliverables: "Working modules; integration test reports; security review; UAT sign-off; defect register closed", duration: "8 to 16 weeks" },
    { phase: "Phase 4: Parallel-Run and Go-Live", milestones: "Data reconciliation signed off; parallel-run validated; cutover executed", responsibleRole: "Implementation Lead", deliverables: "Parallel-run report; data reconciliation report; cutover plan; go-live notice", duration: "3 to 5 weeks" },
    { phase: "Phase 5: Hypercare and Handover", milestones: "SLA monitoring; training complete; source code and data handed over under exit clause", responsibleRole: "Support Lead", deliverables: "Hypercare report; staff training records; handover pack (source code, data, documentation)", duration: "4 to 6 weeks" },
  ];

  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network/.test(sector)) return [
    { phase: "Phase 1: Demand and Coverage Analysis", milestones: "Traffic demand model validated; coverage simulation complete; spectrum licensing pathway confirmed", responsibleRole: "RF Engineer + Spectrum Specialist", deliverables: "Demand forecast; coverage simulation report; spectrum licensing roadmap", duration: "2 to 4 weeks" },
    { phase: "Phase 2: Network Design", milestones: "Base-station siting plan, backhaul design, and network architecture agreed", responsibleRole: "Network Design Lead + RF Engineer", deliverables: "Site acquisition list; backhaul design (fibre/microwave); network architecture document; security controls plan", duration: "5 to 9 weeks" },
    { phase: "Phase 3: Procurement and Site Works", milestones: "Equipment specifications issued; site construction/installation supervised", responsibleRole: "Procurement Specialist + Installation Supervisor", deliverables: "Equipment specifications; site survey reports; installation supervision records", duration: "8 to 20 weeks" },
    { phase: "Phase 4: Commissioning and Acceptance", milestones: "Drive-test and coverage acceptance; SLA baseline established", responsibleRole: "Test Lead + Network Design Lead", deliverables: "Drive-test report; site acceptance test (SAT) records; SLA baseline report", duration: "4 to 6 weeks" },
    { phase: "Phase 5: O&M Handover", milestones: "Operator trained; O&M documentation issued", responsibleRole: "Project Principal + Support Lead", deliverables: "O&M manual; operator training records; network-management platform handover", duration: "2 to 3 weeks" },
  ];

  if (/interior design|fit[-\s]?out|space planning|finishes|joinery/i.test(sector)) return [
    { phase: "Phase 1: Brief & Programming", milestones: "Space programme and adjacency matrix signed off", responsibleRole: "Lead Interior Architect", deliverables: "Functional brief; area schedule; stakeholder workshop record", duration: "1 to 2 weeks" },
    { phase: "Phase 2: Concept & Schematic Design", milestones: "Client approval of concept boards and schematic layouts", responsibleRole: "Interior Designer", deliverables: "Concept boards; floor plans; reflected ceiling plans; partition schedules", duration: "3 to 5 weeks" },
    { phase: "Phase 3: Detailed Design & FF&E Specification", milestones: "Construction documentation issued for contractor tender", responsibleRole: "Lead Interior Architect", deliverables: "Full drawings package; FF&E schedule; quantity schedules; room data sheets", duration: "4 to 6 weeks" },
    { phase: "Phase 4: Construction Administration", milestones: "Shop drawings approved; materials samples signed off", responsibleRole: "Resident Interior Architect", deliverables: "Shop drawing review log; sample approval register; site inspection reports", duration: "Construction period" },
    { phase: "Phase 5: Close-out", milestones: "Snag list cleared; as-built drawings issued", responsibleRole: "Lead Interior Architect", deliverables: "Snagging clearance certificate; as-built drawings; O&M manuals for installed items", duration: "Weeks N to N+4" },
  ];
  if (/construction supervision|resident engineer|site supervision|quality.*inspector/i.test(sector)) return [
    { phase: "Phase 1: Pre-Construction Review", milestones: "Contractor's programme, method statements, ITP and HSMP approved", responsibleRole: "Resident Engineer", deliverables: "Pre-construction review report; baseline photographic survey; mobilisation inspection certificate", duration: "2 to 3 weeks before site start" },
    { phase: "Phase 2: Construction Supervision", milestones: "Hold-point inspections completed at defined stages; NCRs closed within SLA", responsibleRole: "Resident Engineer + Site Inspector", deliverables: "Weekly site reports; hold-point certificates; NCR log; laboratory test certificates", duration: "Construction period" },
    { phase: "Phase 3: Payment Certification", milestones: "Monthly IPCs issued within 14 days of contractor submission", responsibleRole: "Resident Engineer + QS", deliverables: "Interim Payment Certificates; measurement records; cost register", duration: "Monthly during construction" },
    { phase: "Phase 4: Practical Completion & Defects", milestones: "Punch list cleared; DLP inspections completed", responsibleRole: "Resident Engineer", deliverables: "Practical completion certificate; punch list; DLP inspection report; performance bond release recommendation", duration: "Weeks N to N+6 + DLP" },
  ];
  if (/contract administration|FIDIC|variation order|claims management|quantity survey/i.test(sector)) return [
    { phase: "Phase 1: Contract Mobilisation", milestones: "Contract administration manual issued; delegated authority register in place", responsibleRole: "Contract Administrator", deliverables: "CA manual; key-date schedule; contractor mobilisation assessment", duration: "1 to 2 weeks" },
    { phase: "Phase 2: Cost Control & Variation Management", milestones: "Monthly cost reports issued; all VOs agreed before next IPC", responsibleRole: "Contract Administrator + QS", deliverables: "Monthly cost reports; VO log; Engineer's Instructions; contract sum adjustments", duration: "Duration of contract" },
    { phase: "Phase 3: Claims Management", milestones: "EOT determinations issued within 28 days of submission", responsibleRole: "Contract Administrator", deliverables: "EOT analysis; disruption cost assessments; written determinations", duration: "As claims arise" },
    { phase: "Phase 4: Final Account & Closeout", milestones: "Final account agreed; all bonds released", responsibleRole: "Contract Administrator", deliverables: "Final quantity-schedule reconciliation; agreed final account; lessons-learned report", duration: "Weeks N to N+8" },
  ];

  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(sector)) return [
    { phase: "Phase 1: Condition Survey & Assessment", milestones: "Measured survey completed; significance assessment signed off by heritage authority", responsibleRole: "Heritage Conservation Specialist + Structural Engineer", deliverables: "Condition assessment report; significance statement; hazardous-materials survey; conservation philosophy statement", duration: "2 to 4 weeks" },
    { phase: "Phase 2: Conservation Plan & Design", milestones: "Conservation plan approved; structural and material interventions agreed", responsibleRole: "Lead Heritage Architect", deliverables: "Conservation plan; restoration drawings; MEP upgrade design; reversible-material specification", duration: "6 to 10 weeks" },
    { phase: "Phase 3: Regulatory Approvals & Tender Documents", milestones: "Heritage authority approval certificate obtained; tender package issued", responsibleRole: "Lead Heritage Architect", deliverables: "Full tender package (drawings, specs, quantity schedules, conservation method statements); approval certificate; stakeholder consultation records", duration: "4 to 6 weeks" },
    { phase: "Phase 4: Conservation Works Supervision", milestones: "Material-sample approvals; three hold-point inspections completed", responsibleRole: "Resident Heritage Architect + Structural Inspector", deliverables: "Supervision reports; NCR register; photographic record; progress reports; payment certifications", duration: "Construction period" },
    { phase: "Phase 5: Completion & Handover", milestones: "As-built drawings completed; maintenance manual issued; handover to cultural authority", responsibleRole: "Heritage Conservation Specialist", deliverables: "As-built conservation drawings; before/after photographic archive; updated condition report; maintenance manual; completion certificate", duration: "2 to 4 weeks" },
  ];

  if (/industrial|manufactur|factory|abattoir|processing.*plant|warehouse.*industrial/i.test(sector)) return [
    { phase: "Phase 1: Feasibility & Process Brief", milestones: "Production process flow diagram agreed; utility demand confirmed; site suitability report signed", responsibleRole: "Project Principal + Process Specialist", deliverables: "Feasibility study; process flow diagram; utility demand assessment; preliminary layout", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Detailed Design", milestones: "Architectural/structural/MEP design package coordinated; environmental pre-approval check", responsibleRole: "Lead Structural Engineer + MEP Engineers", deliverables: "Full design package; industrial flooring spec; HVAC/exhaust ventilation; fire suppression layout; hazardous-materials management plan", duration: "6 to 12 weeks" },
    { phase: "Phase 3: Regulatory & Environmental Approvals", milestones: "Environmental permit application submitted; EIA/ESIA completed if required", responsibleRole: "Environmental Lead", deliverables: "Environmental permit application; effluent treatment design; waste management plan; occupational safety assessment", duration: "4 to 8 weeks" },
    { phase: "Phase 4: Tender Documents", milestones: "Quantity schedules, specifications, and equipment schedule issued", responsibleRole: "Project Principal", deliverables: "Tender package; equipment procurement list; FAT requirements; works programme", duration: "3 to 5 weeks" },
    { phase: "Phase 5: Construction Supervision & Commissioning", milestones: "Structural hold-point inspections; process commissioning passed; operator training complete", responsibleRole: "Resident Engineer", deliverables: "Progress reports; QA records; commissioning test protocols; operator training records; as-built drawings", duration: "Construction period + 4 weeks" },
  ];

  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|basement.*podium/i.test(sector)) return [
    { phase: "Phase 1: Feasibility & Concept", milestones: "Structural system selected; vertical transport concept agreed; preliminary quantity schedules produced", responsibleRole: "Lead Architect + Structural Lead", deliverables: "Massing study; floor-plate efficiency analysis; structural system selection memo; preliminary quantity schedules", duration: "2 to 4 weeks" },
    { phase: "Phase 2: Structural & Architectural Design", milestones: "ETABS/SAP2000 analysis complete; shear wall, core, and foundation design signed off", responsibleRole: "Lead Structural Engineer + Architect", deliverables: "Full architectural drawings; structural analysis report; foundation design; seismic/wind load compliance memo", duration: "8 to 14 weeks" },
    { phase: "Phase 3: MEP & Specialist Systems", milestones: "MEP design coordinated; fire, BMS, lift systems specified", responsibleRole: "MEP Engineers + Lift Specialist", deliverables: "MEP design package; fire alarm/suppression; BMS architecture; lift/car-lift system design; generator/UPS sizing; curtain-wall specification", duration: "6 to 10 weeks" },
    { phase: "Phase 4: Regulatory Approvals & Tender Documents", milestones: "Structural calculations submitted to authority; tender package issued", responsibleRole: "Lead Engineer + QS", deliverables: "Structural calculation package; full tender package (drawings, quantity schedules, specs); bid evaluation report", duration: "4 to 6 weeks" },
    { phase: "Phase 5: Construction Supervision", milestones: "Foundation, shear wall, and curtain wall hold-point inspections; lift acceptance test", responsibleRole: "Resident Engineer + Structural Inspector", deliverables: "Progress reports; concrete-test certificates; curtain-wall inspection reports; lift acceptance test; as-built drawings", duration: "Construction period" },
  ];

  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(sector)) return [
    { phase: "Phase 1: Concept & Feasibility", milestones: "Development programme agreed; feasibility assessment produced; concept design approved", responsibleRole: "Lead Architect + Project Principal", deliverables: "Feasibility study; development programme (room mix, F&B, BOH); concept design; preliminary quantity schedules", duration: "2 to 4 weeks" },
    { phase: "Phase 2: Design Development", milestones: "Full architectural design completed; interior design concept and FF&E schedule agreed", responsibleRole: "Lead Architect + Interior Designer", deliverables: "Architectural drawings (all floors, public areas, BOH); interior concept; FF&E schedule; brand-standard compliance checklist", duration: "6 to 12 weeks" },
    { phase: "Phase 3: MEP & Specialist Systems", milestones: "MEP package coordinated; kitchen/pool/spa mechanical complete", responsibleRole: "MEP Engineers", deliverables: "MEP package; HVAC for guestrooms; kitchen ventilation; pool/spa mechanical; AV and guest-technology design; access-control system", duration: "5 to 8 weeks" },
    { phase: "Phase 4: Tender Documents & Procurement", milestones: "Tender package issued; FF&E procurement schedule produced; brand sign-off obtained", responsibleRole: "Lead Architect + QS", deliverables: "Tender package (drawings, quantity schedules, specs); FF&E procurement schedule; brand-operator sign-off", duration: "3 to 5 weeks" },
    { phase: "Phase 5: Construction Supervision & Pre-Opening", milestones: "Room-by-room snagging complete; MEP commissioning passed; punch list cleared", responsibleRole: "Resident Engineer + Interior Architect", deliverables: "Progress reports; FF&E delivery inspection; MEP commissioning tests; mock-room inspection; pre-opening punch list; handover pack", duration: "Construction period + 6 weeks" },
  ];

  if (/geotech|soil.*invest|borehole.*programme|site.*invest|subsoil.*invest|ground.*invest/i.test(sector)) return [
    { phase: "Phase 1: Desk Study & Mobilisation", milestones: "Desk study complete; borehole programme approved by client; drilling rig mobilised", responsibleRole: "Principal Geotechnical Engineer", deliverables: "Desk study report; borehole location plan; drilling programme; laboratory accreditation confirmation", duration: "1 to 2 weeks" },
    { phase: "Phase 2: Field Investigation", milestones: "All boreholes/trial pits completed; SPT tests performed; samples extracted and dispatched to laboratory", responsibleRole: "Senior Geotechnical Engineer + Driller", deliverables: "Borehole logs; SPT records; sample dispatch records; field groundwater monitoring readings; soil profile sketch", duration: "2 to 6 weeks" },
    { phase: "Phase 3: Laboratory Testing", milestones: "Index, shear-strength, and compaction tests complete; results reviewed against acceptance criteria", responsibleRole: "Laboratory Manager + Geotechnical Engineer", deliverables: "Laboratory test certificates (grain size, Atterberg, UCS/triaxial, CBR, compaction); groundwater quality analysis if required", duration: "2 to 4 weeks" },
    { phase: "Phase 4: Analysis & Interpretation", milestones: "Bearing capacity and settlement analyses completed; foundation type recommended; peer review complete", responsibleRole: "Principal Geotechnical Engineer", deliverables: "Bearing capacity and settlement calculations; liquefaction assessment; slope-stability analysis (if applicable); interpreted soil profile; foundation recommendation summary", duration: "1 to 2 weeks" },
    { phase: "Phase 5: Report Preparation & Issue", milestones: "Draft report reviewed by independent senior engineer; final report issued to client", responsibleRole: "Principal Geotechnical Engineer", deliverables: "Geotechnical investigation report (executive summary, borehole logs, laboratory results, interpreted profile, foundation recommendations); peer-review sign-off certificate", duration: "1 to 2 weeks" },
  ];
  return [
    { phase: "Phase 1: Inception", milestones: "Inception report; scope confirmation; stakeholder map", responsibleRole: "Project Manager", deliverables: "Inception report; work plan; communication plan", duration: "1 to 2 weeks" },
    { phase: "Phase 2: Analysis and Design", milestones: "Substantive deliverable produced; client review", responsibleRole: "Discipline Leads", deliverables: "Draft deliverable; review record; revised deliverable", duration: "4 to 8 weeks" },
    { phase: "Phase 3: Implementation Support", milestones: "Implementation milestones met; progress reporting", responsibleRole: "Project Manager + Discipline Leads", deliverables: "Progress reports; intermediate deliverables; quality hold-points", duration: "Engagement period" },
    { phase: "Phase 4: Close-Out", milestones: "Final deliverable accepted; handover complete", responsibleRole: "Project Manager", deliverables: "Final deliverable; handover documentation; close-out report", duration: "2 to 3 weeks" },
  ];
}

export function buildWorkPlanTable(opts: { primarySector: string }): string {
  const phases = phasesForSector(opts.primarySector);
  const rows = phases.map((p) => `| ${escCell(p.phase)} | ${escCell(p.milestones)} | ${escCell(p.responsibleRole)} | ${escCell(p.deliverables)} | ${escCell(p.duration)} |`);

  return [
    "## C.6 Work Plan and Schedule",
    `Phased work plan tied to milestones, responsible expert roles, deliverables, and indicative duration. Each phase has a documented hand-off and a written sign-off requirement before the next phase commences.`,
    "",
    "| Phase | Milestone | Responsible Role | Deliverables | Indicative Duration |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
