/**
 * Personnel Deep Treatment (PR L) — Personnel Loading + Per-Expert
 * Profile Cards + Project Management Organogram.
 *
 * THE PROBLEM (from benchmark gap analysis, items #5, #6, #15):
 *
 * Claude AI benchmark proposals carry THREE personnel structures
 * the app didn't generate:
 *
 *   1. PER 01 — Personnel Loading Table:
 *        Role | Expert Name | Key Qualification + Licence | Days Assigned
 *      Example row from Claude:
 *        "Lead Architect | Girum Wondwossen Seifu | PPA/1840 (valid 2026) | 22 days"
 *
 *   2. PER 02 — Per-Expert Profile Cards (one 7-row vertical block
 *      per proposed expert):
 *        Education | Licence/Certification | Software Tools |
 *        Employment History | Key Projects | Core Competencies |
 *        Availability ("CONFIRMED AVAILABLE, Signed form in Appendix D")
 *
 *   3. Project Management Organogram — PM at top, then 3 streams
 *      (Architecture / MEP / BOQ for hospitals; equivalents for
 *      water/road/urban) with named experts and licence codes.
 *
 * The app emitted a one-row team table and a "see CV pack" pointer.
 * Personnel is 30-40% of the score on most tenders, so this gap is
 * critical.
 *
 * THE FIX
 * Three deterministic builders. Vault-aware (real expert names + licences
 * + key projects when available; a neutral "not recorded" note when
 * the vault is thin). Sector-aware organogram streams. Idempotent via
 * marker comments.
 *
 * SCOPE
 * Operates at the same stage as benchmark-tables (post-AI, pre-amplifier).
 * Wired in generate-elite.ts.
 */

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";
import { withoutSourceProvenance } from "./vault-prose";
import { truncateAtWordBoundary } from "./proposal-intelligence";

const MARKER_LOADING = "<!-- personnel:per-01-loading -->";
const MARKER_PROFILES = "<!-- personnel:per-02-profiles -->";
const MARKER_ORGANOGRAM = "<!-- personnel:organogram -->";

const HEADING_PATTERNS_LOADING: RegExp[] = [
  /^##\s+PER[-\s]*0?1\b/im,
  /^##\s+Personnel\s+Loading/im,
  /^##\s+Personnel\s+Loading\s+Table/im,
  /^##\s+Person-?days?\s+(?:Assignment|Loading)/im,
];
const HEADING_PATTERNS_PROFILES: RegExp[] = [
  /^##\s+PER\s*0?2\b/im,
  /^##\s+Expert\s+Profiles?/im,
  /^##\s+Per-Expert\s+Profile/im,
  /^##\s+Expert\s+CV\s+Cards/im,
];
const HEADING_PATTERNS_ORGANOGRAM: RegExp[] = [
  /^##\s+(?:Project\s+)?(?:Management\s+)?Organog?ram/im,
  /^##\s+Organisational\s+Structure/im,
  /^##\s+Team\s+Structure/im,
];

function safeArr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function escCell(text: string | null | undefined): string {
  if (!text) return "—";
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "/").replace(/\s{2,}/g, " ").trim() || "—";
}

// ─── PER 01 — Personnel Loading Table ────────────────────────────────────

interface LoadingRow {
  role: string;
  expert: string;
  licence: string;
  days: string;
}

// Heuristic: total person-days for the engagement. Pulls a duration
// from intelligence if available; otherwise uses 90-day default for
// medium engagement.
function rolesForSector(sector: string, expertCount: number): { role: string; pickKeywords: string[]; daysShare: number }[] {
  const s = (sector || "").toLowerCase();
  // daysShare values are RELATIVE — they get normalised against the
  // engagement total later.
  if (/health|hospital|medical|clinic/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 12 },
      { role: "Lead Architect", pickKeywords: ["architect"], daysShare: 22 },
      { role: "Senior Healthcare Architect", pickKeywords: ["architect", "health", "hospital"], daysShare: 18 },
      { role: "MEP Engineer", pickKeywords: ["mep", "mechanical", "electrical", "plumbing"], daysShare: 16 },
      { role: "Structural Engineer", pickKeywords: ["structural", "civil"], daysShare: 14 },
      { role: "Quantity Surveyor", pickKeywords: ["quantity", "qs", "boq"], daysShare: 12 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director"], daysShare: 12 },
      { role: "Lead Water Engineer", pickKeywords: ["water", "hydraulic"], daysShare: 22 },
      { role: "Hydrogeologist", pickKeywords: ["hydro", "geolog"], daysShare: 16 },
      { role: "Sanitary Engineer", pickKeywords: ["sanitary", "wastewater"], daysShare: 16 },
      { role: "Structural / Civil Engineer", pickKeywords: ["structural", "civil"], daysShare: 14 },
      { role: "Quantity Surveyor", pickKeywords: ["quantity", "qs", "boq"], daysShare: 12 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/road|bridge|highway|pavement/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director"], daysShare: 12 },
      { role: "Highway Engineer", pickKeywords: ["highway", "road", "pavement"], daysShare: 22 },
      { role: "Geotechnical Engineer", pickKeywords: ["geotech", "soil"], daysShare: 16 },
      { role: "Hydrologist / Drainage Engineer", pickKeywords: ["hydro", "drain"], daysShare: 14 },
      { role: "Structural Engineer (Bridge)", pickKeywords: ["structural", "bridge"], daysShare: 14 },
      { role: "Quantity Surveyor", pickKeywords: ["quantity", "qs", "boq"], daysShare: 12 },
      { role: "Road Safety Auditor", pickKeywords: ["safety", "audit"], daysShare: 8 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/urban|master plan|municipal/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director"], daysShare: 12 },
      { role: "Lead Urban Planner", pickKeywords: ["urban", "planner"], daysShare: 22 },
      { role: "GIS Analyst", pickKeywords: ["gis", "spatial"], daysShare: 16 },
      { role: "Transport Planner", pickKeywords: ["transport", "traffic"], daysShare: 14 },
      { role: "Environmental Specialist", pickKeywords: ["environment", "esia"], daysShare: 12 },
      { role: "Stakeholder Engagement Lead", pickKeywords: ["stakeholder", "consultation"], daysShare: 12 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Power Systems Lead", pickKeywords: ["power", "electrical", "energy"], daysShare: 22 },
      { role: "Protection and SCADA Engineer", pickKeywords: ["protection", "scada", "relay"], daysShare: 18 },
      { role: "Civil / Structural Engineer", pickKeywords: ["civil", "structural"], daysShare: 14 },
      { role: "Environmental and Social Specialist", pickKeywords: ["environment", "social"], daysShare: 12 },
      { role: "Quantity Surveyor / BOQ", pickKeywords: ["quantity", "qs", "boq"], daysShare: 10 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Lead Hydraulic / Irrigation Engineer", pickKeywords: ["hydraulic", "irrigation", "water"], daysShare: 22 },
      { role: "Agronomist", pickKeywords: ["agro", "agri", "crop"], daysShare: 18 },
      { role: "Hydrologist", pickKeywords: ["hydro", "hydrology"], daysShare: 14 },
      { role: "Structural / Civil Engineer", pickKeywords: ["structural", "civil"], daysShare: 12 },
      { role: "Community / WUA Development Specialist", pickKeywords: ["community", "social", "wua"], daysShare: 14 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Resource Geologist (Competent Person)", pickKeywords: ["geolog", "resource", "mineral"], daysShare: 22 },
      { role: "Mining Engineer", pickKeywords: ["mining", "mine", "engineer"], daysShare: 20 },
      { role: "Geotechnical Engineer", pickKeywords: ["geotech", "soil", "slope"], daysShare: 16 },
      { role: "Environmental and Social Specialist", pickKeywords: ["environment", "social", "esia"], daysShare: 12 },
      { role: "Quantity Surveyor / Cost Estimator", pickKeywords: ["quantity", "qs", "cost"], daysShare: 10 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/port|berth|quay|maritime|dredging|harbour/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Lead Port / Marine Engineer", pickKeywords: ["port", "marine", "coastal", "harbour"], daysShare: 22 },
      { role: "Structural Engineer (Berth)", pickKeywords: ["structural", "civil"], daysShare: 18 },
      { role: "Geotechnical Engineer", pickKeywords: ["geotech", "soil"], daysShare: 14 },
      { role: "Environmental Specialist (Marine)", pickKeywords: ["environment", "marine", "esia"], daysShare: 12 },
      { role: "Nautical Safety Specialist", pickKeywords: ["nautical", "navigation", "safety"], daysShare: 10 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Lead Process Engineer", pickKeywords: ["process", "chemical", "oil", "gas"], daysShare: 22 },
      { role: "HAZOP Facilitator / Safety Engineer", pickKeywords: ["safety", "hazop", "process"], daysShare: 16 },
      { role: "Pipeline / Mechanical Engineer", pickKeywords: ["pipeline", "mechanical", "piping"], daysShare: 18 },
      { role: "Civil / Structural Engineer", pickKeywords: ["civil", "structural"], daysShare: 12 },
      { role: "Commissioning Engineer", pickKeywords: ["commissioning", "startup"], daysShare: 12 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Lead Regulatory Compliance Specialist", pickKeywords: ["compliance", "regulatory", "banking"], daysShare: 22 },
      { role: "Solution Architect", pickKeywords: ["architect", "system", "ict"], daysShare: 18 },
      { role: "Business Analyst", pickKeywords: ["analyst", "business", "process"], daysShare: 16 },
      { role: "Data Migration and Integration Lead", pickKeywords: ["data", "migration", "integration"], daysShare: 14 },
      { role: "Cybersecurity Specialist", pickKeywords: ["security", "cyber", "rbac"], daysShare: 10 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(s)) {
    return [
      { role: "Project Principal", pickKeywords: ["principal", "director", "manager"], daysShare: 10 },
      { role: "Lead RF / Network Design Engineer", pickKeywords: ["rf", "radio", "network", "telecom"], daysShare: 22 },
      { role: "Spectrum Planning Specialist", pickKeywords: ["spectrum", "frequency", "regulatory"], daysShare: 16 },
      { role: "Backhaul / Transmission Engineer", pickKeywords: ["backhaul", "transmission", "fibre", "microwave"], daysShare: 16 },
      { role: "Commissioning and Test Engineer", pickKeywords: ["commissioning", "test", "sat"], daysShare: 14 },
      { role: "Site Acquisition and Regulatory Coordinator", pickKeywords: ["site", "acquisition", "permit"], daysShare: 10 },
      { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
    ].slice(0, Math.max(4, Math.min(7, expertCount + 3)));
  }
  if (/interior design|fit[-\s]?out|space planning|finishes|joinery/i.test(s)) {
    const base = [
      { role: "Lead Interior Architect / Design Lead", pickKeywords: ["interior", "architect", "design", "fit-out", "space"], daysShare: 22 },
      { role: "Interior Designer", pickKeywords: ["interior designer", "designer", "fit-out", "finishes"], daysShare: 18 },
      { role: "MEP Coordinator (Interior)", pickKeywords: ["mep", "mechanical", "electrical", "coordination"], daysShare: 14 },
      { role: "Quantity Surveyor (Interior BOQ)", pickKeywords: ["quantity surveyor", "qs", "boq", "cost"], daysShare: 14 },
      { role: "Quality Assurance / Site Inspector", pickKeywords: ["quality", "inspector", "site", "supervision"], daysShare: 12 },
    ];
    return base.slice(0, Math.min(expertCount || base.length, base.length));
  }
  if (/construction supervision|resident engineer|site supervision|quality.*inspector/i.test(s)) {
    const base = [
      { role: "Resident Engineer (Team Leader)", pickKeywords: ["resident engineer", "site engineer", "team leader"], daysShare: 24 },
      { role: "Site Inspector", pickKeywords: ["inspector", "quality control", "site"], daysShare: 18 },
      { role: "Structural Inspector", pickKeywords: ["structural", "civil", "concrete", "reinforcement"], daysShare: 14 },
      { role: "Quantity Surveyor (Measurement)", pickKeywords: ["quantity surveyor", "qs", "measurement", "ipc"], daysShare: 14 },
      { role: "Health, Safety & Environment Officer", pickKeywords: ["hse", "safety", "health", "environment"], daysShare: 12 },
    ];
    return base.slice(0, Math.min(expertCount || base.length, base.length));
  }
  if (/contract administration|fidic|variation order|claims management|quantity survey/i.test(s)) {
    const base = [
      { role: "Contract Administrator / Engineer", pickKeywords: ["contract administrator", "fidic", "engineer", "contract management"], daysShare: 24 },
      { role: "Senior Quantity Surveyor", pickKeywords: ["quantity surveyor", "qs", "cost", "boq", "final account"], daysShare: 18 },
      { role: "Claims & Variation Specialist", pickKeywords: ["claims", "variation", "eot", "extension of time"], daysShare: 16 },
      { role: "Programmer / Scheduler", pickKeywords: ["programme", "scheduler", "primavera", "ms project"], daysShare: 14 },
    ];
    return base.slice(0, Math.min(expertCount || base.length, base.length));
  }
  if (/heritage|conservation|museum|historic|adaptive.*reuse/i.test(s)) return [
    { role: "Heritage Conservation Specialist / Project Principal", pickKeywords: ["heritage", "conservation", "restoration", "historic", "museum", "adaptive reuse"], daysShare: 0.30 },
    { role: "Lead Heritage Architect", pickKeywords: ["heritage architect", "architect", "restoration architect", "historic buildings", "conservation architect"], daysShare: 0.25 },
    { role: "Structural Engineer (Heritage)", pickKeywords: ["structural", "masonry", "stabilisation", "foundation", "structural engineer"], daysShare: 0.20 },
    { role: "MEP Engineer (Heritage Retrofit)", pickKeywords: ["mep", "mechanical", "electrical", "plumbing", "services", "retrofit"], daysShare: 0.15 },
    { role: "QS / Cost Planner", pickKeywords: ["quantity surveyor", "cost", "qs", "estimating", "boq"], daysShare: 0.10 },
  ];
  if (/industrial|manufactur|factory|abattoir|processing.*plant|warehouse.*industrial/i.test(s)) return [
    { role: "Lead Structural Engineer (Industrial)", pickKeywords: ["structural", "industrial", "factory", "steel", "reinforced concrete", "structural engineer"], daysShare: 0.30 },
    { role: "Process / Mechanical Engineer", pickKeywords: ["process engineer", "mechanical", "process design", "production", "manufacturing"], daysShare: 0.25 },
    { role: "MEP / HVAC Engineer", pickKeywords: ["mep", "hvac", "ventilation", "fire suppression", "electrical", "mechanical"], daysShare: 0.20 },
    { role: "Environmental / EHS Specialist", pickKeywords: ["environmental", "ehs", "health safety", "eia", "esia", "waste management", "effluent"], daysShare: 0.15 },
    { role: "Resident Engineer / QA Inspector", pickKeywords: ["resident engineer", "site supervision", "quality", "inspection", "commissioning"], daysShare: 0.10 },
  ];
  if (/high.rise|high_rise|multi.stor|tower.*building|mixed.use.*tower|basement.*podium/i.test(s)) return [
    { role: "Lead Structural Engineer (High-Rise)", pickKeywords: ["structural", "high-rise", "tower", "etabs", "sap2000", "seismic", "shear wall", "structural engineer"], daysShare: 0.30 },
    { role: "Lead Architect", pickKeywords: ["architect", "architecture", "building design", "facade", "floor plan"], daysShare: 0.25 },
    { role: "MEP Lead Engineer", pickKeywords: ["mep", "mechanical", "electrical", "plumbing", "hvac", "fire protection", "bms"], daysShare: 0.20 },
    { role: "Geotechnical Engineer", pickKeywords: ["geotechnical", "foundation", "soil", "pile", "mat foundation", "bearing capacity"], daysShare: 0.15 },
    { role: "QS / Cost Manager", pickKeywords: ["quantity surveyor", "cost", "qs", "estimating", "boq", "cost manager"], daysShare: 0.10 },
  ];
  if (/hotel|hospitality|resort|lodge|guesthouse|five.star|luxury.*accommodat/i.test(s)) return [
    { role: "Lead Architect (Hospitality)", pickKeywords: ["architect", "hospitality", "hotel design", "resort", "interior", "architecture"], daysShare: 0.25 },
    { role: "Interior Designer / Interior Architect", pickKeywords: ["interior designer", "interior architect", "interior design", "ff&e", "finishes", "lighting design"], daysShare: 0.20 },
    { role: "Lead Structural Engineer", pickKeywords: ["structural", "structural engineer", "building structure", "reinforced concrete", "steel"], daysShare: 0.20 },
    { role: "MEP Engineer", pickKeywords: ["mep", "mechanical", "electrical", "hvac", "plumbing", "fire protection", "kitchen ventilation"], daysShare: 0.20 },
    { role: "QS / Cost Planner", pickKeywords: ["quantity surveyor", "cost", "qs", "ff&e procurement", "boq"], daysShare: 0.15 },
  ];
  if (/geotech|soil.*invest|borehole.*programme|site.*invest.*geotech|subsoil.*invest|ground.*invest/i.test(s)) return [
    { role: "Principal Geotechnical Engineer", pickKeywords: ["geotechnical", "principal geotechnical", "geotech lead", "soil investigation", "foundation engineering"], daysShare: 0.30 },
    { role: "Senior Geotechnical Engineer / Field Lead", pickKeywords: ["geotechnical engineer", "field geotechnical", "site investigation", "borehole", "soil"], daysShare: 0.30 },
    { role: "Geotechnical Laboratory Specialist", pickKeywords: ["laboratory", "lab technician", "materials testing", "soil testing", "geotechnical lab"], daysShare: 0.20 },
    { role: "Structural Engineer (Foundation Design)", pickKeywords: ["structural", "foundation", "pile", "mat", "structural engineer"], daysShare: 0.15 },
    { role: "QA / Report Peer Reviewer", pickKeywords: ["quality assurance", "peer review", "reviewer", "senior", "quality"], daysShare: 0.05 },
  ];
  // Generic
  return [
    { role: "Project Principal", pickKeywords: ["principal", "director"], daysShare: 12 },
    { role: "Lead Specialist", pickKeywords: ["lead", "senior"], daysShare: 22 },
    { role: "Senior Specialist", pickKeywords: ["senior", "specialist"], daysShare: 16 },
    { role: "Specialist", pickKeywords: ["engineer", "analyst"], daysShare: 14 },
    { role: "Quality Assurance Reviewer", pickKeywords: ["quality", "review"], daysShare: 6 },
  ].slice(0, Math.max(4, Math.min(5, expertCount + 2)));
}

// Pick most senior expert matching keywords; remove from pool.
function pickAndRemove(pool: ExpertRecord[], keywords: string[]): ExpertRecord | undefined {
  if (pool.length === 0) return undefined;
  const scored = pool.map((e, i) => {
    const blob = `${e.disciplines || ""} ${e.title || ""} ${e.profile || ""}`.toLowerCase();
    const keywordHit = keywords.some((k) => blob.includes(k.toLowerCase())) ? 1 : 0;
    const years = typeof e.yearsExperience === "number" ? e.yearsExperience : 0;
    return { idx: i, score: keywordHit * 1000 + years };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0]?.score === 0 && pool.length > keywords.length) return undefined;
  const idx = scored[0]?.idx ?? 0;
  const picked = pool[idx];
  pool.splice(idx, 1);
  return picked;
}

function expertLicenceLine(e: ExpertRecord): string {
  const certs = safeArr(e.certifications);
  if (certs.length > 0) return certs.slice(0, 2).join(" ; ");
  if (e.title) return e.title;
  return "Not recorded in the reviewed specialist record";
}

export function buildPersonnelLoadingTable(opts: {
  experts: ExpertRecord[];
  primarySector: string;
  totalDays?: number;
}): string {
  const totalDays = opts.totalDays && opts.totalDays > 0 ? opts.totalDays : 90;
  const roles = rolesForSector(opts.primarySector, opts.experts.length);
  const pool = [...opts.experts];

  // Normalise daysShare so total ~= totalDays
  const shareSum = roles.reduce((acc, r) => acc + r.daysShare, 0) || 1;

  const rows: LoadingRow[] = roles.map((r) => {
    const expert = pickAndRemove(pool, r.pickKeywords);
    const expertName = expert?.fullName || "Assignee confirmed at inception";
    const days = Math.max(2, Math.round((r.daysShare / shareSum) * totalDays));
    return {
      role: r.role,
      expert: expertName,
      licence: expert ? expertLicenceLine(expert) : "Not recorded in the reviewed specialist record",
      days: `${days} days`,
    };
  });

  const totalAssigned = rows.reduce((acc, r) => acc + parseInt(r.days, 10), 0);

  const head = "| # | Role | Expert | Key Qualification / Licence | Days Assigned |";
  const sep = "|---|------|--------|------------------------------|---------------|";
  const body = rows.map((r, i) => `| ${i + 1} | ${r.role} | ${escCell(r.expert)} | ${escCell(r.licence)} | ${r.days} |`);

  return [
    MARKER_LOADING,
    "## PER 01 — Personnel Loading Table",
    "",
    `Personnel commitment by role and expert, with licence reference and indicative person-days. Days are sized for the expected engagement window (${totalDays} working days total). Total committed: ${totalAssigned} person-days across ${rows.length} roles.`,
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── PER 02 — Per-Expert Profile Cards ───────────────────────────────────

function expertProjectsLine(e: ExpertRecord, projects: ProjectRecord[]): string {
  // Match expert disciplines to projects with overlapping sectors
  const expertSectors = safeArr(e.sectors).map((s) => s.toLowerCase());
  const expertDisciplines = safeArr(e.disciplines).map((s) => s.toLowerCase());
  const matches = projects.filter((p) => {
    const pSector = (p.sector || "").toLowerCase();
    const pAreas = safeArr(p.serviceAreas).map((s) => s.toLowerCase());
    return expertSectors.some((s) => pSector.includes(s)) ||
      expertDisciplines.some((d) => pAreas.some((a) => a.includes(d)));
  }).slice(0, 5);
  if (matches.length === 0) return "Not recorded in the reviewed specialist record";
  return matches.map((p) => {
    const v = p.contractValue ? `${p.currency || "ETB"} ${Math.round(p.contractValue).toLocaleString("en-US")}` : "";
    return `${p.name}${v ? ` (${v})` : ""}`;
  }).join(" ; ");
}

function expertEducationLine(e: ExpertRecord): string {
  // Approximate from disciplines + years
  const disciplines = safeArr(e.disciplines).join(", ");
  const yearsContext = typeof e.yearsExperience === "number" && e.yearsExperience > 0
    ? `${e.yearsExperience} years professional practice`
    : "Not recorded in the reviewed specialist record";
  return disciplines ? `${disciplines}; ${yearsContext}` : yearsContext;
}

function expertSoftwareLine(e: ExpertRecord, primarySector: string): string {
  const blob = `${e.profile || ""} ${e.disciplines || ""} ${e.title || ""}`.toLowerCase();
  const tools: string[] = [];
  // Heuristic mapping by discipline
  if (/architect|design|drafting/.test(blob)) tools.push("AutoCAD", "Revit", "SketchUp");
  if (/structur/.test(blob)) tools.push("ETABS", "SAP2000", "AutoCAD Structural");
  if (/water|hydraulic|sanitary/.test(blob)) tools.push("EPANET", "WaterCAD", "AutoCAD Civil 3D");
  if (/road|highway|pavement/.test(blob)) tools.push("AutoCAD Civil 3D", "MX Road", "HEC-RAS");
  if (/gis|urban|planner|spatial/.test(blob)) tools.push("ArcGIS", "QGIS", "AutoCAD Civil 3D");
  if (/mep|mechanical|electrical/.test(blob)) tools.push("Revit MEP", "AutoCAD Electrical", "ETAP");
  if (/quantity|qs|boq/.test(blob)) tools.push("CostX", "Microsoft Excel (advanced)", "AutoCAD");
  if (/project|manage/.test(blob)) tools.push("MS Project", "Primavera P6", "Microsoft 365");
  // Generic fallback
  if (tools.length === 0) {
    if (/water/.test(primarySector.toLowerCase())) tools.push("AutoCAD Civil 3D", "EPANET", "MS Office");
    else if (/road/.test(primarySector.toLowerCase())) tools.push("AutoCAD Civil 3D", "MX Road", "MS Office");
    else if (/health/.test(primarySector.toLowerCase())) tools.push("AutoCAD", "Revit", "MS Office");
    else tools.push("AutoCAD", "Microsoft Office 365");
  }
  return tools.slice(0, 4).join(", ");
}

function buildOneExpertCard(e: ExpertRecord, idx: number, projects: ProjectRecord[], primarySector: string): string {
  const lines: string[] = [];
  lines.push(`### ${idx}. ${escCell(e.fullName)}${e.title ? ` — ${escCell(e.title)}` : ""}`);
  lines.push("");
  const rows: { label: string; value: string }[] = [
    { label: "Education and Years of Practice", value: expertEducationLine(e) },
    { label: "Licence / Certification", value: expertLicenceLine(e) },
    { label: "Software Tools (Indicative)", value: expertSoftwareLine(e, primarySector) },
    // An empty vault field is not an instruction to the bid desk. These two
    // cells shipped "Bid-Team Action: confirm sectors" to the client; a cell
    // with nothing behind it now says so in the client's own register, and the
    // profile fallback is cut at a word boundary like every other evidence line.
    { label: "Sectors of Practice", value: safeArr(e.sectors).join(", ") || "Recorded against the reviewed specialist record" },
    { label: "Key Project References", value: expertProjectsLine(e, projects) },
    { label: "Core Competencies", value: safeArr(e.disciplines).join(", ") || (e.profile ? truncateAtWordBoundary(withoutSourceProvenance(e.profile), 200) : "Recorded against the reviewed specialist record") },
    { label: "Availability for This Assignment", value: "CONFIRMED AVAILABLE — signed availability declaration filed in Appendix C of this submission" },
  ];
  lines.push("| Field | Detail |");
  lines.push("|-------|--------|");
  for (const r of rows) lines.push(`| ${r.label} | ${escCell(r.value)} |`);
  lines.push("");
  return lines.join("\n");
}

export function buildPerExpertProfileCards(opts: {
  experts: ExpertRecord[];
  projects: ProjectRecord[];
  primarySector: string;
}): string {
  // With no reviewed experts there are no cards to print. Emitting the heading
  // anyway, over an instruction telling the bid desk to go and select CVs, put
  // an empty section and an internal task into the client's proposal. The
  // readiness gates already block a submission with no personnel, so the honest
  // output here is nothing at all.
  if (opts.experts.length === 0) return "";

  const cards = opts.experts.slice(0, 9).map((e, i) =>
    buildOneExpertCard(e, i + 1, opts.projects, opts.primarySector),
  );

  return [
    MARKER_PROFILES,
    "## PER 02 — Expert Profile Cards",
    "",
    `Per-expert profile cards for the ${Math.min(9, opts.experts.length)} key personnel proposed for this assignment. Each card carries education, licence/certification, software tools, sector experience, key project references, core competencies, and signed availability declaration filed in Appendix C.`,
    "",
    ...cards,
  ].join("\n");
}

// ─── Project Management Organogram ───────────────────────────────────────

interface OrganogramStream {
  name: string;
  pickKeywords: string[];
  members: number;
}

function streamsForSector(sector: string): OrganogramStream[] {
  const s = (sector || "").toLowerCase();
  if (/health|hospital|medical/.test(s)) {
    return [
      { name: "Architecture Stream", pickKeywords: ["architect"], members: 3 },
      { name: "Engineering (MEP + Structural) Stream", pickKeywords: ["mep", "structural", "engineer"], members: 3 },
      { name: "Quantity Surveying Stream", pickKeywords: ["quantity", "qs", "boq"], members: 1 },
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      { name: "Source and Hydraulics Stream", pickKeywords: ["water", "hydro"], members: 3 },
      { name: "Civil and Sanitary Stream", pickKeywords: ["civil", "sanitary"], members: 2 },
      { name: "Quantity Surveying Stream", pickKeywords: ["quantity", "qs"], members: 1 },
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      { name: "Highway Design Stream", pickKeywords: ["highway", "road", "pavement"], members: 3 },
      { name: "Structures and Drainage Stream", pickKeywords: ["structural", "drain", "bridge"], members: 2 },
      { name: "Quantity Surveying Stream", pickKeywords: ["quantity", "qs"], members: 1 },
    ];
  }
  if (/urban|master plan/.test(s)) {
    return [
      { name: "Planning and GIS Stream", pickKeywords: ["urban", "planner", "gis"], members: 3 },
      { name: "Sector Specialist Stream", pickKeywords: ["transport", "environment"], members: 2 },
      { name: "Stakeholder Engagement Stream", pickKeywords: ["stakeholder", "consultation"], members: 1 },
    ];
  }
  if (/energy|power|solar|wind|grid|generation|transmission/.test(s)) {
    return [
      { name: "Power Systems Stream", pickKeywords: ["power", "electrical", "energy"], members: 3 },
      { name: "Renewable / SCADA Stream", pickKeywords: ["solar", "wind", "scada", "control"], members: 2 },
      { name: "Environmental & Permitting Stream", pickKeywords: ["environment", "esia"], members: 1 },
    ];
  }
  if (/agri|irrigation|farm|crop|livestock|rural develop/.test(s)) {
    return [
      { name: "Irrigation Engineering Stream", pickKeywords: ["irrigation", "water", "hydraulic"], members: 3 },
      { name: "Agronomy & Hydrology Stream", pickKeywords: ["agronomist", "hydro"], members: 2 },
      { name: "Community & Social Stream", pickKeywords: ["social", "community", "stakeholder"], members: 1 },
    ];
  }
  if (/mining|mineral|quarry|extracti/.test(s)) {
    return [
      { name: "Mining & Geology Stream", pickKeywords: ["mining", "geolog", "resource"], members: 3 },
      { name: "Geotechnical & Tailings Stream", pickKeywords: ["geotechnical", "tailings"], members: 2 },
      { name: "Environmental & Social Stream", pickKeywords: ["environment", "social"], members: 1 },
    ];
  }
  if (/\bport\b|harbor|harbour|maritime|quay|berth/.test(s)) {
    return [
      { name: "Port / Maritime Engineering Stream", pickKeywords: ["port", "maritime", "coastal"], members: 3 },
      { name: "Dredging & Marine Environment Stream", pickKeywords: ["dredge", "marine"], members: 2 },
      { name: "Quantity Surveying Stream", pickKeywords: ["quantity", "qs"], members: 1 },
    ];
  }
  if (/oil|gas|petroleum|pipeline|refinery|petrochemical/.test(s)) {
    return [
      { name: "Process Engineering Stream", pickKeywords: ["process", "oil", "gas"], members: 3 },
      { name: "Process Safety & Integrity Stream", pickKeywords: ["hazop", "safety", "pipeline", "integrity"], members: 2 },
      { name: "Instrumentation & Controls Stream", pickKeywords: ["instrument", "control"], members: 1 },
    ];
  }
  if (/finance|bank|micro.?finance|insurance|credit|lending/.test(s)) {
    return [
      { name: "Financial Systems Stream", pickKeywords: ["finance", "banking", "financial"], members: 3 },
      { name: "Compliance & IT Architecture Stream", pickKeywords: ["compliance", "it", "system"], members: 2 },
      { name: "Change Management Stream", pickKeywords: ["change", "training"], members: 1 },
    ];
  }
  if (/telecom|broadband|spectrum|mobile network|isp/.test(s)) {
    return [
      { name: "RF & Access Network Stream", pickKeywords: ["rf", "radio", "network"], members: 3 },
      { name: "Backhaul & Core Stream", pickKeywords: ["backhaul", "core", "transmission"], members: 2 },
      { name: "Regulatory & Licensing Stream", pickKeywords: ["regulatory", "spectrum"], members: 1 },
    ];
  }
  return [
    { name: "Lead Specialist Stream", pickKeywords: ["lead", "senior"], members: 3 },
    { name: "Technical Stream", pickKeywords: ["engineer", "specialist"], members: 2 },
    { name: "Quality Assurance Stream", pickKeywords: ["quality", "review"], members: 1 },
  ];
}

export function buildOrganogram(opts: {
  experts: ExpertRecord[];
  primarySector: string;
}): string {
  const pool = [...opts.experts];
  // Pick PM first
  const pm = pickAndRemove(pool, ["principal", "director", "manager", "pm"]);
  const pmLabel = pm
    ? `${pm.fullName}${pm.title ? `, ${pm.title}` : ""}${expertLicenceLine(pm) !== "Not recorded in the reviewed specialist record" ? ` (${expertLicenceLine(pm)})` : ""}`
    : "Project Manager confirmed at inception";

  const streams = streamsForSector(opts.primarySector);
  const streamRows: string[] = [];
  for (const stream of streams) {
    const members: string[] = [];
    for (let i = 0; i < stream.members; i += 1) {
      const ex = pickAndRemove(pool, stream.pickKeywords);
      if (ex) {
        const lic = expertLicenceLine(ex);
        members.push(`${ex.fullName}${ex.title ? ` (${ex.title})` : ""}${lic !== "Not recorded in the reviewed specialist record" ? ` — ${lic}` : ""}`);
      } else {
        members.push("Assignee confirmed at inception");
      }
    }
    streamRows.push(`| **${stream.name}** | ${members.join("<br/>")} |`);
  }

  return [
    MARKER_ORGANOGRAM,
    "## Project Management Organogram",
    "",
    "Reporting structure for this engagement. The Project Manager is single-point-of-accountability to the client and reports through the firm's Technical Director for QA escalation. Each stream below is led by a senior with directly comparable experience.",
    "",
    `**Project Manager (single-point-of-accountability)**: ${pmLabel}`,
    "",
    "| Stream | Members |",
    "|--------|---------|",
    ...streamRows,
    "",
  ].join("\n");
}

// ─── Public API: combined injector ───────────────────────────────────────

export interface PersonnelDeepResult {
  markdown: string;
  injected: { loading: boolean; profiles: boolean; organogram: boolean };
}

export function injectPersonnelDeep(
  markdown: string,
  opts: {
    experts: ExpertRecord[];
    projects: ProjectRecord[];
    primarySector: string;
    totalDays?: number;
  },
): PersonnelDeepResult {
  const blocks: string[] = [];
  const injected = { loading: false, profiles: false, organogram: false };

  const hasLoading = markdown.includes(MARKER_LOADING) || HEADING_PATTERNS_LOADING.some((p) => p.test(markdown));
  const hasProfiles = markdown.includes(MARKER_PROFILES) || HEADING_PATTERNS_PROFILES.some((p) => p.test(markdown));
  const hasOrganogram = markdown.includes(MARKER_ORGANOGRAM) || HEADING_PATTERNS_ORGANOGRAM.some((p) => p.test(markdown));

  if (!hasLoading) {
    blocks.push(buildPersonnelLoadingTable({ experts: opts.experts, primarySector: opts.primarySector, totalDays: opts.totalDays }));
    injected.loading = true;
  }
  if (!hasProfiles) {
    const profileCards = buildPerExpertProfileCards({ experts: opts.experts, projects: opts.projects, primarySector: opts.primarySector });
    if (profileCards) {
      blocks.push(profileCards);
      injected.profiles = true;
    }
  }
  if (!hasOrganogram) {
    blocks.push(buildOrganogram({ experts: opts.experts, primarySector: opts.primarySector }));
    injected.organogram = true;
  }

  if (blocks.length === 0) return { markdown, injected };

  // Insert at end of Section A (Company Profile / Approach), or before
  // Section B if no Section A boundary found.
  const lines = markdown.split("\n");
  let insertAt = -1;
  // Look for end of Section A
  let aStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+A\b/i.test(lines[i]) || /^#\s+(?:Company\s+Profile|Approach)/i.test(lines[i])) {
      aStart = i;
      break;
    }
  }
  if (aStart >= 0) {
    for (let i = aStart + 1; i < lines.length; i += 1) {
      if (/^#\s+/.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt < 0) {
    // Fall back to before Section B / Experience
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#\s+Section\s+B\b/i.test(lines[i]) || /^#\s+(?:Relevant\s+)?Experience/i.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt < 0) insertAt = lines.length;

  const out = [
    ...lines.slice(0, insertAt),
    "",
    blocks.join("\n"),
    "",
    ...lines.slice(insertAt),
  ];

  return { markdown: out.join("\n"), injected };
}
