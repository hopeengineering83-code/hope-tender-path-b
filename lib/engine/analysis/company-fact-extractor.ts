// Company fact extractor (closes Section A.1 / A.2 / Cover Page gaps)
//
// THE PROBLEM
// ───────────
// The Company Prisma model has columns for foundingYear, headcount,
// licenseGrade, gmName, gmTitle, gmLicense, tin, vat, registrationNumber,
// address, phone, email, website. The May 7 benchmark diff showed that
// Section A.2 of the generated proposal renders one cell per column —
// and every cell said "Bid-Team Action: confirm X". Reason: the user's
// "AI-Ready Summary" company profile contains all those facts in
// free-form prose, but no extractor was reading them into the columns.
//
// THE FIX
// ───────
// Pure-regex extractor, no AI. Parses the profile-summary text and
// returns a partial { foundingYear, headcount, licenseGrade, gmName,
// gmTitle, gmLicense, tin, vat, registrationNumber, address, phone,
// email, website, serviceLines, sectors } object suitable for
// `prisma.company.update({ data: extracted })`.
//
// Idempotent: only suggests fields that aren't already populated. Caller
// merges the result with `chooseIncomingOrExisting()` semantics so user
// edits in the company UI are never overwritten.

export interface CompanyFactExtraction {
  foundingYear?: number;
  headcount?: number;
  licenseGrade?: string;
  gmName?: string;
  gmTitle?: string;
  gmLicense?: string;
  tin?: string;
  vat?: string;
  registrationNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  serviceLines?: string[];
  sectors?: string[];
}

const FOUNDING_PATTERNS = [
  /\bfound(?:ed|ing|ation)\b[^\n]{0,40}?(\d{4})\b/i,
  /\bestablish(?:ed)?\b[^\n]{0,40}?(\d{4})\b/i,
  /\bdate\s+of\s+(?:establishment|incorporation|registration)\b[^\n]{0,60}?(\d{4})\b/i,
  /\bsince\s+(\d{4})\b/i,
];

const HEADCOUNT_PATTERNS = [
  /\b(?:total|active)?\s*staff(?:\s+headcount)?\s*[:\-]?\s*(\d{1,5})\b/i,
  /\b(\d{1,5})\s+(?:total\s+)?(?:active\s+)?(?:staff|employees|professionals|engineers)\b/i,
  /\b(?:staff|employees|workforce|team)\s*(?:of|:)\s*(\d{1,5})\b/i,
];

const LICENSE_GRADE_PATTERNS = [
  /\bcategory\s+([1-9](?:\s*\(\s*Grade\s+[IVX]+\s*\))?)/i,
  /\b(Grade\s+[IVX1-9]+)\b[^\n]{0,40}?\b(?:license|licence|consultancy|consulting)\b/i,
  /\b(?:licen[cs]e\s+grade|grade)\s*[:\-]?\s*(Grade\s+[IVX1-9]+|Cat(?:egory)?\s*[1-9](?:\s*\(Grade\s+[IVX]+\))?)/i,
];

const TIN_PATTERN = /\bTIN\s*[#:\-]?\s*(\d{6,15})\b/i;
const VAT_PATTERN = /\bVAT(?:\s*Reg(?:\.|istration)?)?\s*[#:\-]?\s*(\d{6,15})\b/i;
const REG_NUM_PATTERN = /\b(?:registration|business)\s*(?:no\.?|number)\s*[:\-]?\s*([A-Z0-9\-/]{4,30})\b/i;

const EMAIL_PATTERN = /\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\b/i;
// Website: capture only when NOT preceded by "@" (to avoid email
// domains). Uses negative lookbehind.
const WEBSITE_PATTERN = /(?<!@)\b((?:https?:\/\/)?(?:www\.)?[a-z0-9\-]+\.(?:com|org|net|gov|co|io|africa|et|uk|us|ng))\b/i;
// Phone: require leading "+" OR a "Phone/Tel" label so we don't match
// arbitrary digit strings like TINs or VAT registration numbers.
const PHONE_PATTERN = /(?:phone|tel(?:ephone)?|mobile)\s*[:\-]?\s*(\+?\d[\d\s\-]{6,20}\d)|(\+\d{1,4}[\s\-]?\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})/i;

const GM_LINE_PATTERNS = [
  // "General Manager: Eng. Ahmed Kebede Tekaw"
  /\bGeneral\s+Manager\s*[:\-]?\s*([A-Z][A-Za-z.'\- ]{2,80})/,
  // "GM | Eng. Ahmed Kebede Tekaw"
  /\bGM\s*[\|:\-]\s*([A-Z][A-Za-z.'\- ]{2,80})/,
  // "Eng. Ahmed Kebede Tekaw, General Manager"
  /\b([A-Z][A-Za-z.'\- ]{4,60})\s*,\s*General\s+Manager\b/,
];
const GM_LICENSE_PATTERNS = [
  // "PPE Structural (IPSTE/6884)"
  /\b(PP[A-Z]{1,4}|PE|PEC|PEPCM|IPSTE|IPSE|PSNE|PAR)\s*[/\-]?\s*(\d{3,8})/i,
  /\b(licen[cs]e\s*(?:no\.?|#)?\s*[:\-]?\s*[A-Z0-9/\-]{3,20})\b/i,
];

// Address / phone patterns are intentionally loose — better to surface
// nothing than a bad guess. Caller merges with existing values, never
// overwrites a populated column.
const ADDRESS_PATTERNS = [
  /\b(?:head\s+office|registered\s+office|address|HQ|headquarters)\s*[:\-]?\s*([A-Z][A-Za-z0-9,.'\-/() ]{8,160})/i,
];

// Service lines: comma-separated list inside "Service lines: …" or
// "Services include: …" labels. Span allows wrapped lines (\n) but
// stops at a period followed by whitespace + uppercase letter (end of
// sentence). Multiline flag (s) lets `.` match newlines inside the
// non-greedy capture.
const SERVICE_LINES_PATTERN = /\b(?:service\s+lines?|services\s+include|core\s+services|service\s+offerings?)\s*[:\-]?\s*([\s\S]{20,500}?)\.\s*(?=[A-Z]|\n\n|$)/i;
// Sectors: same pattern but with sector keyword.
const SECTORS_PATTERN = /\b(?:sectors?(?:\s+of\s+work)?|sector\s+(?:focus|coverage))\s*[:\-]?\s*([\s\S]{10,400}?)\.\s*(?=[A-Z]|\n\n|$)/i;

function clean(s?: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function pickFirst<T>(text: string, patterns: RegExp[], coerce: (m: RegExpMatchArray) => T | undefined): T | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const out = coerce(m);
      if (out !== undefined) return out;
    }
  }
  return undefined;
}

export function extractCompanyFacts(profileSummary: string): CompanyFactExtraction {
  const text = profileSummary || "";
  if (!text) return {};

  const out: CompanyFactExtraction = {};

  // Founding year
  const year = pickFirst(text, FOUNDING_PATTERNS, (m) => {
    const n = Number(m[1]);
    return n >= 1900 && n <= 2100 ? n : undefined;
  });
  if (year) out.foundingYear = year;

  // Headcount
  const head = pickFirst(text, HEADCOUNT_PATTERNS, (m) => {
    const n = Number(m[1]);
    return n >= 1 && n <= 100_000 ? n : undefined;
  });
  if (head) out.headcount = head;

  // License grade — keep the longest variant we see.
  const lic = pickFirst(text, LICENSE_GRADE_PATTERNS, (m) => clean(m[1]) || undefined);
  if (lic) out.licenseGrade = lic;

  // TIN / VAT / registration
  const tin = text.match(TIN_PATTERN); if (tin) out.tin = tin[1];
  const vat = text.match(VAT_PATTERN); if (vat) out.vat = vat[1];
  const reg = text.match(REG_NUM_PATTERN); if (reg) out.registrationNumber = reg[1];

  // GM name + license
  const gm = pickFirst(text, GM_LINE_PATTERNS, (m) => clean(m[1]).replace(/^Eng\.?\s+/i, "Eng. ").slice(0, 80));
  if (gm) out.gmName = gm;
  // Default title — only set when not already on the same line.
  if (gm && /\bGeneral\s+Manager\b/i.test(text)) out.gmTitle = "General Manager";
  // GM license: try the structured PE/PPA-pattern first.
  const gmLic = pickFirst(text, GM_LICENSE_PATTERNS, (m) => `${m[1] ?? ""}${m[2] ? `/${m[2]}` : ""}`.toUpperCase().replace(/\s+/g, "").trim() || undefined);
  if (gmLic) out.gmLicense = gmLic.slice(0, 40);

  // Email / website / phone — first match wins.
  const em = text.match(EMAIL_PATTERN); if (em) out.email = em[1].toLowerCase();
  const ws = text.match(WEBSITE_PATTERN);
  if (ws) {
    const w = ws[1].toLowerCase();
    // Reject when the captured token is an email's domain by checking that
    // the character before it isn't '@'.
    const idx = text.toLowerCase().indexOf(w);
    if (idx === 0 || text[idx - 1] !== "@") out.website = w;
  }
  // Phone: regex has two capture groups (label or +country). Pick first non-empty.
  const ph = text.match(PHONE_PATTERN); if (ph) out.phone = clean(ph[1] || ph[2]);

  // Address
  const addr = pickFirst(text, ADDRESS_PATTERNS, (m) => clean(m[1]).slice(0, 200));
  if (addr) out.address = addr;

  // Service lines / sectors
  const svM = text.match(SERVICE_LINES_PATTERN);
  if (svM) {
    out.serviceLines = svM[1]
      .split(/[,;|]/)
      .map((s) => clean(s))
      .filter((s) => s.length >= 3 && s.length <= 80)
      .slice(0, 16);
  }
  const sc = text.match(SECTORS_PATTERN);
  if (sc) {
    out.sectors = sc[1]
      .split(/[,;|]/)
      .map((s) => clean(s))
      .filter((s) => s.length >= 3 && s.length <= 60)
      .slice(0, 16);
  }

  return out;
}

/**
 * Merge extracted facts with the existing Company row. Only fills empty
 * columns — never overwrites a value the user entered manually. Returns
 * the partial update payload for `prisma.company.update({ data })`.
 */
export function mergeFactsIntoCompany(
  existing: Partial<Record<keyof CompanyFactExtraction | "serviceLines" | "sectors", unknown>>,
  extracted: CompanyFactExtraction,
): CompanyFactExtraction & { serviceLines?: string; sectors?: string } {
  const out: Record<string, unknown> = {};
  const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

  for (const k of ["foundingYear", "headcount", "licenseGrade", "gmName", "gmTitle", "gmLicense", "tin", "vat", "registrationNumber", "address", "phone", "email", "website"] as const) {
    if (isEmpty(existing[k]) && extracted[k] !== undefined) out[k] = extracted[k];
  }

  // serviceLines + sectors: stored as JSON-string columns. Only set when
  // existing value is empty / "[]" / not parseable.
  const isJsonEmpty = (v: unknown) => {
    if (typeof v !== "string") return true;
    try { return JSON.parse(v).length === 0; } catch { return true; }
  };
  if (extracted.serviceLines && extracted.serviceLines.length > 0 && isJsonEmpty(existing.serviceLines)) {
    out.serviceLines = JSON.stringify(extracted.serviceLines);
  }
  if (extracted.sectors && extracted.sectors.length > 0 && isJsonEmpty(existing.sectors)) {
    out.sectors = JSON.stringify(extracted.sectors);
  }
  return out as CompanyFactExtraction & { serviceLines?: string; sectors?: string };
}
