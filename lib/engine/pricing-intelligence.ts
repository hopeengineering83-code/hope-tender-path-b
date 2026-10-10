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

import { SEED_BENCHMARKS, BENCHMARK_STALE_AFTER_MONTHS, benchmarkAgeMonths, classifyRole, findBenchmark, marketOf, seniorityOf, type BenchmarkCategory, type BenchmarkSeniority, type PricingBenchmark } from "./pricing-benchmarks";

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
  /**
   * Rates the owner approved on other tenders, with the country of the tender
   * each was approved for, the scenario it was approved in, and whether the
   * owner typed or adjusted that rate.
   */
  priorRates: Array<{ label: string; category: string; unit: string; rate: number; currency: string; date: string | Date; tenderTitle?: string | null; country?: string | null; scenario?: string | null; ownerAdjusted?: boolean }>;
  companyDefaultCurrency?: string | null;
  /** The benchmark registry: the shipped public figures plus the owner's own. Defaults to the shipped figures. */
  benchmarks?: readonly PricingBenchmark[];
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
  /** A personnel line's seniority (title and years), so a rate entered for it is filed for that seniority. */
  seniority?: BenchmarkSeniority | null;
  /**
   * How the billed rate is built when it starts from a cost (a salary, an
   * allowance): cost per unit, then overhead and margin. Absent for a rate
   * that is already a fee (an approved rate, a fee benchmark, a tender rate).
   */
  build?: { costRate: number; overheadPct: number; marginPct: number } | null;
};

export type PricingWarning = { code: "STALE_BENCHMARK" | "STALE_RATE" | "WEAK_COMPARATOR" | "FOREIGN_CURRENCY" | "MISSING_QUANTITY" | "ABNORMAL_MARGIN" | "BELOW_COST" | "BUDGET_EXCEEDED" | "NO_RATE"; message: string };

export type EvaluationModel = {
  model: "QCBS" | "LCS" | "QBS" | "FIXED_BUDGET" | "UNKNOWN";
  technicalWeight: number | null;
  financialWeight: number | null;
  basis: string;
};

export type PricingScenario = {
  id: PricingScenarioId;
  label: string;
  description: string;
  contingencyPct: number;
  overheadPct: number;
  marginPct: number;
  lines: EstimateLine[];
  /** Cost → overhead → margin, for lines built from a cost; fee-rate lines are summed separately. */
  build: { directCost: number; overhead: number; margin: number; feeLines: number };
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
  /** The tender's market (country code), when its country is known. */
  market: string | null;
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
  warnings: PricingWarning[];
  evaluation: EvaluationModel;
  /** The benchmarks this estimate used, with their sources. */
  benchmarksUsed: Array<Pick<PricingBenchmark, "id" | "label" | "source" | "sourceUrl" | "sourceType" | "effectiveDate" | "lastVerified" | "confidence" | "origin">>;
  evidenceUsed: string[];
  generatedAt: string;
};

const WORKING_DAYS_PER_MONTH = 22;
/** An approved rate up to this age is HIGH-confidence evidence; older, MEDIUM, then LOW. */
const PRIOR_RATE_HIGH_MONTHS = 18;
const PRIOR_RATE_MEDIUM_MONTHS = 36;
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
  // Generic role nouns say nothing about the discipline: "Pavement Engineer"
  // and "Water Engineer" are not the same role.
  return label.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["and", "the", "for", "with", "senior", "junior", "expert", "specialist", "engineer", "officer", "consultant", "manager", "team", "lead", "leader", "principal", "chief", "assistant"].includes(w));
}

function labelSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeLabel(a));
  const tb = new Set(normalizeLabel(b));
  if (ta.size === 0 || tb.size === 0) {
    // A label of generic words only ("Team Leader") matches a label that
    // contains every one of them.
    const words = (v: string) => new Set(v.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
    const [short, long] = [words(a), words(b)].sort((x, y) => x.size - y.size) as [Set<string>, Set<string>];
    return short.size > 0 && Array.from(short).every((w) => long.has(w)) ? 1 : 0;
  }
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

const SCENARIOS: Array<{ id: PricingScenarioId; label: string; description: string; factor: number; budgetShare: number; contingencyPct: number; overheadPct: number; marginPct: number }> = [
  { id: "AGGRESSIVE", label: "Competitive", description: "Lowest defensible price: evidence rates trimmed 5%, the low end of each benchmark and of comparable past contracts, cost-built personnel at 80% overhead and 5% margin, no contingency.", factor: 0.95, budgetShare: 0.88, contingencyPct: 0, overheadPct: 80, marginPct: 5 },
  { id: "BALANCED", label: "Balanced (recommended)", description: "Evidence rates as approved before, benchmark medians, cost-built personnel at 100% overhead and 10% margin, 5% contingency.", factor: 1.0, budgetShare: 0.94, contingencyPct: 5, overheadPct: 100, marginPct: 10 },
  { id: "CONSERVATIVE", label: "Conservative", description: "Protects margin and risk: evidence rates plus 7%, the high end of each benchmark and of comparable past contracts, cost-built personnel at 120% overhead and 15% margin, 10% contingency.", factor: 1.07, budgetShare: 0.99, contingencyPct: 10, overheadPct: 120, marginPct: 15 },
];

/**
 * The tender's evaluation model: how much price weighs. QCBS weights are read
 * from "technical … 60% … financial … 40%"; least-cost and quality-based
 * selection from their names. Nothing is assumed when the tender says nothing.
 */
export function evaluationModelOf(text: string): EvaluationModel {
  // Stated weights decide first: a QCBS tender names "the lowest price" too,
  // in its financial-score formula ("the lowest price receives 100 points").
  const flat = text.replace(/\s+/g, " ");
  const t = /\btechnical\b[^.%]{0,80}?(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:for\s+)?(?:the\s+)?technical/i.exec(flat);
  const f = /\bfinancial\b[^.%]{0,80}?(\d{1,3})\s*%|(\d{1,3})\s*%\s*(?:for\s+)?(?:the\s+)?financial/i.exec(flat);
  const tw = t ? Number(t[1] ?? t[2]) : null;
  const fw = f ? Number(f[1] ?? f[2]) : null;
  if (tw !== null && fw !== null && tw + fw === 100) {
    if (fw === 0) return { model: "QBS", technicalWeight: 100, financialWeight: 0, basis: `technical ${tw}% / financial ${fw}%, stated by the tender` };
    return { model: "QCBS", technicalWeight: tw, financialWeight: fw, basis: `technical ${tw}% / financial ${fw}%, stated by the tender` };
  }
  for (const s of sentences(text)) {
    // "The Client is not bound to accept the lowest bid" reserves a right; it
    // is not a selection method.
    if (/\bnot\s+(?:be\s+)?(?:bound|obliged|obligated|required)\s+to\s+accept\b|\bnot\s+necessarily\s+(?:accept|award)/i.test(s)) continue;
    if (/\b(?:least[\s-]+cost|lowest\s+(?:evaluated\s+)?(?:price|cost|bid)|\bLCS\b)/i.test(s)) return { model: "LCS", technicalWeight: null, financialWeight: null, basis: `stated by the tender: "${snippet(s)}"` };
    if (/\b(?:quality[\s-]+based\s+selection|\bQBS\b)/i.test(s)) return { model: "QBS", technicalWeight: 100, financialWeight: 0, basis: `stated by the tender: "${snippet(s)}"` };
    if (/\bfixed[\s-]+budget\b|\bFBS\b/i.test(s)) return { model: "FIXED_BUDGET", technicalWeight: null, financialWeight: null, basis: `stated by the tender: "${snippet(s)}"` };
  }
  return { model: "UNKNOWN", technicalWeight: null, financialWeight: null, basis: "the tender states no evaluation weights" };
}

/** The per-diem tier for where the field work is. */
function perDiemTier(text: string): { key: string; basis: string } {
  if (/\b(?:woredas?|kebeles?|rural|villages?|communit(?:y|ies))\b/i.test(text)) return { key: "per_diem_woreda", basis: "field work in woredas/kebeles" };
  if (/\b(?:zones?|zonal)\b/i.test(text)) return { key: "per_diem_zonal_capital", basis: "field work in zones" };
  if (/\bregion(?:al|s)?\b/i.test(text)) return { key: "per_diem_regional_capital", basis: "field work in the regions" };
  return { key: "per_diem_addis_ababa", basis: "no field location stated; Addis Ababa rate assumed" };
}

const RULE_BENCHMARK: Readonly<Record<string, BenchmarkCategory>> = {
  "field-transport": "TRANSPORT",
  "per-diem": "PER_DIEM",
  "enumerators": "ENUMERATOR",
  "workshops": "WORKSHOP",
  "boreholes": "DRILLING",
  "laboratory": "LABORATORY",
  "survey": "SURVEY",
  "site-vehicle": "EQUIPMENT",
  "reports": "PRINTING",
};

/**
 * Where a rate the owner enters for an estimate line is filed in the rate
 * card, so the same line on a later tender finds it: personnel day rates by
 * role and seniority, described work by its own key. Null for a line the
 * rate card does not hold (a lump-sum fee).
 */
export function rateCardSlotFor(line: Pick<EstimateLine, "key" | "category" | "label" | "unit" | "seniority">): { category: BenchmarkCategory; serviceKey: string; seniority: BenchmarkSeniority | null; label: string } | null {
  if (line.category === "PERSONNEL") {
    if (line.unit !== "DAY") return null;
    const title = line.label.split(" — ")[0]!.trim();
    return { category: "PERSONNEL_FEE", serviceKey: classifyRole(title), seniority: line.seniority ?? seniorityOf(title), label: title };
  }
  const category = RULE_BENCHMARK[line.key];
  return category ? { category, serviceKey: line.key.replace(/-/g, "_"), seniority: null, label: line.label } : null;
}

/** Build the estimate. */
export function estimateTenderPrice(input: PricingEvidenceInput): PricingEstimate {
  const text = input.tenderText ?? "";
  const evidenceUsed: string[] = [];
  const lowConfidence: string[] = [];
  const warnings: PricingWarning[] = [];
  const benchmarks = input.benchmarks ?? SEED_BENCHMARKS;
  const benchmarksUsed = new Map<string, PricingBenchmark>();
  const recordBenchmark = (bm: PricingBenchmark) => {
    benchmarksUsed.set(bm.id, bm);
    if (benchmarkAgeMonths(bm, input.now) > BENCHMARK_STALE_AFTER_MONTHS) {
      warnings.push({ code: "STALE_BENCHMARK", message: `${bm.label}: effective ${bm.effectiveDate}, older than ${BENCHMARK_STALE_AFTER_MONTHS} months.` });
    }
  };
  const evaluation = evaluationModelOf(text);
  const market = marketOf(input.tender.country);

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
    evidenceRate?: {
      rate: number; basis: string; source: string; date: string | null; confidence: PricingConfidence; scalable: boolean;
      /** A benchmark's spread: the scenarios take its low / median / high instead of scaling the median. */
      range?: { low: number; high: number };
      /** A cost passed through at cost (an allowance), not a fee. */
      atCost?: boolean;
    };
  };
  const drafts: Draft[] = [];
  const team = input.experts.length > 0 ? input.experts : [];
  const expertYears = new Map(team.map((e) => [`expert:${e.id}`, e.yearsExperience ?? null]));
  const expertYearsOf = (key: string) => expertYears.get(key) ?? null;
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
      seniority: seniorityOf(role, expert.yearsExperience),
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
      seniority: seniorityOf(role),
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
  // An approved rate is reused only in the same currency and, where both are
  // known, the same country: a Nairobi day rate does not price Addis Ababa.
  //
  // A rate approved inside the Competitive or Conservative scenario carries
  // that scenario's adjustment. Reused as-is and adjusted again, it moved a
  // step on every tender — down 5% per least-cost bid, compounding. Unless the
  // owner typed it, it is reused at its balanced equivalent.
  const priorRates = input.priorRates
    .filter((r) => {
      if (!(r.rate > 0) || r.currency.toUpperCase() !== currency) return false;
      const rateMarket = marketOf(r.country);
      return !market || !rateMarket || rateMarket === market;
    })
    .map((r) => {
      const scenario = SCENARIOS.find((sc) => sc.id === r.scenario);
      if (r.ownerAdjusted || !scenario || scenario.factor === 1) return { ...r, approvedAs: null as string | null };
      return { ...r, rate: r.rate / scenario.factor, approvedAs: `${r.rate.toLocaleString("en-US")} in the ${scenario.label} scenario` };
    });
  for (const d of drafts) {
    if (d.rateKeyword) {
      const fixed = prescribedRate(text, d.rateKeyword);
      if (fixed && fixed.currency === currency) {
        d.evidenceRate = { rate: fixed.rate, basis: `rate fixed by the tender: "${fixed.quote}"`, source: "Tender document", date: null, confidence: "HIGH", scalable: false };
        continue;
      }
    }
    const candidates = priorRates
      .filter((r) => r.unit === d.unit)
      .map((r) => ({ r, sim: d.category === "PERSONNEL" ? labelSimilarity(d.label.split(" — ")[0]!, r.label.split(" — ")[0]!) : labelSimilarity(d.label, r.label) }))
      .filter((c) => c.sim >= 0.5 && c.r.category === d.category)
      .sort((a, b) => new Date(b.r.date).getTime() - new Date(a.r.date).getTime());
    if (candidates.length === 0 && d.category === "PERSONNEL" && d.unit === "DAY") {
      // No approved rate for this role by name. The owner's approved day rates
      // for the same tier (team lead vs other experts) are the firm's own
      // pricing for comparable seniority — weaker evidence, marked MEDIUM.
      const leader = LEADER_RE.test(d.label);
      const tier = priorRates
        .filter((r) => r.category === "PERSONNEL" && r.unit === "DAY" && monthsBetween(new Date(r.date), input.now) <= PRIOR_RATE_MEDIUM_MONTHS)
        .filter((r) => LEADER_RE.test(r.label) === leader)
        .sort((a, b) => a.rate - b.rate);
      if (tier.length > 0) {
        const median = tier[Math.floor((tier.length - 1) / 2)]!;
        const latest = tier.reduce((m, r) => (new Date(r.date) > new Date(m.date) ? r : m), tier[0]!);
        d.evidenceRate = {
          rate: median.rate,
          basis: `median of ${tier.length} day rate(s) the owner approved for ${leader ? "team-lead" : "expert"} roles on earlier tenders (no approved rate for this role by name)`,
          source: "Owner-approved rates, same seniority tier",
          date: toIsoDate(latest.date),
          confidence: "MEDIUM",
          scalable: true,
        };
        continue;
      }
    }
    if (candidates.length > 0) {
      const best = candidates[0]!.r;
      const ageMonths = monthsBetween(new Date(best.date), input.now);
      d.evidenceRate = {
        rate: best.rate,
        basis: `rate the owner approved for "${best.label}"${best.tenderTitle ? ` on "${best.tenderTitle}"` : ""}${best.approvedAs ? ` (${best.approvedAs}, reused at its balanced equivalent)` : ""}`,
        source: "Owner-approved rate on a previous tender",
        date: toIsoDate(best.date),
        confidence: ageMonths <= PRIOR_RATE_HIGH_MONTHS ? "HIGH" : ageMonths <= PRIOR_RATE_MEDIUM_MONTHS ? "MEDIUM" : "LOW",
        scalable: true,
      };
      if (ageMonths > PRIOR_RATE_HIGH_MONTHS) {
        warnings.push({ code: "STALE_RATE", message: `${d.label}: the approved rate it reuses is ${Math.round(ageMonths)} months old (${toIsoDate(best.date)}); prices may have moved since — confirm it.` });
      }
    }
  }
  const directCount = drafts.filter((d) => d.evidenceRate).length;
  if (directCount > 0) evidenceUsed.push(`${directCount} line(s) priced from tender-fixed or previously approved rates.`);

  // ── Benchmark registry: the owner's rate card and the shipped public figures
  const tier = perDiemTier(text);
  let benchmarked = 0;
  for (const d of drafts) {
    if (d.evidenceRate) continue;
    let bm: PricingBenchmark | null = null;
    if (d.category === "PERSONNEL" && d.unit === "DAY") {
      const title = d.label.split(" — ")[0]!;
      bm = findBenchmark(benchmarks, { category: "PERSONNEL_FEE", serviceKey: classifyRole(title), seniority: seniorityOf(title, expertYearsOf(d.key)), currency, unit: "DAY", market });
    } else if (RULE_BENCHMARK[d.key]) {
      const category = RULE_BENCHMARK[d.key]!;
      bm = findBenchmark(benchmarks, { category, serviceKey: category === "PER_DIEM" ? tier.key : d.key.replace(/-/g, "_"), currency, unit: d.unit, market });
    }
    if (!bm && d.key === "enumerators") {
      // No enumerator rate is held. An enumerator is a short-term entry-level
      // hire: the public entry salary with the statutory employer pension, per
      // working day, is a documented floor. Passed through at cost, LOW.
      const entry = findBenchmark(benchmarks, { category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "JUNIOR", currency, unit: "MONTH", market });
      const charges = findBenchmark(benchmarks, { category: "STATUTORY_RATE", serviceKey: "employer_pension", currency, unit: "PERCENT", market });
      if (entry) {
        recordBenchmark(entry);
        if (charges) recordBenchmark(charges);
        const cost = (entry.median * (1 + (charges ? charges.median / 100 : 0))) / WORKING_DAYS_PER_MONTH;
        const rate = roundEstimatedRate(cost);
        d.evidenceRate = {
          rate,
          basis: `cost-built at cost: ${entry.label} ${currency} ${entry.median.toLocaleString("en-US")}/month${charges ? ` + ${charges.median}% employer pension` : ""} ÷ ${WORKING_DAYS_PER_MONTH} days ≈ ${currency} ${rate.toLocaleString("en-US")}/day (${entry.source}) — a public entry-pay floor; local enumerator rates may be higher`,
          source: "Cost model (public salary scale)",
          date: entry.effectiveDate,
          confidence: "LOW",
          scalable: false,
          atCost: true,
        };
        d.assumptions.push("Enumerators paid the public entry-level day cost and reimbursed at cost: no overhead or margin is added.");
        benchmarked += 1;
      }
      continue;
    }
    if (!bm) continue;
    recordBenchmark(bm);
    benchmarked += 1;
    const atCost = bm.rateBasis === "COST";
    d.evidenceRate = {
      rate: bm.median,
      basis: `${bm.label} — ${bm.source}${d.key === "per-diem" ? ` (${tier.basis})` : ""}`,
      source: bm.origin === "OWNER" ? "Owner rate card" : "Market benchmark (public source)",
      date: bm.effectiveDate,
      confidence: bm.confidence,
      scalable: !atCost,
      range: { low: bm.low, high: bm.high },
      atCost,
    };
    if (atCost) d.assumptions.push("Reimbursed at cost: no overhead or margin is added.");
  }
  if (benchmarked > 0) evidenceUsed.push(`${benchmarked} line(s) priced from the benchmark registry (source and date on each).`);

  // ── Cost model for personnel with no rate evidence ────────────────────
  // A professional's day cost from the public salary scale for the role's
  // seniority plus the statutory employer pension, over the working days of a
  // month. The scenario then adds overhead and margin. Transparent and LOW:
  // a public scale is a floor for private consultancy pay.
  const pension = findBenchmark(benchmarks, { category: "STATUTORY_RATE", serviceKey: "employer_pension", currency, unit: "PERCENT", market });
  const dayCost = (title: string, years?: number | null) => {
    const salary = findBenchmark(benchmarks, { category: "PERSONNEL_SALARY", serviceKey: classifyRole(title), seniority: seniorityOf(title, years), currency, unit: "MONTH", market });
    if (!salary) return null;
    const charges = pension ? pension.median / 100 : 0;
    return { cost: round2((salary.median * (1 + charges)) / WORKING_DAYS_PER_MONTH), salary, charges };
  };

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
  if (!benchmarks.some((bm) => bm.category === "PERSONNEL_FEE" && bm.currency.toUpperCase() === currency)) {
    lowConfidence.push(`Market benchmarks: no published consultancy fee rate for ${currency} is held; personnel without an approved rate are cost-built from the public salary scale (LOW).`);
  }
  if (skippedCurrency > 0) warnings.push({ code: "FOREIGN_CURRENCY", message: `${skippedCurrency} past contract value(s) in another currency were not converted; no exchange rate is assumed.` });
  if (envelope?.confidence === "LOW") warnings.push({ code: "WEAK_COMPARATOR", message: envelope.basis });

  // ── Scenarios ──────────────────────────────────────────────────────────
  const scenarios: PricingScenario[] = SCENARIOS.map((sc) => {
    const notes: string[] = [];
    const lines: EstimateLine[] = drafts.map((d) => {
      const base = {
        key: d.key, category: d.category, label: d.label, quantity: d.quantity, unit: d.unit,
        quantityBasis: d.quantityBasis, quantityConfidence: d.quantityConfidence,
        assumptions: [...d.assumptions], expertId: d.expertId ?? null, seniority: d.seniority ?? null,
      };
      if (d.evidenceRate) {
        const ev = d.evidenceRate;
        const rate = ev.range && !ev.atCost
          ? roundEstimatedRate(sc.id === "AGGRESSIVE" ? ev.range.low : sc.id === "BALANCED" ? ev.rate : ev.range.high)
          : ev.scalable ? roundEstimatedRate(ev.rate * sc.factor) : ev.rate;
        const assumptions = ev.range && !ev.atCost && ev.range.low !== ev.range.high
          ? [...base.assumptions, `${sc.label}: the benchmark's ${sc.id === "AGGRESSIVE" ? "low" : sc.id === "BALANCED" ? "median" : "high"} value.`]
          : ev.scalable && !ev.range && sc.factor !== 1 ? [...base.assumptions, `Scenario adjustment ×${sc.factor} on the approved rate.`] : base.assumptions;
        return {
          ...base, assumptions, rate, amount: round2(rate * d.quantity),
          rateBasis: ev.basis, rateSource: ev.source, sourceDate: ev.date,
          rateConfidence: ev.confidence, confidence: weaker(ev.confidence, d.quantityConfidence),
          build: ev.atCost ? { costRate: rate, overheadPct: 0, marginPct: 0 } : null,
        };
      }
      return {
        ...base, rate: null, amount: null, build: null,
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

    // Personnel still without a rate: build it from cost.
    for (const l of lines) {
      if (l.rate !== null || l.category !== "PERSONNEL" || l.unit !== "DAY") continue;
      const title = l.label.split(" — ")[0]!;
      const c = dayCost(title, expertYears.get(l.key));
      if (!c) continue;
      recordBenchmark(c.salary);
      if (pension) recordBenchmark(pension);
      const rate = roundEstimatedRate(c.cost * (1 + sc.overheadPct / 100) * (1 + sc.marginPct / 100));
      l.rate = rate;
      l.amount = round2(rate * l.quantity);
      l.build = { costRate: c.cost, overheadPct: sc.overheadPct, marginPct: sc.marginPct };
      l.rateBasis = `cost-built: ${c.salary.label} ${currency} ${c.salary.median.toLocaleString("en-US")}/month${c.charges ? ` + ${Math.round(c.charges * 100)}% employer pension` : ""} ÷ ${WORKING_DAYS_PER_MONTH} days = ${currency} ${c.cost.toLocaleString("en-US")}/day cost, + ${sc.overheadPct}% overhead + ${sc.marginPct}% margin (${c.salary.source})`;
      l.rateSource = "Cost model (public salary scale)";
      l.sourceDate = c.salary.effectiveDate;
      l.rateConfidence = "LOW";
      l.confidence = "LOW";
      l.assumptions.push(`Overhead ${sc.overheadPct}% and margin ${sc.marginPct}% are this scenario's commercial assumptions; adjust them at approval.`);
    }

    // Below cost: a fee rate under the day cost of the same seniority loses money.
    for (const l of lines) {
      if (l.rate === null || l.category !== "PERSONNEL" || l.unit !== "DAY" || l.build) continue;
      const c = dayCost(l.label.split(" — ")[0]!, expertYears.get(l.key));
      if (c && l.rate < c.cost) {
        warnings.push({ code: "BELOW_COST", message: `${sc.label}: ${l.label} at ${currency} ${l.rate.toLocaleString("en-US")}/day is below its estimated day cost of ${currency} ${c.cost.toLocaleString("en-US")}.` });
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
        warnings.push({ code: "BUDGET_EXCEEDED", message: `${sc.label}: the evidence-based price exceeded the client's budget and was scaled ×${round2(scale)} to fit; check it still covers cost.` });
      }
    }
    // Cost → overhead → margin, for the cost-built lines; fee lines as billed.
    const build = { directCost: 0, overhead: 0, margin: 0, feeLines: 0 };
    for (const l of lines) {
      if (l.amount === null) continue;
      if (l.build) {
        const cost = l.build.costRate * l.quantity;
        const overhead = cost * l.build.overheadPct / 100;
        build.directCost += cost;
        build.overhead += overhead;
        build.margin += (cost + overhead) * l.build.marginPct / 100;
      } else {
        build.feeLines += l.amount;
      }
    }
    build.directCost = round2(build.directCost);
    build.overhead = round2(build.overhead);
    build.margin = round2(build.margin);
    build.feeLines = round2(build.feeLines);
    const contingency = round2(subtotal * sc.contingencyPct / 100);
    const vat = round2((subtotal + contingency) * vatPercent / 100);
    const complete = lines.every((l) => l.rate !== null);
    if (!complete) notes.push(`${lines.filter((l) => l.rate === null).length} line(s) have no defensible rate; enter them before approving.`);
    return { id: sc.id, label: sc.label, description: sc.description, contingencyPct: sc.contingencyPct, overheadPct: sc.overheadPct, marginPct: sc.marginPct, lines, build, subtotal, contingency, vat, offerTotal: round2(subtotal + contingency + vat), complete, notes };
  });

  // The evaluation model decides which scenario fits: least-cost selection
  // rewards the lowest defensible price; quality-based selection does not
  // score price; QCBS weighs both, so the balanced price is recommended
  // unless price carries at least half the score.
  const recommended: PricingScenarioId = evaluation.model === "LCS"
    ? "AGGRESSIVE"
    : evaluation.model === "QBS" ? "CONSERVATIVE"
      : evaluation.model === "QCBS" && (evaluation.financialWeight ?? 0) >= 50 ? "AGGRESSIVE" : "BALANCED";
  const chosen = scenarios.find((s) => s.id === recommended)!;
  const pricedLines = chosen.lines.filter((l) => l.rate !== null).length;
  const status: PricingEstimate["status"] = chosen.complete ? "COMPLETE" : pricedLines > 0 ? "PARTIAL" : "INSUFFICIENT_EVIDENCE";
  for (const l of chosen.lines) {
    if (l.confidence === "LOW") lowConfidence.push(`${l.label}: ${l.rateBasis}; ${l.quantityBasis}.`);
    if (l.confidence === "NONE") {
      lowConfidence.push(`${l.label}: no rate evidence — the owner must enter the rate.`);
      warnings.push({ code: "NO_RATE", message: l.category === "SUBCONSULTANT"
        ? `${l.label}: specialist subcontracted work with no rate held; enter the subcontractor's quoted price before approving (and add it to the rate card once).`
        : `${l.label}: no defensible rate; enter it before approving (or add it to the rate card once).` });
    }
    if (l.quantityConfidence === "LOW") warnings.push({ code: "MISSING_QUANTITY", message: `${l.label}: quantity assumed — ${l.quantityBasis}.` });
  }
  for (const sc of scenarios) {
    const base = sc.build.directCost + sc.build.overhead;
    if (base > 0 && (sc.build.margin / base > 0.4 || sc.build.margin < 0)) {
      warnings.push({ code: "ABNORMAL_MARGIN", message: `${sc.label}: margin ${Math.round((sc.build.margin / base) * 100)}% of cost and overhead.` });
    }
  }
  const money = (n: number) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const why = evaluation.model === "LCS"
    ? "The tender awards the lowest evaluated price, so the Competitive scenario is recommended; it stays above the estimated cost of every line."
    : evaluation.model === "QBS"
      ? "The tender selects on quality alone, so price is not scored: the Conservative scenario protects delivery and margin."
      : evaluation.model === "QCBS"
        ? `Price carries ${evaluation.financialWeight}% of the score (technical ${evaluation.technicalWeight}%). Under QCBS the financial score is usually the lowest price ÷ this price × ${evaluation.financialWeight}: ${recommended === "AGGRESSIVE" ? "with price weighted this heavily, the Competitive scenario gains more score than it gives up in margin" : `pricing ${Math.round((1 - scenarios[0]!.offerTotal / Math.max(chosen.offerTotal, 1)) * 100)}% lower (Competitive) would add at most about ${Math.round((evaluation.financialWeight ?? 0) * (1 - scenarios[0]!.offerTotal / Math.max(chosen.offerTotal, 1)))} points, while the technical score decides most of the ranking — so the Balanced price is recommended`}.`
        : evaluation.model === "FIXED_BUDGET"
          ? "The tender fixes the budget: the offer should use it fully on scope, so the Balanced scenario within the budget is recommended."
          : "The tender states no evaluation weights; the Balanced scenario is recommended as commercially defensible.";
  const recommendation = status === "INSUFFICIENT_EVIDENCE"
    ? `No line can be priced from defensible evidence: the tender states no budget or rates, no comparable past contract value in ${currency}, no approved or rate-card rate, and no benchmark covers these lines. The quantities are prepared; enter the rates (once, in the rate card) and approve.`
    : [
        `Recommended bid: ${money(chosen.offerTotal)}${vatPercent > 0 ? ` including VAT at ${vatPercent}%` : ""} (${chosen.label} scenario).`,
        why,
        budget ? `This is ${Math.round((chosen.offerTotal / (budget.inclusiveOfVat ? budget.amount : budget.amount * (1 + vatPercent / 100))) * 100)}% of the client's stated budget.` : "",
        `Range: Competitive ${money(scenarios[0]!.offerTotal)} · Balanced ${money(scenarios[1]!.offerTotal)} · Conservative ${money(scenarios[2]!.offerTotal)}.`,
        status === "PARTIAL" ? "Some lines have no defensible rate and must be entered before approval." : "",
        `Confidence: ${chosen.lines.filter((l) => l.confidence === "HIGH" || l.confidence === "MEDIUM").length} of ${chosen.lines.length} line(s) rest on direct evidence or a sourced benchmark; the rest are marked LOW.`,
      ].filter(Boolean).join(" ");

  return {
    tenderId: input.tender.id,
    status,
    market,
    currency, currencyBasis,
    vatPercent, vatBasis,
    withholdingPct, withholdingBasis,
    validityDays, validityBasis,
    durationMonths, durationBasis, durationConfidence,
    budget,
    envelope,
    scenarios,
    recommended,
    recommendation,
    lowConfidence: Array.from(new Set(lowConfidence)),
    warnings: warnings.filter((w, i, all) => all.findIndex((o) => o.code === w.code && o.message === w.message) === i),
    evaluation,
    benchmarksUsed: Array.from(benchmarksUsed.values()).map((bm) => ({ id: bm.id, label: bm.label, source: bm.source, sourceUrl: bm.sourceUrl ?? null, sourceType: bm.sourceType, effectiveDate: bm.effectiveDate, lastVerified: bm.lastVerified, confidence: bm.confidence, origin: bm.origin })),
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
    ...(line.build && (line.build.overheadPct > 0 || line.build.marginPct > 0)
      ? [`Build: day cost ${line.build.costRate} + ${line.build.overheadPct}% overhead + ${line.build.marginPct}% margin.`]
      : []),
    ...line.assumptions,
  ].join(" ").slice(0, 2000);
}
