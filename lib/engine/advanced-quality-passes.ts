/**
 * Advanced quality passes — PR HH, LL, MM.
 *
 * PR HH: Content-level table deduplication.
 *   Scans the assembled markdown for Markdown tables whose header row is
 *   identical. When duplicates exist (AI-produced + deterministic builder
 *   both emitted the same table), remove the EARLIER occurrence and keep
 *   the LATER one (deterministic builders run last, so the later one is
 *   always the structured version). Idempotent — run as many times as
 *   needed.
 *
 * PR LL: Tender-specific QA numeric threshold injection.
 *   Extracts numeric thresholds from the tender text (review rounds, day
 *   limits, defect tolerances, inspection frequencies) and appends a
 *   "Tender-Specific Quality Requirements" sub-section directly below the
 *   Three-Stage Review table when present. Elevates the QA section from
 *   generic to tender-responsive — an important differentiator on tenders
 *   that specify ISO or FIDIC QA requirements.
 *
 * PR MM: Appendix readiness register cross-check.
 *   Scans the assembled proposal for "Annex X / Appendix X" references in
 *   table cells and proposal prose. Builds a compact "Appendix Readiness
 *   Register" table at end-of-document listing each detected annex, its
 *   inferred content type, and readiness status derived from the company
 *   vault documents supplied. Annexes without corresponding vault evidence
 *   get a "Bid-Team Action: prepare" flag that surfaces the gap before
 *   submission. Idempotent via marker.
 */

// ─── PR HH: Table deduplication ───────────────────────────────────────────

function extractTableHeader(line: string): string {
  return line
    .split("|")
    .filter((_, i, arr) => i > 0 && i < arr.length - 1)
    .map((c) => c.replace(/\*\*/g, "").trim().toLowerCase())
    .join("|");
}

function isSeparator(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

export interface DedupeTablesResult {
  markdown: string;
  removed: number;
}

export function deduplicateTables(markdown: string): DedupeTablesResult {
  const lines = markdown.split("\n");
  // Collect all table blocks: {startLine, endLine (exclusive), headerKey}
  interface TableBlock { start: number; end: number; headerKey: string }
  const tables: TableBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const start = i;
      const headerKey = extractTableHeader(lines[i]);
      let j = i + 1;
      while (j < lines.length && isTableLine(lines[j])) j += 1;
      tables.push({ start, end: j, headerKey });
      i = j;
    } else {
      i += 1;
    }
  }

  // Group by header key; for each group with duplicates, mark all but the
  // LAST (deterministic) as removed.
  const toRemove = new Set<number>();
  const byHeader = new Map<string, TableBlock[]>();
  for (const t of tables) {
    if (!byHeader.has(t.headerKey)) byHeader.set(t.headerKey, []);
    byHeader.get(t.headerKey)!.push(t);
  }
  for (const group of byHeader.values()) {
    if (group.length < 2) continue;
    // Mark all but the last for removal
    for (const t of group.slice(0, -1)) {
      for (let k = t.start; k < t.end; k += 1) toRemove.add(k);
      // Also remove a blank line immediately before the table, if any
      if (t.start > 0 && lines[t.start - 1].trim() === "") toRemove.add(t.start - 1);
    }
  }

  if (toRemove.size === 0) return { markdown, removed: 0 };

  const out = lines.filter((_, idx) => !toRemove.has(idx));
  return { markdown: out.join("\n").replace(/\n{3,}/g, "\n\n"), removed: toRemove.size };
}

// ─── PR LL: QA numeric threshold injection ────────────────────────────────

interface QaThreshold {
  label: string;
  value: string;
}

function extractQaThresholds(tenderText: string): QaThreshold[] {
  const thresholds: QaThreshold[] = [];
  const seen = new Set<string>();

  const patterns: Array<[string, RegExp]> = [
    ["Maximum deliverable review period", /(\d+)\s*(?:working\s+|calendar\s+)?days?\s+(?:for|per|of|after|from|within)\s+(?:review|comment|feedback|submission|notification)/i],
    ["Required review rounds", /(\d+)\s+(?:rounds?|cycles?|iterations?)\s+of\s+(?:review|revision|comment)/i],
    ["Quality inspection frequency", /(?:quality|QA|QC)\s+inspection(?:s)?\s+(?:every|each|per)\s+(\d+)\s*(?:week|month|day|deliverable)/i],
    ["ISO / QMS standard required", /(ISO\s*\d{4,5}(?::\d{4})?)/i],
    ["Maximum defect / error tolerance", /(\d+(?:\.\d+)?\s*%)\s*(?:defect|error|non-conformance|failure)\s+(?:rate|tolerance|limit)/i],
    ["Minimum peer-review experience", /peer[\s-]?reviewer.{0,40}?(\d+)\s*(?:years?|yr)/i],
    ["Design review stage requirement", /(\d{1,3})%\s*(?:design\s+review|gate\s+review|stage\s+review)/i],
  ];

  for (const [label, re] of patterns) {
    const m = tenderText.match(re);
    if (m) {
      const value = m[1];
      const key = `${label}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        thresholds.push({ label, value });
      }
    }
  }

  return thresholds;
}

const QA_THRESHOLDS_MARKER = "<!-- qa-thresholds:injected -->";
const QA_HEADING_RE = /^##\s+C\.3\s+Quality\s+Assurance/im;

export interface QaThresholdsResult {
  markdown: string;
  injected: boolean;
}

export function injectQaThresholds(markdown: string, tenderText: string): QaThresholdsResult {
  if (markdown.includes(QA_THRESHOLDS_MARKER)) return { markdown, injected: false };

  const thresholds = extractQaThresholds(tenderText);
  if (thresholds.length === 0) return { markdown, injected: false };

  const tableRows = thresholds.map((t) => `| ${t.label} | **${t.value}** | Tender-specified — confirm compliance in QA plan before submission. |`);
  const block = [
    "",
    QA_THRESHOLDS_MARKER,
    "**Tender-Specific Quality Requirements:**",
    "",
    "| Quality Requirement | Tender Threshold | Compliance Confirmation |",
    "|---|---|---|",
    ...tableRows,
    "",
  ].join("\n");

  // Find the QA table and inject after it
  const lines = markdown.split("\n");
  let qaEnd = -1;
  let inQaSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (QA_HEADING_RE.test(lines[i])) {
      inQaSection = true;
      continue;
    }
    if (inQaSection) {
      // End of QA section = next ## heading
      if (/^##\s/.test(lines[i]) && !QA_HEADING_RE.test(lines[i])) {
        qaEnd = i;
        break;
      }
    }
  }

  if (qaEnd < 0 && inQaSection) qaEnd = lines.length;
  if (qaEnd < 0) return { markdown, injected: false };

  const out = [
    ...lines.slice(0, qaEnd),
    block,
    ...lines.slice(qaEnd),
  ];
  return { markdown: out.join("\n"), injected: true };
}

// ─── PR MM: Appendix readiness register ───────────────────────────────────

const APPENDIX_REG_MARKER = "<!-- appendix-register:cross-check -->";

const ANNEX_REF_RE = /\b(?:Annex|Appendix|Attachment)\s+([A-Z]|\d+)\b/gi;

interface AnnexRef {
  label: string;
  inferredContent: string;
}

// Labels aligned with inferPackageReference() in compliance-matrix-builder.ts
// so the Appendix Readiness Register and Section E Compliance Matrix
// use consistent annex descriptions throughout the proposal.
function inferAnnexContent(label: string): string {
  const l = label.toUpperCase();
  const map: Record<string, string> = {
    A: "CV & Qualifications",
    B: "Project Reference Sheets",
    C: "Company Profile",
    D: "Declarations & Undertakings",
    E: "Financial Records",
    F: "Eligibility Documents",
    G: "Tender Forms",
    H: "Consortium / MoU Agreement",
    I: "Technical Drawings / Plans",
    J: "Additional Supporting Documents",
    "1": "Supporting Documentation (per tender numbering)",
    "2": "Supporting Documentation (per tender numbering)",
    "3": "Supporting Documentation (per tender numbering)",
  };
  return map[l] ?? `Supporting Documentation (Annex ${label})`;
}

export interface AppendixRegResult {
  markdown: string;
  injected: boolean;
}

export function injectAppendixReadinessRegister(
  markdown: string,
  vaultDocumentNames: string[],
): AppendixRegResult {
  if (markdown.includes(APPENDIX_REG_MARKER)) return { markdown, injected: false };

  // Collect unique annex references
  const refs = new Map<string, AnnexRef>();
  let m: RegExpExecArray | null;
  ANNEX_REF_RE.lastIndex = 0;
  while ((m = ANNEX_REF_RE.exec(markdown)) !== null) {
    const label = m[1];
    if (!refs.has(label)) {
      refs.set(label, { label, inferredContent: inferAnnexContent(label) });
    }
  }

  if (refs.size === 0) return { markdown, injected: false };

  // Check which annexes are covered by vault documents
  const vaultLower = vaultDocumentNames.map((d) => d.toLowerCase());
  const VAULT_KEYWORDS: Record<string, RegExp> = {
    A: /cv|curriculum vitae|qualification|expert|personnel/i,
    B: /project|reference|portfolio|experience/i,
    C: /company|profile|about|firm/i,
    D: /declaration|eligibility|undertaking|conflict/i,
    E: /financial|audit|balance|turnover|bank/i,
    F: /registration|license|certificate|accreditation/i,
    G: /form|template|bid.*form/i,
    H: /consortium|joint.*venture|mou|partner/i,
  };

  const rows = Array.from(refs.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((ref) => {
      const kw = VAULT_KEYWORDS[ref.label.toUpperCase()];
      const covered = kw
        ? vaultLower.some((d) => kw.test(d))
        : false;
      const status = covered
        ? "Vault document available — attach as-is or update before submission."
        : "Bid-Team Action: prepare document and attach before submission.";
      return `| Annex ${ref.label} | ${ref.inferredContent} | ${status} |`;
    });

  const block = [
    "",
    APPENDIX_REG_MARKER,
    "## Annex & Appendix Readiness Register",
    "",
    "Cross-check of all annexes and appendices referenced in this proposal against the company vault. Items marked 'Bid-Team Action' require preparation before the submission package is assembled.",
    "",
    "| Annex | Inferred Content | Readiness Status |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");

  return { markdown: markdown + block, injected: true };
}
