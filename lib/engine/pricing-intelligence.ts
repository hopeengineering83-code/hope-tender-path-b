/**
 * Pricing Intelligence: an estimated bid price for a tender's financial
 * proposal, built from the strongest evidence the app holds, in three
 * scenarios, for the owner to approve or adjust.
 *
 * The owner used to type every rate. This proposes them — but it never states
 * a precise rate it cannot defend. Every line carries its quantity basis, its
 * rate basis and source (with a date where the source has one), its
 * assumptions, and a confidence. Evidence, strongest first:
 *
 *   1. rates and quantities the tender itself prescribes;
 *   2. the firm's own previously approved rates on other tenders (dated);
 *   3. the selected experts — their roles and seniority set the personnel lines;
 *   4. field, testing, survey, workshop and travel work the tender describes;
 *   5. the implementation period the tender states;
 *   6. a market benchmark only where one is held — none is shipped with the
 *      app, and the estimate says so instead of inventing one;
 *   7. the client's stated budget or ceiling, which no scenario exceeds;
 *   8. a top-down envelope from the firm's own past contracts of comparable
 *      scope (value per month × this tender's period), used only to spread
 *      the remainder over lines with no direct rate evidence — and marked LOW.
 *
 * A line with no defensible rate stays unpriced: the owner is shown exactly
 * which, and approval asks for a rate for each. Rates spread from an envelope
 * are rounded so they never look more precise than their basis.
 *
 * Pure: no database, no clock except `input.now`. The loader
 * (pricing-intelligence-loader.ts) gathers the evidence.
 */

export type PricingConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type PricingScenarioId = "AGGRESSIVE" | "BALANCED" | "CONSERVATIVE";

export type PricingEvidenceInput = {
  tender: {
    id: string;
    title: string;
    country?: string | null;
    category?: string | null;
    currency?: string | null;
    budget?: number | null;
  };
  /** The tender's own text: extracted file text and requirement text. */
  tenderText: string;
  /** Experts the engine selected for this tender, in team order. */
  experts: Array<{ id: string; name: string; title?: string | null; yearsExperience?: number | null }>;
  /** Text of the tender's expert/team requirements; used for roles when no expert is selected. */
  teamRequirementTexts?: string[];
  /** The firm's own past contracts, usable as evidence. */
  historicalProjects: Array<{
    name: string;
    sector?: string | null;
    serviceAreas?: string[];
    contractValue?: number | null;
    currency?: string | null;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    selected?: boolean;
  }>;
  /** Rates the owner approved on other tenders. */
  priorRates: Array<{ label: string; category: string; unit: string; rate: number; currency: string; date: string | Date; tenderTitle?: string | null }>;
  companyDefaultCurrency?: string | null;
  now: Date;
};

export type EstimateLine = {
  key: string;
  category: "PERSONNEL" | "REIMBURSABLE" | "SUBCONSULTANT" | "EQUIPMENT" | "TRAVEL" | "OTHER";
  label: string;
  quantity: number;
  unit: "DAY" | "MONTH" | "LUMP_SUM" | "EACH" | "KM";
  quantityBasis: string;
  quantityConfidence: PricingConfidence;
  /** Null when no defensible rate exists: the owner must supply one. */
  rate: number | null;
  amount: number | null;
  rateBasis: string;
  rateSource: string;
  sourceDate: string | null;
  rateConfidence: PricingConfidence;
  /** The weaker of quantity and rate confidence. */
  confidence: PricingConfidence;
  assumptions: string[];
  expertId?: string | null;
};

export type PricingScenario = {
  id: PricingScenarioId;
  label: string;
  description: string;
  contingencyPct: number;
  lines: EstimateLine[];
  subtotal: number;
  contingency: number;
  vat: number;
  offerTotal: number;
  /** Every line has a rate. */
  complete: boolean;
  notes: string[];
};

export type PricingEstimate = {
  tenderId: string;
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT_EVIDENCE";
  currency: string;
  currencyBasis: string;
  vatPercent: number;
  vatBasis: string;
  withholdingPct: number;
  withholdingBasis: string;
  validityDays: number;
  validityBasis: string;
  durationMonths: number;
  durationBasis: string;
  durationConfidence: PricingConfidence;
  budget: { amount: number; currency: string; basis: string; inclusiveOfVat: boolean } | null;
  envelope: { low: number; median: number; high: number; basis: string; confidence: PricingConfidence; comparables: string[] } | null;
  scenarios: PricingScenario[];
  recommended: PricingScenarioId;
  recommendation: string;
  /** Lines and assumptions the owner should look at before approving. */
  lowConfidence: string[];
  evidenceUsed: string[];
  generatedAt: string;
};

const WORKING_DAYS_PER_MONTH = 22;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const CONF_ORDER: PricingConfidence[] = ["NONE", "LOW", "MEDIUM", "HIGH"];
const weaker = (a: PricingConfidence, b: PricingConfidence): PricingConfidence =>
  CONF_ORDER[Math.min(CONF_ORDER.indexOf(a), CONF_ORDER.indexOf(b))]!;

/** Round an estimated rate to a precision its basis can support. */
export function roundEstimatedRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const step = rate < 100 ? 5 : rate < 1_000 ? 10 : rate < 10_000 ? 50 : rate < 100_000 ? 500 : 1_000;
  return Math.max(step, Math.round(rate / step) * step);
}

/** Round down to the same precision, so a ceiling is never crossed by rounding. */
function floorEstimatedRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const step = rate < 100 ? 5 : rate < 1_000 ? 10 : rate < 10_000 ? 50 : rate < 100_000 ? 500 : 1_000;
  return Math.max(step, Math.floor(rate / step) * step);
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, eighteen: 18, twenty: 20, "twenty-four": 24, thirty: 30, "thirty-six": 36,
};

function readNumber(token: string | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/,/g, "").trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return WORD_NUMBERS[cleaned] ?? null;
}

const NUM = String.raw`(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|twenty-four|thirty|thirty-six)`;

function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.;:!?])\s+(?=[A-Z0-9•\-(])/).map((s) => s.trim()).filter(Boolean);
}

function snippet(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The assignment period the tender states, in months. */
export function statedDurationMonths(text: string): { months: number; quote: string } | null {
  const re = new RegExp(String.raw`\b${NUM}\s*(?:\(\s*\d+\s*\)\s*)?(?:calendar\s+|working\s+)?(months?|weeks?|days?)\b`, "gi");
  const contextRe = /\b(?:duration|period|timeframe|time\s+frame|complet\w*|within|over\s+a|assignment|consultancy|contract|services?\s+will|expected\s+to\s+(?:take|last))\b/i;
  const noise = /\b(?:valid|validity|after\s+(?:the\s+)?(?:deadline|submission)|payment|feedback|days?\s+(?:before|after|prior)|advance|deadline|clarification|warranty|defects?\s+liability|experience)\b/i;
  let best: { months: number; quote: string } | null = null;
  for (const s of sentences(text)) {
    if (!contextRe.test(s) || noise.test(s)) continue;
    for (const m of s.matchAll(re)) {
      const n = readNumber(m[1]!);
      if (!n) continue;
      const unit = m[2]!.toLowerCase();
      const months = unit.startsWith("month") ? n : unit.startsWith("week") ? n / 4.345 : n / 30.4;
      if (months < 0.25 || months > 72) continue;
      if (!best || months > best.months) best = { months: round2(months), quote: snippet(s) };
    }
  }
  return best;
}

const MONEY = String.raw`(?:ETB|Birr|Br\.?|USD|US\$|\$|EUR|€|GBP|£|KES|UGX|TZS|RWF)`;

function currencyCode(token: string): string {
  const t = token.toUpperCase().replace(/\.$/, "");
  if (t === "BIRR" || t === "BR") return "ETB";
  if (t === "US$" || t === "$") return "USD";
  if (t === "€") return "EUR";
  if (t === "£") return "GBP";
  return t;
}

/** A budget, ceiling or estimated cost the tender states. */
export function statedBudget(text: string): { amount: number; currency: string; quote: string; inclusiveOfVat: boolean } | null {
  const re = new RegExp(String.raw`\b(?:budget|ceiling|estimated\s+(?:cost|value|contract\s+(?:value|amount))|maximum\s+(?:amount|price)|not\s+(?:to\s+)?exceed)\b[^.;]{0,80}?(${MONEY})\s?([\d][\d,]*(?:\.\d+)?)\s*(million|m\b)?`, "i");
  for (const s of sentences(text)) {
    const m = re.exec(s);
    if (!m) continue;
    let amount = Number(m[2]!.replace(/,/g, ""));
    if (m[3]) amount *= 1_000_000;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return { amount, currency: currencyCode(m[1]!), quote: snippet(s), inclusiveOfVat: !/\b(?:exclusive\s+of|excluding|excl\.?|before)\s+vat\b/i.test(s) };
  }
  return null;
}

function statedVat(text: string): { pct: number; quote: string } | null {
  for (const s of sentences(text)) {
    const m = /\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:vat|value[\s-]added\s+tax)\b|\b(?:vat|value[\s-]added\s+tax)\s*(?:of|at|@)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(s);
    if (m) return { pct: Number(m[1] ?? m[2]), quote: snippet(s) };
  }
  return null;
}

function statedWithholding(text: string): { pct: number; quote: string } | null {
  for (const s of sentences(text)) {
    const m = /\bwithholding(?:\s+tax)?\s*(?:of|at|@)?\s*(\d{1,2}(?:\.\d+)?)\s*%|\b(\d{1,2}(?:\.\d+)?)\s*%\s*withholding/i.exec(s);
    if (m) return { pct: Number(m[1] ?? m[2]), quote: snippet(s) };
  }
  return null;
}

function statedValidityDays(text: string): { days: number; quote: string } | null {
  for (const s of sentences(text)) {
    const m = /\bvalid(?:ity)?\b[^.;]{0,60}?\b(\d{2,3})\s*(?:\(\s*\d+\s*\)\s*)?(?:calendar\s+)?days\b/i.exec(s);
    if (m) return { days: Number(m[1]), quote: snippet(s) };
  }
  return null;
}

/** A rate the tender fixes for an item ("per diem of ETB 1,200 per day"). */
function prescribedRate(text: string, keyword: RegExp): { rate: number; currency: string; quote: string } | null {
  const re = new RegExp(String.raw`(${MONEY})\s?([\d][\d,]*(?:\.\d+)?)\s*(?:per|/)\s*(?:day|night|month|person|trip|km|unit|each)`, "i");
  for (const s of sentences(text)) {
    if (!keyword.test(s)) continue;
    const m = re.exec(s);
    if (m) return { rate: Number(m[2]!.replace(/,/g, "")), currency: currencyCode(m[1]!), quote: snippet(s) };
  }
  return null;
}

function statedCount(text: string, noun: RegExp): { count: number; quote: string } | null {
  for (const s of sentences(text)) {
    if (!noun.test(s)) continue;
    // The noun is grouped: an alternation ("enumerators?|data collectors?")
    // left bare would match its second branch with no number at all.
    const m = new RegExp(String.raw`\b${NUM}\s*(?:\(\s*\d+\s*\)\s*)?(?:[a-z-]+\s+){0,2}(?:${noun.source})`, "i").exec(s);
    const n = m ? readNumber(m[1]) : null;
    if (n && n > 0 && n < 10_000) return { count: n, quote: snippet(s) };
  }
  return null;
}

function statedPersonInput(text: string, role: string): { days: number; quote: string } | null {
  const words = role.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (words.length === 0) return null;
  for (const s of sentences(text)) {
    const lower = s.toLowerCase();
    if (!words.some((w) => lower.includes(w))) continue;
    const m = new RegExp(String.raw`\b${NUM}\s*(?:\(\s*\d+\s*\)\s*)?(person[\s-]?months?|person[\s-]?days?|man[\s-]?months?|man[\s-]?days?|working\s+days|days\s+input)\b`, "i").exec(s);
    const n = m ? readNumber(m[1]!) : null;
    if (n && n > 0) return { days: /month/i.test(m![2]!) ? n * WORKING_DAYS_PER_MONTH : n, quote: snippet(s) };
  }
  return null;
}

type ReimbursableRule = {
  key: string;
  label: string;
  category: EstimateLine["category"];
  trigger: RegExp;
  unit: EstimateLine["unit"];
  weight: number;
  rateKeyword: RegExp;
  quantity: (ctx: { text: string; fieldDays: number; fieldTeam: number; months: number }) => { quantity: number; basis: string; confidence: PricingConfidence };
};

// Work the tender describes, priced only when the tender describes it. The
// quantities come from the tender where it states them; otherwise from the
// field period and team, stated as assumptions.
const REIMBURSABLE_RULES: ReimbursableRule[] = [
  {
    key: "field-transport", label: "Field transport (vehicle with driver and fuel)", category: "TRAVEL", unit: "DAY", weight: 3,
    trigger: /\b(?:field\s*work|fieldwork|field\s+visits?|site\s+visits?|data[\s-]collection|household\s+survey|baseline\s+survey|community\s+consultations?|site\s+investigation|reconnaissance|supervision\s+visits?)\b/i,
    rateKeyword: /\b(?:vehicle|car\s+hire|transport)\b/i,
    quantity: ({ fieldDays }) => ({ quantity: fieldDays, basis: `${fieldDays} field days`, confidence: "LOW" }),
  },
  {
    key: "per-diem", label: "Per diem and accommodation for field staff", category: "REIMBURSABLE", unit: "DAY", weight: 3,
    trigger: /\b(?:field\s*work|fieldwork|field\s+visits?|site\s+visits?|data[\s-]collection|community\s+consultations?|site\s+investigation)\b/i,
    rateKeyword: /\b(?:per\s+diem|perdiem|accommodation|subsistence|daily\s+allowance)\b/i,
    quantity: ({ fieldDays, fieldTeam }) => ({ quantity: fieldDays * fieldTeam, basis: `${fieldDays} field days × ${fieldTeam} field staff`, confidence: "LOW" }),
  },
  {
    key: "enumerators", label: "Data collectors / enumerators", category: "REIMBURSABLE", unit: "DAY", weight: 3,
    trigger: /\b(?:enumerators?|data\s+collectors?|household\s+survey|questionnaires?\s+(?:will\s+be\s+)?administered)\b/i,
    rateKeyword: /\b(?:enumerators?|data\s+collectors?)\b/i,
    quantity: ({ text, fieldDays }) => {
      const stated = statedCount(text, /enumerators?|data\s+collectors?/i);
      const n = stated?.count ?? 4;
      return stated
        ? { quantity: n * fieldDays, basis: `${n} enumerators stated by the tender × ${fieldDays} field days`, confidence: "MEDIUM" }
        : { quantity: n * fieldDays, basis: `assumed ${n} enumerators × ${fieldDays} field days`, confidence: "LOW" };
    },
  },
  {
    key: "workshops", label: "Stakeholder / validation workshops", category: "REIMBURSABLE", unit: "EACH", weight: 2,
    trigger: /\b(?:workshops?|validation\s+meetings?|stakeholder\s+meetings?|public\s+consultations?|inception\s+meetings?)\b/i,
    rateKeyword: /\bworkshops?\b/i,
    quantity: ({ text }) => {
      const stated = statedCount(text, /workshops?|validation\s+meetings?|consultation\s+meetings?/i);
      return stated
        ? { quantity: stated.count, basis: `count stated by the tender: "${stated.quote}"`, confidence: "HIGH" }
        : { quantity: 1, basis: "the tender describes a workshop/meeting without a count; one is assumed", confidence: "LOW" };
    },
  },
  {
    key: "boreholes", label: "Boreholes / test pits (drilling and logging)", category: "SUBCONSULTANT", unit: "EACH", weight: 4,
    trigger: /\b(?:boreholes?|bore\s+holes?|test\s+pits?|trial\s+pits?|drilling)\b/i,
    rateKeyword: /\b(?:boreholes?|test\s+pits?|drilling)\b/i,
    quantity: ({ text }) => {
      const stated = statedCount(text, /boreholes?|bore\s+holes?|test\s+pits?|trial\s+pits?/i);
      return stated
        ? { quantity: stated.count, basis: `count stated by the tender: "${stated.quote}"`, confidence: "HIGH" }
        : { quantity: 1, basis: "the tender requires drilling/pits without a count; quantity to confirm", confidence: "LOW" };
    },
  },
  {
    key: "laboratory", label: "Laboratory testing", category: "SUBCONSULTANT", unit: "LUMP_SUM", weight: 3,
    trigger: /\b(?:laboratory|lab\s+tests?|material\s+tests?|soil\s+tests?|water\s+quality\s+(?:tests?|analysis))\b/i,
    rateKeyword: /\b(?:laboratory|lab\s+test)\b/i,
    quantity: () => ({ quantity: 1, basis: "testing programme as described by the tender (lump sum)", confidence: "MEDIUM" }),
  },
  {
    key: "survey", label: "Topographic / site survey", category: "SUBCONSULTANT", unit: "LUMP_SUM", weight: 3,
    trigger: /\b(?:topographic(?:al)?\s+survey|land\s+survey|total\s+station|gps\s+survey|cadastral)\b/i,
    rateKeyword: /\b(?:survey)\b/i,
    quantity: () => ({ quantity: 1, basis: "survey as described by the tender (lump sum)", confidence: "MEDIUM" }),
  },
  {
    key: "site-vehicle", label: "Site vehicle for supervision staff", category: "EQUIPMENT", unit: "MONTH", weight: 3,
    trigger: /\b(?:resident\s+engineer|construction\s+supervision|site\s+supervision|contract\s+administration)\b/i,
    rateKeyword: /\b(?:vehicle|car\s+hire)\b/i,
    quantity: ({ months }) => ({ quantity: Math.max(1, Math.ceil(months)), basis: `${Math.max(1, Math.ceil(months))} months of the supervision period`, confidence: "LOW" }),
  },
  {
    key: "reports", label: "Report production, printing and binding", category: "OTHER", unit: "LUMP_SUM", weight: 1,
    trigger: /\b(?:hard\s+cop(?:y|ies)|printed\s+cop(?:y|ies)|bound\s+cop(?:y|ies)|copies\s+of\s+the\s+(?:final\s+)?report)\b/i,
    rateKeyword: /\b(?:printing|copies)\b/i,
    quantity: () => ({ quantity: 1, basis: "printed copies required by the tender (lump sum)", confidence: "MEDIUM" }),
  },
];

const LEADER_RE = /\b(?:team\s+leader|project\s+manager|project\s+director|lead\b|principal|chief)\b/i;

const ROLE_NOUN = /\b(?:leader|manager|director|specialist|expert|engineer|architect|planner|surveyor|economist|sociologist|geologist|hydrologist|hydrogeologist|analyst|advisor|adviser|officer|coordinator|designer|inspector|technician|scientist|consultant)\b/i;

/** Roles a tender names for its team ("Team Leader / WASH Systems Specialist; MEAL/Data Specialist …"). */
export function tenderNamedRoles(texts: readonly string[]): string[] {
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    // Read the list after its lead-in ("… team including a …", "Key experts:").
    const body = text.replace(/^[\s\S]*?\b(?:including|include|includes|comprising|consisting\s+of|composed\s+of|following)\b\s*:?/i, "");
    for (const raw of body.split(/[;,•\n]|:\s/)) {
      let part = raw
        .replace(/\(([^)]*)\)/g, (_m, inner: string) => (LEADER_RE.test(inner) ? ` (${inner.trim()})` : " "))
        .replace(/^[\s\-–—*.\d)]+/, "")
        .replace(/^(?:and|or)\s+/i, "")
        .replace(/[.\s]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      // "The Team Leader must have …" names the role before its verb.
      const verb = /\b(?:must|shall|should|will|is|are|has|have|with|who)\b/i.exec(part);
      if (verb) part = part.slice(0, verb.index).trim();
      part = part.replace(/^(?:a|an|the|one|two|three|key\s+experts?)\s+/i, "").trim();
      if (part.length < 4 || part.length > 70 || !ROLE_NOUN.test(part)) continue;
      if (/\b(?:years?|degree|experience|propose|team\s+composition|multidisciplinary)\b/i.test(part)) continue;
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roles.push(part);
      if (roles.length >= 12) break;
    }
  }
  // "Team Leader" from one requirement and "WASH Systems Specialist (Team
  // Leader)" from another are one person.
  return roles.filter((role) => !roles.some((other) => other !== role && other.toLowerCase().includes(role.toLowerCase())));
}


function seniorityWeight(title: string, years: number | null | undefined, index: number): number {
  if (LEADER_RE.test(title) || index === 0) return 1.5;
  if ((years ?? 0) >= 10 || /\bsenior\b/i.test(title)) return 1.2;
  return 1.0;
}

function normalizeLabel(label: string): string[] {
  return label.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["and", "the", "for", "with", "senior", "expert", "specialist"].includes(w));
}

function labelSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeLabel(a));
  const tb = new Set(normalizeLabel(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

function monthsBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.4));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function toIsoDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

const SCENARIOS: Array<{ id: PricingScenarioId; label: string; description: string; factor: number; budgetShare: number; contingencyPct: number }> = [
  { id: "AGGRESSIVE", label: "Competitive", description: "Lowest defensible price: evidence rates trimmed 5%, the low quartile of comparable past contracts (at least 8% under their median), no contingency.", factor: 0.95, budgetShare: 0.88, contingencyPct: 0 },
  { id: "BALANCED", label: "Balanced (recommended)", description: "Evidence rates as approved before, the median of comparable past contracts, 5% contingency.", factor: 1.0, budgetShare: 0.94, contingencyPct: 5 },
  { id: "CONSERVATIVE", label: "Conservative", description: "Protects margin: evidence rates plus 7%, the high quartile of comparable past contracts (at least 8% over their median), 10% contingency.", factor: 1.07, budgetShare: 0.99, contingencyPct: 10 },
];

/** Build the estimate. */
export function estimateTenderPrice(input: PricingEvidenceInput): PricingEstimate {
  const text = input.tenderText ?? "";
  const evidenceUsed: string[] = [];
  const lowConfidence: string[] = [];

  // ── Currency, tax, validity ────────────────────────────────────────────
  const budgetFromText = statedBudget(text);
  const isEthiopia = /ethiopia/i.test(String(input.tender.country ?? "")) || /\b(?:ETB|Birr)\b/.test(text);
  let currency = (input.tender.currency || budgetFromText?.currency || (isEthiopia ? "ETB" : input.companyDefaultCurrency) || "USD").toUpperCase();
  const currencyBasis = input.tender.currency
    ? "currency recorded on the tender"
    : budgetFromText
      ? `currency of the budget the tender states: "${budgetFromText.quote}"`
      : isEthiopia
        ? "Ethiopian tender priced in Ethiopian Birr"
        : "the firm's default currency (the tender states none)";
  if (!/^[A-Z]{3,8}$/.test(currency)) currency = "USD";

  const vatStated = statedVat(text);
  const vatPercent = vatStated ? vatStated.pct : isEthiopia ? 15 : 0;
  const vatBasis = vatStated
    ? `stated by the tender: "${vatStated.quote}"`
    : isEthiopia
      ? "Ethiopian standard VAT rate (15%); the tender states no rate"
      : "no VAT rate stated by the tender; none applied — confirm the applicable tax";
  if (!vatStated && !isEthiopia) lowConfidence.push("Tax: no VAT rate is stated and the country's rate is not known to the app.");
  const withholding = statedWithholding(text);
  const withholdingPct = withholding?.pct ?? 0;
  const withholdingBasis = withholding ? `stated by the tender: "${withholding.quote}"` : "not stated by the tender; none shown";
  const validity = statedValidityDays(text);
  const validityDays = validity?.days ?? 90;
  const validityBasis = validity ? `stated by the tender: "${validity.quote}"` : "the tender states no validity period; 90 days assumed";

  // ── Period ─────────────────────────────────────────────────────────────
  const period = statedDurationMonths(text);
  const durationMonths = period?.months ?? 3;
  const durationBasis = period ? `stated by the tender: "${period.quote}"` : "the tender states no assignment period; 3 months assumed";
  const durationConfidence: PricingConfidence = period ? "HIGH" : "LOW";
  if (!period) lowConfidence.push("Period: no assignment duration is stated; 3 months is assumed for every time-based quantity.");
  else evidenceUsed.push(`Assignment period of ${durationMonths} month(s) stated by the tender.`);
  const workingDays = Math.max(5, Math.round(durationMonths * WORKING_DAYS_PER_MONTH));

  // ── Budget ─────────────────────────────────────────────────────────────
  let budget: PricingEstimate["budget"] = null;
  if (input.tender.budget && input.tender.budget > 0) {
    budget = { amount: input.tender.budget, currency: (input.tender.currency || currency).toUpperCase(), basis: "budget recorded on the tender", inclusiveOfVat: true };
  } else if (budgetFromText) {
    budget = { amount: budgetFromText.amount, currency: budgetFromText.currency, basis: `stated by the tender: "${budgetFromText.quote}"`, inclusiveOfVat: budgetFromText.inclusiveOfVat };
  }
  if (budget && budget.currency !== currency) {
    lowConfidence.push(`Budget: the stated budget is in ${budget.currency}, the offer in ${currency}; it is not used as a ceiling.`);
    budget = null;
  }
  if (budget) evidenceUsed.push(`Client budget/ceiling ${budget.currency} ${budget.amount.toLocaleString("en-US")} (${budget.basis}).`);

  // ── Personnel ──────────────────────────────────────────────────────────
  type Draft = Omit<EstimateLine, "rate" | "amount" | "rateBasis" | "rateSource" | "sourceDate" | "rateConfidence" | "confidence"> & {
    weight: number;
    rateKeyword?: RegExp;
    evidenceRate?: { rate: number; basis: string; source: string; date: string | null; confidence: PricingConfidence; scalable: boolean };
  };
  const drafts: Draft[] = [];
  const team = input.experts.length > 0 ? input.experts : [];
  if (team.length > 0) evidenceUsed.push(`${team.length} expert(s) selected for this tender set the personnel lines.`);
  team.forEach((expert, index) => {
    const role = (expert.title || "Expert").trim();
    const stated = statedPersonInput(text, role);
    const allocation = LEADER_RE.test(role) || index === 0 ? 0.8 : index < 4 ? 0.5 : 0.35;
    const days = stated ? Math.round(stated.days) : Math.max(1, Math.round(workingDays * allocation));
    drafts.push({
      key: `expert:${expert.id}`,
      category: "PERSONNEL",
      label: `${role} — ${expert.name}`,
      quantity: days,
      unit: "DAY",
      quantityBasis: stated ? `input stated by the tender: "${stated.quote}"` : `${Math.round(allocation * 100)}% of ${workingDays} working days in the ${durationMonths}-month period`,
      quantityConfidence: stated ? "HIGH" : weaker("MEDIUM", durationConfidence),
      assumptions: stated ? [] : [`Input assumed at ${Math.round(allocation * 100)}% of the period (${LEADER_RE.test(role) || index === 0 ? "team lead" : index < 4 ? "key expert" : "support expert"}).`],
      expertId: expert.id,
      weight: days * seniorityWeight(role, expert.yearsExperience, index),
    });
  });
  const namedRoles = team.length === 0 ? tenderNamedRoles(input.teamRequirementTexts ?? []) : [];
  if (namedRoles.length > 0) {
    evidenceUsed.push(`${namedRoles.length} role(s) named by the tender set the personnel lines (no expert is selected yet).`);
    lowConfidence.push("Team: no expert is selected; personnel are priced by the roles the tender names.");
  }
  namedRoles.forEach((role, index) => {
    const stated = statedPersonInput(text, role);
    const allocation = LEADER_RE.test(role) || index === 0 ? 0.8 : index < 4 ? 0.5 : 0.35;
    const days = stated ? Math.round(stated.days) : Math.max(1, Math.round(workingDays * allocation));
    drafts.push({
      key: `role:${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      category: "PERSONNEL",
      label: role,
      quantity: days,
      unit: "DAY",
      quantityBasis: stated ? `input stated by the tender: "${stated.quote}"` : `${Math.round(allocation * 100)}% of ${workingDays} working days in the ${durationMonths}-month period`,
      quantityConfidence: stated ? "HIGH" : weaker("MEDIUM", durationConfidence),
      assumptions: [`Role named by the tender; no expert is selected for it yet.`, ...(stated ? [] : [`Input assumed at ${Math.round(allocation * 100)}% of the period.`])],
      weight: days * seniorityWeight(role, null, index),
    });
  });
  if (team.length === 0 && namedRoles.length === 0) {
    drafts.push({
      key: "professional-fees",
      category: "PERSONNEL",
      label: "Professional fees (consultancy team)",
      quantity: 1,
      unit: "LUMP_SUM",
      quantityBasis: "no experts are selected for this tender; fees are one lump sum",
      quantityConfidence: "LOW",
      assumptions: ["No team is selected; select the experts to price personnel by role."],
      weight: 10,
    });
    lowConfidence.push("Team: no experts are selected for this tender, so professional fees are a single lump sum.");
  }

  // ── Work the tender describes ──────────────────────────────────────────
  const fieldStated = /field\s*work|fieldwork|data[\s-]collection|site\s+investigation/i.test(text)
    ? statedCount(text, /(?:days?\s+(?:of\s+)?field\s*work|field\s*work\s+days?|field\s+days?)/i)
    : null;
  const fieldDays = fieldStated?.count ?? Math.max(5, Math.round(workingDays * 0.3));
  const fieldTeam = Math.max(1, Math.min(team.length || 2, 4));
  for (const rule of REIMBURSABLE_RULES) {
    if (!rule.trigger.test(text)) continue;
    const q = rule.quantity({ text, fieldDays, fieldTeam, months: durationMonths });
    drafts.push({
      key: rule.key,
      category: rule.category,
      label: rule.label,
      quantity: q.quantity,
      unit: rule.unit,
      quantityBasis: q.basis,
      quantityConfidence: q.confidence,
      assumptions: rule.key === "field-transport" || rule.key === "per-diem"
        ? [fieldStated ? `Field period stated by the tender: "${fieldStated.quote}".` : `Field period assumed at 30% of the working days (${fieldDays} days).`]
        : [],
      weight: rule.weight,
      rateKeyword: rule.rateKeyword,
    });
  }

  // ── Direct rate evidence: tender-prescribed, then the firm's own approved rates
  for (const d of drafts) {
    if (d.rateKeyword) {
      const fixed = prescribedRate(text, d.rateKeyword);
      if (fixed && fixed.currency === currency) {
        d.evidenceRate = { rate: fixed.rate, basis: `rate fixed by the tender: "${fixed.quote}"`, source: "Tender document", date: null, confidence: "HIGH", scalable: false };
        continue;
      }
    }
    const candidates = input.priorRates
      .filter((r) => r.currency.toUpperCase() === currency && r.unit === d.unit && r.rate > 0)
      .map((r) => ({ r, sim: d.category === "PERSONNEL" ? labelSimilarity(d.label.split(" — ")[0]!, r.label.split(" — ")[0]!) : labelSimilarity(d.label, r.label) }))
      .filter((c) => c.sim >= 0.5 && (d.category !== "PERSONNEL" || c.r.category === "PERSONNEL"))
      .sort((a, b) => new Date(b.r.date).getTime() - new Date(a.r.date).getTime());
    if (candidates.length > 0) {
      const best = candidates[0]!.r;
      const ageMonths = monthsBetween(new Date(best.date), input.now);
      d.evidenceRate = {
        rate: best.rate,
        basis: `rate the owner approved for "${best.label}"${best.tenderTitle ? ` on "${best.tenderTitle}"` : ""}`,
        source: "Owner-approved rate on a previous tender",
        date: toIsoDate(best.date),
        confidence: ageMonths <= 18 ? "HIGH" : "MEDIUM",
        scalable: true,
      };
    }
  }
  const directCount = drafts.filter((d) => d.evidenceRate).length;
  if (directCount > 0) evidenceUsed.push(`${directCount} line(s) priced from tender-fixed or previously approved rates.`);

  // ── Envelope from comparable past contracts ────────────────────────────
  const tenderWords = new Set(normalizeLabel(`${input.tender.title} ${input.tender.category ?? ""}`));
  const comparable = input.historicalProjects
    .filter((p) => (p.contractValue ?? 0) > 0 && p.startDate && p.endDate && String(p.currency || currency).toUpperCase() === currency)
    .map((p) => {
      const months = monthsBetween(new Date(p.startDate as string), new Date(p.endDate as string));
      const words = normalizeLabel(`${p.name} ${p.sector ?? ""} ${(p.serviceAreas ?? []).join(" ")}`);
      const overlap = words.filter((w) => tenderWords.has(w)).length;
      return { p, months, perMonth: months >= 0.5 ? (p.contractValue as number) / months : 0, relevant: Boolean(p.selected) || overlap > 0 };
    })
    .filter((c) => c.perMonth > 0 && c.relevant);
  const skippedCurrency = input.historicalProjects.filter((p) => (p.contractValue ?? 0) > 0 && p.currency && String(p.currency).toUpperCase() !== currency).length;
  if (skippedCurrency > 0) lowConfidence.push(`${skippedCurrency} past contract value(s) are in another currency and were not used (no exchange rate is assumed).`);
  let envelope: PricingEstimate["envelope"] = null;
  if (comparable.length > 0) {
    const perMonth = comparable.map((c) => c.perMonth).sort((a, b) => a - b);
    const confidence: PricingConfidence = comparable.length >= 3 ? "MEDIUM" : "LOW";
    envelope = {
      low: round2(quantile(perMonth, 0.25) * durationMonths),
      median: round2(quantile(perMonth, 0.5) * durationMonths),
      high: round2(quantile(perMonth, 0.75) * durationMonths),
      basis: `contract value per month of ${comparable.length} comparable past contract(s) of the firm × the ${durationMonths}-month period`,
      confidence,
      comparables: comparable.map((c) => `${c.p.name}: ${currency} ${Math.round(c.p.contractValue as number).toLocaleString("en-US")} over ${round2(c.months)} months`),
    };
    evidenceUsed.push(`Top-down envelope from ${comparable.length} comparable past contract(s).`);
    if (confidence === "LOW") lowConfidence.push(`Envelope: only ${comparable.length} comparable past contract(s) with value and dates; the spread lines are indicative.`);
  }
  lowConfidence.push("Market benchmarks: no current market rate source is held by the app; none is assumed.");

  // ── Scenarios ──────────────────────────────────────────────────────────
  const scenarios: PricingScenario[] = SCENARIOS.map((sc) => {
    const notes: string[] = [];
    const lines: EstimateLine[] = drafts.map((d) => {
      const base = {
        key: d.key, category: d.category, label: d.label, quantity: d.quantity, unit: d.unit,
        quantityBasis: d.quantityBasis, quantityConfidence: d.quantityConfidence,
        assumptions: [...d.assumptions], expertId: d.expertId ?? null,
      };
      if (d.evidenceRate) {
        const rate = d.evidenceRate.scalable ? roundEstimatedRate(d.evidenceRate.rate * sc.factor) : d.evidenceRate.rate;
        const assumptions = d.evidenceRate.scalable && sc.factor !== 1 ? [...base.assumptions, `Scenario adjustment ×${sc.factor} on the approved rate.`] : base.assumptions;
        return {
          ...base, assumptions, rate, amount: round2(rate * d.quantity),
          rateBasis: d.evidenceRate.basis, rateSource: d.evidenceRate.source, sourceDate: d.evidenceRate.date,
          rateConfidence: d.evidenceRate.confidence, confidence: weaker(d.evidenceRate.confidence, d.quantityConfidence),
        };
      }
      return {
        ...base, rate: null, amount: null,
        rateBasis: "no defensible rate evidence", rateSource: "—", sourceDate: null, rateConfidence: "NONE" as PricingConfidence, confidence: "NONE" as PricingConfidence,
      };
    });

    // Spread the remainder of an envelope over the lines without a rate.
    const vatFactor = 1 + vatPercent / 100;
    const contingencyFactor = 1 + sc.contingencyPct / 100;
    let target: { amount: number; basis: string; confidence: PricingConfidence } | null = null;
    if (envelope) {
      // Comparable contracts often cluster; the scenarios still differ by at
      // least the scenario factor around the median.
      const amount = sc.id === "AGGRESSIVE"
        ? Math.min(envelope.low, envelope.median * 0.92)
        : sc.id === "BALANCED" ? envelope.median : Math.max(envelope.high, envelope.median * 1.08);
      target = { amount: amount / contingencyFactor, basis: envelope.basis, confidence: envelope.confidence };
    }
    if (budget) {
      const net = (budget.amount * sc.budgetShare) / (budget.inclusiveOfVat ? vatFactor : 1) / contingencyFactor;
      if (!target || net < target.amount) target = { amount: net, basis: `${Math.round(sc.budgetShare * 100)}% of the client's stated budget`, confidence: target ? weaker(target.confidence, "MEDIUM") : "MEDIUM" };
    }
    const unrated = lines.filter((l) => l.rate === null);
    const ratedSum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    if (unrated.length > 0 && target) {
      const remaining = target.amount - ratedSum;
      if (remaining <= 0) {
        notes.push("Lines priced from direct evidence already reach the envelope; the remaining lines need the owner's rates.");
      } else {
        const weights = new Map(drafts.map((d) => [d.key, d.weight]));
        const personnel = unrated.filter((l) => l.category === "PERSONNEL");
        const other = unrated.filter((l) => l.category !== "PERSONNEL");
        const personnelShare = personnel.length === 0 ? 0 : other.length === 0 ? 1 : 0.75;
        const spread = (group: EstimateLine[], pool: number) => {
          const totalWeight = group.reduce((s, l) => s + (weights.get(l.key) ?? 1), 0) || 1;
          for (const l of group) {
            const share = pool * ((weights.get(l.key) ?? 1) / totalWeight);
            const rate = roundEstimatedRate(share / Math.max(l.quantity, 1));
            l.rate = rate;
            l.amount = round2(rate * l.quantity);
            l.rateBasis = `spread from the ${target!.basis}`;
            l.rateSource = budget && target!.basis.includes("budget") ? "Client budget (tender)" : "Firm's past contract values";
            l.rateConfidence = "LOW";
            l.confidence = "LOW";
            l.assumptions.push(group === personnel
              ? `Personnel take ${Math.round(personnelShare * 100)}% of the envelope remainder, split by input days × seniority.`
              : `Expenses take ${Math.round((1 - personnelShare) * 100)}% of the envelope remainder, split by item weight.`);
          }
        };
        spread(personnel, remaining * personnelShare);
        spread(other, remaining * (1 - personnelShare));
      }
    }

    // A budget is a ceiling: no scenario exceeds it.
    let subtotal = round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
    if (budget) {
      const ceilingNet = budget.amount / (budget.inclusiveOfVat ? vatFactor : 1) / contingencyFactor;
      if (subtotal > ceilingNet && subtotal > 0) {
        const scale = ceilingNet / subtotal;
        for (const l of lines) {
          // A rate the tender fixes is not the bidder's to scale.
          if (l.rate === null || l.rateSource === "Tender document") continue;
          l.rate = floorEstimatedRate(l.rate * scale);
          l.amount = round2(l.rate * l.quantity);
          l.assumptions.push(`Scaled ×${round2(scale)} to stay within the client's budget.`);
        }
        subtotal = round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
        notes.push("Scaled down to stay within the client's stated budget.");
      }
    }
    const contingency = round2(subtotal * sc.contingencyPct / 100);
    const vat = round2((subtotal + contingency) * vatPercent / 100);
    const complete = lines.every((l) => l.rate !== null);
    if (!complete) notes.push(`${lines.filter((l) => l.rate === null).length} line(s) have no defensible rate; enter them before approving.`);
    return { id: sc.id, label: sc.label, description: sc.description, contingencyPct: sc.contingencyPct, lines, subtotal, contingency, vat, offerTotal: round2(subtotal + contingency + vat), complete, notes };
  });

  const balanced = scenarios.find((s) => s.id === "BALANCED")!;
  const pricedLines = balanced.lines.filter((l) => l.rate !== null).length;
  const status: PricingEstimate["status"] = balanced.complete ? "COMPLETE" : pricedLines > 0 ? "PARTIAL" : "INSUFFICIENT_EVIDENCE";
  for (const l of balanced.lines) {
    if (l.confidence === "LOW") lowConfidence.push(`${l.label}: ${l.rateBasis}; ${l.quantityBasis}.`);
    if (l.confidence === "NONE") lowConfidence.push(`${l.label}: no rate evidence — the owner must enter the rate.`);
  }
  const money = (n: number) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const recommendation = status === "INSUFFICIENT_EVIDENCE"
    ? `No line can be priced from defensible evidence: the tender states no budget or rates, the firm has no comparable past contract value in ${currency}, and no rate was approved on a previous tender. The quantities are prepared; enter the rates and approve.`
    : [
        `Recommended bid: ${money(balanced.offerTotal)}${vatPercent > 0 ? ` including VAT at ${vatPercent}%` : ""} (Balanced scenario).`,
        budget ? `This is ${Math.round((balanced.offerTotal / (budget.inclusiveOfVat ? budget.amount : budget.amount * (1 + vatPercent / 100))) * 100)}% of the client's stated budget.` : "",
        `The Competitive scenario (${money(scenarios[0]!.offerTotal)}) improves the price score at the cost of margin; the Conservative scenario (${money(scenarios[2]!.offerTotal)}) protects margin and risk.`,
        status === "PARTIAL" ? "Some lines have no defensible rate and must be entered before approval." : "",
        `Confidence: ${balanced.lines.filter((l) => l.confidence === "HIGH" || l.confidence === "MEDIUM").length} of ${balanced.lines.length} line(s) rest on direct evidence; the rest are marked LOW.`,
      ].filter(Boolean).join(" ");

  return {
    tenderId: input.tender.id,
    status,
    currency, currencyBasis,
    vatPercent, vatBasis,
    withholdingPct, withholdingBasis,
    validityDays, validityBasis,
    durationMonths, durationBasis, durationConfidence,
    budget,
    envelope,
    scenarios,
    recommended: "BALANCED",
    recommendation,
    lowConfidence: Array.from(new Set(lowConfidence)),
    evidenceUsed,
    generatedAt: input.now.toISOString(),
  };
}

/** The notes stored on an approved cost line: where its numbers came from. */
export function approvedLineNotes(line: EstimateLine, scenario: PricingScenarioId): string {
  return [
    `Approved ${scenario} estimate.`,
    `Quantity: ${line.quantityBasis}.`,
    `Rate: ${line.rateBasis}${line.sourceDate ? ` (${line.sourceDate})` : ""}.`,
    `Confidence: ${line.confidence}.`,
    ...line.assumptions,
  ].join(" ").slice(0, 2000);
}
