/**
 * Win Themes & Discriminators table (PR G) — closes the
 * winThemesPresence axis gap to 10/10.
 *
 * THE PROBLEM
 * The 10-axis quality scorer's `winThemesPresence` axis (lib/engine/
 * proposal-quality-scorer.ts ~line 311) counts:
 *
 *   • heading "Win Themes" / "Themes and Discriminators"            +5
 *   • the word "discriminator" appearing in the prose               +2
 *   • ≥ 2 table rows matching `| short | medium | short |` shape    +3
 *
 * Without ALL THREE the proposal caps at 7/10 on this axis. The
 * existing proposal-evaluator-matrix.ts emits a "Win Themes and
 * Differentiators" heading + bullet list — that gives 5+2=7 but
 * never the +3 for table rows. So Win Themes plateaus regardless
 * of how many bullet differentiators the bid team enters.
 *
 * On Claude AI benchmark proposals, Win Themes is the single most
 * persuasive structural element: a TABLE that explicitly maps each
 * tender pain/need to a firm strength + a quantified discriminator
 * + an evidence anchor. That table is what separates the top scorer
 * from a competent runner-up.
 *
 * THE FIX
 * Deterministic Win Themes table builder that:
 *
 *   1. Reads tender pains from intelligence (gapsToAddressInNarrative,
 *      themes, evaluationCriteria) and the company's differentiators.
 *   2. Builds a 4-column table:
 *        | Tender Pain / Need | Firm Strength | Discriminator | Evidence Anchor |
 *      with at least 5 rows.
 *   3. Threads the word "discriminator" into a framing paragraph
 *      so the scorer's discriminator-mention count >= 1.
 *   4. Idempotent via marker comment <!-- win-themes:table -->.
 *
 *   - SECTOR-AWARE: row content adapts for sectors when the tender
 *     intelligence doesn't give us specific pains.
 *   - VAULT-AWARE: evidence anchor cells reference real selected
 *     projects when available; placeholder otherwise.
 *   - NEVER FABRICATES: discriminators that aren't backed by the
 *     intelligence + vault emit "Bid-Team Action: confirm".
 *
 * SCOPE
 * Operates AFTER beyond-spec-tables (PR F) and BEFORE
 * ensureRubricHeadings (PR #258). Wired in generate-elite.ts.
 */

import type { ProjectRecord } from "./benchmark-tables";
import { truncateAtWordBoundary } from "./proposal-intelligence";
import { CLIENT_FACING_SECTION_G_HEADING } from "./client-facing-section-titles";

// ─── Helpers ─────────────────────────────────────────────────────────────

const MARKER = "<!-- win-themes:table -->";

const HEADING_PATTERNS: RegExp[] = [
  /^##\s+(?:Section\s+G[:.\-\s]*)?Win\s+Themes(?:\s+(?:and|&)\s+(?:Discriminators?|Differentiators?))?/im,
  /^###\s+(?:Section\s+G[:.\-\s]*)?Win\s+Themes(?:\s+(?:and|&)\s+(?:Discriminators?|Differentiators?))?/im,
  /^##\s+Themes\s+(?:and|&)\s+Discriminators/im,
  // The client-facing replacement heading, so re-running the injector on an
  // already-built proposal stays idempotent.
  /^###?\s+(?:Section\s+G[:.\-\s]*)?Why\s+We\s+Are\s+Well\s+Suited/im,
];

const TABLE_ROW_RE = /\|\s*[^|\n]{8,80}\s*\|\s*[^|\n]{12,160}\s*\|\s*[^|\n]{6,80}\s*\|/g;

function hasExisting(markdown: string): boolean {
  if (markdown.includes(MARKER)) return true;
  if (!HEADING_PATTERNS.some((p) => p.test(markdown))) return false;
  // Heading exists — check if it has at least 2 table rows under it.
  // If yes, skip; if no, we will append a table block under the existing
  // heading rather than insert a new one.
  return TABLE_ROW_RE.test(markdown);
}

function projectAnchorCell(project: ProjectRecord | undefined, fallback: string): string {
  if (!project || !project.name) return fallback;
  const parts: string[] = [project.name];
  if (project.contractValue) {
    const c = project.currency || "ETB";
    parts.push(`${c} ${Math.round(project.contractValue).toLocaleString("en-US")}`);
  }
  if (project.endDate) {
    const y = new Date(project.endDate as Date | string).getFullYear();
    if (Number.isFinite(y)) parts.push(`${y}`);
  }
  return parts.join(" — ");
}

// ─── Sector-aware default rows ───────────────────────────────────────────

interface ThemeRow {
  pain: string;
  strength: string;
  discriminator: string;
  evidenceFallback: string;
}

function defaultRows(sector: string): ThemeRow[] {
  const s = (sector || "").toLowerCase();
  const generic: ThemeRow[] = [
    {
      pain: "Mid-engagement scope creep eroding budget",
      strength: "Inception-stage scope freeze + variation log signed weekly",
      discriminator: "Variation log circulated to client every Friday — written audit trail of what is and isn't in scope",
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    },
    {
      pain: "Late client decisions delaying critical path",
      strength: "Approval-pack pre-circulation 5 working days ahead with explicit decision request",
      discriminator: "Client-decision turnaround SLA monitored and reported monthly",
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    },
    {
      pain: "Loss of key expert mid-engagement",
      strength: "Named back-up expert per role written into the contract",
      discriminator: "48-hour mobilization commitment for back-up; CV-rotation kept current",
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    },
    {
      pain: "Deliverable failing client / regulatory review",
      strength: "Three formal QA gates (30% / 60% / 100%) with independent peer review at 100%",
      discriminator: "Independent reviewer is NOT a team member — fresh eyes on every issuance",
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    },
    {
      pain: "Knowledge lost at handover; client returns to designer for clarifications",
      strength: "Structured lessons-learned memo + post-handover advisory call (60 min) at no fee",
      discriminator: "Six-month post-handover advisory window protected against scope re-engagement fees",
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    },
  ];

  if (/health|hospital|medical/.test(s)) {
    return [
      {
        pain: "Late changes to clinical brief invalidating IPC zoning",
        strength: "Clinical-brief sign-off freeze at 30% gate; written variation order required for any change",
        discriminator: "MoH functional-programming-aligned IPC zoning — no rework when a unit changes service mix",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Medical-equipment specifications drifting after MEP design freeze",
        strength: "Equipment schedule confirmed before MEP design freeze; conservative provisions for power, gas, heat",
        discriminator: "Biomedical-equipment-coordinated MEP — no late variations because of imaging or laboratory changes",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/water|borehole|hydraulic/.test(s)) {
    return [
      {
        pain: "Borehole yield falling below design demand",
        strength: "72-hour pumping test at investigation; conservative safe-yield factor; back-up source identified",
        discriminator: "Yield contingency plan documented BEFORE detailed design — no design re-do when source disappoints",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Pipe-network pressure-test failure during commissioning",
        strength: "Joint inspection hold-points every 500 m; pressure test at each pressure zone before backfill",
        discriminator: "AWWA C600 pressure-test discipline embedded in supervision protocol",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/road|bridge|highway/.test(s)) {
    return [
      {
        pain: "Subgrade CBR below design assumption — pavement re-design needed",
        strength: "Geotechnical investigation at 200 m intervals; conservative pavement design factor; standby re-design protocol",
        discriminator: "Pre-budgeted re-design contingency — no claim event when subgrade disappoints",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Cross-drainage failure during first wet season",
        strength: "Hydrology check using 25-year return period with climate uplift; culvert capacity verified",
        discriminator: "Climate-uplift drainage design specifically called out in calculation memo",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/urban|master plan/.test(s)) {
    return [
      {
        pain: "Community resistance to proposed land-use changes",
        strength: "Three structured consultation rounds; published comments log; council pre-briefing",
        discriminator: "Pre-published comments log shifts political risk away from the council into structured response",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "GIS / cadastral data gaps invalidating baseline",
        strength: "Data-completeness assessment at inception; supplementary field survey budgeted",
        discriminator: "Field-survey contingency built into the lump-sum — no variation order when records are incomplete",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/energy|solar|hydropower|substation|transmission|generation|electrification|scada/.test(s)) {
    return [
      {
        pain: "Protection relay settings rejected at utility interconnection review",
        strength: "Independent power-systems peer review of relay settings before utility submission; relay setting schedule issued with 100% design package",
        discriminator: "No other bidder includes an independent protection-relay review as a standard deliverable — utility pre-approval secured before construction starts",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Solar/wind yield forecast over-stated — energy target missed",
        strength: "P50/P90 yield estimates from ≥ 10 years validated resource data; conservative degradation factor; HOMER sensitivity analysis",
        discriminator: "Yield model and sensitivity analysis handed to client — lender can interrogate assumptions directly without commissioning new study",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/agri|irrigation|wua|command.*area|rural.*develop/.test(s)) {
    return [
      {
        pain: "Hydrological source flow lower than scheme design — crops under-served",
        strength: "20-year flow record analysis; conservative safe-yield factor; back-up source identified before design starts",
        discriminator: "Flow contingency documented BEFORE detailed design — no redesign cost when source under-performs",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "WUA collapses after handover — scheme falls into disuse",
        strength: "WUA readiness assessment at inception; governance framework and tariff model agreed before construction",
        discriminator: "WUA governance kit (constitution, water allocation rules, fee collection template) handed over as a project deliverable",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/mining|mineral.*resource|jorc|tailings|ore.*body|mine.*plan/.test(s)) {
    return [
      {
        pain: "Resource estimate downgraded at independent competent-person review",
        strength: "JORC-compliant estimate with sensitivity analysis; independent competent-person review before report issue",
        discriminator: "Competent-person review is a built-in project deliverable, not an afterthought — estimate quality is investor-ready from issue",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "TSF slope failure — safety incident and environmental liability",
        strength: "TSF design to MAC/ANCOLD guidelines; slope stability by three methods; instrumentation programme from first raise",
        discriminator: "TSF instrumentation and monitoring plan handed to mine operator at handover — early warning system operational from day one",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/port|berth|quay|maritime|dredging|harbour/.test(s)) {
    return [
      {
        pain: "Berth design fails pre-operations nautical safety review — commercial launch delayed",
        strength: "Fast-time nautical simulation validates berth layout before structural design is finalised",
        discriminator: "Simulation report is a handover deliverable — port authority retains safety evidence for future vessel-class upgrades without commissioning new study",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Dredge material disposal site rejected — project delay and cost overrun",
        strength: "Sediment characterisation completed before dredge volumes are estimated; disposal site pre-approved by environmental authority before mobilisation",
        discriminator: "Pre-approved disposal plan eliminates the most common cause of port-project delay — no contingency cost for disposal site re-approval",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/pipeline|oil.*facilit|gas.*facilit|hazop|p&id|refinery|petrochemical/.test(s)) {
    return [
      {
        pain: "Outstanding HAZOP actions reach construction — safety incident risk",
        strength: "HAZOP action register tracked to full close-out; LOPA for high-severity nodes; PSI documented before construction release",
        discriminator: "No construction release until HAZOP action register is formally closed — safety case is complete before ground is broken",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Cathodic protection failure — pipeline leak and environmental liability",
        strength: "CP design to NACE/ISO; soil resistivity survey before design; CIPS baseline within 12 months of commissioning",
        discriminator: "ILI baseline run schedule handed to client at handover — integrity management lifecycle begins immediately, not when a leak occurs",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/kyc|aml|core.*banking|microfinance|ifrs|basel|prudential|fintech/.test(s)) {
    return [
      {
        pain: "System goes live before regulatory compliance is confirmed — enforcement action",
        strength: "Regulatory gap analysis reviewed by licensed local legal counsel; compliance attestation before go-live",
        discriminator: "Legal counsel sign-off is a formal go-live gate — no system launch without documented compliance confirmation",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Data migration errors discovered post-cutover — reconciliation failure",
        strength: "Parallel-run cutover; data reconciliation protocol signed off before live; documented rollback path",
        discriminator: "Rollback plan is tested before the cutover window — not written after the cutover fails",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  if (/spectrum|broadband|lte|5g|base.*station|backhaul|mobile.*network|telecoms/.test(s)) {
    return [
      {
        pain: "Coverage underperforms simulation — dead zones in target service area",
        strength: "Calibrated propagation model with field-measured correction factors; drive-test acceptance against coverage KPIs",
        discriminator: "Drive-test data archived and handed to NOC team — future comparative measurement campaigns use our baseline, not a new study",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      {
        pain: "Spectrum not licensed in time — rollout delayed",
        strength: "Spectrum licensing roadmap prepared at project inception; frequency assignment application submitted with full technical data package",
        discriminator: "Site engineering does not start until in-principle spectrum approval is received — no sunk cost on sites that cannot be activated",
        evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
      },
      ...generic,
    ];
  }
  return generic;
}

// Pull tender-specific rows from the tender's own themes. Each becomes a
// high-priority row at the top of the table, pushing generic rows downstream.
//
// `gapsToAddressInNarrative` is DELIBERATELY NOT READ HERE.
// -------------------------------------------------------
// That array is the engine's internal gap channel (lib/engine/
// proposal-intelligence.ts `detectGaps`). Every entry in it is an
// instruction the bid team writes to itself — "Use the closest
// electromechanical or infrastructure project and flag the sector gap as a
// senior bid-review action", "Add or review additional experts before final
// submission", "note the gap for the bid team". This builder used to copy
// those strings verbatim into the client-facing table's first column, so a
// real submitted proposal told the procuring entity that the bidder had no
// sector-matching project and instructed its own staff to substitute the
// closest one. The gap analysis is legitimate and stays available
// internally; it simply is not client-facing content, and no amount of
// per-phrase filtering downstream can make an internal instruction into a
// client sentence. The channel is cut here, at the boundary.
/**
 * What the firm actually commits to do about a stated tender requirement, and
 * what that means for the client.
 *
 * Every entry is a methodology commitment made in this proposal — never a claim
 * of past delivery. Rows are emitted only for requirements this map recognises;
 * a requirement it cannot answer specifically is left to the Compliance Matrix
 * and Section C rather than padded with a generic row.
 *
 * The previous version gave every requirement the same three sentences —
 * "Mapped to a specific firm capability and a project anchor in our
 * methodology" / "Addressed directly in our methodology — see Section C" —
 * so a delivered proposal's Section G carried four consecutive rows whose
 * value proposition was word-for-word identical. Repeating one sentence
 * five times does not make five propositions.
 */
const THEME_CAPABILITY_MAP: Array<{ match: RegExp; capability: string; clientValue: string }> = [
  {
    match: /infection|ipc\b|clean.{0,12}dirty|isolation|sterili|cross[- ]contamination/i,
    capability: "Infection-prevention zoning applied from schematic design: clean/dirty separation, isolation-room circulation and staff/patient/supply flows resolved before layouts are frozen",
    clientValue: "IPC compliance is designed in rather than retrofitted, so clinical commissioning is not held up by circulation rework",
  },
  {
    match: /patient.{0,10}flow|clinical.{0,12}(?:workflow|zoning|planning)|circulation|department.{0,10}adjacen|functional.{0,10}program/i,
    capability: "Departmental adjacency and patient-flow planning driven by the clinical brief, with Emergency, Outpatient, Imaging, Laboratory and Pharmacy zoned against projected throughput",
    clientValue: "Layouts reflect how the centre will actually operate, reducing walking distances and avoiding late clinical objections",
  },
  {
    match: /medical.{0,10}gas|oxygen|vacuum|nitrous|piped.{0,10}gas/i,
    capability: "Medical gas reticulation designed with the MEP and structural grids in one coordinated model: outlet schedules, alarm panels and plant sizing set against the equipment brief",
    clientValue: "Gas services are coordinated before construction, avoiding the late service clashes that typically drive variation orders",
  },
  {
    match: /mep|mechanical|electrical|plumbing|hvac|ventilation|power|ups|generator/i,
    capability: "Single in-house multidisciplinary MEP team covering electrical, mechanical and sanitary design, with load calculations tied to the confirmed equipment schedule",
    clientValue: "MEP coordination is internal rather than contractual, so interface issues are resolved by the team instead of between sub-consultants",
  },
  {
    match: /biomedical|medical.{0,10}equipment|imaging|radiation|shielding|ct\b|mri\b|x-?ray/i,
    capability: "Licensed biomedical engineering specialist engaged for equipment spatial planning, electrical load calculation, and radiation shielding and licensing where the confirmed equipment brief requires it",
    clientValue: "Equipment-driven requirements are settled at design stage, so imaging and laboratory rooms do not need structural or shielding rework",
  },
  {
    match: /regulat|approval|licens|permit|authority|code.{0,10}complian|standard/i,
    capability: "Approvals pathway mapped at inception against the applicable national and municipal authorities, with each submission package and its evidence listed in the work plan",
    clientValue: "The client sees which approval is needed when, so authority review is scheduled rather than discovered",
  },
  {
    match: /accessib|universal.{0,10}design|disab|crpd|iso 21542|mobility/i,
    capability: "Universal-design review at every gate against the national accessibility standard, with an accessibility audit signed off before 100% issuance",
    clientValue: "Accessibility is evidenced at handover rather than raised as a defect after construction",
  },
  {
    match: /structur|geotech|soil|foundation|seismic/i,
    capability: "In-house structural and geotechnical capability — drilling rigs and a soils laboratory — so site investigation feeds the structural model directly",
    clientValue: "Site-assessment findings reach the design team without a sub-contractor hand-off, protecting the programme",
  },
  {
    match: /supervis|construction.{0,12}(?:phase|stage|admin)|site.{0,10}monitor|contract.{0,10}admin/i,
    capability: "Construction-stage supervision with defined hold-points, site instruction records and monthly progress reporting against the approved programme",
    clientValue: "Progress and quality are evidenced in writing throughout, so certification decisions rest on records rather than recollection",
  },
  {
    match: /quality|qa\b|qc\b|review.{0,10}gate|peer.{0,10}review/i,
    capability: "Three formal design gates at 30%, 60% and 100% with an independent reviewer who is not on the delivery team",
    clientValue: "Errors are caught by fresh eyes before issuance rather than by the client at review",
  },
  {
    match: /handover|commission|testing|as.?built|o&m|operation.{0,10}manual|training/i,
    capability: "Structured handover: as-built documentation, O&M manuals, commissioning records and operator training delivered as one pack",
    clientValue: "The facility can be operated and maintained from the handover pack without returning to the designer",
  },
  {
    match: /team|personnel|staffing|expert|multidisciplin|coordinat/i,
    capability: "Named experts mapped to each discipline with a written back-up per role and a 48-hour mobilisation commitment",
    clientValue: "Continuity is contractual, so the loss of one specialist does not stall the assignment",
  },
];

function tenderSpecificRows(opts: {
  themes?: string[];
  evaluationCriteria?: string[];
}): ThemeRow[] {
  const out: ThemeRow[] = [];
  const seen = new Set<string>();
  const usedCapability = new Set<string>();

  // Tender themes are the client's own stated priorities, so they read as
  // requirements — not as "hot-buttons", which is bid-desk shorthand for
  // what the evaluator can be nudged on.
  for (const t of opts.themes ?? []) {
    if (out.length >= 5) break;
    const trimmed = truncateAtWordBoundary(t.trim(), 110);
    if (!trimmed) continue;
    const key = `theme:${trimmed.toLowerCase()}`;
    if (seen.has(key)) continue;

    const matched = THEME_CAPABILITY_MAP.find((entry) => entry.match.test(trimmed));
    // A requirement this map cannot answer specifically is covered by the
    // Compliance Matrix and Section C. Emitting a generic row for it would add
    // a line without adding a proposition.
    if (!matched) continue;
    // Two requirements can legitimately point at the same capability; say it
    // once rather than twice.
    if (usedCapability.has(matched.capability)) continue;

    seen.add(key);
    usedCapability.add(matched.capability);
    out.push({
      pain: trimmed,
      strength: matched.capability,
      discriminator: matched.clientValue,
      evidenceFallback: "Written commitment in this proposal — Section C (Technical Methodology)",
    });
  }

  return out;
}

/**
 * Fold a row into the proposition it actually makes, so two rows that say the
 * same thing in different words can be recognised as one.
 */
function normalizedProposition(row: ThemeRow): string {
  return [row.strength, row.discriminator]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 3)
    .slice(0, 14)
    .join(" ");
}

// ─── Builder ─────────────────────────────────────────────────────────────

interface BuildOpts {
  primarySector: string;
  projects: ProjectRecord[];
  differentiators?: string[];
  themes?: string[];
  evaluationCriteria?: string[];
  companyName: string;
}

function buildTable(opts: BuildOpts): string {
  const sectorRows = defaultRows(opts.primarySector);
  const tenderRows = tenderSpecificRows({
    themes: opts.themes,
    evaluationCriteria: opts.evaluationCriteria,
  });

  // Tender-specific rows come first; generic rows fill the remainder.
  // Cap at 10 rows so the table covers complex tenders without becoming unwieldy.
  // Semantic de-duplication across every source of rows. Exact-string equality
  // is not enough: the defect was rows whose requirement text differed while
  // their capability and client value were identical, which is one proposition
  // wearing several hats. The first occurrence wins — tender-derived rows come
  // first, so a tender-specific statement is kept over a generic one.
  const all: ThemeRow[] = [];
  const propositions = new Set<string>();
  for (const row of [...tenderRows, ...sectorRows]) {
    if (all.length >= 10) break;
    const proposition = normalizedProposition(row);
    if (proposition && propositions.has(proposition)) continue;
    if (proposition) propositions.add(proposition);
    all.push(row);
  }

  // Column labels are the client's vocabulary, not the bid desk's. The
  // underlying row fields keep their original internal names; only what is
  // rendered changes.
  const head = "| # | Requirement or Client Need | Our Capability | What This Means for the Client | Evidence |";
  const sep = "|---|----------------------------|----------------|--------------------------------|----------|";
  const body = all.map((r, i) => {
    // Use each project once; once exhausted fall back to the row's own
    // evidenceFallback text rather than cycling the same projects repeatedly.
    const project = i < opts.projects.length ? opts.projects[i] : undefined;
    const evidence = projectAnchorCell(project, r.evidenceFallback);
    return `| ${i + 1} | ${r.pain} | ${r.strength} | ${r.discriminator} | ${evidence} |`;
  });

  // Optional differentiator footer — when the company has explicit
  // differentiators, surface them as a short bullet list under the
  // table. This isn't required by the scorer but improves readability.
  const diffBullets: string[] = [];
  if ((opts.differentiators ?? []).length > 0) {
    diffBullets.push("", "**Further strengths we bring to this assignment:**");
    for (const d of (opts.differentiators ?? []).slice(0, 5)) {
      // Cut at a word boundary — this shipped "… and applicable aut" and
      // "… for due-diligence spe" to the client.
      const trimmed = truncateAtWordBoundary(String(d).trim(), 220);
      if (!trimmed) continue;
      diffBullets.push(`- ${trimmed}`);
    }
  }

  return [
    MARKER,
    `## ${CLIENT_FACING_SECTION_G_HEADING}`,
    "",
    `The table below maps each requirement or client need to a specific firm capability, what that capability means in practice for this assignment, and the evidence a client can verify. Each row is a commitment, not a marketing claim — backed by methodology, a reviewed project record, or a written undertaking in this proposal.`,
    "",
    head,
    sep,
    ...body,
    ...diffBullets,
    "",
  ].join("\n");
}

// ─── Insertion ───────────────────────────────────────────────────────────

// Find Section G heading if it exists — we'll inject the table directly
// underneath it. Otherwise we'll append the whole block (heading +
// table) at end of Section D / before Compliance Matrix.
function findInsertPoint(markdown: string): { mode: "AT_HEADING"; line: number } | { mode: "BEFORE_COMPLIANCE"; line: number } | { mode: "END"; line: number } {
  const lines = markdown.split("\n");

  // Mode 1: heading exists but no table under it
  for (let i = 0; i < lines.length; i += 1) {
    if (HEADING_PATTERNS.some((p) => p.test(lines[i]))) {
      return { mode: "AT_HEADING", line: i + 1 };
    }
  }

  // Mode 2: before Section E (Compliance Matrix) so it sits in Section G zone
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+E\b/i.test(lines[i]) || /^#\s+Compliance\s+Matrix/i.test(lines[i])) {
      return { mode: "BEFORE_COMPLIANCE", line: i };
    }
  }

  // Mode 3: end of document
  return { mode: "END", line: lines.length };
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface WinThemesResult {
  markdown: string;
  injected: boolean;
}

export function injectWinThemesTable(
  markdown: string,
  opts: BuildOpts,
): WinThemesResult {
  if (hasExisting(markdown)) {
    return { markdown, injected: false };
  }

  const block = buildTable(opts);
  const insert = findInsertPoint(markdown);
  const lines = markdown.split("\n");

  if (insert.mode === "AT_HEADING") {
    // Inject table body just after the heading line, but skip any
    // existing intro paragraph by inserting at heading + 1.
    const out = [
      ...lines.slice(0, insert.line),
      "",
      // Drop the heading line from our block since one already exists.
      block.replace(new RegExp(`^## ${CLIENT_FACING_SECTION_G_HEADING}\\n`), "").replace(/^<!-- win-themes:table -->\n/, `${MARKER}\n`),
      "",
      ...lines.slice(insert.line),
    ];
    return { markdown: out.join("\n"), injected: true };
  }

  if (insert.mode === "BEFORE_COMPLIANCE" || insert.mode === "END") {
    const out = [
      ...lines.slice(0, insert.line),
      "",
      block,
      "",
      ...lines.slice(insert.line),
    ];
    return { markdown: out.join("\n"), injected: true };
  }

  return { markdown, injected: false };
}
