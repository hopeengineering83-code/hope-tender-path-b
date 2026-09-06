/**
 * Deliverable Crosswalk + Phase Narrative + Branded Innovations
 * (PR N) — closes the final structural gaps to Claude AI benchmark.
 *
 * THE PROBLEM (from benchmark gap analysis, items #4, #8, #13):
 *
 * Item #4 [HIGH] — Deliverable Crosswalk Missing
 *   Claude renders, per featured project, a "Deliverables Matching
 *   <CLIENT> Scope" cross-mapping showing which D1-Dn codes that
 *   project has proof for (e.g., "Floor plan redesign (D2);
 *   3D visualization (D4); BOQ (D8)"). The app extracts D-codes from
 *   the tender (PR K) but doesn't map them to project evidence.
 *
 * Item #8 [HIGH] — Innovation Section Generic, No Branded Hooks
 *   Claude includes named, tender-specific innovations:
 *     "Innovation 1: Hope Core Real-Time Project Dashboard"
 *     "Innovation 2: PATH Brand Integration from Day One"
 *   The app's beyond-spec-tables emits generic bullets. When the tender
 *   names a brand or website, the proposal must call it out.
 *
 * Item #13 [HIGH] — Phase Narrative Missing
 *   Claude writes 7 phase paragraphs (Phase 1: Site Survey...,
 *   Phase 2: Concept Design...) each 60-110 words naming the
 *   responsible expert + the artefacts produced. The app's work-plan
 *   is a 4-row table of generic "Phase 1: Inception... 1 to 2 weeks".
 *
 * THE FIX
 * Three deterministic post-pass builders:
 *
 *   - buildDeliverableCrosswalk: extracts D-codes from tender text,
 *     maps each code to the most relevant reviewed project from the
 *     evidence library based on keyword overlap with project's
 *     summary/serviceAreas.
 *
 *   - buildPhaseNarrative: emits 5-7 phase paragraphs, each
 *     60-110 words, sector-aware, naming a responsible expert from
 *     the team and the artefacts produced. Inserts under Section C
 *     after C.0 Tender Specifics.
 *
 *   - buildBrandedInnovationHooks: when the tender mentions a brand
 *     or website, emits 2-3 named innovation hooks (e.g.,
 *     "<BRAND> Brand Integration from Day One"). Inserted as
 *     Section D innovation supplement.
 *
 * SCOPE
 * Operates AFTER personnel-deep (PR L) and BEFORE tender-closers
 * (PR M). Idempotent via marker comments.
 */

import type { ExpertRecord, ProjectRecord } from "./benchmark-tables";
import { truncateAtWordBoundary } from "./proposal-intelligence";

const MARKER_CROSSWALK = "<!-- deliverable:crosswalk -->";
const MARKER_PHASES = "<!-- methodology:phase-narrative -->";
const MARKER_BRANDED = "<!-- innovation:branded-hooks -->";

const HEADING_PATTERNS_CROSSWALK: RegExp[] = [
  /^##\s+Deliverable\s+(?:Cross-?walk|Mapping)/im,
  /^##\s+Project-to-Deliverable\s+Mapping/im,
];
const HEADING_PATTERNS_PHASES: RegExp[] = [
  /^##\s+Phase[- ]by[- ]Phase\s+(?:Methodology|Narrative)/im,
  /^##\s+Phased\s+Methodology\s+Narrative/im,
  /^##\s+Phase\s+Narrative/im,
];
const HEADING_PATTERNS_BRANDED: RegExp[] = [
  /^##\s+Tender-Specific\s+Innovation/im,
  /^##\s+Branded\s+Innovation\s+Hooks/im,
];

// ─── Deliverable Crosswalk ───────────────────────────────────────────────

function extractDCodes(tenderText: string): string[] {
  if (!tenderText) return [];
  const codes = new Set<string>();
  const re = /\bD\s*(\d{1,2})\b/gi;
  for (const m of tenderText.matchAll(re)) {
    const num = parseInt(m[1], 10);
    if (Number.isFinite(num) && num >= 1 && num <= 30) {
      codes.add(`D${num}`);
    }
  }
  // Also detect "Deliverable 1", "Output 1", etc. → map to D1
  const re2 = /\b(?:Deliverable|Output|Product|Task)\s+(\d{1,2})\b/gi;
  for (const m of tenderText.matchAll(re2)) {
    const num = parseInt(m[1], 10);
    if (Number.isFinite(num) && num >= 1 && num <= 30) {
      codes.add(`D${num}`);
    }
  }
  return [...codes].sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

// Heuristic: pull a short title for each D-code from the surrounding
// sentence in the tender text. Returns map of D-code → short label
// (4-10 words).
function extractDCodeLabels(tenderText: string, codes: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const code of codes) {
    const num = code.slice(1);
    const re = new RegExp(`\\b(?:D\\s*${num}|Deliverable\\s+${num}|Output\\s+${num}|Product\\s+${num}|Task\\s+${num})\\b\\s*[:\\-—.]?\\s*([^\\n.]{6,140})`, "i");
    const m = tenderText.match(re);
    if (m && m[1]) {
      const label = m[1].replace(/\s+/g, " ").trim().split(/[.;:]/)[0].slice(0, 90);
      if (label.length > 5) out.set(code, label);
    }
  }
  return out;
}

function projectMatchesCode(project: ProjectRecord, code: string, label: string): boolean {
  const blob = `${project.name || ""} ${project.summary || ""} ${project.serviceAreas || ""} ${project.sector || ""}`.toLowerCase();
  const labelLower = label.toLowerCase();
  if (blob.length === 0) return false;

  // Look for distinctive keyword overlap
  const labelTokens = labelLower.match(/\b[a-z]{4,}\b/g) ?? [];
  if (labelTokens.length === 0) return false;
  const hits = labelTokens.filter((t) => blob.includes(t)).length;
  return hits >= Math.min(2, labelTokens.length);
}

export function buildDeliverableCrosswalk(opts: {
  tenderText: string;
  projects: ProjectRecord[];
}): string {
  const codes = extractDCodes(opts.tenderText);
  if (codes.length === 0 || opts.projects.length === 0) return "";
  const labels = extractDCodeLabels(opts.tenderText, codes);

  // For each project, list which codes it has evidence for
  const projectRows = opts.projects.slice(0, 4).map((p, idx) => {
    const matched: string[] = [];
    for (const code of codes) {
      const lbl = labels.get(code) || "";
      if (projectMatchesCode(p, code, lbl)) matched.push(code);
    }
    const matchedDisplay = matched.length > 0 ? matched.join(", ") : "—";
    const v = p.contractValue ? `${p.currency || "ETB"} ${Math.round(p.contractValue).toLocaleString("en-US")}` : "";
    const scope = truncateAtWordBoundary((p.summary || "").replace(/\s+/g, " ").trim(), 220);
    return `| ${idx + 1} | ${p.name}${v ? ` (${v})` : ""} | ${matchedDisplay} | ${scope || "—"} |`;
  });

  const head = "| # | Project Reference | Deliverables Proven (Codes) | Scope Demonstrated |";
  const sep = "|---|--------------------|------------------------------|--------------------|";

  // Reverse legend (codes → label)
  const codeLegend = codes.map((c) => {
    const lbl = labels.get(c);
    return lbl ? `${c}: ${lbl}` : c;
  }).join(" ; ");

  return [
    MARKER_CROSSWALK,
    "## Deliverable-to-Project Crosswalk",
    "",
    "Each featured project below has been reviewed against the tender's deliverable list. The Deliverables Proven column lists the code(s) for which the project carries direct evidence — the same scope element executed under contract previously.",
    "",
    `**Deliverable code legend (from tender):** ${codeLegend}`,
    "",
    head,
    sep,
    ...projectRows,
    "",
  ].join("\n");
}

// ─── Phase Narrative ────────────────────────────────────────────────────

interface PhaseSpec {
  title: string;
  durationLabel: string; // "Days 1–3" or "Weeks 1–2"
  picksKeyword: string[];
  artefacts: string;
  sectorVocab: (sector: string) => string;
}

function phaseSpecsForSector(sector: string, totalDays: number): PhaseSpec[] {
  // Use day-based labels when totalDays is small (≤ 56 = 2 months);
  // week-based labels for larger engagements.
  const useDays = totalDays > 0 && totalDays <= 56;
  const fmt = (start: number, end: number) => useDays
    ? `Days ${start}-${end}`
    : `Weeks ${Math.ceil(start / 7)}-${Math.ceil(end / 7)}`;

  const split = (fraction: number) => Math.max(1, Math.round(totalDays * fraction));

  const generic: PhaseSpec[] = [
    {
      title: "Phase 1: Inception, ToR Confirmation, and Mobilization",
      durationLabel: fmt(1, split(0.10)),
      picksKeyword: ["principal", "director", "manager"],
      artefacts: "Signed inception report, confirmed ToR, document-control archive, kick-off meeting minutes, risk-register baseline, weekly cadence schedule",
      sectorVocab: () => "team mobilization, stakeholder map, data-collection plan, communication protocol",
    },
    {
      title: "Phase 2: Baseline Studies and Data Collection",
      durationLabel: fmt(split(0.10) + 1, split(0.30)),
      picksKeyword: ["lead", "senior", "specialist"],
      artefacts: "Baseline data report, gap-analysis memo, technical-conditions log, data-completeness assessment",
      sectorVocab: (s) => /health/.test(s.toLowerCase())
        ? "site survey, clinical-flow observation, biomedical equipment audit, IPC compliance baseline"
        : /water/.test(s.toLowerCase())
          ? "borehole siting, geophysical survey, hydrogeological assessment, water-quality analysis"
          : /road/.test(s.toLowerCase())
            ? "topographic survey, geotechnical investigation, traffic count, drainage condition assessment"
            : /urban/.test(s.toLowerCase())
              ? "GIS land-use mapping, demographic data collection, infrastructure inventory, demand assessment"
              : /energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification/i.test(s)
                ? "load-forecast memo, P50/P90 yield modelling, site reconnaissance, grid-connection pre-application"
                : /agri|irrigation|WUA|command.*area/i.test(s)
                  ? "FAO Penman-Monteith crop-water requirement, 20-year flow record review, command-area mapping"
                  : /mining|JORC|tailings|ore.*body|mine.*plan/i.test(s)
                    ? "resource estimation, block-model development, geotechnical investigation scoping"
                    : /port|berth|quay|maritime|dredging|harbour/i.test(s)
                      ? "met-ocean analysis, bathymetric survey, geotechnical investigation, nautical simulation brief"
                      : /HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit/i.test(s)
                        ? "design basis memorandum, P&ID development, HAZOP study, LOPA analysis"
                        : /KYC|AML|core.*banking|microfinance|IFRS|Basel/i.test(s)
                          ? "regulatory gap analysis, target operating model design, data-quality assessment"
                          : /spectrum|broadband|LTE|5G|base.*station|backhaul/i.test(s)
                            ? "traffic demand modelling, RF coverage simulation, spectrum licensing roadmap"
                            : "baseline data collection, technical-condition logging, gap mapping",
    },
    {
      title: "Phase 3: Concept and Schematic Design / Scenario Development",
      durationLabel: fmt(split(0.30) + 1, split(0.50)),
      picksKeyword: ["architect", "engineer", "planner", "lead"],
      artefacts: "Concept design report, schematic drawings, preliminary cost estimate, design rationale memo, 30% gate sign-off pack",
      sectorVocab: (s) => /health/.test(s.toLowerCase())
        ? "clinical zoning matrix, IPC flow diagram, conceptual MEP layout, equipment provisional schedule"
        : /water/.test(s.toLowerCase())
          ? "demand-projection memo, hydraulic-network sketch, source-yield interpretation, treatment-process selection"
          : /road/.test(s.toLowerCase())
            ? "alignment options, pavement-design alternatives, drainage strategy, road-safety framework"
            : /energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification/i.test(s)
              ? "single-line diagram, technology-selection report, SKM/ETAP load-flow model, protection relay coordination study"
              : /agri|irrigation|WUA|command.*area/i.test(s)
                ? "irrigation network layout options, diversion/weir structure concept, WUA governance draft framework"
                : /mining|JORC|tailings|ore.*body|mine.*plan/i.test(s)
                  ? "pit or underground design options, slope-stability analysis (three methods), TSF concept design"
                  : /port|berth|quay|maritime|dredging|harbour/i.test(s)
                    ? "berth layout options, fast-time nautical simulation brief, dredge volume estimate, ISPS compliance outline"
                    : /HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit/i.test(s)
                      ? "P&ID development, HAZOP study with action register, LOPA for high-severity nodes"
                      : /KYC|AML|core.*banking|microfinance|IFRS|Basel/i.test(s)
                        ? "system architecture document, integration plan, RBAC/encryption design, UAT protocol"
                        : /spectrum|broadband|LTE|5G|base.*station|backhaul/i.test(s)
                          ? "base-station siting plan, backhaul design with path availability calculations, site acquisition list"
                          : "concept layouts, scenario evaluation matrix, preferred-option memo, stakeholder consultation log",
    },
    {
      title: "Phase 4: Detailed Design / Methodology Execution",
      durationLabel: fmt(split(0.50) + 1, split(0.80)),
      picksKeyword: ["lead", "senior", "engineer", "specialist"],
      // "BOQ" is a priced term. In a tender that separates the technical and
      // financial envelopes the price guard drops any line carrying one, which
      // deleted this phase's whole body and left the narrative reading
      // "Phases 1, 2, 3, 5, 6" under its own claim of six phases. The
      // deliverable itself is a quantity schedule; the rest of the app already
      // calls it that.
      artefacts: "Detailed design drawings (architectural / structural / MEP / civil as applicable), specifications, quantity schedules, design report, 60% gate sign-off pack",
      sectorVocab: (s) => /health/.test(s.toLowerCase())
        ? "fully coordinated MEP + medical-gas drawings, structural sizing, IPC-compliant detail design, clinical-equipment integration"
        : /water/.test(s.toLowerCase())
          ? "EPANET-verified network, pump-station detail design, treatment-plant process drawings, structural calculations"
          : /road/.test(s.toLowerCase())
            ? "AASHTO/ERA pavement design, drainage detail design, structural design (culverts/bridges), tender BOQ"
            : /energy|power.*plant|\bsolar\b|wind.*farm|substation|hydropower|electrification/i.test(s)
              ? "full engineering design package (civil/structural, electrical, SCADA), grid-code compliance dossier, procurement BOQ"
              : /agri|irrigation|WUA|command.*area/i.test(s)
                ? "irrigation network detail design, diversion/weir structural calculations, WUA governance framework, tender BOQ"
                : /mining|JORC|tailings|ore.*body|mine.*plan/i.test(s)
                  ? "mine plan, TSF detailed design, regulatory submission package, procurement BOQ"
                  : /port|berth|quay|maritime|dredging|harbour/i.test(s)
                    ? "berth structural design, dredge disposal plan, shore-power layout, ISPS compliance documentation, BOQ"
                    : /HAZOP|P&ID|pipeline.*design|oil.*facilit|gas.*facilit/i.test(s)
                      ? "pipeline stress analysis, cathodic-protection design, civil/structural drawings, vendor data requirements matrix"
                      : /KYC|AML|core.*banking|microfinance|IFRS|Basel/i.test(s)
                        ? "UAT execution, data migration with reconciliation, legal counsel regulatory compliance confirmation"
                        : /spectrum|broadband|LTE|5G|base.*station|backhaul/i.test(s)
                          ? "network design package, EMR compliance dossier, installation supervision procedures, drive-test protocol"
                          : "detailed scenario, implementation roadmap, regulatory-alignment memo, capacity-building plan",
    },
    {
      title: "Phase 5: Internal QA, Independent Peer Review, and Client Comments",
      durationLabel: fmt(split(0.80) + 1, split(0.92)),
      picksKeyword: ["quality", "review", "director"],
      artefacts: "100% peer-review pack, independent-reviewer memo, client-comments resolution log, revised deliverable",
      sectorVocab: () => "comment-resolution register, design-integrity audit, regulatory pre-check, sign-off matrix",
    },
    {
      title: "Phase 6: Final Issuance and Handover",
      durationLabel: fmt(split(0.92) + 1, totalDays),
      picksKeyword: ["principal", "director", "manager"],
      artefacts: "Final deliverable issuance, as-issued drawings register, handover memo, lessons-learned summary, defects-liability tracker",
      sectorVocab: () => "handover pack, client-archive transfer, post-handover advisory window, archive copy",
    },
  ];

  return generic;
}

function pickName(experts: ExpertRecord[], keywords: string[], used: Set<string>): string {
  for (const k of keywords) {
    const match = experts.find((e) =>
      !used.has(e.fullName) &&
      `${e.title || ""} ${e.disciplines || ""} ${e.profile || ""}`.toLowerCase().includes(k.toLowerCase()),
    );
    if (match) {
      used.add(match.fullName);
      return `${match.fullName}${match.title ? ` (${match.title})` : ""}`;
    }
  }
  // Fallback: first unused
  const unused = experts.find((e) => !used.has(e.fullName));
  if (unused) {
    used.add(unused.fullName);
    return `${unused.fullName}${unused.title ? ` (${unused.title})` : ""}`;
  }
  return "Bid-Team Action: confirm phase lead";
}

export function buildPhaseNarrative(opts: {
  experts: ExpertRecord[];
  primarySector: string;
  totalDays?: number;
}): string {
  const totalDays = opts.totalDays && opts.totalDays > 0 ? opts.totalDays : 90;
  const phases = phaseSpecsForSector(opts.primarySector, totalDays);
  const used = new Set<string>();

  const blocks: string[] = [];
  blocks.push(MARKER_PHASES);
  blocks.push("## Phase-by-Phase Methodology Narrative");
  blocks.push("");
  blocks.push(`The methodology is delivered across ${phases.length} phases over an indicative ${totalDays}-day engagement window. Each phase below names the responsible expert, the artefacts produced, and the sector-specific activities executed.`);
  blocks.push("");

  for (const phase of phases) {
    const lead = pickName(opts.experts, phase.picksKeyword, used);
    const sectorActivity = phase.sectorVocab(opts.primarySector);
    blocks.push(`### ${phase.title} — ${phase.durationLabel}`);
    blocks.push("");
    blocks.push(`**Phase lead:** ${lead}.`);
    blocks.push("");
    blocks.push(`This phase covers ${sectorActivity}. The output artefacts are: ${phase.artefacts}. Phase exit gate: client sign-off on the Phase deliverable before the next phase begins.`);
    blocks.push("");
  }

  return blocks.join("\n");
}

// ─── Branded Innovation Hooks ───────────────────────────────────────────

interface BrandedHook {
  title: string;
  description: string;
}

function detectBrandsAndWebsites(tenderText: string): { brand: string | null; website: string | null; clientName: string | null } {
  if (!tenderText) return { brand: null, website: null, clientName: null };
  const text = tenderText.replace(/\s+/g, " ").slice(0, 12_000);

  // Website
  const wmatch = text.match(/\b(?:https?:\/\/[^\s,;]+|www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const website = wmatch ? wmatch[0].replace(/[.,;:]+$/, "") : null;

  // Brand: ALL-CAPS proper noun (≥3 letters) + organization-suffix
  const bmatch = text.match(/\b([A-Z][A-Z0-9]{2,})\s+(?:Ethiopia|Foundation|International|Bank|Holdings?|Group)\b/);
  const brand = bmatch ? bmatch[0] : null;

  // Client name: first ALL-CAPS proper noun on its own
  let clientName: string | null = null;
  const cmatch = text.match(/\b([A-Z]{3,})\b/);
  if (cmatch) {
    const candidate = cmatch[1];
    // Reject obvious non-client words
    if (!/^(?:RFP|EOI|TENDER|BID|HOPE|BOQ|MEP|GIS|CAD|DWG|VAT|TIN|ETB|USD|EUR|GBP|GNI|GDP|IPC|MOH|EU|UN|WHO)$/.test(candidate)) {
      clientName = candidate;
    }
  }

  return { brand, website, clientName };
}

export function buildBrandedInnovationHooks(opts: {
  tenderText: string;
  companyName: string;
}): string {
  const { brand, website, clientName } = detectBrandsAndWebsites(opts.tenderText);
  const hooks: BrandedHook[] = [];

  // Hook 1: Always — the firm's project dashboard offered to client
  hooks.push({
    title: `${opts.companyName} Project Dashboard for Client Real-Time Visibility`,
    description: `A read-only project workspace shared with the client throughout the engagement. The dashboard carries: live decision log, drawing version history, deliverable status against each tender requirement, weekly look-ahead, and risk register. The client tracks progress without waiting for a status meeting; the bidder retains a defensible audit trail.`,
  });

  // Hook 2: Brand integration when brand or website detected
  if (brand || website) {
    const brandLabel = brand || (clientName ? `${clientName}` : "Client") || "Client";
    const websiteLabel = website ? ` from ${website}` : "";
    hooks.push({
      title: `${brandLabel} Brand Integration from Day One`,
      description: `Concept design at the 30% gate carries an explicit brand-alignment review item. Brand guidelines are downloaded${websiteLabel} (or requested at inception). Every design output — drawings, specifications, presentation pack, signage proposals — reflects the client visual standard. Revision rounds for brand-driven adjustments are planned into the engagement programme.`,
    });
  }

  // Hook 3: Lessons-learned + post-handover advisory
  hooks.push({
    title: `Lessons-Learned Memo and Post-Handover Advisory Window`,
    description: `Engagement closes with a structured lessons-learned session co-authored with the client team and a written memo handed over with the deliverable. The bidder retains a 6-month post-handover advisory window, one 60-minute call per month, so the client has continuity support through early implementation.`,
  });

  if (hooks.length === 0) return "";

  const blocks: string[] = [
    MARKER_BRANDED,
    `## Tender-Specific Innovation Hooks`,
    "",
    "Beyond the standard innovation and value-engineering proposals, the bidder offers the following tender-specific innovation hooks. Each is named, described, and tied to a measurable client benefit.",
    "",
  ];
  // The hook numbers are derived from the hooks actually emitted, not written
  // into each title. Hook 2 only appears when the tender names a brand or a
  // website, so hard-coded labels shipped a proposal that listed "Innovation 1"
  // and then "Innovation 3" — a reader counts that as a missing item.
  hooks.forEach((h, index) => {
    blocks.push(`### Innovation ${index + 1}: ${h.title}`);
    blocks.push("");
    blocks.push(h.description);
    blocks.push("");
  });
  return blocks.join("\n");
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface DeliverablePhaseResult {
  markdown: string;
  injected: { crosswalk: boolean; phases: boolean; branded: boolean };
}

export function injectDeliverableAndPhases(
  markdown: string,
  opts: {
    tenderText: string;
    projects: ProjectRecord[];
    experts: ExpertRecord[];
    primarySector: string;
    companyName: string;
    totalDays?: number;
  },
): DeliverablePhaseResult {
  const blocks: string[] = [];
  const injected = { crosswalk: false, phases: false, branded: false };

  const hasCrosswalk = markdown.includes(MARKER_CROSSWALK) || HEADING_PATTERNS_CROSSWALK.some((p) => p.test(markdown));
  const hasPhases = markdown.includes(MARKER_PHASES) || HEADING_PATTERNS_PHASES.some((p) => p.test(markdown));
  const hasBranded = markdown.includes(MARKER_BRANDED) || HEADING_PATTERNS_BRANDED.some((p) => p.test(markdown));

  if (!hasCrosswalk) {
    const block = buildDeliverableCrosswalk({ tenderText: opts.tenderText, projects: opts.projects });
    if (block) {
      blocks.push(block);
      injected.crosswalk = true;
    }
  }
  if (!hasPhases) {
    blocks.push(buildPhaseNarrative({ experts: opts.experts, primarySector: opts.primarySector, totalDays: opts.totalDays }));
    injected.phases = true;
  }
  if (!hasBranded) {
    const block = buildBrandedInnovationHooks({ tenderText: opts.tenderText, companyName: opts.companyName });
    if (block) {
      blocks.push(block);
      injected.branded = true;
    }
  }

  if (blocks.length === 0) return { markdown, injected };

  // Insert at end of Section C / Technical Approach (after the tender
  // specifics block and methodology tables). Falls back to before
  // Section D if no Section C heading exists.
  const lines = markdown.split("\n");
  let insertAt = -1;
  let cStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+C\b/i.test(lines[i]) || /^#\s+Technical\s+Approach/i.test(lines[i])) {
      cStart = i;
      break;
    }
  }
  if (cStart >= 0) {
    for (let i = cStart + 1; i < lines.length; i += 1) {
      if (/^#\s+/.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    if (insertAt < 0) insertAt = lines.length;
  } else {
    // Fall back to before Section D
    for (let i = 0; i < lines.length; i += 1) {
      if (/^#\s+Section\s+D\b/i.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    if (insertAt < 0) insertAt = lines.length;
  }

  const out = [
    ...lines.slice(0, insertAt),
    "",
    blocks.join("\n"),
    "",
    ...lines.slice(insertAt),
  ];

  return { markdown: out.join("\n"), injected };
}
