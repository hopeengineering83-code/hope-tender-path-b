import { nonClientEntityLabelPattern, canonicalizeCountry } from "./metadata-validators";

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

function getSourcePage(text: string, index: number): number | null {
  const precedingText = text.slice(0, index);
  const markerRegex = /\[Page\s+(\d+)\]/gi;
  let match;
  let lastPage = null;
  while ((match = markerRegex.exec(precedingText)) !== null) {
    lastPage = parseInt(match[1], 10);
  }
  return lastPage;
}

export function cutAtNextFieldLabel(val: string): string {
  const labels = [
    "deadline", "closing", "submission", "reference", "ref", "procurement",
    "budget", "currency", "validity", "bond", "copies", "client",
    "contact", "email", "phone", "address", "country", "city", "website",
    "portal", "donor", "implementing", "owner", "representative", "officer",
    "title", "subject", "channel"
  ];
  const rx = new RegExp(`\\s+(?:${labels.join("|")})\\s*[:\\-]`, "i");
  const m = rx.exec(val);
  return m ? val.slice(0, m.index).trim() : val.trim();
}

const LABEL_WORDS = "(?:Number|Reference|Ref|No|ID|Code)";
const REFERENCE_PATTERNS: Array<{ rx: RegExp; confidence: "HIGH" | "MEDIUM" }> = [
  { rx: new RegExp("\\b(?:Tender|RFP|RFQ|ITB|EOI|Procurement)\\s+(?:Reference|Ref\\.|ID)\\s*[:#-]?\\s*(?!" + LABEL_WORDS + "\\b)([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"), confidence: "HIGH" },
  { rx: new RegExp("\\bReference\\s+(?:No\\.?|Number|#)\\s*[:.]?\\s*(?!" + LABEL_WORDS + "\\b)([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"), confidence: "HIGH" },
];

export function extractReference(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    if (text.length < SOURCE_MIN) continue;
    for (const p of REFERENCE_PATTERNS) {
      const m = p.rx.exec(text);
      if (!m) continue;
      cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: p.confidence });
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
      cands.push({ found: true, value: d, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: p.confidence });
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
    cands.push({ found: true, value: Array.from(new Set(emails.map(e => e.toLowerCase()))), sourceQuote: trimQuote(windowText.slice(0, QUOTE_MAX)), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, anchorIdx), confidence: "HIGH" });
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
      cands.push({ found: true, value: p.value, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: p.confidence });
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
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractPageLimit(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:page|length)\s+limit\s*[:\-]?\s*(\d{1,3})/i.exec(text) || /(?:not\s+exceed|maximum\s+of)\s*(\d{1,3})\s*pages/i.exec(text);
    if (m) cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractValidityDays(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:validity|valid)\s*(?:period|for)?\s*[:\-]?\s*(\d{2,3})\s*days/i.exec(text);
    if (m) {
        cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
    } else {
        const m2 = /(?:validity|valid)\s*(?:period|for)?\s*[:\-]?\s*(\d{1})\s*months/i.exec(text);
        if (m2) cands.push({ found: true, value: parseInt(m2[1], 10) * 30, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractBidBondAmount(input: ExtractorInput): ExtractedFieldOrMissing<{ amount: number; currency: string | null }> {
  const cands: ExtractedField<{ amount: number; currency: string | null }>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:bid|proposal)\s*(?:bond|security|guarantee)\s*(?:in\s+the\s+amount\s+of|amount|of)?\s*[:\-]?\s*([A-Z]{3}|[$€£])?\s*([\d,.]+)/i.exec(text);
    if (m) {
        cands.push({ found: true, value: { amount: parseFloat(m[2].replace(/,/g, "")), currency: m[1] ?? null }, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
    } else {
        const m2 = /(?:bid|proposal)\s*(?:bond|security|guarantee)\s*of\s*([\d,.]+)\s*%/i.exec(text);
        if (m2) cands.push({ found: true, value: { amount: 0, currency: "PERCENT" }, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index), confidence: "MEDIUM" });
    }
  }
  return pickBest(cands);
}

export function extractNumberOfCopies(input: ExtractorInput): ExtractedFieldOrMissing<number> {
  const cands: ExtractedField<number>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /plus\s*(\d{1,2})\s*copies/i.exec(text) || /(\d{1,2})\s*hard\s*copies/i.exec(text) || /copies\s*[:\-]?\s*(\d{1,2})/i.exec(text);
    if (m) cands.push({ found: true, value: parseInt(m[1], 10), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractMandatorySiteVisit(input: ExtractorInput): ExtractedFieldOrMissing<boolean> {
  const cands: ExtractedField<boolean>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /mandatory\s+site\s+visit/i.exec(text);
    if (m) cands.push({ found: true, value: true, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
    const m2 = /optional\s+site\s+visit/i.exec(text);
    if (m2) cands.push({ found: true, value: false, sourceQuote: captureAround(text, m2.index, m2[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m2.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /(?:client|procuring\s+entity|contracting\s+authority|employer|procuring\s+entity)\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientContactEmail(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /contact\s+e-mail\s*[:\-]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].toLowerCase(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
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
        if (!isNaN(d.getTime())) cands.push({ found: true, value: d, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractDonorAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /donor\s+agency\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractImplementingAgency(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /implementing\s+agency\s*[:\-]\s*([^\n\r]{3,100})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractLegalClientName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /\b(?:full\s+legal\s+name|legal\s+entity\s+name)\s*(?:of\s+client|of\s+the\s+client)?\s*[:\-]\s*([^\n\r]{3,150})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientContactName(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /contact\s+person\s*[:\-]?\s*([A-Z][A-Za-z.\- ']{4,80})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientContactTitle(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /title\s*[:\-]\s*([^\n\r]{2,80})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientContactPhone(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /phone\s*[:\-]\s*(\+?[\d\s\-().]{7,30})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientAddress(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /client\s+address\s*[:\-]\s*([^\n\r]{5,200})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
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
        if (canonical) cands.push({ found: true, value: canonical, sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
    }
  }
  return pickBest(cands);
}

export function extractClientCity(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /city\s+location\s*[:\-]\s*([^\n\r]{2,100})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractClientWebsite(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /website\s*[:\-]\s*(https?:\/\/[^\s\n\r]+|www\.[^\s\n\r]+)/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractProjectTitle(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /project\s+title\s*[:\-]?\s*([^\n\r]{8,180})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractSubmissionEmailSubject(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /email\s+subject\s*[:\-]\s*([^\n\r]{3,160})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractContactChannel(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /clarification\s+channel\s*[:\-]\s*([^\n\r]{5,150})/i.exec(text) || /pre-bid\s+channel\s*[:\-]\s*([^\n\r]{5,150})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
  }
  return pickBest(cands);
}

export function extractAuthorizedOfficer(input: ExtractorInput): ExtractedFieldOrMissing<string> {
  const cands: ExtractedField<string>[] = [];
  for (const file of input.files ?? []) {
    const text = (file?.extractedText ?? "").toString();
    const m = /authorized\s+(?:representative|officer)\s*[:\-]\s*([A-Z][A-Za-z.\- ']{4,80})/i.exec(text);
    if (m) cands.push({ found: true, value: m[1].trim(), sourceQuote: captureAround(text, m.index, m[0].length), sourceFile: file?.fileName ?? null, sourcePage: getSourcePage(text, m.index), confidence: "HIGH" });
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
