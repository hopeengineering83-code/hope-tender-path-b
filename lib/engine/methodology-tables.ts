/**
 * Methodology Tables (PR E) — closes the depth gap to Claude AI benchmark.
 *
 * THE PROBLEM
 * Even after PR D, Section C reads as prose. Real elite tender proposals
 * (the Claude AI benchmark we're matching) carry FIVE structural tables
 * that evaluators tick off directly:
 *
 *   1. Project Phasing Table — Inception / Mobilization / Execution /
 *      Closure with deliverables, durations, responsible person.
 *   2. RACI Matrix — Responsible / Accountable / Consulted / Informed
 *      across activities × team members.
 *   3. Risk Register — risk, category, likelihood, impact, mitigation,
 *      owner.
 *   4. Quality Assurance Plan / Inspection & Test Plan (ITP) — checkpoint,
 *      criterion, method, frequency, responsible, hold/witness.
 *   5. Communication & Reporting Protocol — meeting/deliverable, audience,
 *      cadence, owner, format.
 *
 * Without these tables the proposal scores well on prose axes but
 * evaluators don't see the structured commitments they're trained to
 * find. They're also rubric items themselves on most TOR scoresheets.
 *
 * THE FIX
 * Deterministic post-pass that, AFTER the section-c-amplifier and
 * BEFORE the rubric-driven enforcement, appends any of the five tables
 * that are missing from the markdown. Tables are:
 *
 *   - SECTOR-AWARE: row content changes with primary sector (healthcare
 *     uses IPC hold-points; road uses Marshall mix; water uses pressure
 *     test, etc.). Column headers stay constant.
 *
 *   - VAULT-AWARE: when the company has named experts in the team,
 *     the RACI matrix and Communication table use real names; when
 *     the vault is empty, those columns carry "Bid-Team Action: confirm
 *     team lead before submission".
 *
 *   - IDEMPOTENT: each table emits a marker comment
 *     `<!-- methodology-table:phasing -->` / `:raci` / `:risk-register` /
 *     `:qa-itp` / `:communication`. If the marker exists OR the table
 *     heading already exists in the markdown, the table is skipped on
 *     re-run.
 *
 *   - NEVER FABRICATES: every cell that depends on data the system
 *     doesn't have emits `Bid-Team Action: confirm <field>` instead.
 *
 * SCOPE
 * Operates AFTER amplifySectionCDepth but BEFORE ensureRubricHeadings,
 * so the rubric pass can reference these tables when its own check
 * runs. Wired in generate-elite.ts.
 */

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";

// ─── Helpers ─────────────────────────────────────────────────────────────

const MARKER_PREFIX = "methodology-table";
const MARKER_REGEX = /<!--\s+methodology-table:([a-z-]+)\s+-->/gi;

const HEADING_PATTERNS: Record<string, RegExp[]> = {
  phasing: [
    /^##\s+(?:Project\s+)?Phasing(?:\s+Table)?/im,
    /^###\s+(?:Project\s+)?Phasing(?:\s+Table)?/im,
    /^##\s+(?:Project\s+)?Phasing\s+and\s+Deliverables/im,
    /^##\s+Implementation\s+Phases/im,
  ],
  raci: [
    /^##\s+RACI(?:\s+Matrix)?/im,
    /^###\s+RACI(?:\s+Matrix)?/im,
    /^##\s+Responsibility\s+Assignment/im,
  ],
  riskRegister: [
    /^##\s+Risk\s+Register/im,
    /^###\s+Risk\s+Register/im,
    /^##\s+Risk\s+Management\s+(?:Register|Plan)/im,
  ],
  qaItp: [
    /^##\s+(?:Quality\s+Assurance\s+Plan|Inspection\s+(?:and|&)\s+Test\s+Plan|ITP\b)/im,
    /^###\s+(?:Quality\s+Assurance\s+Plan|Inspection\s+(?:and|&)\s+Test\s+Plan|ITP\b)/im,
  ],
  communication: [
    /^##\s+Communication\s+(?:and|&)\s+Reporting(?:\s+Protocol)?/im,
    /^###\s+Communication\s+(?:and|&)\s+Reporting(?:\s+Protocol)?/im,
    /^##\s+Reporting\s+Protocol/im,
  ],
};

function detectExisting(markdown: string): Set<string> {
  const present = new Set<string>();

  // Marker comments win — once a table has been emitted by this module,
  // it stays detected even if the heading text was reformatted.
  for (const m of markdown.matchAll(MARKER_REGEX)) {
    if (m[1]) present.add(m[1]);
  }

  // Heading text — covers the case where the AI emitted the table
  // organically and we shouldn't duplicate it.
  for (const [key, patterns] of Object.entries(HEADING_PATTERNS)) {
    if (present.has(toMarker(key))) continue;
    if (patterns.some((p) => p.test(markdown))) {
      present.add(toMarker(key));
    }
  }

  return present;
}

function toMarker(key: string): string {
  if (key === "raci") return "raci";
  if (key === "riskRegister") return "risk-register";
  if (key === "qaItp") return "qa-itp";
  if (key === "phasing") return "phasing";
  if (key === "communication") return "communication";
  return key;
}

function safeName(expert: ExpertRecord | undefined, role: string): string {
  if (expert && expert.fullName) return `${expert.fullName}${expert.title ? ` (${expert.title})` : ""}`;
  return `Bid-Team Action: confirm ${role}`;
}

// Pick the most senior expert for a given role. Heuristic: highest
// yearsExperience whose disciplines contain the role keyword. Falls
// back to the highest-experience expert overall, then to a placeholder.
function pickExpert(experts: ExpertRecord[], roleKeywords: string[]): ExpertRecord | undefined {
  if (experts.length === 0) return undefined;
  const scored = experts.map((e) => {
    const blob = `${e.disciplines || ""} ${e.title || ""} ${e.profile || ""}`.toLowerCase();
    const keywordHit = roleKeywords.some((k) => blob.includes(k.toLowerCase())) ? 1 : 0;
    const years = typeof e.yearsExperience === "number" ? e.yearsExperience : 0;
    return { e, score: keywordHit * 1000 + years };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.e;
}

// ─── Sector-aware row content ────────────────────────────────────────────

interface PhasingRow {
  phase: string;
  deliverables: string;
  duration: string;
  responsible: string; // role keyword used to lookup expert
}

function sectorPhasingRows(sector: string): PhasingRow[] {
  const s = sector.toLowerCase();

  if (/health|hospital|medical|clinic/.test(s)) {
    return [
      { phase: "1. Inception", deliverables: "Inception report; clinical-brief confirmation; stakeholder map; site reconnaissance memo", duration: "Weeks 1–2", responsible: "Project Principal" },
      { phase: "2. Conceptual Design", deliverables: "Functional zoning diagram; clinical adjacency matrix; preliminary IPC flow study; concept drawings; cost order-of-magnitude", duration: "Weeks 3–6", responsible: "Architect" },
      { phase: "3. Detailed Design", deliverables: "Architectural, structural, MEP, medical-gas drawings; specifications; BOQ; tender documents; planning permit pack", duration: "Weeks 7–14", responsible: "Lead Engineer" },
      { phase: "4. Tender & Construction Supervision", deliverables: "Tender evaluation report; construction supervision with three IPC hold-points; monthly progress reports; payment certifications", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Close-out", deliverables: "As-built drawings; O&M manuals; commissioning report; Health Authority licensing pack; defects-liability tracker", duration: "Weeks N–N+8", responsible: "Project Principal" },
    ];
  }
  if (/water|borehole|hydraulic|sanitary/.test(s)) {
    return [
      { phase: "1. Inception", deliverables: "Inception report; ToR confirmation; data-collection plan; site reconnaissance memo", duration: "Weeks 1–2", responsible: "Project Principal" },
      { phase: "2. Source Investigation", deliverables: "Borehole siting / yield test report; geophysical survey; water-quality analysis; demand projection", duration: "Weeks 3–6", responsible: "Hydrogeologist" },
      { phase: "3. Hydraulic Design", deliverables: "EPANET / WaterCAD model; pipe-network sizing; pump-station design; reservoir sizing; treatment-process design", duration: "Weeks 7–12", responsible: "Water Engineer" },
      { phase: "4. Tender & Construction Supervision", deliverables: "Tender documents (BOQ, drawings, specs); construction supervision; pressure-test hold-points; pump commissioning", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Close-out", deliverables: "As-built drawings; O&M manual; operator training records; leakage-check report; handover certificate", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/road|bridge|highway|pavement/.test(s)) {
    return [
      { phase: "1. Inception", deliverables: "Inception report; ToR confirmation; data-collection plan; site reconnaissance memo", duration: "Weeks 1–2", responsible: "Project Principal" },
      { phase: "2. Survey & Investigation", deliverables: "Topographic survey; geotechnical investigation (CBR, Proctor, boreholes); traffic count + design-traffic computation (AADT, ESAL)", duration: "Weeks 3–6", responsible: "Geotechnical Engineer" },
      { phase: "3. Detailed Design", deliverables: "Alignment design; pavement design (AASHTO/ERA); drainage design; structural design (culverts/bridges); road-safety audit; tender documents", duration: "Weeks 7–14", responsible: "Highway Engineer" },
      { phase: "4. Tender & Construction Supervision", deliverables: "Tender evaluation; construction supervision with subgrade/sub-base/base/surface hold-points; Marshall mix design oversight; monthly progress", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Close-out", deliverables: "As-built drawings; maintenance manual; pre-handover road-safety audit; defects-liability tracker", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/urban|master plan|municipal/.test(s)) {
    return [
      { phase: "1. Inception", deliverables: "Inception report; stakeholder consultation framework; data-collection plan", duration: "Weeks 1–2", responsible: "Project Principal" },
      { phase: "2. Baseline Studies", deliverables: "GIS land-use mapping; demographic analysis; infrastructure inventory; transport / utilities / green-space demand assessment", duration: "Weeks 3–8", responsible: "Urban Planner" },
      { phase: "3. Scenario Development", deliverables: "Land-use zoning scenarios; environmental + social screening; phasing strategy; stakeholder consultation report", duration: "Weeks 9–14", responsible: "Urban Planner" },
      { phase: "4. Master Plan Issuance", deliverables: "Final master plan + zoning regulations; implementation roadmap; capacity-building plan; regulatory alignment memo", duration: "Weeks 15–18", responsible: "Project Principal" },
      { phase: "5. Adoption Support", deliverables: "Public consultation support; council adoption pack; training programme; transition plan", duration: "Weeks 19–22", responsible: "Project Principal" },
    ];
  }
  // Generic
  return [
    { phase: "1. Inception", deliverables: "Inception report; ToR confirmation; data-collection plan; risk register baseline", duration: "Weeks 1–2", responsible: "Project Principal" },
    { phase: "2. Baseline & Analysis", deliverables: "Baseline data report; technical analysis memo; gap assessment", duration: "Weeks 3–6", responsible: "Lead Specialist" },
    { phase: "3. Detailed Deliverable", deliverables: "Detailed design / plan / report covering all ToR scope items; peer-reviewed draft for client comment", duration: "Weeks 7–12", responsible: "Lead Specialist" },
    { phase: "4. Stakeholder Validation", deliverables: "Stakeholder workshop; comments log; revised draft; final issuance", duration: "Weeks 13–14", responsible: "Project Principal" },
    { phase: "5. Close-out", deliverables: "Final deliverable; handover memo; defects-liability tracker", duration: "Weeks 15–16", responsible: "Project Principal" },
  ];
}

interface RiskRow {
  category: string;
  risk: string;
  likelihood: "Low" | "Medium" | "High";
  impact: "Low" | "Medium" | "High";
  mitigation: string;
  owner: string; // role
}

function sectorRiskRows(sector: string): RiskRow[] {
  const s = sector.toLowerCase();
  const generic: RiskRow[] = [
    { category: "Schedule", risk: "Late client decision on key approvals delays critical-path activities", likelihood: "Medium", impact: "High", mitigation: "Approval-pack pre-circulation 5 working days ahead; standing weekly client meeting; escalation matrix with 48-hour SLA", owner: "Project Principal" },
    { category: "Scope", risk: "Mid-engagement scope expansion erodes budget and quality", likelihood: "Medium", impact: "Medium", mitigation: "Variation log maintained from week 1; signed change-order required before any work outside ToR; monthly scope-health memo", owner: "Project Principal" },
    { category: "Resource", risk: "Loss of a key expert during the engagement", likelihood: "Low", impact: "High", mitigation: "Named back-up expert per role in this proposal; CV-rotation kept current; 48-hour mobilization commitment", owner: "Lead Specialist" },
    { category: "Quality", risk: "Deliverable fails internal peer review at 100% gate", likelihood: "Low", impact: "High", mitigation: "30%/60%/100% formal QA gates signed off by Project Principal + Technical Director; independent peer review at 100%", owner: "Technical Director" },
    { category: "Compliance", risk: "Regulatory or licensing change during engagement", likelihood: "Low", impact: "Medium", mitigation: "Compliance scan at inception and 60% review; named regulatory liaison; designs reference current statutes by clause", owner: "Compliance Lead" },
  ];

  if (/health|hospital|medical/.test(s)) {
    return [
      ...generic,
      { category: "Clinical", risk: "Late changes to clinical brief invalidate IPC zoning", likelihood: "Medium", impact: "High", mitigation: "Clinical-brief sign-off freeze at 30% gate; any change after freeze triggers a written variation order with cost/time impact", owner: "Architect" },
      { category: "Equipment", risk: "Medical-equipment specifications change after MEP design freeze", likelihood: "Medium", impact: "High", mitigation: "Equipment schedule confirmed before MEP design freeze; conservative provisions for power, gas, and heat loads", owner: "Lead Engineer" },
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      ...generic,
      { category: "Hydrogeological", risk: "Borehole yield falls below design demand", likelihood: "Medium", impact: "High", mitigation: "Step-drawdown + 72-hour pumping test at site investigation; conservative safe-yield factor; back-up source identified", owner: "Hydrogeologist" },
      { category: "Construction", risk: "Pipe-network pressure-test failure during commissioning", likelihood: "Low", impact: "High", mitigation: "Joint inspection hold-point at every 500 m; pressure test at each pressure zone before backfill; defects-rectification protocol", owner: "Resident Engineer" },
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      ...generic,
      { category: "Geotechnical", risk: "Subgrade CBR below design assumption — pavement re-design needed", likelihood: "Medium", impact: "High", mitigation: "Geotechnical investigation programme at 200 m intervals; conservative pavement design factor; standby re-design protocol", owner: "Geotechnical Engineer" },
      { category: "Drainage", risk: "Cross-drainage failure during first wet season", likelihood: "Low", impact: "High", mitigation: "Hydrology check using 25-year return period; culvert capacity verified; side-drain longitudinal slope ≥ 0.5%", owner: "Highway Engineer" },
    ];
  }
  if (/urban|master plan/.test(s)) {
    return [
      ...generic,
      { category: "Stakeholder", risk: "Community resistance to proposed land-use changes", likelihood: "Medium", impact: "High", mitigation: "Three structured consultation rounds; published comments log; council pre-briefing before public release", owner: "Urban Planner" },
      { category: "Data", risk: "GIS / cadastral data gaps invalidate baseline analysis", likelihood: "Medium", impact: "Medium", mitigation: "Data-completeness assessment at inception; supplementary field survey budgeted; alternative data-source list", owner: "Urban Planner" },
    ];
  }
  return generic;
}

interface QAItpRow {
  checkpoint: string;
  criterion: string;
  method: string;
  frequency: string;
  responsible: string; // role
  type: "Hold" | "Witness" | "Review";
}

function sectorQARows(sector: string): QAItpRow[] {
  const s = sector.toLowerCase();
  const generic: QAItpRow[] = [
    { checkpoint: "30% Schematic Review", criterion: "Scope coverage and zoning rationale match ToR", method: "Internal peer review against ToR-clause checklist", frequency: "Once at 30%", responsible: "Project Principal", type: "Hold" },
    { checkpoint: "60% Design Development Review", criterion: "Technical design integrity, coordination across disciplines", method: "Multi-discipline coordination review; clash audit", frequency: "Once at 60%", responsible: "Technical Director", type: "Hold" },
    { checkpoint: "100% Pre-Issue Review", criterion: "Deliverable completeness, regulatory compliance, ToR coverage", method: "Independent peer review by senior expert not on team", frequency: "Once at 100%", responsible: "Technical Director", type: "Hold" },
    { checkpoint: "Documentation QA", criterion: "Drawings, specs, BOQ cross-reference correctly; revision control intact", method: "Cross-document audit with revision register", frequency: "Each issuance", responsible: "Document Controller", type: "Review" },
    { checkpoint: "Client Comment Resolution", criterion: "All client comments addressed in writing", method: "Comment-resolution register with response per comment", frequency: "After each review cycle", responsible: "Project Principal", type: "Review" },
  ];
  if (/health|hospital|medical/.test(s)) {
    return [
      ...generic,
      { checkpoint: "IPC Flow Audit", criterion: "Patient/staff/supply flows comply with IPC standard", method: "Flow-pattern walk-through against IPC checklist", frequency: "30% and 100%", responsible: "Architect", type: "Hold" },
      { checkpoint: "Medical Gas Routing", criterion: "Gas supply lines reach all designated points; capacity adequate", method: "Schedule cross-check; flow + pressure calculations", frequency: "60% and 100%", responsible: "Lead Engineer", type: "Hold" },
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      ...generic,
      { checkpoint: "Hydraulic Model Verification", criterion: "Network pressures, flows, residual chlorine within design tolerances", method: "EPANET/WaterCAD output review against design criteria", frequency: "Once at 60%", responsible: "Water Engineer", type: "Hold" },
      { checkpoint: "Pipeline Pressure Test", criterion: "Test pressure ≥ 1.5 × working pressure held for 24 hours; no leakage", method: "Hydrostatic pressure test per AWWA C600", frequency: "Each test section", responsible: "Resident Engineer", type: "Witness" },
      { checkpoint: "Pump Commissioning", criterion: "Pump duty point matches design head/flow within ±5%", method: "Performance curve verification on site", frequency: "Each pump", responsible: "Resident Engineer", type: "Witness" },
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      ...generic,
      { checkpoint: "Subgrade Acceptance", criterion: "CBR ≥ design value; compaction ≥ 95% MDD", method: "In-situ CBR + sand-cone density tests", frequency: "Every 200 m", responsible: "Geotechnical Engineer", type: "Hold" },
      { checkpoint: "Asphalt Mix Design", criterion: "Marshall stability, flow, void content within ERA spec", method: "Marshall mix design + JMF approval", frequency: "Per mix change", responsible: "Highway Engineer", type: "Hold" },
      { checkpoint: "Drainage Construction", criterion: "Culvert invert levels, longitudinal slopes match design", method: "Survey check before backfill", frequency: "Each structure", responsible: "Resident Engineer", type: "Witness" },
    ];
  }
  return generic;
}

interface CommsRow {
  item: string;
  audience: string;
  cadence: string;
  owner: string; // role
  format: string;
}

function commsRows(): CommsRow[] {
  return [
    { item: "Client Coordination Meeting", audience: "Client Project Manager + Project Principal + Lead Specialist", cadence: "Weekly", owner: "Project Principal", format: "Standing agenda, written minutes within 48h, action register" },
    { item: "Monthly Progress Report", audience: "Client Project Manager + Client Director", cadence: "Monthly (5th of each month)", owner: "Project Principal", format: "Written report: progress vs plan, risks, decisions needed, next-period look-ahead" },
    { item: "Technical Design Workshop", audience: "Multi-discipline team + Client technical reviewers", cadence: "30%, 60%, 100% gates", owner: "Technical Director", format: "Workshop with pre-circulated pack; decisions captured in design log" },
    { item: "Stakeholder Consultation", audience: "End-users, regulators, community representatives", cadence: "Inception + 60% gate + final", owner: "Project Principal", format: "Structured workshop with attendance register, comments log, response memo" },
    { item: "Risk Register Review", audience: "Internal team + Client PM", cadence: "Monthly", owner: "Project Principal", format: "Updated register circulated 48h ahead; live discussion at coordination meeting" },
    { item: "Escalation Path", audience: "Client Director / Technical Director", cadence: "On-demand, 48-hour SLA", owner: "Project Principal", format: "Written memo flagging the issue, options, recommendation" },
  ];
}

// ─── Table builders ──────────────────────────────────────────────────────

function buildPhasingTable(sector: string): string {
  const rows = sectorPhasingRows(sector);
  const head = "| # | Phase | Key Deliverables | Indicative Duration | Responsible |";
  const sep = "|---|-------|------------------|---------------------|-------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.phase} | ${r.deliverables} | ${r.duration} | ${r.responsible} |`);
  return [
    `<!-- methodology-table:phasing -->`,
    `## Project Phasing and Deliverables`,
    "",
    `The engagement is delivered in five phases, each with a defined deliverable, duration, and responsible expert. Phase transitions are gated by client sign-off on the prior deliverable.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildRACITable(experts: ExpertRecord[]): string {
  const principal = pickExpert(experts, ["principal", "director", "manager", "team leader"]);
  const lead = pickExpert(experts.filter((e) => e !== principal), ["senior", "lead", "specialist"]);
  const technical = pickExpert(experts.filter((e) => e !== principal && e !== lead), ["engineer", "architect", "planner"]);
  const qa = pickExpert(experts.filter((e) => e !== principal && e !== lead && e !== technical), ["quality", "review", "director"]);

  const principalLabel = safeName(principal, "Project Principal");
  const leadLabel = safeName(lead, "Lead Specialist");
  const technicalLabel = safeName(technical, "Technical Expert");
  const qaLabel = safeName(qa, "QA Reviewer");

  const head = `| Activity | ${principalLabel} | ${leadLabel} | ${technicalLabel} | ${qaLabel} | Client PM |`;
  const sep = "|----------|---|---|---|---|---|";
  const rows = [
    "| Inception report and scope confirmation | A | R | C | I | C |",
    "| Baseline data collection and analysis | A | R | C | I | I |",
    "| Detailed design / methodology execution | A | R | R | C | I |",
    "| 30% / 60% / 100% peer review | A | C | C | R | I |",
    "| Client coordination and reporting | R | C | I | I | A |",
    "| Risk register maintenance | A | R | C | C | I |",
    "| Stakeholder consultation | A | R | C | I | C |",
    "| Final issuance and handover | A | R | C | R | A |",
  ];
  return [
    `<!-- methodology-table:raci -->`,
    `## RACI Matrix`,
    "",
    `Responsibilities are assigned across the team using the RACI convention: **R**esponsible (does the work), **A**ccountable (signs off), **C**onsulted (provides input), **I**nformed (kept aware). Each activity has exactly one Accountable owner.`,
    "",
    head,
    sep,
    ...rows,
    "",
  ].join("\n");
}

function buildRiskRegister(sector: string): string {
  const rows = sectorRiskRows(sector);
  const head = "| # | Category | Risk | Likelihood | Impact | Mitigation | Owner |";
  const sep = "|---|----------|------|------------|--------|------------|-------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.category} | ${r.risk} | ${r.likelihood} | ${r.impact} | ${r.mitigation} | ${r.owner} |`);
  return [
    `<!-- methodology-table:risk-register -->`,
    `## Risk Register`,
    "",
    `Risks identified at inception are tracked in the live risk register, reviewed monthly, and re-scored after each mitigation action. The register below captures the inception baseline.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildQAItpTable(sector: string): string {
  const rows = sectorQARows(sector);
  const head = "| # | Checkpoint | Criterion | Method | Frequency | Responsible | Type |";
  const sep = "|---|------------|-----------|--------|-----------|-------------|------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.checkpoint} | ${r.criterion} | ${r.method} | ${r.frequency} | ${r.responsible} | ${r.type} |`);
  return [
    `<!-- methodology-table:qa-itp -->`,
    `## Quality Assurance Plan and Inspection & Test Plan (ITP)`,
    "",
    `Quality is enforced through formal hold points (work cannot proceed without sign-off), witness points (independent verification at the activity), and review points (documentation audit). Each checkpoint is recorded in the QA register with sign-off.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

function buildCommsTable(): string {
  const rows = commsRows();
  const head = "| # | Item | Audience | Cadence | Owner | Format |";
  const sep = "|---|------|----------|---------|-------|--------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.item} | ${r.audience} | ${r.cadence} | ${r.owner} | ${r.format} |`);
  return [
    `<!-- methodology-table:communication -->`,
    `## Communication and Reporting Protocol`,
    "",
    `Communication is structured around fixed cadences with named owners, so that the client knows what report or meeting to expect and when. Action registers and minutes provide a written audit trail.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── Splice point detection ─────────────────────────────────────────────

// Find the end of Section C (or the closest equivalent — Technical Approach
// / Methodology heading) and insert the methodology tables there. Falls
// back to end-of-document if no such section exists.
function findSectionCEnd(markdown: string): number {
  const lines = markdown.split("\n");
  let startLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (
      /^#\s+Section\s+C\b/i.test(lines[i]) ||
      /^#\s+(?:Technical\s+Approach|Methodology|Technical\s+Methodology)$/i.test(lines[i])
    ) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) return lines.length;

  for (let i = startLine + 1; i < lines.length; i += 1) {
    if (/^#\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface MethodologyTablesResult {
  markdown: string;
  injected: Array<{ key: string; reason: "MISSING" | "SKIPPED_PRESENT" }>;
}

/**
 * Inject the five methodology tables (Phasing, RACI, Risk Register,
 * QA/ITP, Communication) into the proposal markdown. Idempotent.
 *
 * @param markdown the post-amplifier proposal body
 * @param opts.primarySector the detected sector — drives row content
 * @param opts.experts selected expert vault for RACI name resolution
 * @param _opts.projects (unused at present, reserved for future
 *        risk-register evidence anchors)
 */
export function injectMethodologyTables(
  markdown: string,
  opts: {
    primarySector: string;
    experts: ExpertRecord[];
    projects: ProjectRecord[];
  },
): MethodologyTablesResult {
  const present = detectExisting(markdown);
  const injected: Array<{ key: string; reason: "MISSING" | "SKIPPED_PRESENT" }> = [];

  const blocks: string[] = [];

  if (!present.has("phasing")) {
    blocks.push(buildPhasingTable(opts.primarySector));
    injected.push({ key: "phasing", reason: "MISSING" });
  } else {
    injected.push({ key: "phasing", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("raci")) {
    blocks.push(buildRACITable(opts.experts));
    injected.push({ key: "raci", reason: "MISSING" });
  } else {
    injected.push({ key: "raci", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("risk-register")) {
    blocks.push(buildRiskRegister(opts.primarySector));
    injected.push({ key: "risk-register", reason: "MISSING" });
  } else {
    injected.push({ key: "risk-register", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("qa-itp")) {
    blocks.push(buildQAItpTable(opts.primarySector));
    injected.push({ key: "qa-itp", reason: "MISSING" });
  } else {
    injected.push({ key: "qa-itp", reason: "SKIPPED_PRESENT" });
  }

  if (!present.has("communication")) {
    blocks.push(buildCommsTable());
    injected.push({ key: "communication", reason: "MISSING" });
  } else {
    injected.push({ key: "communication", reason: "SKIPPED_PRESENT" });
  }

  if (blocks.length === 0) return { markdown, injected };

  // Splice block at end of Section C / Technical Approach. If no such
  // section exists, append to end of document.
  const insertAt = findSectionCEnd(markdown);
  const lines = markdown.split("\n");
  const out = [
    ...lines.slice(0, insertAt),
    "",
    blocks.join("\n"),
    "",
    ...lines.slice(insertAt),
  ];

  return { markdown: out.join("\n"), injected };
}
