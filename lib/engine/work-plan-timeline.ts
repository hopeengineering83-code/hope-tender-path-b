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
    { phase: "Phase 4: Working Drawings + BOQ", milestones: "Construction-document package issued", responsibleRole: "Project Principal", deliverables: "Working drawings; technical specifications; BOQ; Stage-3 sign-off", duration: "4 to 6 weeks" },
    { phase: "Phase 5: Construction Supervision", milestones: "Three quality hold-points (foundation, MEP rough-in, pre-commissioning) observed", responsibleRole: "Senior Resident Engineer", deliverables: "Bi-weekly progress reports; QA hold-point certificates; payment certifications", duration: "Construction period" },
    { phase: "Phase 6: Close-Out", milestones: "As-built drawings, O&M, equipment commissioning, regulatory certificates", responsibleRole: "Project Principal + Project Manager", deliverables: "As-built package; O&M manuals; warranty register; Health Authority licensing pack", duration: "2 to 4 weeks" },
  ];

  if (/water|borehole|hydraulic|sanitary/.test(sector)) return [
    { phase: "Phase 1: Source Investigation", milestones: "Borehole siting / source survey complete; yield tested", responsibleRole: "Hydraulic Lead + Geotechnical Lead", deliverables: "Source identification report; yield test results; quality analysis", duration: "2 to 3 weeks" },
    { phase: "Phase 2: Demand and System Sizing", milestones: "Demand projection, hydraulic model, pump and storage sizing", responsibleRole: "Hydraulic Lead", deliverables: "Hydraulic model (EPANET / WaterCAD); pump curve match; storage sizing memo", duration: "3 to 4 weeks" },
    { phase: "Phase 3: Detailed Design", milestones: "Distribution network, pump station, storage, treatment design coordinated", responsibleRole: "MEP / Sanitary Lead + Structural Lead", deliverables: "Network drawings; pump station drawings; treatment design; specifications", duration: "5 to 8 weeks" },
    { phase: "Phase 4: Tender Documents", milestones: "BOQ, specifications, and tender drawings issued", responsibleRole: "Project Principal", deliverables: "Tender package; works program; cost estimate", duration: "3 to 4 weeks" },
    { phase: "Phase 5: Construction Supervision", milestones: "Pipe pressure tests, pump commissioning, leakage check", responsibleRole: "Senior Resident Engineer", deliverables: "Bi-weekly progress reports; commissioning checklists; payment certifications", duration: "Construction period" },
    { phase: "Phase 6: Handover and O&M", milestones: "System commissioned, operator trained, O&M manual issued", responsibleRole: "Project Principal + Hydraulic Lead", deliverables: "Commissioning report; operator training records; O&M manual", duration: "2 to 4 weeks" },
  ];

  if (/road|bridge|highway|pavement|transport/.test(sector)) return [
    { phase: "Phase 1: Survey and Investigation", milestones: "Topographic, geotechnical, and traffic data collected", responsibleRole: "Survey Lead + Geotechnical Lead", deliverables: "Survey drawings; geotechnical report; traffic count and ESAL calculation", duration: "3 to 5 weeks" },
    { phase: "Phase 2: Design", milestones: "Alignment, pavement, drainage, and structures designed", responsibleRole: "Road Design Lead + Structural Lead", deliverables: "Alignment drawings; pavement design; drainage drawings; structures design", duration: "8 to 12 weeks" },
    { phase: "Phase 3: Tender Documents", milestones: "BOQ, specifications, and safety audit complete", responsibleRole: "Project Principal", deliverables: "Tender package; safety audit report; cost estimate", duration: "4 to 6 weeks" },
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
    { phase: "Phase 3: Detailed Design", milestones: "MEP, structural, fire safety coordinated", responsibleRole: "MEP Lead + Structural Lead + Lead Architect", deliverables: "Working drawings; specifications; BOQ; Education Authority submission", duration: "6 to 10 weeks" },
    { phase: "Phase 4: Construction Supervision and Handover", milestones: "Materials testing, fire certificate, functional approval", responsibleRole: "Senior Resident Engineer", deliverables: "Progress reports; completion certificate; O&M manuals", duration: "Construction period + close-out" },
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
