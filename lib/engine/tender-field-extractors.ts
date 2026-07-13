import { nonClientEntityLabelPattern, canonicalizeCountry, containsMetadataPlaceholder } from "./metadata-validators";

// Deterministic, source-grounded extractors for tender-metadata scalar fields.
export type ExtractedField<T> = {
  found: true;
  value: T;
  sourceQuote: string;
  sourceFile: string | null;
  sourcePage: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};
export type ExtractedFieldMissing = { found: false; reason: string };
export type ExtractedFieldOrMissing<T> = ExtractedField<T> | ExtractedFieldMissing;

export type TenderFileInput = { fileName?: string | null; extractedText?: string | null; totalPages?: number | null };
export type ExtractorInput = { files: TenderFileInput[] };

const QUOTE_MAX = 200;
const SOURCE_MIN = 80;

function pickBest<T>(candidates: ExtractedField<T>[]): ExtractedFieldOrMissing<T> {
  if (candidates.length === 0) return { found: false, reason: "no plausible match in any tender file" };
  const order = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  candidates.sort((a, b) => order[b.confidence] - order[a.confidence]);
  return candidates[0];
}

// Several free-text extractors previously hardcoded confidence: "HIGH" for
// any match at all, regardless of how plausible the captured text actually
// was -- a garbled OCR capture ("g0v.et /// 2 3") reported the same "HIGH"
// confidence as a clean one, making pickBest's confidence-based ranking
// meaningless for these fields. This gives a real (if coarse) corroboration
// signal: a short or placeholder-like capture is downgraded to MEDIUM.
function confidenceForCapturedText(value: string): "HIGH" | "MEDIUM" {
  const trimmed = value.trim();
  if (trimmed.length < 4) return "MEDIUM";
  if (containsMetadataPlaceholder(trimmed)) return "MEDIUM";
  // Mostly non-letter noise (stray punctuation/digits with little real text).
  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (letters < trimmed.length * 0.4) return "MEDIUM";
  return "HIGH";
}

function trimQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
}

function captureAround(text: string, index: number, length: number, before = 30, after = 80): string {
  const start = Math.max(0, index - before);
  const end = Math.min(text.length, index + length + after);
  return trimQuote(text.slice(start, end));
}

function getSourcePage(text: string, index: number, totalPages?: number | null): number | null {
  if (index < 0 || index > text.length) return null;
  const precedingText = text.slice(0, index);
  const markerRegex = /\[Page\s+(\d+)\]/gi;
  let match;
  let lastPage: number | null = null;
  while ((match = markerRegex.exec(precedingText)) !== null) {
    lastPage = parseInt(match[1], 10);
  }
  // An impossible marker page (beyond the file's known page count) is unreliable
  // and must never be persisted → null.
  if (lastPage !== null && typeof totalPages === "number" && totalPages > 0 && lastPage > totalPages) return null;
  // No boundary markers: only a single-page file may safely attribute to page 1;
  // a multi-page file with no markers must not guess a page by assumption.
  if (lastPage === null) return totalPages === 1 ? 1 : null;
  return lastPage;
}

// Trims a captured value at the first *secondary* field label, so a flattened
// single-line page ("Org Name Reference: X Donor: Y ...") does not run past the
// organisation name into the following labelled fields. Labels are matched only
// when colon/dash-terminated, so they never cut inside a legitimate org name.
// Multi-word labels (e.g. "Funded By", "Implementing Partner") and the #793
// funder/recipient family must all be recognised — see pdfjs-metadata-safety and
// extract-client-name-flattened regression tests.
export function cutAtNextFieldLabel(val: string): string {
  const labels = [
    "submission deadline", "deadline", "closing date", "closing", "submission",
    "reference", "ref", "procurement", "project",
    "budget", "currency", "validity", "bond", "copies",
    "client", "contact", "email", "e-mail", "phone", "address", "country", "city", "website", "portal",
    "donor agency", "donor", "funded by", "funder", "financier",
    "implementing partner", "implementing agency", "implementing",
    "recipient", "grantee", "consultant", "beneficiary", "employer",
    "name of procuring entity", "procuring entity",
    "owner", "representative", "officer", "title", "subject", "channel",
  ];
  // Convert intra-label spaces to \s+ so "Funded By" / "Implementing Partner"
  // match across arbitrary whitespace; escape hyphens for the character-class-free
  // alternation. Ordering is irrelevant to the cut position because every
  // alternative begins at the same leading-whitespace boundary.
  const alt = labels.map((l) => l.replace(/\s+/g, "\\s+").replace(/-/g, "\\-")).join("|");
  const rx = new RegExp(`\\s+(?:${alt})\\s*[:\\-]`, "i");
  const m = rx.exec(val);
  return m ? val.slice(0, m.index).trim() : val.trim();
}

const LABEL_WORDS = "(?:Number|Reference|Ref|No|ID|Code)";
const REFERENCE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: new RegExp("\\b(?:Tender|RFP|RFQ|ITB|EOI|Procurement)\\s+(?:Reference|Ref\\.|ID\\b)\\s*[:#-]?\\s*(?!" + LABEL_WORDS + "\\b)([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"), confidence: "HIGH" },
  { rx: new RegExp("\\bReference\\s+(?:No\\.?|Number\\b|#)\\s*[:.]?\\s*(?!" + LABEL_WORDS + "\\b)([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"), confidence: "HIGH" },
];

// Pure label words that must never be returned as a reference *value* — a
// capture that is only "Number"/"Reference"/"Tender" etc. means the pattern ran
// onto the label instead of the code.
const LABEL_REJECT = /^(number|reference|ref|no|id|code|tender|rfp|rfq|itb|eoi|procurement)$/i;

export function extractReference(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of REFERENCE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const value = m[1].trim();
      if (LABEL_REJECT.test(value)) continue; // reject pure-label captures
      cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: p.confidence });
      break;
    }
  }
  return pickBest(cands);
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DEADLINE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: new RegExp(`(?:submission|closing|deadline|due|receipt|bids)\\s*(?:date|time|deadline)?\\s*[:\\-]?\\s*(\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4})`, "i"), confidence: "HIGH" },
  { rx: new RegExp(`(?:submission|closing|deadline|due|receipt|bids)\\s*(?:date|time|deadline)?\\s*[:\\-]?\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"), confidence: "HIGH" },
  { rx: new RegExp(`(?:submission|closing|deadline|due|receipt|bids)\\s*(?:date|time|deadline)?\\s*[:\\-]?\\s*(\\d{1,2}/\\d{1,2}/\\d{4})`, "i"), confidence: "MEDIUM" },
];

export function extractDeadline(input: ExtractorInput): ExtractedFieldOrMissing<Date> {
  const cands: ExtractedField<Date>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of DEADLINE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      const d = new Date(m[1]);
      if (isNaN(d.getTime())) continue;
      cands.push({ found: true, value: d, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: p.confidence });
      break;
    }
  }
  return pickBest(cands);
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export function extractSubmissionEmails(input: ExtractorInput): ExtractedFieldOrMissing<string[]> {
  const cands: ExtractedField<string[]>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const anchorIdx = text.toLowerCase().search(/submit|submission|closing|deadline|receipt|bids/);
    if (anchorIdx === -1) continue;
    const windowText = text.slice(anchorIdx, anchorIdx + 2000);
    const emails = windowText.match(EMAIL_PATTERN);
    if (!emails) continue;
    cands.push({ found: true, value: Array.from(new Set(emails.map(e => e.toLowerCase()))), sourceQuote: trimQuote(windowText.slice(0, QUOTE_MAX)), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, anchorIdx, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

const METHOD_PATTERNS: Array<{ rx: RegExp; value: string; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: /electronic\s+submission\s+via\s+(?:the\s+)?(?:[a-z-]*\s*portal|email|system)/i, value: "PORTAL", confidence: "HIGH" },
  { rx: /submission\s+via\s+(?:the\s+)?(?:[a-z-]*\s*portal|email|system)/i, value: "PORTAL", confidence: "HIGH" },
  { rx: /submit\s+proposals?\s+electronically/i, value: "PORTAL", confidence: "HIGH" },
  { rx: /hard\s+copies\s+required/i, value: "SEALED_ENVELOPE", confidence: "HIGH" },
  { rx: /submit\s+in\s+person|physical\s+submission/i, value: "SEALED_ENVELOPE", confidence: "HIGH" },
];

export function extractSubmissionMethod(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    for (const p of METHOD_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      cands.push({ found: true, value: p.value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: p.confidence });
      break;
    }
  }
  return pickBest(cands);
}

export function extractSubmissionAddress(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /submission\s+address\s*[:\-]\s*([^\n\r]{5,200})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractPageLimit(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:page|length)\s+limit\s*[:\-]?\s*(\d{1,3})/i.exec(text) || /(?:not\s+exceed|maximum\s+of)\s*(\d{1,3})\s*pages/i.exec(text);
    if (m) cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractValidityDays(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:validity|valid)\s*(?:period|for)?\s*[:\-]?\s*(\d{2,3})\s*days/i.exec(text);
    if (m) {
        cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    } else {
        const m2 = /(?:validity|valid)\s*(?:period|for)?\s*[:\-]?\s*(\d{1})\s*months/i.exec(text);
        if (m2) cands.push({ found: true, value: parseInt(m2[1], 10) * 30, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index, file?.totalPages), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

// Real currency codes only — with the case-insensitive /i flag below, a bare
// [A-Z]{3} group matches ANY 3-letter word ("the", "abc", ...), not just an
// actual currency code, and was silently captured as the bid bond's currency.
const VALID_BID_BOND_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES",
  "UGX", "TZS", "RWF", "XOF", "XAF", "CAD", "AUD", "JPY", "CNY", "INR", "CHF", "GHS",
]);

export function extractBidBondAmount(input: ExtractorInput): ExtractedFieldOrMissing<{ amount: number; currency: string | null }> {
  const cands: ExtractedField<{ amount: number; currency: string | null }>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:bid|proposal)\s*(?:bond|security|guarantee)\s*(?:in\s+the\s+amount\s+of|amount|of)?\s*[:\-]?\s*([A-Z]{3}|[$€£])?\s*([\d,.]+)/i.exec(text);
    if (m) {
        const rawCurrency = m[1] ?? null;
        const currency = rawCurrency && rawCurrency.length === 3
          ? (VALID_BID_BOND_CURRENCIES.has(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null)
          : rawCurrency;
        cands.push({ found: true, value: { amount: parseFloat(m[2].replace(/,/g, "")), currency }, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    } else {
        const m2 = /(?:bid|proposal)\s*(?:bond|security|guarantee)\s*of\s*([\d,.]+)\s*%/i.exec(text);
        if (m2) cands.push({ found: true, value: { amount: 0, currency: "PERCENT" }, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index, file?.totalPages), confidence: "MEDIUM" });
    }
  }
  return pickBest(cands);
}

export function extractNumberOfCopies(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /plus\s*(\d{1,2})\s*copies/i.exec(text) || /(\d{1,2})\s*hard\s*copies/i.exec(text) || /copies\s*[:\-]?\s*(\d{1,2})/i.exec(text);
    if (m) cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractMandatorySiteVisit(input: ExtractorInput): ExtractedFieldOrMissing<boolean> {
  const cands: ExtractedField<boolean>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /mandatory\s+site\s+visit/i.exec(text);
    if (m) cands.push({ found: true, value: true, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    const m2 = /optional\s+site\s+visit/i.exec(text);
    if (m2) cands.push({ found: true, value: false, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    // Only genuine procuring-entity labels seed a client name. "Employer",
    // "Beneficiary", "Donor Agency", "Implementing Partner" etc. are non-client
    // roles (Fix B / #793) and must NOT be accepted here. Cut the captured value
    // at the next field label so a flattened one-line page does not absorb the
    // following labelled fields.
    const m = /(?:client|procuring\s+entity|contracting\s+authority)\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) {
      const value = cutAtNextFieldLabel(m[1]).trim();
      if (value.length >= 3) cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractClientContactEmail(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /contact\s+e-mail\s*[:\-]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].toLowerCase(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractPreBidMeetingDate(input: ExtractorInput): ExtractedFieldOrMissing<Date> {
  const cands: ExtractedField<Date>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /pre-bid\s+(?:meeting|conference)\s*(?:date|held\s+on)?\s*[:\-]?\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\s+\d{4})/i.exec(text);
    if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) cands.push({ found: true, value: d, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractDonorAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /donor\s+agency\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractImplementingAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /implementing\s+agency\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractLegalClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /\b(?:full\s+legal\s+name|legal\s+entity\s+name)\s*(?:of\s+client|of\s+the\s+client)?\s*[:\-]\s*([^\n\r]{3,150})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractClientContactName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /contact\s+person\s*[:\-]?\s*([A-Z][A-Za-z.\- ']{4,80})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

// Document-level titles ("Project Title:", "Tender Title:", "Contract Title:", ...)
// must never be mistaken for a contact person's job title.
const NON_CONTACT_TITLE_PREFIX = /(project|tender|contract|rfp|bid|assignment|consultancy|proposal|document)\s+title\s*[:\-]/i;

export function extractClientContactTitle(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    // Prefer explicit contact-role labels — unambiguous even without proximity to "Contact Person".
    const explicit = /(?:job\s+title|contact\s+title|designation|position)\s*[:\-]\s*([^\n\r]{2,80})/i.exec(text);
    if (explicit) {
      cands.push({ found: true, value: explicit[1].trim(), sourceQuote: captureAround(text, explicit.index, explicit[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, explicit.index, file?.totalPages), confidence: "HIGH" });
      continue;
    }
    // Fall back to a bare "Title:" label, but skip any occurrence that is actually
    // a document/project-level title rather than a person's role.
    const titleRegex = /\btitle\s*[:\-]\s*([^\n\r]{2,80})/gi;
    let m: RegExpExecArray | null;
    while ((m = titleRegex.exec(text)) !== null) {
      const window = text.slice(Math.max(0, m.index - 20), m.index + m[0].length);
      if (NON_CONTACT_TITLE_PREFIX.test(window)) continue;
      cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "MEDIUM" });
      break;
    }
  }
  return pickBest(cands);
}

export function extractClientContactPhone(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /phone\s*[:\-]\s*(\+?[\d\s\-().]{7,30})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientAddress(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /client\s+address\s*[:\-]\s*([^\n\r]{5,200})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractCountry(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /country\s*[:\-]\s*([A-Za-z'’.\-\s]{2,60})/i.exec(text);
    if (m) {
        const canonical = canonicalizeCountry(m[1].trim());
        if (canonical) cands.push({ found: true, value: canonical, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractClientCity(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /city\s+location\s*[:\-]\s*([^\n\r]{2,100})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractClientWebsite(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /website\s*[:\-]\s*(https?:\/\/[^\s\n\r]+|www\.[^\s\n\r]+)/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractProjectTitle(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /project\s+title\s*[:\-]?\s*([^\n\r]{8,180})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractSubmissionEmailSubject(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /email\s+subject\s*[:\-]\s*([^\n\r]{3,160})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractContactChannel(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /clarification\s+channel\s*[:\-]\s*([^\n\r]{5,150})/i.exec(text) || /pre-bid\s+channel\s*[:\-]\s*([^\n\r]{5,150})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export function extractAuthorizedOfficer(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /authorized\s+(?:representative|officer)\s*[:\-]\s*([A-Z][A-Za-z.\- ']{4,80})/i.exec(text);
    if (m) { const value = m[1].trim(); cands.push({ found: true, value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index, file?.totalPages), confidence: confidenceForCapturedText(value) }); }
  }
  return pickBest(cands);
}

export type ExtractorFieldName = "reference" | "deadline" | "submissionEmails" | "submissionMethod" | "submissionAddress" | "pageLimit" | "validityDays" | "bidBondAmount" | "numberOfCopiesRequired" | "mandatorySiteVisit" | "clientName" | "clientContactEmail" | "preBidMeetingDate" | "donorAgency" | "implementingAgency" | "legalClientName" | "clientContactName" | "clientContactTitle" | "clientContactPhone" | "clientAddress" | "country" | "clientCity" | "clientWebsite" | "projectTitle" | "submissionEmailSubject" | "contactChannel" | "authorizedOfficer";
export const SUPPORTED_EXTRACTORS: readonly ExtractorFieldName[] = ["reference", "deadline", "submissionEmails", "submissionMethod", "submissionAddress", "pageLimit", "validityDays", "bidBondAmount", "numberOfCopiesRequired", "mandatorySiteVisit", "clientName", "clientContactEmail", "preBidMeetingDate", "donorAgency", "implementingAgency", "legalClientName", "clientContactName", "clientContactTitle", "clientContactPhone", "clientAddress", "country", "clientCity", "clientWebsite", "projectTitle", "submissionEmailSubject", "contactChannel", "authorizedOfficer"];

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
    case "projectTitle": return extractProjectTitle(input);
    case "submissionEmailSubject": return extractSubmissionEmailSubject(input);
    case "contactChannel": return extractContactChannel(input);
    case "authorizedOfficer": return extractAuthorizedOfficer(input);
  }
}
