// Tender Metadata Auto-Extractor (PR XX-METADATA upgrade).
//
// THE PROBLEM
// ───────────
// The pre-fix extractor populated title / reference / client / country /
// category / deadline / submissionMethod / submissionAddress with simple
// single-pattern regex. Real tenders also carry:
//   • client contact person (name + title) + email + phone
//   • client address
//   • bid bond / EMD amount + currency
//   • validity period (days)
//   • pre-bid meeting date / location
//   • mandatory site visit flag
//   • number of copies required (original + N copies)
//   • page limit
//   • evaluation criteria weights (technical vs financial split)
//   • currency from contract value or budget
//
// User report (May 11): "make the APP extract and fill all client details
// (name, address, ref no...)". This module is the answer — multi-pattern
// extraction across 15+ tender fields, no AI call, no network. Patterns
// are tuned for World Bank / UNDP / AfDB / govt RFP templates.

import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  canonicalizeCountry,
  isValidClientContact,
} from "./metadata-validators";

export type TenderMetadataDraft = {
  title: string;
  reference: string | null;
  clientName: string | null;
  // ─── new fields (returned but only mapped to DB when columns exist) ───
  clientContactName: string | null;
  clientContactTitle: string | null;
  clientContactEmail: string | null;
  clientContactPhone: string | null;
  clientAddress: string | null;
  country: string | null;
  category: string;
  budget: number | null;
  currency: string | null;
  deadline: Date | null;
  submissionMethod: string | null;
  submissionAddress: string | null;
  submissionEmails: string[];
  validityDays: number | null;
  bidBondAmount: number | null;
  bidBondCurrency: string | null;
  preBidMeetingDate: Date | null;
  preBidMeetingLocation: string | null;
  mandatorySiteVisit: boolean;
  numberOfCopiesRequired: number | null;
  pageLimit: number | null;
  technicalWeight: number | null;
  financialWeight: number | null;
  description: string | null;
  intakeSummary: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/[.;,]+$/, "").slice(0, 240);
  }
  return null;
}

function firstMatchGroup(text: string, patterns: RegExp[], group: number): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[group]) return clean(match[group]).replace(/[.;,]+$/, "").slice(0, 240);
  }
  return null;
}

function inferTitle(text: string, fallbackFileName: string): string {
  // PRIORITY ORDER: explicit "Project Title:" label first, then RFP "for X"
  // pattern. The pre-fix order put RFP first and would capture "No. 2026-024"
  // as the title for inputs like "RFP No. 2026-024\nProject Title: Architectural ...".
  const title = firstMatch(text, [
    /(?:project\s+title|assignment\s+title|tender\s+title|procurement\s+title|contract\s+title)\s*[:\-]?\s*([^\n\r]{8,180})/i,
    /(?:consultancy\s+services\s+for|services\s+for|design\s+(?:of|and)\s+supervision\s+of)\s*([^\n\r]{10,180})/i,
    /(?:request\s+for\s+proposals?|rfp|expression\s+of\s+interest|eoi|terms\s+of\s+reference|tor)\s+(?:for|to)\s+([^\n\r]{10,180})/i,
    /(?:request\s+for\s+proposals?|rfp|expression\s+of\s+interest|eoi)\s*[:\-]\s*([A-Z][^\n\r]{10,180})/i,
  ]);
  if (title && !/^no\.?\s*[\d\-/]+$/i.test(title)) return title;

  const meaningfulLine = text
    .split(/\n|\r/)
    .map(clean)
    .find((line) => line.length >= 12 && line.length <= 160 && /(tender|proposal|consultancy|service|design|supervision|project|procurement|construction|planning|architectural)/i.test(line) && !/^(?:rfp|tender|reference|ref)\s*no/i.test(line));
  if (meaningfulLine) return meaningfulLine;

  return fallbackFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Uploaded Tender";
}

function inferReference(text: string): string | null {
  const ref = firstMatch(text, [
    // Explicit label — colon/dash optional (e.g. "RFP No. 2026-024" has no colon)
    /(?:reference\s*(?:no\.?|number)?|ref\.?\s*no\.?|rfp\s*no\.?|tender\s*no\.?|bid\s*no\.?|procurement\s*no\.?)\s*[:\-]?\s*([A-Z0-9\-/_.]{3,80})/i,
    // Standalone acronym + digit combo (must start with a digit to avoid bare acronyms)
    /\b((?:RFP|EOI|TOR|RFQ|NCB|ICB|BID|RFx)[\-/_. ]?\d[A-Z0-9\-/_.]{1,78})\b/i,
  ]);
  if (!ref) return null;
  // Canonical validator handles stop-words ("only", "n/a", etc.) and the
  // digit requirement — keeping this delegate keeps validation rules in one place.
  return isValidReferenceNumber(ref) ? ref : null;
}

function inferClient(text: string): string | null {
  const raw = firstMatch(text, [
    /(?:client|procuring\s+entity|procurement\s+entity|employer|owner|contracting\s+authority|beneficiary|issuing\s+authority)\s*[:\-]\s*([^\n\r]{3,120})/i,
    /(?:issued\s+by|prepared\s+by|invitation\s+by|on\s+behalf\s+of)\s*[:\-]\s*([^\n\r]{3,120})/i,
  ]);
  if (!raw) return null;
  // Canonical validator handles TOC/section noise, placeholders, and length
  // sanity. If a regex captured a proposal section heading or a fragment
  // like "references (where available) Photos...", isValidClientName
  // returns false and we drop it.
  return isValidClientName(raw) ? raw : null;
}

function inferClientContactName(text: string): string | null {
  const raw = firstMatch(text, [
    /(?:contact\s+person|focal\s+person|tender\s+contact|attn(?:ention)?|to\s+the\s+attention\s+of)\s*[:\-]?\s*([A-Z][A-Za-z.\- ']{4,80})/i,
    /(?:procurement\s+(?:officer|manager|focal))\s*[:\-]?\s*([A-Z][A-Za-z.\- ']{4,80})/i,
  ]);
  if (!raw) return null;
  return isValidClientContact(raw) ? raw : null;
}

function inferClientContactTitle(text: string): string | null {
  return firstMatch(text, [
    /(?:procurement\s+(?:officer|manager|director|head|specialist))/i,
    /(?:project\s+manager|tender\s+secretary|contracts\s+manager)/i,
  ]);
}

function inferEmails(text: string): string[] {
  const out = new Set<string>();
  const matches = text.match(/\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi) ?? [];
  for (const m of matches) out.add(m.toLowerCase());
  return Array.from(out).slice(0, 6);
}

function inferPhone(text: string): string | null {
  return firstMatch(text, [
    /(?:tel|phone|mobile|cell)\s*[:\-]?\s*(\+?\d[\d\s\-]{6,20}\d)/i,
    /(\+\d{1,4}[\s\-]?\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})/,
  ]);
}

function inferClientAddress(text: string): string | null {
  return firstMatch(text, [
    /(?:address|registered\s+office|head\s+office|location)\s*[:\-]?\s*([A-Z0-9][A-Za-z0-9,.'\-/() ]{10,180})/i,
    /(?:P\.?\s*O\.?\s*Box\s+\d+[^\n\r]{0,140})/i,
  ]);
}

function inferCountry(text: string): string | null {
  const raw = firstMatch(text, [
    /(?:country|location)\s*[:\-]\s*([A-Za-z ]{3,80})/i,
  ]);
  // If the labelled value contains a known country (e.g. "Ethiopia (Addis
  // Ababa)"), prefer the canonical country name from that capture so we
  // store "Ethiopia" not "Ethiopia (Addis Ababa)" in the country column.
  // OCR fragments like "A ddis Ababa" fail isValidCountry and fall through
  // to the body-wide search.
  if (raw && isValidCountry(raw)) {
    return canonicalizeCountry(raw);
  }
  // Body-wide search for the first known country name.
  return canonicalizeCountry(text);
}

function inferCategory(text: string): string {
  if (/hospital|health|clinic|medical|patient|biomedical|pharma/i.test(text)) return "Healthcare";
  if (/urban|master\s*plan/i.test(text)) return "Urban Planning";
  if (/road|bridge|infrastructure|transport/i.test(text)) return "Infrastructure";
  if (/school|education|university|campus|classroom/i.test(text)) return "Education";
  if (/environment|esia|esmp|biodiversity/i.test(text)) return "Environmental";
  if (/water\s+supply|borehole|hydraulic|WASH/i.test(text)) return "Water";
  if (/energy|solar|wind\s+farm|substation|grid|power\s+plant|hydropower|electrification/i.test(text)) return "Energy";
  if (/agri|irrigation|\bWUA\b|command\s*area|crop\s+water/i.test(text)) return "Agriculture";
  if (/mining|\bJORC\b|tailings|ore\s+body|mine\s+plan|mineral\s+resource/i.test(text)) return "Mining";
  if (/\bport\b|berth|quay|maritime|dredging|harbour|nautical/i.test(text)) return "Port & Maritime";
  if (/\bHAZOP\b|\bP&ID\b|pipeline\s+design|oil\s+facilit|gas\s+facilit|petrochemical|upstream\s+petroleum/i.test(text)) return "Oil & Gas";
  if (/\bKYC\b|\bAML\b|core\s+banking|microfinance|\bIFRS\b|\bBasel\b|fintech|payment\s+system/i.test(text)) return "Financial Services";
  if (/spectrum|broadband|\bLTE\b|\b5G\b|base\s+station|backhaul|mobile\s+network/i.test(text)) return "Telecoms";
  if (/architectural|interior|floor\s*plan/i.test(text)) return "Consulting";
  if (/construction|supervision|design|engineering|consultancy|consultant/i.test(text)) return "Consulting";
  if (/supply|goods|equipment|procurement\s+of\s+goods/i.test(text)) return "Supply";
  if (/software|\bit\b|information\s+technology|digital|ICT/i.test(text)) return "IT";
  return "General";
}

function parseDateValue(raw: string | null): Date | null {
  if (!raw) return null;
  const cleaned = raw.replace(/(at|before|no later than|local time|hrs?|hours?).*$/i, "").trim();
  const date = new Date(cleaned);
  if (!Number.isNaN(date.getTime())) return date;

  const dmy = cleaned.match(/(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const alt = new Date(year, month, day);
    if (!Number.isNaN(alt.getTime())) return alt;
  }

  // "25 March 2026" style
  const longForm = cleaned.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (longForm) {
    const day = Number(longForm[1]);
    const monthName = longForm[2].toLowerCase();
    const monthMap: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const month = monthMap[monthName];
    const year = Number(longForm[3]);
    if (Number.isFinite(month)) {
      const alt = new Date(year, month, day);
      if (!Number.isNaN(alt.getTime())) return alt;
    }
  }
  return null;
}

function inferDeadline(text: string): Date | null {
  const raw = firstMatch(text, [
    /(?:deadline|submission\s+deadline|closing\s+date|bid\s+closing\s+date|proposal\s+submission\s+date|due\s+date)\s*[:\-]?\s*([^\n\r]{6,100})/i,
    /(?:submitted\s+no\s+later\s+than|submit\s+.*?by|to\s+be\s+received\s+by)\s*([^\n\r]{6,100})/i,
  ]);
  return parseDateValue(raw);
}

function inferSubmissionMethod(text: string): string | null {
  if (/e-?mail|email/i.test(text)) return "Email";
  if (/portal|e-procurement|electronic\s+procurement|online\s+submission/i.test(text)) return "Portal";
  if (/hard\s+copy|sealed\s+envelope|physical\s+submission|deliver\s+to/i.test(text)) return "Hard copy";
  return firstMatch(text, [/submission\s+method\s*[:\-]?\s*([^\n\r]{3,120})/i]);
}

function inferSubmissionAddress(text: string): string | null {
  return firstMatch(text, [
    /(?:submission\s+address|delivery\s+address|submit\s+to)\s*[:\-]?\s*([^\n\r]{6,180})/i,
    /(?:portal|electronic\s+submission)\s*[:\-]?\s*(https?:\/\/[^\s)]+|www\.[^\s)]+)/i,
  ]);
}

function inferBudget(text: string): { amount: number | null; currency: string | null } {
  const patterns = [
    /(?:budget|estimated\s+cost|contract\s+value|tender\s+value)\s*[:\-]?\s*(USD|EUR|GBP|ETB|NGN|KES|UGX|TZS|RWF|ZAR|EGP|XAF|XOF|MAD)\s*([\d,]+(?:\.\d+)?)/i,
    /(?:budget|estimated\s+cost|contract\s+value|tender\s+value)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(USD|EUR|GBP|ETB|NGN|KES|UGX|TZS|RWF|ZAR|EGP|XAF|XOF|MAD)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const currency = (m[1].length === 3 ? m[1] : m[2]).toUpperCase();
      const rawAmount = m[1].length === 3 ? m[2] : m[1];
      const amount = Number(rawAmount.replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) return { amount, currency };
    }
  }
  return { amount: null, currency: null };
}

function inferValidityDays(text: string): number | null {
  const raw = firstMatch(text, [
    /(?:validity|proposal\s+validity|bid\s+validity|offer\s+valid(?:ity)?)\s*[:\-]?\s*(\d{1,3})\s*(?:calendar\s+)?days/i,
    /valid(?:ity)?\s+for\s+(\d{1,3})\s*(?:calendar\s+)?days/i,
  ]);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 730 ? n : null;
}

function inferBidBond(text: string): { amount: number | null; currency: string | null } {
  const patterns = [
    /(?:bid\s+bond|earnest\s+money|EMD|tender\s+security|performance\s+security)\s*[:\-]?\s*(USD|EUR|GBP|ETB|NGN|KES|ZAR|EGP)\s*([\d,]+)/i,
    /(?:bid\s+bond|earnest\s+money|EMD|tender\s+security)\s*[:\-]?\s*([\d,]+)\s*(USD|EUR|GBP|ETB|NGN|KES|ZAR|EGP)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const currency = (m[1].length === 3 ? m[1] : m[2]).toUpperCase();
      const rawAmount = m[1].length === 3 ? m[2] : m[1];
      const amount = Number(rawAmount.replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) return { amount, currency };
    }
  }
  return { amount: null, currency: null };
}

function inferPreBidMeeting(text: string): { date: Date | null; location: string | null } {
  const raw = firstMatch(text, [
    /(?:pre-?bid\s+meeting|pre-?proposal\s+meeting|clarification\s+meeting)\s*[:\-]?\s*([^\n\r]{8,150})/i,
  ]);
  if (!raw) return { date: null, location: null };
  const date = parseDateValue(raw);
  return { date, location: raw.length < 150 ? raw : null };
}

function inferMandatorySiteVisit(text: string): boolean {
  return /mandatory\s+site\s+visit|site\s+visit\s+is\s+mandatory|compulsory\s+site\s+visit/i.test(text);
}

function inferNumberOfCopies(text: string): number | null {
  const raw = firstMatch(text, [
    /(?:original\s+plus|original\s*\+\s*|in\s+)\s*(\d{1,2})\s+(?:copies|copy)/i,
    /(\d{1,2})\s+copies\s+(?:of\s+the\s+)?(?:proposal|bid)/i,
  ]);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}

function inferPageLimit(text: string): number | null {
  const raw = firstMatch(text, [
    /(?:page\s+limit|maximum\s+(?:of\s+)?pages|not\s+to\s+exceed)\s*[:\-]?\s*(\d{1,3})/i,
    /(\d{1,3})\s+pages?\s+(?:maximum|limit|excluding)/i,
  ]);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

function inferEvaluationWeights(text: string): { technical: number | null; financial: number | null } {
  // "Technical: 80%, Financial: 20%" or "80% technical / 20% financial"
  const patterns = [
    /(?:technical\s+(?:proposal)?)\s*[:\-]?\s*(\d{1,3})\s*%[^a-z]+(?:financial\s+(?:proposal)?)\s*[:\-]?\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*(?:technical|technical\s+proposal)\s*[^\d]+(\d{1,3})\s*%\s*(?:financial|financial\s+proposal)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const technical = Number(m[1]);
      const financial = Number(m[2]);
      if (Number.isFinite(technical) && Number.isFinite(financial) && technical + financial >= 95 && technical + financial <= 105) {
        return { technical, financial };
      }
    }
  }
  return { technical: null, financial: null };
}

function summaryFromText(text: string): string | null {
  const useful = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clean)
    .filter((line) => line.length > 25)
    .filter((line) => /(scope|require|shall|must|expert|personnel|project|experience|methodology|evaluation|technical|financial|submission|form|annex|appendix|deadline|file|proposal)/i.test(line))
    .slice(0, 50)
    .join("\n");
  return useful || null;
}

export function inferTenderMetadata(extractedText: string, fallbackFileName: string): TenderMetadataDraft {
  const text = extractedText.slice(0, 250_000);

  const trimmedLen = text.trim().length;
  if (trimmedLen < 500) {
    const baseFileName = fallbackFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled tender";
    return {
      title: `[REVIEW NEEDED] ${baseFileName}`,
      reference: null,
      clientName: null,
      clientContactName: null,
      clientContactTitle: null,
      clientContactEmail: null,
      clientContactPhone: null,
      clientAddress: null,
      country: null,
      category: "General",
      budget: null,
      currency: null,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      submissionEmails: [],
      validityDays: null,
      bidBondAmount: null,
      bidBondCurrency: null,
      preBidMeetingDate: null,
      preBidMeetingLocation: null,
      mandatorySiteVisit: false,
      numberOfCopiesRequired: null,
      pageLimit: null,
      technicalWeight: null,
      financialWeight: null,
      description: `Tender intake from "${fallbackFileName}" extracted only ${trimmedLen} characters of text — not enough for automatic metadata inference. Likely a scanned PDF without an OCR text layer. Set PDF_OCR_ENABLED=true and re-upload, OR use the Edit form to fill in tender details manually.`,
      intakeSummary: null,
    };
  }

  // Primary fields
  const title = inferTitle(text, fallbackFileName);
  const reference = inferReference(text);
  const clientName = inferClient(text);
  const country = inferCountry(text);
  const category = inferCategory(text);
  const deadline = inferDeadline(text);
  const submissionMethod = inferSubmissionMethod(text);
  const submissionAddress = inferSubmissionAddress(text);
  const submissionEmails = inferEmails(text);

  // Client contact details (NEW)
  const clientContactName = inferClientContactName(text);
  const clientContactTitle = inferClientContactTitle(text);
  const clientContactEmail = submissionEmails[0] ?? null;
  const clientContactPhone = inferPhone(text);
  const clientAddress = inferClientAddress(text);

  // Commercial / submission detail (NEW)
  const budget = inferBudget(text);
  const validityDays = inferValidityDays(text);
  const bidBond = inferBidBond(text);
  const preBid = inferPreBidMeeting(text);
  const mandatorySiteVisit = inferMandatorySiteVisit(text);
  const numberOfCopiesRequired = inferNumberOfCopies(text);
  const pageLimit = inferPageLimit(text);
  const evalWeights = inferEvaluationWeights(text);

  const intakeSummary = summaryFromText(text);
  const description = intakeSummary?.slice(0, 1200) ?? text.slice(0, 1200) ?? null;

  return {
    title,
    reference,
    clientName,
    clientContactName,
    clientContactTitle,
    clientContactEmail,
    clientContactPhone,
    clientAddress,
    country,
    category,
    budget: budget.amount,
    currency: budget.currency,
    deadline,
    submissionMethod,
    submissionAddress,
    submissionEmails,
    validityDays,
    bidBondAmount: bidBond.amount,
    bidBondCurrency: bidBond.currency,
    preBidMeetingDate: preBid.date,
    preBidMeetingLocation: preBid.location,
    mandatorySiteVisit,
    numberOfCopiesRequired,
    pageLimit,
    technicalWeight: evalWeights.technical,
    financialWeight: evalWeights.financial,
    description,
    intakeSummary,
  };
}
