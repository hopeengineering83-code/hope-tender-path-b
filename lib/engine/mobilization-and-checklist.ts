/**
 * Mobilization Plan + Submission Readiness Checklist (PR H).
 *
 * Two more deterministic tables that real elite tender proposals carry
 * but the app didn't generate:
 *
 *   1. Mobilization & Resourcing Plan — week-by-week ramp-up of team
 *      members, equipment, software, office facilities, support staff.
 *      Donor-funded engagements (World Bank, AfDB, EU) explicitly score
 *      "implementation arrangements" and look for this.
 *
 *   2. Submission Readiness Checklist — tear-out final-checks list the
 *      bid manager runs through before clicking submit. Mandatory items
 *      (signature, stamp, file format, deadline) plus quality items
 *      (compliance matrix complete, all CVs signed, references in pack).
 *
 * Both are deterministic, vault-aware, and idempotent (marker comments).
 *
 * SCOPE
 * Operates AFTER win-themes-table (PR G) and BEFORE
 * ensureRubricHeadings. Wired in generate-elite.ts.
 */

import type { ExpertRecord } from "./benchmark-tables";

const MARKER_MOBILIZATION = "<!-- mobilization-plan:table -->";
const MARKER_CHECKLIST = "<!-- submission-checklist:list -->";

const MOBILIZATION_HEADING_PATTERNS: RegExp[] = [
  /^##\s+Mobilization(?:\s+(?:and|&)\s+(?:Resourcing|Resource)\s+Plan)?/im,
  /^###\s+Mobilization(?:\s+(?:and|&)\s+(?:Resourcing|Resource)\s+Plan)?/im,
  /^##\s+Resourcing\s+Plan/im,
];

const CHECKLIST_HEADING_PATTERNS: RegExp[] = [
  /^##\s+Submission\s+Readiness\s+Checklist/im,
  /^###\s+Submission\s+Readiness\s+Checklist/im,
  /^##\s+Final\s+Submission\s+Control\s+Checklist/im,
  /^##\s+Pre-Submission\s+Checklist/im,
];

function hasMobilization(markdown: string): boolean {
  if (markdown.includes(MARKER_MOBILIZATION)) return true;
  return MOBILIZATION_HEADING_PATTERNS.some((p) => p.test(markdown));
}

function hasChecklist(markdown: string): boolean {
  if (markdown.includes(MARKER_CHECKLIST)) return true;
  return CHECKLIST_HEADING_PATTERNS.some((p) => p.test(markdown));
}

// ─── Mobilization rows ───────────────────────────────────────────────────

interface MobilizationRow {
  category: string;
  week1to2: string;
  week3to8: string;
  week9plus: string;
}

function mobilizationRows(experts: ExpertRecord[]): MobilizationRow[] {
  const teamSize = experts.length;
  const teamLabel = teamSize > 0 ? `${teamSize} reviewed expert(s) from the firm's vault` : "Bid-Team Action: confirm team selection before mobilization";

  return [
    {
      category: "Core Team Mobilization",
      week1to2: `Project Principal + Lead Specialist on site / virtual engagement; ${teamLabel}`,
      week3to8: "Full multi-discipline team mobilized; specialist sub-consultants if required",
      week9plus: "Phased ramp-down as deliverables close; resident engineer remains for supervision",
    },
    {
      category: "Office / Workspace",
      week1to2: "Project office set up at firm's HQ + secondary site office if engagement requires; document control archive initialised",
      week3to8: "Active document control with version-managed deliverable register; daily standup workspace",
      week9plus: "Archive workspace; deliverable transfer to client-managed system at handover",
    },
    {
      category: "Software & Digital Tools",
      week1to2: "Licensed CAD / BIM / GIS / hydraulic / pavement / project-management tools provisioned to team; cloud-storage workspace per engagement",
      week3to8: "Active design + collaboration; daily backups; version control; coordination tools (BIM 360 / Revit / EPANET / WaterCAD / AutoCAD Civil 3D / ArcGIS as relevant to scope)",
      week9plus: "Final-deliverable file format conversion (DWG → DWF, PDF/A); model handover pack",
    },
    {
      category: "Field Equipment",
      week1to2: "Site-survey kit (total station / GNSS / drone); geotechnical kit (DCP, sand-cone density, sampling tubes); hydrology kit if relevant",
      week3to8: "Active deployment as per programme; condition checks weekly",
      week9plus: "Equipment de-mobilization; calibration certificates filed",
    },
    {
      category: "Support Staff",
      week1to2: "Document controller, GIS analyst, drafting team, admin support active from week 1",
      week3to8: "Continued support with phase-aligned ramp; technical writers engaged for deliverable production",
      week9plus: "Admin + document control active until close-out memo signed",
    },
    {
      category: "Quality Assurance Resourcing",
      week1to2: "Technical Director nominated as 100% gate reviewer; independent peer reviewer identified",
      week3to8: "Active gate reviews at 30% / 60% / 100%; independent peer review at 100%",
      week9plus: "Close-out QA — final-deliverable audit; client-comment resolution log signed off",
    },
    {
      category: "Communication Infrastructure",
      week1to2: "Weekly client coordination cadence established; reporting templates issued; escalation matrix circulated",
      week3to8: "Active weekly meetings + monthly progress reports; live action register",
      week9plus: "Close-out memo + lessons-learned session with client team",
    },
  ];
}

function buildMobilizationTable(experts: ExpertRecord[]): string {
  const rows = mobilizationRows(experts);
  const head = "| Resource Category | Weeks 1–2 (Inception / Mobilization) | Weeks 3–8 (Active Delivery) | Week 9+ (Steady State / Close-out) |";
  const sep = "|-------------------|--------------------------------------|-----------------------------|------------------------------------|";
  const body = rows.map((r) => `| ${r.category} | ${r.week1to2} | ${r.week3to8} | ${r.week9plus} |`);
  return [
    MARKER_MOBILIZATION,
    "## Mobilization and Resourcing Plan",
    "",
    "Mobilization is structured in three windows: an Inception window (Weeks 1–2) that establishes team, workspace, tools, and reporting cadence; an Active Delivery window (Weeks 3–8) that runs the design / methodology with full team commitment; and a Steady State / Close-out window (Week 9 onwards) that transitions to construction supervision or handover. The plan below shows what is in place at each window.",
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}

// ─── Submission readiness rows ───────────────────────────────────────────

interface ChecklistGroup {
  group: string;
  items: { item: string; mandatory: boolean }[];
}

// `financialProposalRequired === false` means the tender asks for no financial
// proposal at this stage. Checklist wording must not then point the reader at a
// financial document that is not part of the submission. Nothing changes for
// tenders that do require one.
function checklistGroups(financialProposalRequired: boolean): ChecklistGroup[] {
  const stampTargets = financialProposalRequired
    ? "cover letter, declaration, financial proposal"
    : "cover letter, declaration";
  return [
    {
      group: "Identity & Authorization",
      items: [
        { item: "Cover letter signed by authorized signatory (typically GM)", mandatory: true },
        { item: `Company stamp affixed where required (${stampTargets})`, mandatory: true },
        { item: "Power of Attorney attached if signatory is not GM", mandatory: false },
        { item: "Authorised representative contact details correct on cover", mandatory: true },
      ],
    },
    {
      group: "Eligibility & Compliance",
      items: [
        { item: "Trade licence / business registration certificate attached", mandatory: true },
        { item: "TIN / VAT certificate attached", mandatory: true },
        { item: "Tax-clearance certificate within validity window", mandatory: true },
        { item: "Professional licence (engineering / architecture / planning) attached", mandatory: false },
        { item: "Anti-corruption / integrity declaration signed", mandatory: false },
        { item: "Conflict-of-interest declaration signed", mandatory: false },
      ],
    },
    {
      group: "Technical Pack",
      items: [
        { item: "Cover page formatted per tender instructions (or omitted if tender forbids)", mandatory: true },
        { item: "Table of contents present and accurate", mandatory: true },
        { item: "All Sections A–H present (or rubric criteria sections present)", mandatory: true },
        { item: "Compliance matrix complete with status per requirement", mandatory: true },
        { item: "Win Themes / Discriminators table present", mandatory: false },
        { item: "Self-score (Section H) present with predicted overall and top-three risks", mandatory: false },
      ],
    },
    {
      group: "Team & References",
      items: [
        { item: "All proposed CVs attached, signed, and dated", mandatory: true },
        { item: "Project reference list with at least the minimum required by ToR", mandatory: true },
        { item: "Testimony / completion letters attached for cited references", mandatory: false },
        { item: "Sub-consultant / JV agreements attached (if applicable)", mandatory: false },
      ],
    },
    {
      group: "Format & File Hygiene",
      items: [
        { item: "File format matches tender instruction (PDF / DOCX / printed)", mandatory: true },
        { item: "Page numbering consistent and present on every page", mandatory: true },
        { item: "Page size, margins, and font match tender format requirements", mandatory: false },
        { item: "All hyperlinks tested if tender allows electronic submission", mandatory: false },
        { item: "File names match tender naming convention", mandatory: true },
        { item: "Total page / word count within any tender-set limit", mandatory: false },
      ],
    },
    {
      group: "Submission",
      items: [
        { item: "Submission method confirmed (e-tender portal / physical / email)", mandatory: true },
        { item: "Deadline date AND time confirmed in submitter's local timezone", mandatory: true },
        { item: "Number of copies (original + duplicates) prepared per tender", mandatory: true },
        { item: "Sealing / packaging instructions followed (separate Technical and Financial envelopes)", mandatory: true },
        { item: "Receipt / acknowledgement obtained at submission", mandatory: true },
        { item: "Internal copy retained in firm's bid archive", mandatory: false },
      ],
    },
  ];
}

function buildChecklist(financialProposalRequired: boolean): string {
  const groups = checklistGroups(financialProposalRequired);
  const blocks: string[] = [
    MARKER_CHECKLIST,
    "## Submission Readiness Checklist",
    "",
    "The bid manager runs through this checklist immediately before submission. Items marked **[Mandatory]** must be ticked before the bid is dispatched; items marked **[Recommended]** should be confirmed where the tender or context applies. A signed copy of this checklist is retained in the bid archive.",
    "",
  ];

  for (const g of groups) {
    blocks.push(`### ${g.group}`);
    blocks.push("");
    for (const it of g.items) {
      const tag = it.mandatory ? "**[Mandatory]**" : "[Recommended]";
      blocks.push(`- [ ] ${tag} ${it.item}`);
    }
    blocks.push("");
  }

  blocks.push("---");
  blocks.push("");
  blocks.push("**Final sign-off**");
  blocks.push("");
  blocks.push("- [ ] Bid Manager: I have run through every item in this checklist. Mandatory items are ticked or have a written exception logged in the bid file. The bid is ready for submission.");
  blocks.push("");
  blocks.push("Signed: ____________________   Name: ____________________   Date: ____________________");
  blocks.push("");

  return blocks.join("\n");
}

// ─── Insertion ───────────────────────────────────────────────────────────

function findMobilizationInsertPoint(markdown: string): number {
  const lines = markdown.split("\n");
  // Prefer: end of Section A (Approach / Company Profile)
  let aStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (
      /^#\s+Section\s+A\b/i.test(lines[i]) ||
      /^#\s+(?:Company\s+Profile|Approach\s+and\s+Methodology)/i.test(lines[i])
    ) {
      aStart = i;
      break;
    }
  }
  if (aStart >= 0) {
    for (let i = aStart + 1; i < lines.length; i += 1) {
      if (/^#\s+/.test(lines[i])) return i;
    }
  }
  // Fallback: before Section C
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#\s+Section\s+C\b/i.test(lines[i]) || /^#\s+Technical\s+Approach/i.test(lines[i])) {
      return i;
    }
  }
  return lines.length;
}

function findChecklistInsertPoint(markdown: string): number {
  // Always at end of document — checklist is the last thing the bid
  // manager reads.
  return markdown.split("\n").length;
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface MobAndChecklistResult {
  markdown: string;
  injected: { mobilization: boolean; checklist: boolean };
}

export function injectMobilizationAndChecklist(
  markdown: string,
  opts: { experts: ExpertRecord[]; financialProposalRequired?: boolean },
): MobAndChecklistResult {
  let result = markdown;
  const injected = { mobilization: false, checklist: false };

  if (!hasMobilization(result)) {
    const block = buildMobilizationTable(opts.experts);
    const insertAt = findMobilizationInsertPoint(result);
    const lines = result.split("\n");
    result = [
      ...lines.slice(0, insertAt),
      "",
      block,
      "",
      ...lines.slice(insertAt),
    ].join("\n");
    injected.mobilization = true;
  }

  if (!hasChecklist(result)) {
    const block = buildChecklist(opts.financialProposalRequired !== false);
    const insertAt = findChecklistInsertPoint(result);
    const lines = result.split("\n");
    result = [
      ...lines.slice(0, insertAt),
      "",
      block,
      "",
    ].join("\n");
    injected.checklist = true;
  }

  return { markdown: result, injected };
}
