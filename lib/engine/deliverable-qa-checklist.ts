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
  if (/energy|power|solar|wind|grid|generation|transmission/.test(s)) {
    return [
      { check: "Load-flow model verified at design capacity and peak demand scenario", responsibleRole: rolesByKeyword(experts, ["power", "electrical", "energy"]), deliverables: sub([2, 3]), acceptance: "Voltage within ±5% at all buses; fault level within switchgear ratings" },
      { check: "Grid-code compliance documentation complete and reviewed", responsibleRole: rolesByKeyword(experts, ["power", "protection"]), deliverables: sub([3, 4]), acceptance: "All grid-code requirements checked; non-compliance findings resolved" },
      { check: "Protection relay coordination verified by independent power-systems specialist", responsibleRole: rolesByKeyword(experts, ["protection", "relay", "electrical"]), deliverables: sub([4]), acceptance: "Relay-settings memo peer-reviewed and signed; selectivity confirmed" },
      { check: "SCADA tag list and HMI screen layout reviewed by client operations team", responsibleRole: rolesByKeyword(experts, ["scada", "control", "ict"]), deliverables: sub([5]), acceptance: "Operations team sign-off on tag list; HMI comment-response register closed" },
      { check: "BOQ quantities verified against drawing takeoff", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([6]), acceptance: "Cross-check accuracy ≥ 98%; discrepancies flagged" },
      { check: "All deliverables peer-reviewed at 30 / 60 / 100% gates", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: all, acceptance: "Sign-off memo on file from Project Principal at each gate" },
    ];
  }
  if (/agri|irrigation|farm|crop|livestock|rural develop/.test(s)) {
    return [
      { check: "Hydrological analysis uses ≥ 20-year flow record; low-flow scenario verified", responsibleRole: rolesByKeyword(experts, ["hydro", "water"]), deliverables: sub([1, 2]), acceptance: "Data source and period documented; low-flow yield ≥ design demand" },
      { check: "FAO Penman-Monteith irrigation demand calculation reviewed and signed", responsibleRole: rolesByKeyword(experts, ["agronomist", "irrigation"]), deliverables: sub([2, 3]), acceptance: "Crop coefficient (Kc) values match FAO 56; calculation reviewed by lead engineer" },
      { check: "Irrigation network hydraulic model verified at design and peak demand", responsibleRole: rolesByKeyword(experts, ["irrigation", "hydraulic", "water"]), deliverables: sub([3]), acceptance: "Pressure within design envelope at all outlets; pump-head matches" },
      { check: "WUA governance structure reviewed by sociologist and legal adviser", responsibleRole: rolesByKeyword(experts, ["social", "community"]), deliverables: sub([5]), acceptance: "WUA bylaws reviewed; registration requirements confirmed with local authority" },
      { check: "O&M manual reviewed for local language clarity and completeness", responsibleRole: rolesByKeyword(experts, ["principal", "director"]), deliverables: sub([6]), acceptance: "Manual spot-checked by farmer representative; feedback incorporated" },
    ];
  }
  if (/mining|mineral|quarry|extracti/.test(s)) {
    return [
      { check: "Resource estimate JORC compliance reviewed by independent competent person", responsibleRole: rolesByKeyword(experts, ["geolog", "resource", "mining"]), deliverables: sub([1, 2]), acceptance: "Competent person sign-off memo on file; confidence classification documented" },
      { check: "Slope stability analysis uses ≥ 3 methods (LEM, numerical, empirical)", responsibleRole: rolesByKeyword(experts, ["geotechnical", "geotech"]), deliverables: sub([3]), acceptance: "All three methods documented; Factor of Safety ≥ 1.3 (static)" },
      { check: "TSF design reviewed against MAC/ANCOLD guidelines", responsibleRole: rolesByKeyword(experts, ["tailings", "geotechnical"]), deliverables: sub([4]), acceptance: "Dam-safety review memo; closure and financial provision calculated" },
      { check: "Environmental baseline and closure plan peer-reviewed by ESIA specialist", responsibleRole: rolesByKeyword(experts, ["environment", "esia", "social"]), deliverables: sub([5]), acceptance: "ESIA compliance checklist signed; no-net-loss biodiversity commitment documented" },
      { check: "Mine plan checked for consistency with resource model and production schedule", responsibleRole: rolesByKeyword(experts, ["mining", "mineral"]), deliverables: sub([2, 3]), acceptance: "Mine plan tonnage reconciled with resource model ± 5%" },
    ];
  }
  if (/\bport\b|harbor|harbour|maritime|quay|berth|shipping terminal/.test(s)) {
    return [
      { check: "Vessel-class parameters confirmed with port authority before design", responsibleRole: rolesByKeyword(experts, ["port", "maritime", "coastal"]), deliverables: sub([1]), acceptance: "Port authority written confirmation on file; LOA, DWT, draft documented" },
      { check: "Mooring analysis verified at design vessel in worst-case met-ocean conditions", responsibleRole: rolesByKeyword(experts, ["port", "maritime"]), deliverables: sub([2, 3]), acceptance: "Met-ocean data source documented; mooring forces within bollard/cleat ratings" },
      { check: "Dredge volume and disposal site confirmed; sediment characterisation completed", responsibleRole: rolesByKeyword(experts, ["dredge", "marine", "environment"]), deliverables: sub([2, 4]), acceptance: "Sediment characterisation report on file; disposal approval path confirmed" },
      { check: "ISPS compliance checklist completed and reviewed", responsibleRole: rolesByKeyword(experts, ["port", "maritime"]), deliverables: sub([5]), acceptance: "ISPS checklist 100% complete; port security plan template ready" },
      { check: "BOQ quantities verified against drawing takeoff", responsibleRole: rolesByKeyword(experts, ["quantity", "qs"]), deliverables: sub([6]), acceptance: "Cross-check accuracy ≥ 98%" },
    ];
  }
  if (/oil|gas|petroleum|pipeline|refinery|petrochemical/.test(s)) {
    return [
      { check: "All HAZOP action items tracked to close-out before detailed design freeze", responsibleRole: rolesByKeyword(experts, ["hazop", "safety", "process"]), deliverables: sub([3, 4]), acceptance: "Zero open HAZOP actions at design freeze; close-out register signed" },
      { check: "P&ID freeze confirmed; all post-HAZOP changes processed through MOC", responsibleRole: rolesByKeyword(experts, ["process", "piping"]), deliverables: sub([3]), acceptance: "MOC log shows all P&ID changes have risk re-assessment; P&ID revision history documented" },
      { check: "Pipeline stress analysis completed and peer-reviewed", responsibleRole: rolesByKeyword(experts, ["pipeline", "stress", "piping"]), deliverables: sub([4]), acceptance: "Stress isometrics reviewed; Caesar II or equivalent output reviewed by independent engineer" },
      { check: "Vendor data requirements issued with all purchase orders; tracking log current", responsibleRole: rolesByKeyword(experts, ["process", "procurement"]), deliverables: sub([5]), acceptance: "VDR issued per PO; weekly tracking shows no overdue items" },
      { check: "Cathodic protection and ILI programme specified at handover package", responsibleRole: rolesByKeyword(experts, ["pipeline", "integrity"]), deliverables: sub([6]), acceptance: "CP design calculations signed; ILI schedule specified per pipeline class" },
    ];
  }
  if (/finance|bank|micro.?finance|insurance|credit|lending/.test(s)) {
    return [
      { check: "Regulatory gap analysis reviewed by licensed local legal counsel", responsibleRole: rolesByKeyword(experts, ["compliance", "regulatory", "legal"]), deliverables: sub([1, 2]), acceptance: "Counsel sign-off on gap matrix; all high-risk gaps have remediation plans" },
      { check: "Data quality assessment completed before migration planning starts", responsibleRole: rolesByKeyword(experts, ["data", "migration"]), deliverables: sub([2]), acceptance: "Data quality scorecard ranked by business impact; critical issues remediated" },
      { check: "Integration architecture peer-reviewed by independent IT architect", responsibleRole: rolesByKeyword(experts, ["it", "system", "architect"]), deliverables: sub([3]), acceptance: "Architecture reviewed; all interfaces documented with protocols and error handling" },
      { check: "UAT protocol covers all critical business processes; defect triage completed", responsibleRole: rolesByKeyword(experts, ["finance", "banking"]), deliverables: sub([4]), acceptance: "UAT pass rate ≥ 98% for critical processes; zero P1 defects open at go-live" },
      { check: "Change-readiness survey completed at 60% gate; resistance hot-spots addressed", responsibleRole: rolesByKeyword(experts, ["change", "training"]), deliverables: sub([5]), acceptance: "Survey results reviewed by steering committee; action plan for red-zone units" },
    ];
  }
  if (/telecom|broadband|spectrum|mobile network|isp/.test(s)) {
    return [
      { check: "RF propagation model verified against field-measurement pilot sites", responsibleRole: rolesByKeyword(experts, ["rf", "radio", "network"]), deliverables: sub([1, 2]), acceptance: "Model vs. measurement RMSE ≤ 8 dB at pilot sites; coverage predictions credible" },
      { check: "Spectrum licence path confirmed with national regulator before network design freeze", responsibleRole: rolesByKeyword(experts, ["regulatory", "spectrum"]), deliverables: sub([1]), acceptance: "Written regulator confirmation on file; fallback band documented" },
      { check: "Backhaul link budget reviewed and site-to-site capacity verified", responsibleRole: rolesByKeyword(experts, ["backhaul", "transmission"]), deliverables: sub([3]), acceptance: "Each link meets availability target (≥ 99.9% at design rain rate)" },
      { check: "NOC KPI dashboard pre-configured and tested before commercial launch", responsibleRole: rolesByKeyword(experts, ["network", "ict"]), deliverables: sub([5]), acceptance: "All critical KPIs monitored; alert thresholds set; dashboard accepted by NOC team" },
      { check: "RF optimisation drive-test completed after commissioning; coverage map issued", responsibleRole: rolesByKeyword(experts, ["rf", "radio"]), deliverables: sub([6]), acceptance: "Drive-test coverage map meets agreed targets; gaps documented and resolved" },
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
