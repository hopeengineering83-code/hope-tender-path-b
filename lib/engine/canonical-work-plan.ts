// THE canonical work plan. One phase list; every representation derives from it.
//
// WHY
// ---
// A delivered technical proposal said both of these, nine pages apart:
//
//   C.13 "The engagement is delivered in 5 phases, each with a defined
//         deliverable, duration, and responsible expert."
//   C.16 "The methodology is delivered across 6 phases over an indicative
//         90-day engagement window."
//
// Two builders each owned a private phase list — methodology-tables.ts had a
// five-phase, sector-specific delivery lifecycle; deliverable-and-phases.ts had
// a six-phase design-process skeleton — and nothing reconciled them. An
// evaluator reading the work plan cannot tell which is the offer.
//
// Making that contradiction impossible means one authority, not a consistency
// check: a check can only report the disagreement after both lists exist. The
// phase spine below is that authority, and the table, the narrative, the
// timeline and the phase leads all render from it.
//
// The spine is the sector-specific list, because it is the one that actually
// varies by tender: healthcare gets IPC hold-points and a licensing pack, roads
// get AASHTO/ERA pavement design and subgrade hold-points, water gets yield
// tests and pressure-test hold-points. The design-process list it replaces was
// generic scaffolding with sector vocabulary appended, and its per-phase
// artefacts were less specific than these at every phase.
//
// Adding a sector means adding one branch here, and every representation
// follows.

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
  if (/geotech|soil.*invest|borehole.*programme|site.*invest.*geotech|subsoil.*invest|ground.*invest/i.test(s)) {
    return [
      { phase: "1. Desk Study & Mobilisation", deliverables: "Desk study (geological maps, hydrogeological records, previous investigations); borehole location plan; drilling programme; laboratory accreditation confirmation; site reconnaissance photographs", duration: "Weeks 1–2", responsible: "Principal Geotechnical Engineer" },
      { phase: "2. Field Investigation", deliverables: "Borehole logs; trial-pit logs; SPT records and blowcounts; undisturbed sample dispatch records; standpipe piezometer readings; field groundwater levels; soil profile sketch", duration: "Weeks 2–6", responsible: "Senior Geotechnical Engineer + Driller" },
      { phase: "3. Laboratory Testing", deliverables: "Test certificates (grain-size distribution, Atterberg limits, natural moisture content, UCS/triaxial shear strength, CBR, compaction — where applicable); groundwater chemistry analysis if required", duration: "Weeks 4–8", responsible: "Geotechnical Laboratory Manager" },
      { phase: "4. Analysis & Peer Review", deliverables: "Bearing capacity calculation (Terzaghi/Meyerhof/EC7); settlement analysis; liquefaction assessment; slope-stability report (if applicable); pile capacity recommendation; independent peer-review certificate", duration: "Weeks 8–10", responsible: "Principal Geotechnical Engineer" },
      { phase: "5. Report Issue", deliverables: "Geotechnical investigation report (executive summary, borehole logs, laboratory results, interpreted soil profile, foundation recommendations); peer-review sign-off certificate; drawing set (borehole location plan, soil profile sections)", duration: "Weeks 10–12", responsible: "Principal Geotechnical Engineer" },
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

/** One phase of the canonical work plan, as every representation sees it. */
export interface CanonicalWorkPlanPhase {
  /** 1-based position in the plan. */
  readonly index: number;
  /** "1. Inception" — carries its own number so table and narrative agree. */
  readonly title: string;
  /** Semicolon-separated artefacts this phase produces. */
  readonly deliverables: string;
  /** "Weeks 3-6", or "Days 8-21" when the tender states a total day count. */
  readonly durationLabel: string;
  /** The role accountable for the phase, e.g. "Resident Engineer". */
  readonly responsibleRole: string;
  /** Lower-cased words used to match a named expert to this phase's role. */
  readonly leadKeywords: readonly string[];
}

/**
 * Split a role label into the keywords used to find a matching expert. The
 * role itself is the strongest signal ("Resident Engineer" -> "resident",
 * "engineer"), with a generic senior fallback so a phase always names someone
 * when the vault holds anyone at all.
 */
function leadKeywordsFor(role: string): readonly string[] {
  const fromRole = role
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3 && word !== "team");
  return [...fromRole, "principal", "director", "lead", "senior", "engineer", "specialist"];
}

/**
 * The canonical work plan for a tender.
 *
 * `totalDays` comes from the tender when it states one ("28 calendar days from
 * signed contract"); the week labels are rescaled to day numbers so the plan
 * speaks the tender's own units.
 */
export function canonicalWorkPlan(opts: { sector: string; totalDays?: number }): readonly CanonicalWorkPlanPhase[] {
  let rows = sectorPhasingRows(opts.sector);
  if (opts.totalDays && opts.totalDays > 0) rows = rewritePhasesToDays(rows, opts.totalDays);
  return rows.map((row, i) => ({
    index: i + 1,
    title: row.phase,
    deliverables: row.deliverables,
    durationLabel: row.duration,
    responsibleRole: row.responsible,
    leadKeywords: leadKeywordsFor(row.responsible),
  }));
}
