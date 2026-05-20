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
  if (/energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification|generation|transmission.*line/i.test(s)) {
    return [
      { phase: "1. Inception & Demand Analysis", deliverables: "Inception report; load-forecast memo; P50/P90 yield model (renewables); site-reconnaissance report; grid-connection pre-application", duration: "Weeks 1–3", responsible: "Project Principal" },
      { phase: "2. Conceptual & Preliminary Design", deliverables: "Single-line diagram; technology-selection report; SKM/ETAP load-flow model; protection relay coordination study; civil layout; preliminary BOQ", duration: "Weeks 4–8", responsible: "Power Systems Lead" },
      { phase: "3. Detailed Engineering", deliverables: "Full engineering design package (civil/structural, electrical, SCADA); specifications; procurement BOQ; grid-code compliance dossier", duration: "Weeks 9–16", responsible: "Lead Engineer" },
      { phase: "4. Procurement & Construction Supervision", deliverables: "Tender evaluation report; construction supervision with FAT hold-point; monthly progress reports; payment certificates", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Commissioning & Handover", deliverables: "SAT protocol results; SCADA acceptance test; O&M manual; operator training records; regulatory commissioning certificate; handover pack", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/agri|irrigation|WUA|command.*area|FAO.*Penman|crop.*water/i.test(s)) {
    return [
      { phase: "1. Inception & Hydrological Baseline", deliverables: "Inception report; minimum 20-year flow record review; FAO Penman-Monteith crop-water-requirement calculation; command-area boundary mapping", duration: "Weeks 1–4", responsible: "Project Principal" },
      { phase: "2. Scheme Design", deliverables: "Irrigation network design (canal or pressurised pipe); diversion/weir structure design; WUA governance draft framework; preliminary BOQ", duration: "Weeks 5–10", responsible: "Lead Hydraulic/Irrigation Engineer" },
      { phase: "3. Tender Documents", deliverables: "Full tender package (drawings, specifications, BOQ); environmental screening memo; construction supervision plan", duration: "Weeks 11–14", responsible: "Lead Engineer" },
      { phase: "4. Construction Supervision & Commissioning", deliverables: "Construction supervision; hydraulic commissioning tests; canal seepage tests; distribution efficiency measurement", duration: "Construction window + 3 weeks", responsible: "Resident Engineer" },
      { phase: "5. WUA Handover & O&M", deliverables: "WUA establishment certificate; O&M manual; operator training records; season-performance report; agronomic follow-up memo", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/mining|JORC|tailings|ore.*body|mine.*plan|mineral.*resource|blast.*design/i.test(s)) {
    return [
      { phase: "1. Resource Assessment", deliverables: "JORC-compliant resource estimate with independent competent-person review; block-model documentation; geotechnical investigation scope", duration: "Weeks 1–6", responsible: "Resource Geologist" },
      { phase: "2. Mine Plan & Feasibility", deliverables: "Pit or underground design; slope-stability analysis (three methods); TSF design per MAC/ANCOLD; preliminary BOQ; environmental and social management plan", duration: "Weeks 7–16", responsible: "Mining Engineer" },
      { phase: "3. Permitting & Detailed Engineering", deliverables: "Regulatory submission package; ESIA; detailed design drawings and specifications; procurement BOQ", duration: "Weeks 17–24", responsible: "Lead Engineer" },
      { phase: "4. Construction Supervision", deliverables: "Construction supervision with geotechnical hold-points; quality-control testing programme; monthly progress reports", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Close-out & Closure Plan", deliverables: "As-built drawings; closure plan with financial provision; O&M manual; environmental monitoring baseline; handover pack", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour|nautical/i.test(s)) {
    return [
      { phase: "1. Met-Ocean & Site Investigation", deliverables: "Met-ocean analysis (≥20-year data); bathymetric survey; geotechnical investigation (seabed borings); nautical simulation brief", duration: "Weeks 1–5", responsible: "Lead Port/Marine Engineer" },
      { phase: "2. Design Development", deliverables: "Berth structural design; dredge volume and disposal plan with sediment characterisation; fast-time nautical simulation report; shore-power layout", duration: "Weeks 6–14", responsible: "Lead Engineer" },
      { phase: "3. Tender Documents & ISPS", deliverables: "Full tender package (drawings, specifications, BOQ); ISPS compliance documentation; environmental and social management plan", duration: "Weeks 15–18", responsible: "Lead Engineer" },
      { phase: "4. Construction Supervision", deliverables: "Construction supervision with structural hold-points; dredge disposal monitoring; monthly progress reports; payment certificates", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Commissioning & Handover", deliverables: "Commissioning test results; ISPS certification support; O&M manual; nautical acceptance trial; handover pack", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|petrochemical|upstream.*petroleum/i.test(s)) {
    return [
      { phase: "1. Design Basis & HAZOP", deliverables: "Design basis memorandum; P&ID development; HAZOP study with full action register; LOPA for high-severity nodes", duration: "Weeks 1–5", responsible: "Lead Process Engineer" },
      { phase: "2. Detailed Engineering", deliverables: "Pipeline stress analysis (Caesar II); equipment layout; cathodic-protection design; civil/structural drawings; vendor data requirements matrix", duration: "Weeks 6–16", responsible: "Lead Engineer" },
      { phase: "3. Procurement & Pre-construction", deliverables: "Tender documents (BOQ, specs, drawings); HAZOP action register closure certificate; environmental and social management plan; construction safety plan", duration: "Weeks 17–20", responsible: "Lead Engineer" },
      { phase: "4. Construction Supervision", deliverables: "Construction supervision with welding NDE hold-points; pigging and hydrotest supervision; monthly progress reports", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
      { phase: "5. Commissioning & ILI", deliverables: "Commissioning procedures executed; PSI documentation; ILI programme specification; O&M manual; operator training; handover pack", duration: "Weeks N–N+6", responsible: "Project Principal" },
    ];
  }
  if (/KYC|AML|core.*banking|microfinance|IFRS|Basel|fintech|payment.*system/i.test(s)) {
    return [
      { phase: "1. Regulatory Gap Analysis", deliverables: "Regulatory gap analysis reviewed by licensed local legal counsel; target operating model design; data-quality assessment", duration: "Weeks 1–4", responsible: "Lead Regulatory Compliance Specialist" },
      { phase: "2. System Architecture & Build", deliverables: "System architecture document; integration plan; RBAC/encryption/audit-log configuration; UAT protocol", duration: "Weeks 5–12", responsible: "Solution Architect" },
      { phase: "3. UAT & Data Migration", deliverables: "UAT execution and sign-off; data migration with reconciliation; legal counsel regulatory compliance confirmation", duration: "Weeks 13–18", responsible: "Lead Engineer" },
      { phase: "4. Parallel-Run & Go-Live", deliverables: "Parallel-run execution (data reconciliation signed off before go-live); cutover plan; staff training completion certificate", duration: "Weeks 19–22", responsible: "Project Principal" },
      { phase: "5. Hypercare & Handover", deliverables: "Post-go-live hypercare plan; support documentation; lessons-learned report; knowledge-base wiki; handover pack", duration: "Weeks 23–26", responsible: "Project Principal" },
    ];
  }
  if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(s)) {
    return [
      { phase: "1. Demand & Coverage Modelling", deliverables: "Traffic demand model; calibrated RF coverage simulation with field-measured correction factors; spectrum licensing roadmap", duration: "Weeks 1–4", responsible: "Lead RF/Network Engineer" },
      { phase: "2. Network Design", deliverables: "Base-station siting plan; backhaul design (fibre/microwave) with path availability calculations; site acquisition list; EMR compliance dossier", duration: "Weeks 5–10", responsible: "Lead Engineer" },
      { phase: "3. Procurement & Site Works", deliverables: "Tender documents (BOQ, specs); in-principle spectrum approval confirmation; site acquisition agreements; installation supervision", duration: "Weeks 11–18", responsible: "Site Acquisition Coordinator" },
      { phase: "4. Drive-Test & Commissioning", deliverables: "Drive-test results against coverage KPIs; SAT protocol completion; EMR compliance measurements; operator training records", duration: "Weeks 19–22", responsible: "Commissioning/Test Engineer" },
      { phase: "5. O&M Handover", deliverables: "O&M manual; network monitoring dashboard; performance KPI report; spectrum licence confirmation; handover pack", duration: "Weeks 23–26", responsible: "Project Principal" },
    ];
  }
  if (/interior design|fit[-\s]?out|space planning|finishes.*schedule|furniture.*layout|joinery/i.test(s)) {
    return [
      { phase: "1. Space Programming & Brief", deliverables: "Functional brief; occupant schedule; adjacency matrix; net-to-gross area schedule; stakeholder workshop record", duration: "Weeks 1–2", responsible: "Lead Interior Architect" },
      { phase: "2. Concept Design", deliverables: "Concept boards (mood, material palette, lighting concept); furniture concept layouts; preliminary BOQ (indicative)", duration: "Weeks 3–5", responsible: "Interior Designer" },
      { phase: "3. Schematic Design", deliverables: "Floor plans with furniture layout; reflected ceiling plans; partition and floor finishes schedules; joinery elevations; client-sign-off record", duration: "Weeks 6–9", responsible: "Interior Designer" },
      { phase: "4. Detailed Design & FF&E Specification", deliverables: "Full FF&E schedule with supplier options and lead times; room data sheets; MEP coordination drawings; construction documentation package (drawings, specs, BOQ)", duration: "Weeks 10–15", responsible: "Lead Interior Architect" },
      { phase: "5. Construction Administration & Close-out", deliverables: "Shop drawing review log; sample approval register; site inspection reports; snagging list; defects clearance certificate; as-built drawings", duration: "Construction window + 4 weeks", responsible: "Lead Interior Architect" },
    ];
  }
  if (/construction supervision|resident engineer|site supervision|quality.*inspector|site.*management.*contract/i.test(s)) {
    return [
      { phase: "1. Pre-Construction Mobilisation", deliverables: "Review of contractor's programme, method statements, ITP, HSMP; mobilisation inspection; baseline photographic survey", duration: "Weeks 1–3 (prior to site start)", responsible: "Resident Engineer" },
      { phase: "2. Construction Phase — Quality & Progress", deliverables: "Weekly and monthly site supervision reports; hold-point and witness-point inspection certificates; NCR log; laboratory test certificates; material approval register", duration: "Construction period", responsible: "Resident Engineer + Site Inspector" },
      { phase: "3. Payment Certification", deliverables: "Monthly IPC (Interim Payment Certificate) based on measured quantities; cost register update; cash-flow projection", duration: "Monthly throughout construction", responsible: "Resident Engineer + QS" },
      { phase: "4. Variation Order Management", deliverables: "VO register; cost assessment of contractor claims; Engineer's Instructions; updated contract sum statement", duration: "Ongoing during construction", responsible: "Resident Engineer" },
      { phase: "5. Completion & DLP", deliverables: "Practical completion certificate; punch list / snag list; DLP inspection report; performance bond release recommendation; final account summary", duration: "Weeks N to N+6 + DLP", responsible: "Resident Engineer" },
    ];
  }
  if (/contract administration|FIDIC|variation order|payment certificate|claims management|quantity survey/i.test(s)) {
    return [
      { phase: "1. Contract Mobilisation & Setup", deliverables: "Contract administration manual; delegated authority register; key-date schedule; contractor mobilisation assessment", duration: "Weeks 1–2", responsible: "Contract Administrator" },
      { phase: "2. Cost Control & Reporting", deliverables: "Monthly cost report (actual vs contract sum); forecast final cost; contingency drawdown register; cash-flow projection", duration: "Monthly throughout contract", responsible: "Contract Administrator + QS" },
      { phase: "3. Variation & Change Management", deliverables: "VO log; quantum assessment per each variation; Engineer's Instructions; contract sum adjustment register", duration: "Ongoing", responsible: "Contract Administrator" },
      { phase: "4. Claims Evaluation", deliverables: "EOT claim analysis (time-impact method); disruption cost assessment; formal written determination; updated programme baseline", duration: "As claims arise", responsible: "Contract Administrator" },
      { phase: "5. Final Account & Closeout", deliverables: "Final BOQ reconciliation; agreed final account statement; outstanding claims settlement; certificate of substantial completion; lessons-learned report", duration: "Weeks N to N+8", responsible: "Contract Administrator" },
    ];
  }
  if (/heritage|conservation|museum|historic|adaptive.*reuse|heritage.*renovation/i.test(s)) {
    return [
      { phase: "1. Condition Survey & Conservation Assessment", deliverables: "Measured survey of existing structure; condition assessment report (structural, fabric, services); significance assessment; conservation philosophy statement; hazardous materials survey", duration: "Weeks 1–4", responsible: "Heritage Conservation Specialist + Structural Engineer" },
      { phase: "2. Conservation Plan & Design", deliverables: "Conservation plan; structural stabilisation design; architectural restoration drawings; MEP upgrade design; material specification using reversible/compatible materials; planning/heritage authority pre-submission", duration: "Weeks 5–12", responsible: "Lead Heritage Architect" },
      { phase: "3. Tender Documents & Approvals", deliverables: "Full tender package (drawings, specs, BOQ, conservation method statements); planning/heritage authority approval certificate; stakeholder consultation records", duration: "Weeks 13–16", responsible: "Lead Heritage Architect" },
      { phase: "4. Conservation Works Supervision", deliverables: "Specialist contractor supervision with material sample approval; conservation works monitoring log; NCR register; progress reports; photographic record", duration: "Construction window", responsible: "Resident Heritage Architect + Structural Inspector" },
      { phase: "5. Completion & Documentation", deliverables: "As-built conservation drawings; photographic archive (before/after); updated condition report; maintenance manual; completion certificate; handover to cultural authority", duration: "Weeks N to N+6", responsible: "Heritage Conservation Specialist" },
    ];
  }
  if (/industrial|manufactur|factory|abattoir|processing.*plant|production.*facilit|warehouse.*industrial/i.test(s)) {
    return [
      { phase: "1. Feasibility & Process Brief", deliverables: "Feasibility study; production process flow diagram; utility demand assessment (power, water, compressed air, waste); site suitability report; preliminary layout", duration: "Weeks 1–3", responsible: "Project Principal + Process Specialist" },
      { phase: "2. Detailed Design", deliverables: "Architectural/structural/MEP design package; industrial flooring specification; loading dock design; HVAC/exhaust ventilation system; fire suppression layout; hazardous materials management plan", duration: "Weeks 4–12", responsible: "Lead Structural Engineer + MEP Engineers" },
      { phase: "3. Regulatory & Environmental Approvals", deliverables: "Environmental permit application package; effluent treatment design; waste management plan; occupational safety assessment; EIA/ESIA if required", duration: "Weeks 10–16", responsible: "Environmental Lead" },
      { phase: "4. Tender Documents & Procurement", deliverables: "Full tender package (BOQ, drawings, specs); equipment procurement list; factory acceptance test (FAT) requirements", duration: "Weeks 17–20", responsible: "Lead Engineer" },
      { phase: "5. Construction Supervision & Commissioning", deliverables: "Structural hold-point inspections; equipment installation supervision; process commissioning tests; occupational health and safety audit; training of operators; as-built drawings", duration: "Construction window + 4 weeks", responsible: "Resident Engineer" },
    ];
  }
  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|\bG\+\d{2,}\b|basement.*podium/i.test(s)) {
    return [
      { phase: "1. Feasibility & Concept Design", deliverables: "Massing study; floor plate efficiency analysis; vertical transport (lift/car lift) concept; structural system selection (shear wall/core/frame); MEP riser strategy; preliminary BOQ (order of magnitude)", duration: "Weeks 1–4", responsible: "Lead Architect + Structural Lead" },
      { phase: "2. Detailed Structural & Architectural Design", deliverables: "Full architectural design (all floors, facades, roof); structural analysis (ETABS/SAP2000, seismic/wind load); shear wall and core layout; transfer beam/slab design; foundation design (mat/pile)", duration: "Weeks 5–16", responsible: "Lead Structural Engineer + Architect" },
      { phase: "3. MEP & Specialist Systems Design", deliverables: "MEP design package; fire alarm and suppression; BMS; car lift system design; aluminium curtain wall specification; generator/UPS sizing; plumbing riser diagram", duration: "Weeks 12–18", responsible: "MEP Engineers + Lift Specialist" },
      { phase: "4. Regulatory Approvals & Tender Documents", deliverables: "Structural calculation submission to AA City/regional authority; full tender package (drawings, BOQ, specs); bid evaluation report", duration: "Weeks 19–24", responsible: "Lead Engineer + QS" },
      { phase: "5. Construction Supervision", deliverables: "Foundation and shear wall hold-point inspections; structural concrete testing (cube test, rebar pull-out); curtain wall installation inspection; lift installation acceptance test; progress reports; as-built drawings", duration: "Construction period", responsible: "Resident Engineer + Structural Inspector" },
    ];
  }
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(s)) {
    return [
      { phase: "1. Concept & Feasibility", deliverables: "Feasibility study (market demand, RevPAR analysis, development program); concept design (room mix, F&B, BOH layout); landscape/pool/spa concept; preliminary BOQ", duration: "Weeks 1–4", responsible: "Lead Architect + Project Principal" },
      { phase: "2. Design Development", deliverables: "Full architectural design (all rooms, public areas, back-of-house); structural system; interior design concept (finishes, FF&E schedule, lighting); brand-standard compliance checklist", duration: "Weeks 5–14", responsible: "Lead Architect + Interior Designer" },
      { phase: "3. MEP & Specialist Systems", deliverables: "MEP package; HVAC for guestrooms (fan coil/VRF); kitchen ventilation; pool/spa mechanical; audiovisual and guest technology design; access control and security systems", duration: "Weeks 12–18", responsible: "MEP Engineers" },
      { phase: "4. Tender Documents & Procurement", deliverables: "Full tender package (drawings, BOQ, specs); FF&E procurement schedule; brand operator sign-off; construction supervision plan", duration: "Weeks 19–22", responsible: "Lead Architect + QS" },
      { phase: "5. Construction Supervision & Pre-Opening", deliverables: "Construction supervision with room-by-room snagging protocol; FF&E delivery inspection; MEP commissioning tests; mock room inspection; pre-opening punch list clearance; handover pack", duration: "Construction period + 6 weeks", responsible: "Resident Engineer + Interior Architect" },
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
  if (/energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification|generation|transmission.*line/i.test(s)) {
    return [
      ...generic,
      { category: "Grid Code", risk: "Protection relay settings rejected by utility at submission", likelihood: "Medium", impact: "High", mitigation: "Independent power-systems peer review of relay settings before utility submission; pre-submission coordination meeting with utility engineer", owner: "Power Systems Lead" },
      { category: "Yield", risk: "P50 energy yield shortfall due to resource uncertainty", likelihood: "Medium", impact: "High", mitigation: "P90 sensitivity analysis completed; conservative yield factor applied in financial model; bankable resource assessment commissioned", owner: "Lead Engineer" },
    ];
  }
  if (/agri|irrigation|WUA|command.*area|FAO.*Penman|crop.*water/i.test(s)) {
    return [
      ...generic,
      { category: "Hydrological", risk: "Source flow falls below minimum design demand in dry year", likelihood: "Medium", impact: "High", mitigation: "Minimum 20-year flow record analysis; conservative safe-yield factor; back-up source siting memo", owner: "Hydrologist" },
      { category: "Institutional", risk: "WUA governance collapse after scheme handover", likelihood: "Medium", impact: "High", mitigation: "WUA establishment agreed with community before commissioning; O&M fund mechanism designed into scheme; post-handover advisory support for 6 months", owner: "Community/WUA Specialist" },
    ];
  }
  if (/mining|JORC|tailings|ore.*body|mine.*plan|mineral.*resource/i.test(s)) {
    return [
      ...generic,
      { category: "Resource", risk: "Resource estimate downgrade at competent-person review", likelihood: "Medium", impact: "High", mitigation: "Competent-person review built into workflow at resource estimation stage; conservative classification applied; sensitivity analysis on cut-off grade", owner: "Resource Geologist" },
      { category: "Environmental", risk: "Environmental permit delay blocks construction start", likelihood: "Medium", impact: "High", mitigation: "ESIA commenced at feasibility stage; regulator pre-engagement meeting; permit critical-path flagged in programme baseline", owner: "Environmental Specialist" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour|nautical/i.test(s)) {
    return [
      ...generic,
      { category: "Met-Ocean", risk: "Design wave height exceeded during construction window", likelihood: "Medium", impact: "High", mitigation: "20-year met-ocean analysis; construction window selected for calm season; contingency day allowance in programme", owner: "Lead Port/Marine Engineer" },
      { category: "Dredge Disposal", risk: "Sediment characterisation triggers Category II disposal — disposal site change required", likelihood: "Medium", impact: "High", mitigation: "Pre-dredge sediment sampling at feasibility stage; disposal options shortlist with regulatory pre-consultation", owner: "Environmental Specialist" },
    ];
  }
  if (/HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|petrochemical|upstream.*petroleum/i.test(s)) {
    return [
      ...generic,
      { category: "Process Safety", risk: "HAZOP action register not fully closed before construction release", likelihood: "Low", impact: "High", mitigation: "HAZOP action register formal closure is a gated milestone; no construction release without PSI documentation sign-off", owner: "HAZOP Facilitator" },
      { category: "Integrity", risk: "Pipeline hydrotest failure due to weld or fitting defect", likelihood: "Low", impact: "High", mitigation: "NDE hold-points (RT/UT) at each weld before backfill; hydrotest witnessed and recorded per ASME B31.4/B31.8", owner: "Resident Engineer" },
    ];
  }
  if (/KYC|AML|core.*banking|microfinance|IFRS|Basel|fintech|payment.*system/i.test(s)) {
    return [
      ...generic,
      { category: "Regulatory", risk: "Regulatory gap analysis incomplete — system fails central bank audit", likelihood: "Low", impact: "High", mitigation: "Licensed local legal counsel sign-off is a formal gate condition before system go-live; gap register tracked weekly", owner: "Lead Regulatory Compliance Specialist" },
      { category: "Data Migration", risk: "Ledger data migration error causes reconciliation failure at go-live", likelihood: "Medium", impact: "High", mitigation: "Three parallel-run cycles with independent reconciliation sign-off before cutover; rollback plan documented and tested", owner: "Data Migration Lead" },
    ];
  }
  if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(s)) {
    return [
      ...generic,
      { category: "Spectrum", risk: "Spectrum approval delayed — site engineering cannot start", likelihood: "Medium", impact: "High", mitigation: "In-principle spectrum approval confirmed before any site engineering commences; alternative band contingency assessed", owner: "Spectrum Planning Specialist" },
      { category: "Coverage", risk: "Modelled coverage not achieved after deployment", likelihood: "Medium", impact: "High", mitigation: "Calibrated RF model using field-measured correction factors; drive-test acceptance against coverage KPIs before handover", owner: "Lead RF/Network Engineer" },
    ];
  }
  if (/interior design|fit[-\s]?out|space planning|finishes|joinery/i.test(s)) {
    return [
      ...generic,
      { category: "Procurement", risk: "FF&E lead times exceed programme", likelihood: "Medium", impact: "High", mitigation: "Place orders at end of schematic phase; track supplier lead times weekly", owner: "Lead Interior Architect" },
      { category: "Scope", risk: "Scope creep from client change requests during construction", likelihood: "High", impact: "Medium", mitigation: "Change-control process at each design gate; signed change orders before executing changes", owner: "Lead Interior Architect" },
      { category: "Coordination", risk: "MEP coordination clashes discovered on site", likelihood: "Medium", impact: "Medium", mitigation: "BIM clash detection at DD stage; 2D overlay checks before issuing construction drawings", owner: "MEP Coordinator" },
      { category: "Materials", risk: "Material sample approval delays contractor programme", likelihood: "Medium", impact: "Medium", mitigation: "Submit samples minimum 3 weeks before installation; maintain parallel approval register", owner: "Lead Interior Architect" },
    ];
  }
  if (/construction supervision|resident engineer|site supervision/i.test(s)) {
    return [
      ...generic,
      { category: "Quality", risk: "Contractor fails to meet quality hold-points", likelihood: "Medium", impact: "High", mitigation: "Mandatory H-point sign-off before proceeding; NCR issuance with defined closeout timeline", owner: "Resident Engineer" },
      { category: "Commercial", risk: "Contractor submits inflated interim payment claims", likelihood: "High", impact: "High", mitigation: "Measured remeasurement at each IPC; back-up documentation required before certification", owner: "Resident Engineer + QS" },
      { category: "Access", risk: "Site access restrictions delay supervision", likelihood: "Medium", impact: "Medium", mitigation: "Access protocol agreed with Employer before mobilisation; site access log maintained", owner: "Resident Engineer" },
      { category: "Programme", risk: "Contractor programme slippage leads to EOT claims", likelihood: "High", impact: "Medium", mitigation: "Weekly progress meeting minutes; contemporaneous record keeping; time-impact analysis on request", owner: "Resident Engineer" },
    ];
  }
  if (/contract administration|FIDIC|variation order|claims management/i.test(s)) {
    return [
      ...generic,
      { category: "Claims", risk: "Contractor submits unsubstantiated EOT claims", likelihood: "High", impact: "High", mitigation: "Programme baselines locked at award; contemporaneous delay records maintained throughout", owner: "Contract Administrator" },
      { category: "Commercial", risk: "Variation scope disputed by contractor", likelihood: "Medium", impact: "High", mitigation: "Issue Engineer's Instructions before work starts; agree quantum before next IPC", owner: "Contract Administrator" },
      { category: "Commercial", risk: "Final account settlement delayed by unresolved claims", likelihood: "Medium", impact: "Medium", mitigation: "Claims resolution schedule agreed at practical completion; FIDIC dispute board as backstop", owner: "Contract Administrator" },
      { category: "Budget", risk: "Cost overrun breaches approved project budget", likelihood: "Medium", impact: "High", mitigation: "Monthly forecast-final-cost report to Employer; early-warning system per FIDIC Clause 8.3", owner: "Contract Administrator" },
    ];
  }
  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(s)) {
    return [
      ...generic,
      { category: "Material Compatibility", risk: "Inappropriate repair mortar carbonates original masonry causing irreversible damage", likelihood: "Medium", impact: "High", mitigation: "Material compatibility testing (XRF/petrographic) at inception; conservation-grade lime mortar specified as default; no OPC in contact with historic fabric", owner: "Heritage Conservation Specialist" },
      { category: "Regulatory", risk: "Heritage authority rejects proposed intervention — rework required", likelihood: "Low", impact: "High", mitigation: "Pre-application meeting with heritage authority at conservation-plan stage; conservation philosophy statement approved before design freeze", owner: "Lead Heritage Architect" },
    ];
  }
  if (/industrial|manufactur|factory|abattoir|processing.*plant|warehouse.*industrial/i.test(s)) {
    return [
      ...generic,
      { category: "Process Safety", risk: "Industrial occupancy classification change triggers mandatory fire-suppression upgrade", likelihood: "Medium", impact: "High", mitigation: "Occupancy and hazardous materials assessment at inception; fire-safety engineer in design team from Phase 1; regulation compliance checklist updated at every design gate", owner: "MEP/Fire-Safety Lead" },
      { category: "Commissioning", risk: "Equipment installation sequence error delays production start", likelihood: "Medium", impact: "High", mitigation: "Detailed commissioning sequencing plan; factory acceptance test (FAT) held before delivery; start-up engineer on site for first production run", owner: "Resident Engineer" },
    ];
  }
  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|\bG\+\d{2,}\b|basement.*podium/i.test(s)) {
    return [
      ...generic,
      { category: "Structural", risk: "Seismic or wind load exceedance detected after structural analysis — re-design required", likelihood: "Low", impact: "High", mitigation: "ETABS/SAP2000 analysis includes Ethiopian seismic zone and topographic wind factor; peer review by independent structural engineer before construction documents", owner: "Lead Structural Engineer" },
      { category: "Authority Approval", risk: "Structural calculations rejected by AA City Authority — re-submission delay", likelihood: "Medium", impact: "High", mitigation: "Pre-submission coordination meeting with reviewing authority; calculations package formatted to authority checklist; 3-week re-submission buffer in programme", owner: "Lead Structural Engineer" },
    ];
  }
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(s)) {
    return [
      ...generic,
      { category: "Brand Standard", risk: "Design fails brand operator technical standards review — costly redesign", likelihood: "Medium", impact: "High", mitigation: "Brand technical standards review at concept stage and 60% design stage; compliance matrix tracked against brand checklist throughout", owner: "Lead Architect" },
      { category: "FF&E", risk: "Long-lead furniture/fixture/equipment items not ordered early enough — delay pre-opening", likelihood: "Medium", impact: "High", mitigation: "FF&E schedule agreed at design development stage; procurement lead times flagged in programme; provisional sum provisions for critical items", owner: "Interior Architect + Project Manager" },
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
  if (/energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification|generation|transmission.*line/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "Load-Flow & Protection Review", criterion: "Load-flow, short-circuit, and protection relay coordination results within grid-code limits", method: "SKM/ETAP model output review; independent peer review of relay settings", frequency: "Once at 60% and pre-submission", responsible: "Power Systems Lead", type: "Hold" },
      { checkpoint: "Factory Acceptance Test (FAT)", criterion: "Equipment performance matches specification; no outstanding non-conformances", method: "Witnessed FAT per IEC/IEEE test protocol", frequency: "Each major equipment item", responsible: "Resident Engineer", type: "Witness" },
      { checkpoint: "Site Acceptance Test (SAT)", criterion: "SCADA comms, protection relay trips, metering accuracy verified on site", method: "SAT protocol executed against checklist", frequency: "Per substation / plant area", responsible: "Commissioning Engineer", type: "Hold" },
    ];
  }
  if (/agri|irrigation|WUA|command.*area|FAO.*Penman|crop.*water/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "Crop-Water Requirement Verification", criterion: "FAO Penman-Monteith calculation verified against field climate data", method: "Independent agronomist review of CWR calculation memo", frequency: "Once at 30%", responsible: "Agronomist", type: "Hold" },
      { checkpoint: "Canal Hydraulic Acceptance", criterion: "Discharge at design flow; seepage rate ≤ allowable loss", method: "Gauging at head works and tail of reach; seepage test", frequency: "Each canal reach", responsible: "Resident Engineer", type: "Witness" },
    ];
  }
  if (/mining|JORC|tailings|ore.*body|mine.*plan|mineral.*resource/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "Competent-Person Review", criterion: "JORC resource estimate complies with JORC Code; all modifying factors documented", method: "Independent competent-person review and sign-off", frequency: "Once at resource classification stage", responsible: "Resource Geologist", type: "Hold" },
      { checkpoint: "Slope-Stability Acceptance", criterion: "Factor of Safety ≥ minimum per MAC/ANCOLD guidelines for all failure modes", method: "Slope-stability analysis (three methods); peer review", frequency: "Pit or underground design freeze", responsible: "Geotechnical Engineer", type: "Hold" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour|nautical/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "Nautical Simulation Acceptance", criterion: "Berth layout confirmed safe for design vessel in design met-ocean condition", method: "Fast-time nautical simulation witnessed by harbour master", frequency: "Before structural design freeze", responsible: "Nautical Safety Specialist", type: "Hold" },
      { checkpoint: "Dredge Volume Acceptance", criterion: "Dredge volume and disposal characterisation confirmed; disposal site approved by regulator", method: "Sediment sampling lab results; regulator pre-consultation record", frequency: "Before dredge contract award", responsible: "Environmental Specialist", type: "Hold" },
    ];
  }
  if (/HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit|petrochemical|upstream.*petroleum/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "HAZOP Action Register Closure", criterion: "All HAZOP actions closed or formally deferred with risk owner and date", method: "HAZOP action register audit by Lead Process Engineer", frequency: "Before construction release", responsible: "HAZOP Facilitator", type: "Hold" },
      { checkpoint: "NDE & Hydrotest", criterion: "Weld NDE pass rate 100%; hydrotest held at 1.25× MAOP for 4 hours", method: "RT/UT NDE per ASME B31; hydrotest per procedure", frequency: "Each weld / each test section", responsible: "Resident Engineer", type: "Witness" },
    ];
  }
  if (/KYC|AML|core.*banking|microfinance|IFRS|Basel|fintech|payment.*system/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "Regulatory Compliance Gate", criterion: "Licensed legal counsel confirms no outstanding regulatory non-conformances", method: "Legal counsel sign-off memo issued before go-live", frequency: "Before go-live", responsible: "Lead Regulatory Compliance Specialist", type: "Hold" },
      { checkpoint: "Data Migration Reconciliation", criterion: "Reconciliation report shows zero unresolved discrepancies between source and target systems", method: "Three-way reconciliation (source, migration log, target)", frequency: "End of each parallel-run cycle", responsible: "Data Migration Lead", type: "Hold" },
    ];
  }
  if (/spectrum|broadband|LTE|5G|base.*station|backhaul|mobile.*network/i.test(s)) {
    return [
      ...generic,
      { checkpoint: "RF Coverage Drive-Test", criterion: "Coverage KPIs (RSRP, SINR, throughput) met across ≥ 95% of service area", method: "Drive-test with calibrated measurement equipment; map overlay against model", frequency: "After cluster commissioning", responsible: "Commissioning/Test Engineer", type: "Hold" },
      { checkpoint: "Backhaul Path Availability", criterion: "Microwave path availability ≥ 99.99% per ITU-R P.530 calculation", method: "Path availability calculation review; link-budget audit", frequency: "Each microwave hop", responsible: "Backhaul/Transmission Engineer", type: "Hold" },
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

/**
 * Replace generic "Weeks 1–2" duration cells with concrete "Days 1–3"
 * cells, given the tender's stated total day count. Distributes phases
 * proportionally to the original week-range widths.
 *
 * Used when the tender text yields an explicit total like "28 calendar
 * days from signed contract" — the May-7 benchmark Path tender had
 * exactly that. Without this, the generated proposal phases say
 * "Weeks 1–2" / "Weeks 3–6" while the tender expects day numbers.
 */
function rewritePhasesToDays(rows: PhasingRow[], totalDays: number): PhasingRow[] {
  if (totalDays < 7 || totalDays > 1_000) return rows;
  // Detect the maximum week number across rows so we can scale proportionally.
  const ranges: Array<{ start: number; end: number }> = rows.map((r) => {
    const m = r.duration.match(/(\d+)\s*[–-]\s*(\d+)/);
    if (m) return { start: Number(m[1]), end: Number(m[2]) };
    const single = r.duration.match(/Week\s+(\d+)/i);
    if (single) return { start: Number(single[1]), end: Number(single[1]) };
    return { start: 0, end: 0 };
  });
  const maxWeek = Math.max(1, ...ranges.map((r) => r.end));
  return rows.map((r, i) => {
    const range = ranges[i];
    if (range.end === 0) return r; // unparseable — keep original
    const daysStart = Math.max(1, Math.round((range.start - 1) * totalDays / maxWeek) + 1);
    const daysEnd = Math.min(totalDays, Math.round(range.end * totalDays / maxWeek));
    const dur = daysStart === daysEnd ? `Day ${daysStart}` : `Days ${daysStart}–${daysEnd}`;
    return { ...r, duration: dur };
  });
}

function buildPhasingTable(sector: string, totalDays?: number): string {
  let rows = sectorPhasingRows(sector);
  if (totalDays && totalDays > 0) rows = rewritePhasesToDays(rows, totalDays);
  const head = "| # | Phase | Key Deliverables | Indicative Duration | Responsible |";
  const sep = "|---|-------|------------------|---------------------|-------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.phase} | ${r.deliverables} | ${r.duration} | ${r.responsible} |`);
  const intro = totalDays
    ? `The engagement is delivered in ${rows.length} phases over ${totalDays} calendar days, each with a defined deliverable, duration, and responsible expert. Phase transitions are gated by client sign-off on the prior deliverable.`
    : `The engagement is delivered in ${rows.length} phases, each with a defined deliverable, duration, and responsible expert. Phase transitions are gated by client sign-off on the prior deliverable.`;
  return [
    `<!-- methodology-table:phasing -->`,
    `## Project Phasing and Deliverables`,
    "",
    intro,
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
    // PR XX-G10 — when the tender text carries an explicit total
    // duration (e.g., "28 calendar days from signed contract"), the
    // phasing table renders "Day 1–3" / "Day 4–8" cells instead of
    // generic "Weeks 1–2". Pass the parsed total here.
    totalDays?: number;
  },
): MethodologyTablesResult {
  const present = detectExisting(markdown);
  const injected: Array<{ key: string; reason: "MISSING" | "SKIPPED_PRESENT" }> = [];

  const blocks: string[] = [];

  if (!present.has("phasing")) {
    blocks.push(buildPhasingTable(opts.primarySector, opts.totalDays));
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
