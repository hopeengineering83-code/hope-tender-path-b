// Deliverable QA Checklist (May-7 G11 fix)
//
// THE PROBLEM
// ───────────
// Claude AI's reference proposal for the Path tender ended Section C
// with a 7-row "Deliverable-Specific Quality Assurance Checklist" table:
//
//   QA Check Item                        | Responsible      | Deliverable | Acceptance Standard
//   All programme rooms present          | Lead Architect   | 1, 2, 4, 6, 7 | Zero missing rooms
//   All room dimensions cross-checked    | Lead Arch + PM   | 2           | No error > 5 cm
//   MEP services coordinated …           | PM + MEP         | 3, 5        | Zero MEP routing conflicts
//   …
//
// The app's output had NO equivalent. Our existing QA/ITP table is
// generic ("30/60/100% peer review"). The Claude version is
// deliverable-specific — it names each tender deliverable code (D1, D2,
// …) and what passes vs fails for it.
//
// THE FIX
// ───────
// Detect tender deliverable codes (D1, D2, etc., or numbered "1.", "2.")
// from the tender text, then build a 6–8 row table with:
//   QA Check Item           — drawn from sector + scope hints
//   Responsible             — named expert when matched, role otherwise
//   Deliverable             — comma-joined D-codes the row applies to
//   Acceptance Standard     — concrete pass criterion
//
// Pure deterministic. No AI call. Idempotent (marker comment skips
// re-injection).

import type { ExpertRecord } from "./benchmark-tables";

export interface DeliverableQaChecklistOpts {
  tenderText: string;
  primarySector: string;
  experts: ExpertRecord[];
  // Optional list of explicit deliverable codes (e.g., ["D1","D2",..."D8"])
  // when the engine has already extracted them. When omitted, the function
  // tries to extract them from tenderText itself.
  deliverableCodes?: string[];
}

interface ChecklistRow {
  check: string;
  responsibleRole: string;
  deliverables: string;
  acceptance: string;
}

const MARKER = "<!-- deliverable-qa-checklist -->";

function detectDeliverableCodes(tenderText: string): string[] {
  // D1 / D-1 / Deliverable 1 / Deliverable D1
  const set = new Set<string>();
  const rx = /\bD[\s\-]*(\d{1,2})\b|\bDeliverable\s+(?:D\s*)?(\d{1,2})\b/gi;
  for (const m of tenderText.matchAll(rx)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && n >= 1 && n <= 30) set.add(`D${n}`);
  }
  return Array.from(set).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function rolesByKeyword(experts: ExpertRecord[], keywords: string[]): string {
  const profile = (e: ExpertRecord) => `${e.fullName} ${e.title ?? ""}`.toLowerCase();
  const e = experts.find((x) => keywords.some((k) => profile(x).includes(k)));
  return e ? e.fullName : keywords[0]
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function sectorChecklistRows(sector: string, experts: ExpertRecord[], dCodes: string[]): ChecklistRow[] {
  const s = sector.toLowerCase();
  const all = dCodes.length > 0 ? dCodes.join(", ") : "All deliverables";
  const sub = (n: number[]) => dCodes.length > 0 ? n.map((i) => dCodes[i - 1] ?? `D${i}`).filter(Boolean).join(", ") : `Deliverables ${n.join(", ")}`;

  if (/health|hospital|medical|clinic/.test(s)) {
    return [
      { check: "All programme rooms present (clinical, support, public, MEP zones) and labelled per the brief", responsibleRole: rolesByKeyword(experts, ["architect"]), deliverables: sub([1, 2, 4]), acceptance: "Zero missing rooms; every clinical zone labelled" },
      { check: "Room dimensions cross-checked against equipment + furniture footprints with clearances", responsibleRole: rolesByKeyword(experts, ["architect"]), deliverables: sub([2, 6]), acceptance: "All clearances ≥ 1.2 m; no equipment-clash flags" },
      { check: "MEP services (electrical, sanitary, mechanical, medical-gas) coordinated with architecture", responsibleRole: rolesByKeyword(experts, ["mep", "electrical", "sanitary"]), deliverables: sub([3, 5]), acceptance: "Zero MEP routes conflicting with structural elements or partitions" },
      { check: "Infection-Prevention-Control flow validated (clean / dirty separation, isolation room circulation)", responsibleRole: rolesByKeyword(experts, ["architect"]), deliverables: sub([2, 4]), acceptance: "IPC zones documented; circulation diagrams reviewed by clinical lead" },
      { check: "Medical-equipment shielding + utilities (radiation, UPS, gas, vacuum) sized correctly", responsibleRole: rolesByKeyword(experts, ["mep", "electrical"]), deliverables: sub([3, 5]), acceptance: "Equipment schedule signed by Biomedical Engineer; loads + shielding match spec" },
      { check: "BOQ quantities verified against drawing takeoff (sample-of-three per trade)", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([8]), acceptance: "Cross-check accuracy ≥ 98%; discrepancies flagged for resolution" },
      { check: "All DWG / PDF files tested in target software compatibility", responsibleRole: "CAD Technician", deliverables: all, acceptance: "Zero layer errors; reference files bound or purged" },
    ];
  }
  if (/water|borehole|hydraulic|sanitary/.test(s)) {
    return [
      { check: "Water demand projection matches population + service-level standards", responsibleRole: rolesByKeyword(experts, ["water", "hydraulic"]), deliverables: sub([1, 2]), acceptance: "Demand calc reviewed by senior engineer; assumptions documented" },
      { check: "Source yield confirmed by pump test + water-quality analysis", responsibleRole: rolesByKeyword(experts, ["hydrogeo", "water"]), deliverables: sub([2]), acceptance: "Yield ≥ design demand; quality meets drinking-water standard" },
      { check: "Hydraulic model (EPANET / WaterCAD) calibrated and pressure-residual checked", responsibleRole: rolesByKeyword(experts, ["water", "hydraulic"]), deliverables: sub([3]), acceptance: "Pressure within 15–60 m at all consumer nodes; no negative residuals" },
      { check: "Pipe-sizing, pump and reservoir designs reconciled with topographic survey", responsibleRole: rolesByKeyword(experts, ["water"]), deliverables: sub([3, 4]), acceptance: "All elevations from survey; pump head matches static + friction" },
      { check: "BOQ verified against drawing takeoff", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([5]), acceptance: "Cross-check accuracy ≥ 98%" },
      { check: "All deliverables peer-reviewed at 30 / 60 / 100% gates", responsibleRole: rolesByKeyword(experts, ["principal", "director", "manager"]), deliverables: all, acceptance: "Sign-off memo on file from Project Principal" },
    ];
  }
  if (/road|bridge|highway|pavement/.test(s)) {
    return [
      { check: "Topographic survey accuracy verified at control points", responsibleRole: rolesByKeyword(experts, ["surveyor", "highway"]), deliverables: sub([1, 2]), acceptance: "Closure error ≤ 1:5000; benchmark tied to national datum" },
      { check: "Geotechnical + CBR / Proctor results match pavement design assumptions", responsibleRole: rolesByKeyword(experts, ["geotechnical"]), deliverables: sub([2, 3]), acceptance: "CBR ≥ design; Proctor density supports thickness assumptions" },
      { check: "Pavement design follows AASHTO / ERA standard with traffic loading inputs", responsibleRole: rolesByKeyword(experts, ["highway"]), deliverables: sub([3]), acceptance: "Design follows current code; AADT and ESAL documented" },
      { check: "Drainage capacity sized for design storm (10 / 25 / 50 yr per class)", responsibleRole: rolesByKeyword(experts, ["highway", "drainage"]), deliverables: sub([3, 4]), acceptance: "Hydraulic capacity ≥ design flow; outlet protection specified" },
      { check: "Road-safety audit performed at design and pre-handover", responsibleRole: "Road Safety Auditor", deliverables: sub([3, 5]), acceptance: "Audit report on file; recommendations closed or accepted" },
      { check: "BOQ verified against drawing takeoff", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([4]), acceptance: "Cross-check accuracy ≥ 98%" },
    ];
  }
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(s)) {
    return [
      { check: "Load forecast confirmed against utility historical data and grid-code obligations", responsibleRole: rolesByKeyword(experts, ["power", "electrical", "energy"]), deliverables: sub([1, 2]), acceptance: "Forecast reviewed by independent power-systems engineer; design basis memorandum signed off" },
      { check: "Load-flow and short-circuit analysis completed (SKM/ETAP or equivalent)", responsibleRole: rolesByKeyword(experts, ["electrical", "power"]), deliverables: sub([2, 3]), acceptance: "Voltage profiles within code limits; fault levels below equipment ratings; report peer-reviewed" },
      { check: "Protection relay coordination study reviewed before utility submission", responsibleRole: rolesByKeyword(experts, ["electrical", "protection"]), deliverables: sub([3]), acceptance: "Relay setting schedule issued; utility pre-approval acknowledgement on file" },
      { check: "SCADA architecture and FAT/SAT protocols issued before equipment delivery", responsibleRole: rolesByKeyword(experts, ["electrical", "scada", "power"]), deliverables: sub([3, 4]), acceptance: "FAT protocol signed by client and vendor; SAT checklist covers all end-devices" },
      { check: "BOQ verified against drawing takeoff", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([4]), acceptance: "Cross-check accuracy ≥ 98%" },
      { check: "Environmental management plan issued before construction mobilisation", responsibleRole: rolesByKeyword(experts, ["environment", "social"]), deliverables: sub([3, 5]), acceptance: "EMP reviewed and signed off by client; clearing and earthworks hold-point documented" },
    ];
  }
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(s)) {
    return [
      { check: "Hydrological analysis uses ≥ 20-year flow record; safe-yield factor documented", responsibleRole: rolesByKeyword(experts, ["hydro", "hydraulic", "water"]), deliverables: sub([1, 2]), acceptance: "Flow record verified; safe yield ≥ design demand; peer-reviewed memo on file" },
      { check: "FAO Penman-Monteith crop-water calculation validated with local agronomy data", responsibleRole: rolesByKeyword(experts, ["agro", "irrigation"]), deliverables: sub([2]), acceptance: "Calculation inputs (temperature, humidity, wind, radiation) from local station data; reviewed by agronomist" },
      { check: "Irrigation network hydraulic model verified (canal or pressurised pipe)", responsibleRole: rolesByKeyword(experts, ["hydraulic", "irrigation"]), deliverables: sub([3]), acceptance: "Pressure residuals within operating limits; flow velocities within non-erosion limits" },
      { check: "WUA governance framework agreed and training plan issued before commissioning", responsibleRole: rolesByKeyword(experts, ["community", "social", "wua"]), deliverables: sub([4, 5]), acceptance: "WUA constitution signed; tariff model agreed; training plan issued with O&M manual" },
      { check: "Commissioning seepage test completed per canal section before backfill", responsibleRole: rolesByKeyword(experts, ["hydraulic", "irrigation", "supervisor"]), deliverables: sub([5]), acceptance: "Seepage loss ≤ specified allowance; test records signed by Resident Engineer" },
      { check: "O&M manual covers operation, maintenance, and repair for all components", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: sub([5, 6]), acceptance: "Manual reviewed by WUA representative; all components addressed" },
    ];
  }
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(s)) {
    return [
      { check: "Drillhole database validated before block-model estimation begins", responsibleRole: rolesByKeyword(experts, ["geolog", "mining"]), deliverables: sub([1, 2]), acceptance: "Database validation report on file; collar, survey, and assay data verified" },
      { check: "Block-model resource estimate reviewed by independent competent person (JORC)", responsibleRole: rolesByKeyword(experts, ["geolog", "resource"]), deliverables: sub([2, 3]), acceptance: "Competent-person sign-off letter on file; JORC code table complete" },
      { check: "Slope-stability analysis completed using three independent methods", responsibleRole: rolesByKeyword(experts, ["geotech", "geotechnical"]), deliverables: sub([3]), acceptance: "Three analyses documented; inter-ramp angles confirmed; geotechnical peer review on file" },
      { check: "TSF design reviewed against MAC/ANCOLD guidelines before construction", responsibleRole: rolesByKeyword(experts, ["geotechnical", "mining"]), deliverables: sub([3, 4]), acceptance: "MAC/ANCOLD classification confirmed; freeboard and drainage adequacy documented" },
      { check: "Closure plan with financial provision estimate included in feasibility report", responsibleRole: rolesByKeyword(experts, ["environment", "mining"]), deliverables: sub([4, 5]), acceptance: "Closure cost estimate peer-reviewed; financial provision methodology documented" },
      { check: "Regulatory submission package reviewed before lodgement", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: sub([5]), acceptance: "Package checklist signed off; legal counsel review memo on file" },
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour/.test(s)) {
    return [
      { check: "Met-ocean data set validated (≥ 20 years) before berth layout is finalised", responsibleRole: rolesByKeyword(experts, ["port", "marine", "coastal"]), deliverables: sub([1, 2]), acceptance: "Data source documented; extreme value analysis confirmed; design conditions peer-reviewed" },
      { check: "Nautical simulation validates berth layout and turning basin before structural design", responsibleRole: rolesByKeyword(experts, ["nautical", "port", "marine"]), deliverables: sub([2]), acceptance: "Fast-time simulation report on file; layout confirmed safe for design vessel class under design wind/current" },
      { check: "Dredge material characterisation completed before disposal site is selected", responsibleRole: rolesByKeyword(experts, ["environment", "marine"]), deliverables: sub([2, 3]), acceptance: "Bulk chemistry and elutriate test results documented; disposal site pre-approved by environmental authority" },
      { check: "Berth structural design peer-reviewed before construction issue", responsibleRole: rolesByKeyword(experts, ["structural", "port"]), deliverables: sub([3, 4]), acceptance: "Structural peer review memo on file; foundation design confirmed against geotechnical data" },
      { check: "ISPS compliance documentation issued before commissioning", responsibleRole: rolesByKeyword(experts, ["port", "security"]), deliverables: sub([4, 5]), acceptance: "PFSP completed; restricted area designations documented; security officer training plan issued" },
      { check: "Pre-operations nautical safety review completed before first vessel call", responsibleRole: rolesByKeyword(experts, ["nautical", "port"]), deliverables: sub([5]), acceptance: "Safety review report on file; recommendations closed or formally accepted" },
    ];
  }
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(s)) {
    return [
      { check: "HAZOP action register formally closed before construction release", responsibleRole: rolesByKeyword(experts, ["process", "safety", "hazop"]), deliverables: sub([2, 3]), acceptance: "All HAZOP actions closed or formally deferred with written client acceptance; no construction release without formal sign-off" },
      { check: "P&ID interdisciplinary check completed before detailed engineering", responsibleRole: rolesByKeyword(experts, ["process", "mechanical"]), deliverables: sub([2]), acceptance: "IDC sign-off memo on file; all pipe classes and instrument tags consistent with process data" },
      { check: "Pipeline stress analysis (Caesar II or equivalent) peer-reviewed", responsibleRole: rolesByKeyword(experts, ["pipeline", "mechanical", "process"]), deliverables: sub([3]), acceptance: "Stress analysis report peer-reviewed; ASME B31.4/B31.8 compliance confirmed" },
      { check: "Cathodic protection design reviewed before installation", responsibleRole: rolesByKeyword(experts, ["electrical", "pipeline"]), deliverables: sub([3, 4]), acceptance: "CP design review memo on file; soil resistivity survey data used in design" },
      { check: "Pre-commissioning hydrotest and ESD testing completed before handover", responsibleRole: rolesByKeyword(experts, ["commissioning", "process"]), deliverables: sub([5]), acceptance: "Hydrotest records signed by Resident Engineer and client; ESD functional test records on file" },
      { check: "As-built package and integrity management plan issued with handover", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: sub([5, 6]), acceptance: "As-built drawings match construction; ILI baseline run schedule confirmed" },
    ];
  }
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(s)) {
    return [
      { check: "Regulatory gap analysis reviewed by licensed local legal counsel before design", responsibleRole: rolesByKeyword(experts, ["compliance", "regulatory", "legal"]), deliverables: sub([1, 2]), acceptance: "Legal counsel review memo on file; gap analysis sign-off completed before system design begins" },
      { check: "RBAC role matrix documented and signed off by data owner before go-live", responsibleRole: rolesByKeyword(experts, ["security", "compliance", "architect"]), deliverables: sub([3, 4]), acceptance: "RBAC matrix on file; data owner sign-off; encryption at rest and in transit confirmed" },
      { check: "UAT completed with documented acceptance criteria and named sign-off authority", responsibleRole: rolesByKeyword(experts, ["analyst", "test", "business"]), deliverables: sub([4]), acceptance: "UAT sign-off on file; all critical defects closed before parallel-run" },
      { check: "Data reconciliation validated and signed off before go-live cutover", responsibleRole: rolesByKeyword(experts, ["data", "migration", "analyst"]), deliverables: sub([4, 5]), acceptance: "Reconciliation report on file; named data owner sign-off; rollback plan tested" },
      { check: "Pre-go-live penetration test completed and remediation confirmed", responsibleRole: rolesByKeyword(experts, ["security", "cyber"]), deliverables: sub([4, 5]), acceptance: "Penetration test report on file; all critical findings remediated before go-live" },
      { check: "Regulatory compliance attestation included in handover documentation", responsibleRole: rolesByKeyword(experts, ["compliance", "principal"]), deliverables: sub([5, 6]), acceptance: "Attestation signed by legal counsel; handover pack includes source code, data, and documentation" },
    ];
  }
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(s)) {
    return [
      { check: "In-principle spectrum approval received before site engineering starts", responsibleRole: rolesByKeyword(experts, ["spectrum", "regulatory", "rf"]), deliverables: sub([1]), acceptance: "Regulatory authority acknowledgement on file; no site civil works before spectrum in-principle approval" },
      { check: "Coverage simulation uses calibrated propagation model (field-measured correction factors)", responsibleRole: rolesByKeyword(experts, ["rf", "network", "radio"]), deliverables: sub([2, 3]), acceptance: "Calibration drive-test data on file; correction factors documented; simulation meets coverage KPIs" },
      { check: "Backhaul path availability calculated (Rayleigh + rain) for each microwave hop", responsibleRole: rolesByKeyword(experts, ["backhaul", "transmission", "network"]), deliverables: sub([3]), acceptance: "Path availability ≥ 99.99% for each hop; Vigants-Barnett + Crane rain model applied" },
      { check: "SAT protocol issued and completed per site before commercial launch", responsibleRole: rolesByKeyword(experts, ["commissioning", "test", "rf"]), deliverables: sub([4, 5]), acceptance: "SAT checklist on file per site; all RF, power, transmission, and alarm items signed off" },
      { check: "Drive-test acceptance completed against coverage KPIs before commercial launch", responsibleRole: rolesByKeyword(experts, ["rf", "test", "network"]), deliverables: sub([5]), acceptance: "Drive-test report on file; coverage KPIs met; dead zones documented and resolved" },
      { check: "EMR compliance certificates filed for all base stations before commercial operation", responsibleRole: rolesByKeyword(experts, ["rf", "regulatory"]), deliverables: sub([5, 6]), acceptance: "EMR certificate per site on file; exclusion zones marked on site drawings" },
    ];
  }
  // Generic fallback
  return [
    { check: "All scope items addressed and traceable to the ToR", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: all, acceptance: "Compliance matrix shows every requirement covered" },
    { check: "Methodology + work plan reviewed at 30 / 60 / 100% gates", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: all, acceptance: "Sign-off memo from Project Principal at each gate" },
    { check: "Deliverable formatting matches client templates (file names, fonts, layout)", responsibleRole: "Project Manager", deliverables: all, acceptance: "Spot-check of three deliverables passes formatting audit" },
    { check: "Independent peer review at 100% gate by senior reviewer outside the project team", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: all, acceptance: "Reviewer's comments closed or escalated; sign-off recorded" },
    { check: "Risk register reviewed and updated monthly", responsibleRole: rolesByKeyword(experts, ["principal", "director", "manager"]), deliverables: all, acceptance: "Register reviewed in monthly client meeting; mitigations on file" },
  ];
}

export interface DeliverableQaChecklistResult {
  markdown: string;
  injected: boolean;
  rowsRendered: number;
}

export function injectDeliverableQaChecklist(markdown: string, opts: DeliverableQaChecklistOpts): DeliverableQaChecklistResult {
  if (markdown.includes(MARKER)) {
    return { markdown, injected: false, rowsRendered: 0 };
  }
  const dCodes = (opts.deliverableCodes && opts.deliverableCodes.length > 0)
    ? opts.deliverableCodes
    : detectDeliverableCodes(opts.tenderText);
  const rows = sectorChecklistRows(opts.primarySector, opts.experts, dCodes);
  const head = "| QA Check Item | Responsible | Deliverable | Acceptance Standard |";
  const sep = "|---------------|-------------|-------------|---------------------|";
  const body = rows.map((r) => `| ${r.check} | ${r.responsibleRole} | ${r.deliverables} | ${r.acceptance} |`);
  const block = [
    "",
    MARKER,
    "## Deliverable-Specific Quality Assurance Checklist",
    "",
    "Before each formal submission to the client, the Project Manager verifies the following checklist. Any failed line blocks submission until resolved.",
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");

  // Insert near the end of Section C (Technical Approach). If a Section D
  // heading exists, insert just before it. Otherwise append at the end of
  // the document.
  const sectionDStart = markdown.search(/^# Section D[^\n]*$/m);
  if (sectionDStart >= 0) {
    return {
      markdown: `${markdown.slice(0, sectionDStart)}${block}\n${markdown.slice(sectionDStart)}`,
      injected: true,
      rowsRendered: rows.length,
    };
  }
  return {
    markdown: `${markdown.replace(/\s+$/, "")}\n${block}`,
    injected: true,
    rowsRendered: rows.length,
  };
}
