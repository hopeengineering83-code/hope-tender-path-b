/**
 * PR EE — Markdown cover page injector.
 * PR II — RFP reference metadata under cover letter subject line.
 *
 * PR EE: Inserts a formal markdown cover page block at the very start of the
 * assembled proposal (before Cover Letter). The DOCX cover page block already
 * exists (buildCoverBlock) but the markdown output has no equivalent — the
 * TOC-first reader sees raw text with no branding or submission context.
 *
 * PR II: The AI-written cover letter carries a subject line but often omits
 * the compact "RFP # | Submission: date | Validity: X days" reference bar
 * that evaluators use to file the proposal against the procurement record.
 * This injector adds it as the line immediately following the detected
 * subject line when it is absent.
 *
 * Both are idempotent via marker comments. Neither fabricates — fields
 * that are null in the intelligence / tender record are silently omitted.
 */

const COVER_PAGE_MARKER = "<!-- cover-page:markdown -->";
const RFP_META_MARKER = "<!-- rfp-meta:injected -->";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CoverPageOpts {
  companyName: string;
  companyLegalName?: string | null;
  tenderTitle: string;
  clientName: string;
  reference?: string | null;
  exactSubjectLine?: string | null;
  submissionDate?: Date | null;
  proposalValidityDays?: number | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tin?: string | null;
  gmName?: string | null;
  gmTitle?: string | null;
}

export interface CoverPageResult {
  markdown: string;
  coverPageInjected: boolean;
  rfpMetaInjected: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

// ─── PR EE: Markdown cover page ───────────────────────────────────────────

function buildCoverPageBlock(opts: CoverPageOpts): string {
  const lines: string[] = [COVER_PAGE_MARKER, ""];

  const subject = opts.exactSubjectLine
    ? opts.exactSubjectLine.trim()
    : `Technical Proposal — ${opts.tenderTitle}`;

  lines.push(`# ${opts.companyName}`);
  if (opts.companyLegalName && opts.companyLegalName !== opts.companyName) {
    lines.push(`*${opts.companyLegalName}*`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`**${subject}**`);
  lines.push("");

  // Two-column metadata block formatted as a tight table.
  const meta: [string, string][] = [];
  meta.push(["Submitted to", opts.clientName]);
  meta.push(["Submitted by", `${opts.companyName}${opts.companyLegalName && opts.companyLegalName !== opts.companyName ? ` (${opts.companyLegalName})` : ""}`]);
  if (opts.reference) meta.push(["RFP / Tender Reference", opts.reference]);
  const dateStr = formatDate(opts.submissionDate);
  if (dateStr) meta.push(["Submission Date", dateStr]);
  if (opts.proposalValidityDays && opts.proposalValidityDays > 0) {
    meta.push(["Proposal Validity", `${opts.proposalValidityDays} days from submission`]);
  }
  if (opts.address) meta.push(["Address", opts.address]);
  if (opts.phone) meta.push(["Phone", opts.phone]);
  if (opts.email) meta.push(["Email", opts.email]);
  if (opts.website) meta.push(["Website", opts.website]);
  if (opts.tin) meta.push(["TIN", opts.tin]);
  if (opts.gmName) {
    const gmLine = opts.gmTitle ? `${opts.gmName} — ${opts.gmTitle}` : opts.gmName;
    meta.push(["Prepared by", gmLine]);
  }

  lines.push("| | |");
  lines.push("|---|---|");
  for (const [k, v] of meta) {
    lines.push(`| **${k}** | ${v} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// ─── PR II: RFP metadata under cover letter subject line ──────────────────

function buildRfpMetaBar(opts: CoverPageOpts): string {
  const parts: string[] = [];
  if (opts.reference) parts.push(`RFP # ${opts.reference}`);
  const dateStr = formatDate(opts.submissionDate);
  if (dateStr) parts.push(`Submission: ${dateStr}`);
  if (opts.proposalValidityDays && opts.proposalValidityDays > 0) {
    parts.push(`Validity: ${opts.proposalValidityDays} days`);
  }
  if (parts.length === 0) return "";
  return `${RFP_META_MARKER}\n_${parts.join(" | ")}_`;
}

// Find the subject / re line in the cover letter zone.
// Returns the line index of the subject line, or -1.
const SUBJECT_LINE_RE = /^\*{1,2}(?:Subject|Re|Reference|Ref|RE)\s*[:—–]\s*.+\*{1,2}\s*$/i;
const COVER_LETTER_HEADING_RE = /^\s*#{1,3}\s*(?:cover(?:ing)?\s+letter|letter\s+of\s+(?:transmittal|submission|interest)|transmittal\s+letter)/i;

function findSubjectLine(lines: string[]): number {
  // Only look within the cover-letter zone (first 60 lines after a cover-letter heading).
  let inCoverLetter = false;
  let coverLetterStart = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i += 1) {
    if (COVER_LETTER_HEADING_RE.test(lines[i])) {
      inCoverLetter = true;
      coverLetterStart = i;
      break;
    }
  }
  // If no explicit cover letter heading, assume the first 60 lines ARE the cover letter.
  const searchEnd = inCoverLetter ? coverLetterStart + 60 : 60;
  for (let i = inCoverLetter ? coverLetterStart : 0; i < Math.min(lines.length, searchEnd); i += 1) {
    if (SUBJECT_LINE_RE.test(lines[i])) return i;
  }
  return -1;
}

// ─── Public API ───────────────────────────────────────────────────────────

export function injectCoverPageAndRfpMeta(
  markdown: string,
  opts: CoverPageOpts,
): CoverPageResult {
  let result = markdown;
  let coverPageInjected = false;
  let rfpMetaInjected = false;

  // PR EE: inject cover page block at the very top.
  if (!result.includes(COVER_PAGE_MARKER)) {
    const block = buildCoverPageBlock(opts);
    result = block + result;
    coverPageInjected = true;
  }

  // PR II: inject RFP meta bar after subject line in cover letter zone.
  if (!result.includes(RFP_META_MARKER)) {
    const metaBar = buildRfpMetaBar(opts);
    if (metaBar) {
      const lines = result.split("\n");
      const subjectLine = findSubjectLine(lines);
      if (subjectLine >= 0) {
        lines.splice(subjectLine + 1, 0, "", metaBar);
        result = lines.join("\n");
        rfpMetaInjected = true;
      }
    }
  }

  return { markdown: result, coverPageInjected, rfpMetaInjected };
}
