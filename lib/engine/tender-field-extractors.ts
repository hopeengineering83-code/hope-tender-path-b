import { nonClientEntityLabelPattern, canonicalizeCountry } from "./metadata-validators";

// Deterministic, source-grounded extractors for tender-metadata scalar fields.
//
// When AI Analyze is unavailable (rate-limited, providers exhausted, malformed
// JSON) the codebase used to leave tender.reference / .deadline / .pageLimit /
// .submissionEmails / etc. null, then the metadata-completeness gate blocked
// generation forever. The user has been forced to fill these by hand even
// when the tender source plainly carries them.
//
// This module is the pure, regex-only fallback that #519 set the precedent
// for (the evaluationMethodology extractor) extended to the rest of the
// critical-and-near-critical metadata. It NEVER invents content; when a
// pattern does not match, it returns `{ found: false, reason }`.
//
// Used by:
//   • POST /api/tenders/[id]/repair-metadata (the per-field repair endpoint)
//   • the upload pipeline (after OCR / text-extract, auto-fill empty fields)
//
// Output shape per extractor:
//   ExtractedFieldOrMissing<T> =
//     | { found: true, value: T, sourceQuote: string, sourceFile: string|null, confidence: "HIGH"|"MEDIUM"|"LOW" }
//     | { found: false, reason: string }
//
// Hard safety properties:
//   • verbatim sourceQuote (≤200 chars) so the audit log can show WHERE the
//     value came from,
//   • picks the highest-confidence match across all files,
//   • never paraphrases, summarises, or fuzzes,
//   • never returns `null` as a value — only `found:false`.

export type ExtractedField<T> = {
  found: true;
  value: T;
  sourceQuote: string;
  sourceFile: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};
export type ExtractedFieldMissing = { found: false; reason: string };
export type ExtractedFieldOrMissing<T> = ExtractedField<T> | ExtractedFieldMissing;

export type TenderFileInput = { fileName?: string | null; extractedText?: string | null };
export type ExtractorInput = { files: TenderFileInput[] };

const QUOTE_MAX = 200;
const SOURCE_MIN = 80;

function pickBest<T>(candidates: ExtractedField<T>[]): ExtractedFieldOrMissing<T> {
  if (candidates.length === 0) return { found: false, reason: "no plausible match in any tender file" };
  const order = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  candidates.sort((a, b) => order[b.confidence] - order[a.confidence]);
  return candidates[0];
}

function trimQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
}

function captureAround(text: string, index: number, length: number, before = 30, after = 80): string {
  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + length + after);
  return trimQuote(text.slice(start, end));
}

// ─── 1. Reference number ──────────────────────────────────────────────────
// BUGFIX: The old regex captured "Number" as the value when the document had
// "Reference Number:" followed by a newline before the actual number. The
// capture group `[A-Z0-9][A-Z0-9./_\-]{2,40}` matched "Number" because it
// starts with 'N' (uppercase) and contains only letters. Now we:
// 1. Use a negative lookahead to reject label words
// 2. Require the first pattern to use "Ref" (not "Reference") to avoid
//    matching "Reference Number" which should be handled by pattern 2
// 3. Reject pure-label values in the extractReference function
const LABEL_WORDS = "(?:Number|Reference|Ref|No|ID|Code)";
const REFERENCE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  // "Tender Reference: ABC-123" / "RFP ID: XYZ/2026/01" / "Tender Ref: ABC-123"
  // Uses "Reference" (full word) or "Ref." or "ID" — NOT "Ref" alone (which
  // would partially match "Reference" and capture "erence")
  { rx: new RegExp(
    "\\b(?:Tender|RFP|RFQ|ITB|EOI|Procurement)\\s+(?:Reference|Ref\\.|ID)\\s*[:#-]?\\s*" +
    "(?!" + LABEL_WORDS + "\\b)" +
    "([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"
    ), confidence: "HIGH" },
  // "Reference No.: ABC-123" / "Reference Number: XYZ/2026/01"
  { rx: new RegExp(
    "\\bReference\\s+(?:No\\.?|Number|#)\\s*[:.]?\\s*" +
    "(?!" + LABEL_WORDS + "\\b)" +
    "([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"
    ), confidence: "HIGH" },
  // "Procurement Plan No.: 12345" / "ITT No. 7777"
  { rx: new RegExp(
    "\\b(?:Procurement|ITT|ITB|EOI|RFP)\\s+(?:Plan\\s+)?No\\.?\\s*[:#-]?\\s*" +
    "(?!" + LABEL_WORDS + "\\b)" +
    "([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"
    ), confidence: "MEDIUM" },
];

export function extractReference(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  // Reject pure-label values that slipped through (e.g., "Number", "Reference")
  const LABEL_REJECT = /^(number|reference|ref|no|id|code|tender|rfp|rfq|itb|eoi|procurement)$/i;
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of REFERENCE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = m[1].trim();
      if (value.length < 3) continue;
      if (LABEL_REJECT.test(value)) continue; // reject label words
      cands.push({
        found: true,
        value,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 2. Deadline (date + optional time) ──────────────────────────────────
// Two-step: find a deadline-context keyword, then parse a date close after.
const DEADLINE_CONTEXT = /\b(?:Submission|Bid|Proposal|Tender|Closing|Deadline|Last\s+date(?:\s+for\s+submission)?)\s+(?:Deadline|Date|Closing)?\s*[:.]?/gi;
const DATE_PATTERN = /(\d{1,2})\s*[\/\-\s]\s*(?:(\d{1,2})|([A-Za-z]{3,9}))\s*[\/\-\s,]?\s*(\d{2,4})\s*(?:,?\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm|hrs?|h)?)?/i;
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/;

function parseLooseDate(raw: string): Date | null {
  const isoMatch = ISO_DATE.exec(raw);
  if (isoMatch) {
    const [, y, m, d, hh, mm] = isoMatch;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh ?? "0"), Number(mm ?? "0")));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const m = DATE_PATTERN.exec(raw);
  if (!m) return null;
  const dayN = Number(m[1]);
  const monthName = m[3];
  const monthNum = m[2] ? Number(m[2]) : monthName ? monthIndexFromName(monthName) : null;
  const yearRaw = Number(m[4]);
  if (monthNum === null || !Number.isFinite(dayN) || !Number.isFinite(yearRaw)) return null;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  let hour = m[5] ? Number(m[5]) : 0;
  const minute = m[6] ? Number(m[6]) : 0;
  const ampm = (m[7] ?? "").toLowerCase();
  if (ampm.startsWith("p") && hour < 12) hour += 12;
  if (ampm.startsWith("a") && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, monthNum, dayN, hour, minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthIndexFromName(name: string): number | null {
  const lower = name.toLowerCase().slice(0, 3);
  const map: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  return map[lower] ?? null;
}

export function extractDeadline(input: ExtractorInput): ExtractedFieldOrMissing<Date> {
  const cands: ExtractedField<Date>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    DEADLINE_CONTEXT.lastIndex = 0;
    let ctx: RegExpExecArray | null;
    while ((ctx = DEADLINE_CONTEXT.exec(text)) !== null) {
      const window = text.slice(ctx.index, Math.min(text.length, ctx.index + 220));
      const parsed = parseLooseDate(window);
      if (!parsed) continue;
      cands.push({
        found: true,
        value: parsed,
        sourceQuote: trimQuote(window),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 3. Submission emails ────────────────────────────────────────────────
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SUBMISSION_CONTEXT = /\b(?:submit|submission|send|email|tender to|proposal to|bids? to|forward to)\b/i;

export function extractSubmissionEmails(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    EMAIL_PATTERN.lastIndex = 0;
    const emails: string[] = [];
    let firstIndex: number | null = null;
    let m: RegExpExecArray | null;
    while ((m = EMAIL_PATTERN.exec(text)) !== null) {
      const around = text.slice(Math.max(0, m.index - 200), m.index);
      if (!SUBMISSION_CONTEXT.test(around)) continue;
      const email = m[0].toLowerCase();
      if (!emails.includes(email)) emails.push(email);
      if (firstIndex === null) firstIndex = m.index;
      if (emails.length >= 3) break;
    }
    if (emails.length === 0 || firstIndex === null) continue;
    cands.push({
      found: true,
      value: emails.join(", "),
      sourceQuote: captureAround(text, firstIndex, emails[0].length, 120, 80),
      sourceFile: file?.fileName ?? null,
      confidence: emails.length > 0 ? "HIGH" : "MEDIUM",
    });
  }
  return pickBest(cands);
}

// ─── 4. Submission method (portal / email / sealed envelope / hand) ─────
const METHOD_PATTERNS: Array<{ rx: RegExp; value: string; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:online|electronic|e[-\s]?procurement|portal)\s+submission\b/i, value: "PORTAL", confidence: "HIGH" },
  { rx: /\b(?:submit|upload)\s+(?:via|through|on)\s+(?:the\s+)?(?:portal|website|e-procurement|system)\b/i, value: "PORTAL", confidence: "HIGH" },
  { rx: /\bemail\s+submission\b/i, value: "EMAIL", confidence: "HIGH" },
  { rx: /\bsealed\s+(?:envelope|bid|proposal)\b/i, value: "SEALED_ENVELOPE", confidence: "HIGH" },
  { rx: /\bhand[\s-]?(?:delivery|deliver|carry)\b/i, value: "HAND_DELIVERY", confidence: "MEDIUM" },
  { rx: /\bcourier(?:\s+service)?\b/i, value: "COURIER", confidence: "MEDIUM" },
];

export function extractSubmissionMethod(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of METHOD_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      cands.push({
        found: true,
        value: p.value,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 5. Page limit ────────────────────────────────────────────────────────
const PAGE_LIMIT_PATTERNS: RegExp[] = [
  /\b(?:not\s+exceed|maximum|max\.?)\s+(\d{1,3})\s*pages\b/i,
  /\bpage\s+limit\s*[:.]?\s*(\d{1,3})\b/i,
  /\blimited\s+to\s+(\d{1,3})\s*pages\b/i,
  /\b(\d{1,3})\s*pages?\s+maximum\b/i,
];

export function extractPageLimit(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const rx of PAGE_LIMIT_PATTERNS) {
      const m = rx.exec(text);
      if (!m) continue;
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 1 || n > 500) continue;
      cands.push({
        found: true,
        value: n,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 6. Proposal validity (days) ─────────────────────────────────────────
const VALIDITY_PATTERNS: RegExp[] = [
  /\b(?:proposal|bid|offer)\s+(?:shall\s+remain|must\s+remain|to\s+remain|will\s+remain)?\s*valid(?:\s+for)?\s+(?:a\s+(?:minimum\s+)?period\s+of\s+)?(\d{1,3})\s+(days?|months?)\b/i,
  /\bvalidity\s+(?:period\s*[:.]?\s*)?(\d{1,3})\s+(days?|months?)\b/i,
  /\bvalid(?:\s+for)?\s+(\d{1,3})\s+(days?|months?)\b/i,
];

export function extractValidityDays(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const rx of VALIDITY_PATTERNS) {
      const m = rx.exec(text);
      if (!m) continue;
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const days = unit.startsWith("month") ? n * 30 : n;
      if (!Number.isFinite(days) || days < 1 || days > 365) continue;
      cands.push({
        found: true,
        value: days,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 7. Bid bond / bid security ──────────────────────────────────────────
const BID_BOND_PATTERN = /\bbid\s+(?:bond|security|guarantee)\s+(?:of\s+)?(?:in\s+the\s+amount\s+of\s+)?([A-Z]{3})?\s*([\d,]{3,15})(?:\s*([A-Z]{3}))?/i;
const PERCENT_BOND_PATTERN = /\bbid\s+(?:bond|security)\s+(?:of\s+)?(\d{1,2}(?:\.\d+)?)\s*%/i;

export function extractBidBondAmount(input: ExtractorInput): ExtractedFieldOrMissing<{ amount: number; currency: string | null }> {
  const cands: ExtractedField<{ amount: number; currency: string | null }>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    const m = BID_BOND_PATTERN.exec(text);
    if (m) {
      const amountStr = m[2].replace(/[,\s]/g, "");
      const amount = Number(amountStr);
      const currency = (m[1] ?? m[3] ?? null)?.toUpperCase() ?? null;
      if (Number.isFinite(amount) && amount > 0 && amount < 1e12) {
        cands.push({
          found: true,
          value: { amount, currency },
          sourceQuote: captureAround(text, m.index, m[0].length),
          sourceFile: file?.fileName ?? null,
          confidence: currency ? "HIGH" : "MEDIUM",
        });
        continue;
      }
    }
    const pm = PERCENT_BOND_PATTERN.exec(text);
    if (pm) {
      // Percent bond — we can't know the absolute amount without the budget,
      // so emit MEDIUM with a special marker (amount = 0 + currency = "PERCENT").
      // Callers can show "5% of tender value" verbatim from the quote.
      cands.push({
        found: true,
        value: { amount: 0, currency: "PERCENT" },
        sourceQuote: captureAround(text, pm.index, pm[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "MEDIUM",
      });
    }
  }
  return pickBest(cands);
}

// ─── 8. Number of copies required ───────────────────────────────────────
const COPIES_PATTERN = /\b(?:one\s+original\s+(?:plus|and)\s+(\d+)\s+(?:copies|copy)|(\d+)\s+(?:copies|copy)(?:\s+of\s+(?:the\s+)?(?:bid|proposal|tender))?|(\d+)\s+hard\s+copies)/i;

export function extractNumberOfCopies(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    const m = COPIES_PATTERN.exec(text);
    if (!m) continue;
    const n = Number(m[1] ?? m[2] ?? m[3]);
    if (!Number.isFinite(n) || n < 1 || n > 50) continue;
    cands.push({
      found: true,
      value: n,
      sourceQuote: captureAround(text, m.index, m[0].length),
      sourceFile: file?.fileName ?? null,
      confidence: "HIGH",
    });
  }
  return pickBest(cands);
}

// ─── 9. Mandatory site visit ─────────────────────────────────────────────
const SITE_VISIT_REQUIRED = /\b(?:mandatory|compulsory|obligatory|required|must\s+attend)\s+(?:site\s+visit|site\s+inspection)\b/i;
const SITE_VISIT_OPTIONAL = /\b(?:optional|recommended|encouraged)\s+(?:site\s+visit|site\s+inspection)\b/i;
const SITE_VISIT_MENTION = /\bsite\s+(?:visit|inspection)\b/i;

export function extractMandatorySiteVisit(input: ExtractorInput): ExtractedFieldOrMissing<boolean> {
  const cands: ExtractedField<boolean>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    const req = SITE_VISIT_REQUIRED.exec(text);
    if (req) {
      cands.push({
        found: true,
        value: true,
        sourceQuote: captureAround(text, req.index, req[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      continue;
    }
    const opt = SITE_VISIT_OPTIONAL.exec(text);
    if (opt) {
      cands.push({
        found: true,
        value: false,
        sourceQuote: captureAround(text, opt.index, opt[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      continue;
    }
    // Silent presence: site visit mentioned but neither mandatory nor optional
    // → LOW confidence; we default to false (do not block on inference alone).
    const mention = SITE_VISIT_MENTION.exec(text);
    if (mention) {
      cands.push({
        found: true,
        value: false,
        sourceQuote: captureAround(text, mention.index, mention[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: "LOW",
      });
    }
  }
  return pickBest(cands);
}

// ─── 10. Client / procuring entity name ──────────────────────────────────────
const CLIENT_NAME_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  // Explicit label: "Procuring Entity: Ministry of Health"
  // Only match procuring entity / client labels. Beneficiary / Employer / Owner are
  // handled by separate extractors. This prevents non-client entities from becoming
  // the official client/procuring entity.
  { rx: /\b(?:name\s+of\s+)?(?:procuring\s+entity|procurement\s+entity|contracting\s+authority|client|issuing\s+authority)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "HIGH" },
  // "Issued by / Prepared by / Invitation by: <org>"
  { rx: /\b(?:issued|prepared|invitation)\s+by\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "HIGH" },
  // "On behalf of: <org>"
  { rx: /\bon\s+behalf\s+of\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "MEDIUM" },
];

// Secondary field labels that frequently follow the client/entity name on the
// SAME physical line once a PDF is flattened (pdf2json / pdfjs join a page into
// one line, so the `[^\n\r]` capture runs straight past the org name into the
// next labelled field). Cutting the captured value at the first such label
// recovers a clean organisation name instead of a contaminated run.
// The list includes all non-client entity labels (beneficiary, donor, etc.) to
// ensure that flattened text like "Procuring Entity: Ministry Donor: Fund" is
// cleanly cut at "Donor:".
const SECONDARY_FIELD_LABEL = /\s+(?:reference|ref\.?|procurement\s+(?:no|number|ref)|tender\s+(?:no|number|ref)|rfp|rfq|rfb|itb|project|programme|program|country|city|location|region|tel|telephone|phone|mobile|fax|e-?mail|email|website|web|date|closing|deadline|submission|delivery|address|contact|attention|attn|title|sector|budget|currency|duration|validity|issued|published|beneficiary|employer|owner|donor(?:\s+agency)?|funder|financier|financing(?:\s+agency)?|funded\s+by|financed\s+by|funding\s+agency|grant\s+from|loan\s+from|recipient|grantee|consultant|implementing\s+agency|implementing\s+partner|executing\s+agency|project\s+management\s+(?:unit)?)\b\s*(?:no\.?|number)?\s*[:\-]/i;

export function cutAtNextFieldLabel(value: string): string {
  const m = SECONDARY_FIELD_LABEL.exec(value);
  return (m ? value.slice(0, m.index) : value).trim();
}

// Validate that a candidate looks like an organization name, not a sentence.
function looksLikeOrgName(s: string): boolean {
  const t = s.trim();
  // Reject if too short, too long, or ends with common non-org tokens
  if (t.length < 4 || t.length > 150) return false;
  // Must start with a capital letter or common org prefix
  if (!/^[A-Z"']/.test(t)) return false;
  // Reject if it looks like a sentence (contains a verb pattern mid-string)
  if (/\b(?:shall|must|will|does|are|is|has|been|were|was|have|had|can|could|would|should)\b/i.test(t)) return false;
  return true;
}

export function extractClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  const nonClientPattern = nonClientEntityLabelPattern();
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CLIENT_NAME_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const raw = m[1].trim().replace(/\s+/g, " ");
      // Cut at the first secondary field label (Reference:, Project:, Country:,
      // …) so a flattened single-line page doesn't bleed the next field into
      // the org name, then take up to the first comma (address often follows).
      const value = cutAtNextFieldLabel(raw).split(/[,;]/)[0].trim();
      // Reject if the extracted value starts with a non-client entity label
      // (e.g., "Beneficiary: XYZ" captured by a stray pattern).
      if (!looksLikeOrgName(value) || nonClientPattern.test(value)) continue;
      cands.push({
        found: true,
        value: value.slice(0, 200),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
    // Letterhead fallback: org-type keyword in a standalone header line near top
    if (cands.length === 0) {
      const top = text.slice(0, 3000);
      const m2 = /^([A-Z][^\n\r]{5,100}(?:ministry|authority|agency|council|commission|department|institute|corporation|limited|ltd\.?|plc\.?|llc\.?|gmbh|s\.a\.|inc\.?)[^\n\r]{0,60})\s*$/im.exec(top);
      if (m2) {
        const value = m2[1].trim().replace(/\s+/g, " ");
        // Also check the letterhead fallback against non-client labels
        if (looksLikeOrgName(value) && !nonClientPattern.test(value)) {
          cands.push({
            found: true,
            value: value.slice(0, 200),
            sourceQuote: trimQuote(m2[1]),
            sourceFile: file?.fileName ?? null,
            confidence: "MEDIUM",
          });
        }
      }
    }
  }
  return pickBest(cands);
}

// ─── 11. Submission address ───────────────────────────────────────────────
const SUBMISSION_ADDRESS_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  // Explicit label: "Submission address: 123 Main St"
  { rx: /\b(?:submission|proposal|tender|bid)\s+(?:physical\s+)?address\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "HIGH" },
  // "Submit to / Deliver to: <org> <address>"
  { rx: /\b(?:submit(?:ted)?\s+to|deliver(?:ed)?\s+to|drop\s+off\s+at|hand\s+deliver\s+to)\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "HIGH" },
  // "Physical address" / "Office address" in submission context
  { rx: /\b(?:physical|mailing|postal|office)\s+address\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "MEDIUM" },
];

export function extractSubmissionAddress(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of SUBMISSION_ADDRESS_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const raw = m[1].trim().replace(/\s+/g, " ");
      if (raw.length < 5) continue;
      cands.push({
        found: true,
        value: raw.slice(0, 300),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 12. Client contact email ─────────────────────────────────────────────────
// Captures an email address when it appears in a contact/inquiry context.
// Deliberately stricter than extractSubmissionEmails: only fires when the
// email is explicitly labelled as a contact/clarification email, not just
// any email in the document (which avoids capturing portal spam addresses).
const CLIENT_CONTACT_EMAIL_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  // "Contact email: someone@org.org" or "For inquiries, email: …"
  { rx: /\b(?:contact|inquiry|enquiry|clarification|question|queries?)\s+(?:e-?mail|address)\s*[:\-]\s*([\w.+%-]{2,64}@[\w.-]{2,128}\.[a-zA-Z]{2,10})/i, confidence: "HIGH" },
  // Labelled "E-mail: someone@org.org" or "Email: …"
  { rx: /\be-?mail\s*[:\-]\s*([\w.+%-]{2,64}@[\w.-]{2,128}\.[a-zA-Z]{2,10})/i, confidence: "HIGH" },
  // "Contact Person … email address …@…"
  { rx: /\b(?:contact\s+person|focal\s+point|project\s+manager|procurement\s+officer)\b[^@]{0,120}([\w.+%-]{2,64}@[\w.-]{2,128}\.[a-zA-Z]{2,10})/i, confidence: "MEDIUM" },
];

export function extractClientContactEmail(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const EMAIL_RE = /[\w.+%-]{2,64}@[\w.-]{2,128}\.[a-zA-Z]{2,10}/;
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CLIENT_CONTACT_EMAIL_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = (m[1] ?? m[0].match(EMAIL_RE)?.[0] ?? "").trim().toLowerCase();
      if (!value.includes("@")) continue;
      cands.push({
        found: true,
        value,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 13. Pre-bid meeting date ──────────────────────────────────────────────────
const PRE_BID_DATE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  // "Pre-bid meeting: 15 August 2026 at 10:00"
  { rx: /\b(?:pre-?bid\s+(?:conference|meeting|site\s+visit)|mandatory\s+(?:pre-?bid|site)\s+(?:meeting|conference|visit))\s*[:\-]?\s*(?:will\s+be\s+held\s+on\s*)?(\d{1,2}[\s/-][A-Za-z]{3,9}[\s/-]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})/i, confidence: "HIGH" },
  // "Site briefing date: 2026-08-15"
  { rx: /\b(?:site\s+briefing|briefing\s+session|pre-?proposal\s+(?:conference|meeting))\s*[:\-]?\s*(?:on\s+)?(\d{1,2}[\s/-][A-Za-z]{3,9}[\s/-]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})/i, confidence: "MEDIUM" },
];

export function extractPreBidMeetingDate(input: ExtractorInput): ExtractedFieldOrMissing<Date> {
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of PRE_BID_DATE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const raw = m[1].trim();
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      return {
        found: true,
        value: d,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      };
    }
  }
  return { found: false, reason: "No pre-bid meeting date pattern found in tender text." };
}

// ─── 14. Donor agency ─────────────────────────────────────────────────────────
const DONOR_AGENCY_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:donor\s+agency|funding\s+agency|financer|financed\s+by|funded\s+by|grant\s+from|loan\s+from)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "HIGH" },
  { rx: /\b(?:donor|funder|financier)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "MEDIUM" },
];

export function extractDonorAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of DONOR_AGENCY_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = cutAtNextFieldLabel(m[1].trim().replace(/\s+/g, " ")).split(/[,;]/)[0].trim();
      if (!looksLikeOrgName(value)) continue;
      cands.push({
        found: true,
        value: value.slice(0, 200),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 15. Implementing agency ───────────────────────────────────────────────────
const IMPLEMENTING_AGENCY_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:implementing\s+agency|executing\s+agency|implementing\s+partner|project\s+management\s+unit)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "HIGH" },
  { rx: /\b(?:implementer|executor|implementation)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "MEDIUM" },
];

export function extractImplementingAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of IMPLEMENTING_AGENCY_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = cutAtNextFieldLabel(m[1].trim().replace(/\s+/g, " ")).split(/[,;]/)[0].trim();
      if (!looksLikeOrgName(value)) continue;
      cands.push({
        found: true,
        value: value.slice(0, 200),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 16. Legal client name ────────────────────────────────────────────────────
const LEGAL_NAME_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:legal\s+(?:entity\s+)?name|registered\s+(?:entity\s+)?name|official\s+name|entity\s+legal\s+name)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "HIGH" },
  { rx: /\b(?:legal|official|registered)\s+(?:name|entity)\s*[:\-]\s*([^\n\r]{3,120})/i, confidence: "MEDIUM" },
];

export function extractLegalClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of LEGAL_NAME_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = cutAtNextFieldLabel(m[1].trim().replace(/\s+/g, " ")).split(/[,;]/)[0].trim();
      if (!looksLikeOrgName(value)) continue;
      cands.push({
        found: true,
        value: value.slice(0, 200),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 17. Contact person name ──────────────────────────────────────────────────
const CONTACT_NAME_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:contact\s+(?:person|name)|focal\s+point|project\s+manager|procurement\s+officer|contact\s+person\s+name)\s*[:\-]\s*([^\n\r]{3,100})/i, confidence: "HIGH" },
  { rx: /\bcontact\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s*[,\n]|$)/i, confidence: "MEDIUM" },
];

export function extractClientContactName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CONTACT_NAME_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = m[1].trim().replace(/\s+/g, " ").split(/[,;]/)[0].trim();
      if (value.length < 3 || value.length > 100) continue;
      cands.push({
        found: true,
        value: value.slice(0, 100),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 18. Contact title ────────────────────────────────────────────────────────
const CONTACT_TITLE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:title|designation|position|role)\s*[:\-]\s*([^\n\r]{2,80})/i, confidence: "HIGH" },
  { rx: /\b(?:Contact|Focal Point):[^:]*\b([A-Z][a-z]+(?:\s+(?:Manager|Officer|Specialist|Director|Head|Chief|Coordinator|Lead|Supervisor))*)\b/i, confidence: "MEDIUM" },
];

export function extractClientContactTitle(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CONTACT_TITLE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = m[1].trim().replace(/\s+/g, " ").split(/[,;]/)[0].trim();
      if (value.length < 2 || value.length > 80) continue;
      cands.push({
        found: true,
        value: value.slice(0, 80),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 19. Contact phone ────────────────────────────────────────────────────────
const PHONE_PATTERN = /\+?[\d\s\-().]{7,30}/;
const PHONE_CONTEXT = /\b(?:phone|telephone|tel|mobile|cell|contact|call)\b/i;

export function extractClientContactPhone(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    const lines = text.split(/\n/);
    for (const line of lines) {
      if (!PHONE_CONTEXT.test(line)) continue;
      const m = PHONE_PATTERN.exec(line);
      if (!m) continue;
      const value = m[0].trim();
      if (value.length < 7) continue;
      cands.push({
        found: true,
        value: value.slice(0, 30),
        sourceQuote: trimQuote(line),
        sourceFile: file?.fileName ?? null,
        confidence: "HIGH",
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 20. Client address ───────────────────────────────────────────────────────
const CLIENT_ADDRESS_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:client\s+)?address\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "HIGH" },
  { rx: /\b(?:office|head\s+office|headquarters|registered\s+office)\s+address\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "HIGH" },
  { rx: /\blocation\s*[:\-]\s*([^\n\r]{5,200})/i, confidence: "MEDIUM" },
];

export function extractClientAddress(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CLIENT_ADDRESS_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = cutAtNextFieldLabel(m[1].trim().replace(/\s+/g, " ")).slice(0, 300);
      if (value.length < 5) continue;
      cands.push({
        found: true,
        value,
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 21. Country ──────────────────────────────────────────────────────────────
// Uses the shared canonicalizeCountry() against the comprehensive KNOWN_COUNTRIES
// list in metadata-validators (50+ countries across all continents) rather than a
// narrow hardcoded subset, so tenders from any recognised country are captured.
const COUNTRY_PATTERN = /\b(?:country|nation|state)\s*[:\-]\s*([A-Za-z'’.\-\s]{2,60})/i;

export function extractCountry(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    const m = COUNTRY_PATTERN.exec(text);
    if (!m) continue;
    // Canonicalize against the full known-country list (returns the canonical
    // spelling when any known country appears in the captured value, else null).
    const canonical = canonicalizeCountry(m[1].trim().replace(/\s+/g, " "));
    if (!canonical) continue;
    cands.push({
      found: true,
      value: canonical,
      sourceQuote: captureAround(text, m.index, m[0].length),
      sourceFile: file?.fileName ?? null,
      confidence: "HIGH",
    });
  }
  return pickBest(cands);
}

// ─── 22. City / location ──────────────────────────────────────────────────────
const CITY_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:city|location|city\s+location|project\s+location)\s*[:\-]\s*([^\n\r]{2,100})/i, confidence: "HIGH" },
  { rx: /\b(?:Addis\s+Ababa|Addis\s+Abeba|Adama|Mekelle|Bahir\s+Dar|Hawassa|Dire\s+Dawa|Nairobi|Mombasa|Dar\s+es\s+Salaam|Kigali|Kampala|Juba|Khartoum|Cairo)\b/i, confidence: "HIGH" },
];

export function extractClientCity(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of CITY_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = (m[1] ?? m[0]).trim().replace(/\s+/g, " ").split(/[,;]/)[0].trim();
      if (value.length < 2 || value.length > 100) continue;
      cands.push({
        found: true,
        value: value.slice(0, 100),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── 23. Client website ───────────────────────────────────────────────────────
const WEBSITE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /\b(?:website|web\s+site|portal|url|web\s+address)\s*[:\-]\s*(https?:\/\/[^\s\n\r]+|www\.[^\s\n\r]+)/i, confidence: "HIGH" },
  { rx: /\b(?:https?:\/\/|www\.)[^\s\n\r]{5,200}\b/i, confidence: "MEDIUM" },
];

export function extractClientWebsite(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of WEBSITE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      let value = m[1] ? m[1].trim() : m[0].trim();
      if (!value.startsWith("http")) value = "https://" + value;
      if (value.length < 10 || value.length > 300) continue;
      cands.push({
        found: true,
        value: value.slice(0, 300),
        sourceQuote: captureAround(text, m.index, m[0].length),
        sourceFile: file?.fileName ?? null,
        confidence: p.confidence,
      });
      break;
    }
  }
  return pickBest(cands);
}

// ─── Public manifest — which fields the extractor framework supports. ──
export type ExtractorFieldName =
  | "reference"
  | "deadline"
  | "submissionEmails"
  | "submissionMethod"
  | "submissionAddress"
  | "pageLimit"
  | "validityDays"
  | "bidBondAmount"
  | "numberOfCopiesRequired"
  | "mandatorySiteVisit"
  | "clientName"
  | "clientContactEmail"
  | "preBidMeetingDate"
  | "donorAgency"
  | "implementingAgency"
  | "legalClientName"
  | "clientContactName"
  | "clientContactTitle"
  | "clientContactPhone"
  | "clientAddress"
  | "country"
  | "clientCity"
  | "clientWebsite";

export const SUPPORTED_EXTRACTORS: readonly ExtractorFieldName[] = [
  "reference",
  "deadline",
  "submissionEmails",
  "submissionMethod",
  "submissionAddress",
  "pageLimit",
  "validityDays",
  "bidBondAmount",
  "numberOfCopiesRequired",
  "mandatorySiteVisit",
  "clientName",
  "clientContactEmail",
  "preBidMeetingDate",
  "donorAgency",
  "implementingAgency",
  "legalClientName",
  "clientContactName",
  "clientContactTitle",
  "clientContactPhone",
  "clientAddress",
  "country",
  "clientCity",
  "clientWebsite",
];

/**
 * Convenience dispatcher used by the repair endpoint and the auto-fill
 * pipeline. Returns null for unsupported field names so the caller can
 * 422 / skip cleanly.
 */
export function runExtractorByField(field: ExtractorFieldName, input: ExtractorInput): ExtractedFieldOrMissing<unknown> {
  switch (field) {
    case "reference": return extractReference(input);
    case "deadline": return extractDeadline(input);
    case "submissionEmails": return extractSubmissionEmails(input);
    case "submissionMethod": return extractSubmissionMethod(input);
    case "submissionAddress": return extractSubmissionAddress(input);
    case "pageLimit": return extractPageLimit(input);
    case "validityDays": return extractValidityDays(input);
    case "bidBondAmount": return extractBidBondAmount(input);
    case "numberOfCopiesRequired": return extractNumberOfCopies(input);
    case "mandatorySiteVisit": return extractMandatorySiteVisit(input);
    case "clientName": return extractClientName(input);
    case "clientContactEmail": return extractClientContactEmail(input);
    case "preBidMeetingDate": return extractPreBidMeetingDate(input);
    case "donorAgency": return extractDonorAgency(input);
    case "implementingAgency": return extractImplementingAgency(input);
    case "legalClientName": return extractLegalClientName(input);
    case "clientContactName": return extractClientContactName(input);
    case "clientContactTitle": return extractClientContactTitle(input);
    case "clientContactPhone": return extractClientContactPhone(input);
    case "clientAddress": return extractClientAddress(input);
    case "country": return extractCountry(input);
    case "clientCity": return extractClientCity(input);
    case "clientWebsite": return extractClientWebsite(input);
  }
}
