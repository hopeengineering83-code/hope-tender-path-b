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
