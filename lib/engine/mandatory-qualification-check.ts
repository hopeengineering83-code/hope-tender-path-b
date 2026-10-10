/**
 * Does the firm meet a mandatory qualification the tender states as a figure?
 *
 * The compliance engine graded a requirement by whether a record of the right
 * KIND existed: any reviewed financial record "supported" a turnover threshold,
 * any selected project "supported" a count of similar assignments. On
 * 2026-10-10 a mandatory "average annual turnover of ETB 100,000,000 over the
 * last three years", against a Vault holding ETB 20,000,000 and ETB 18,000,000,
 * and "three similar assignments, each of not less than ETB 50,000,000",
 * against one ETB 2,000,000 project, were both printed FULLY MET in the
 * proposal's own compliance matrix. A false compliance claim in a bid is worse
 * than a missing one: the evaluator checks the figures.
 *
 * This reads the threshold the tender states and the figures the Vault holds,
 * and returns one verdict per qualification:
 *
 *   PASS              the figures on file prove it under every reading of the
 *                     tender's wording;
 *   FAIL              the figures on file fall short under every reading — the
 *                     firm cannot presently satisfy it;
 *   CONDITIONAL_PASS  anything between: a year missing, another currency, a
 *                     project with no stated value. It passes only if the owner
 *                     supplies what is named as missing.
 *
 * It never converts currencies, never assumes a missing figure, and returns
 * nothing when the wording is ambiguous (two amounts in one sentence, a
 * cumulative value, named fiscal years): an unread requirement keeps the
 * engine's existing treatment rather than a guessed verdict. Only MANDATORY or
 * CRITICAL requirements are assessed — a scored criterion is never a pass/fail
 * gate.
 */

import { CURRENCY_TOKEN_ALTERNATION, resolveCurrencyToken } from "./currency-reference";
import { isMandatoryPriority } from "./mandatory-evidence-requirement";

export type QualificationVerdict = "PASS" | "CONDITIONAL_PASS" | "FAIL";
export type QualificationKind = "TURNOVER" | "SIMILAR_ASSIGNMENTS" | "FIRM_EXPERIENCE";

export type QualificationAssessment = {
  kind: QualificationKind;
  verdict: QualificationVerdict;
  /** What the tender requires, in one line. */
  required: string;
  /** What the Company Vault holds against it. */
  evidence: string;
  /** What is missing or short; empty on PASS. */
  missing: string;
  decision: string;
};

export type QualificationRequirement = {
  title?: string | null;
  description?: string | null;
  restrictions?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  requiredQuantity?: number | null;
};

export type QualificationEvidence = {
  companyName?: string | null;
  foundingYear?: number | null;
  /** Usable (reviewed or source-verified) financial records only. */
  financialRecords: ReadonlyArray<{
    fiscalYear?: number | null;
    recordType?: string | null;
    amount?: number | null;
    currency?: string | null;
  }>;
  /** Every project on file; `selected` marks the ones matched as similar to this tender. */
  projects: ReadonlyArray<{
    name?: string | null;
    contractValue?: number | null;
    currency?: string | null;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    selected: boolean;
  }>;
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, "twenty-five": 25, thirty: 30,
};
const NUMBER = String.raw`(\d{1,2}|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)`;
/** "three (3)", "3 (three)" */
const ECHO = String.raw`(?:\s*\(\s*(?:\d{1,2}|[a-z-]+)\s*\))?`;

function toNumber(token: string | undefined): number | null {
  if (!token) return null;
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return WORD_NUMBERS[lower] ?? null;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+(?=[A-Z(•\-\d])|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type Money = { amount: number; currency: string };

const SCALE = String.raw`(?:\s*([Mm]illion|[Bb]illion|[Tt]housand|mn|bn|[Mm]|[Bb]n)\b)?`;
const FIGURE = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?: \d{3})+(?![\d,])|\d+(?:\.\d+)?)`;
// Deliberately case-sensitive: CURRENCY_TOKEN_ALTERNATION matches ISO codes in
// upper case only, so "all" is never a currency.
const MONEY_CURRENCY_FIRST = new RegExp(`(${CURRENCY_TOKEN_ALTERNATION})\\.?\\s?${FIGURE}${SCALE}`, "g");
const MONEY_FIGURE_FIRST = new RegExp(`(?<![\\w.,])${FIGURE}${SCALE}\\s?(${CURRENCY_TOKEN_ALTERNATION})(?![A-Za-z])`, "g");

function scaled(figure: string, scale: string | undefined): number {
  const base = Number(figure.replace(/[ ,]/g, ""));
  const unit = (scale ?? "").toLowerCase();
  if (unit === "million" || unit === "mn" || unit === "m") return base * 1_000_000;
  if (unit === "billion" || unit === "bn") return base * 1_000_000_000;
  if (unit === "thousand") return base * 1_000;
  return base;
}

/** Every distinct amount of money in a sentence. */
function moneyIn(sentence: string): Money[] {
  const found: Money[] = [];
  const push = (currencyToken: string, figure: string, scale: string | undefined) => {
    const currency = resolveCurrencyToken(currencyToken);
    const amount = scaled(figure, scale);
    if (!currency || !Number.isFinite(amount) || amount <= 0) return;
    if (!found.some((m) => m.currency === currency && m.amount === amount)) found.push({ amount, currency });
  };
  for (const m of sentence.matchAll(MONEY_CURRENCY_FIRST)) push(m[1]!, m[2]!, m[3]);
  for (const m of sentence.matchAll(MONEY_FIGURE_FIRST)) push(m[3]!, m[1]!, m[2]);
  return found;
}

function currencyCode(raw: string | null | undefined): string | null {
  const token = String(raw ?? "").trim();
  return resolveCurrencyToken(token) ?? resolveCurrencyToken(token.toUpperCase());
}

export function formatMoney(money: Money): string {
  return `${money.currency} ${money.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

const LAST_N_YEARS = new RegExp(String.raw`\b(?:last|past|preceding|previous|recent)\s+${NUMBER}${ECHO}\s*(?:fiscal\s+|financial\s+|calendar\s+|consecutive\s+|accounting\s+)?years?\b`, "i");
const NAMED_YEAR = /(?<![\d,.])(?:19|20)\d{2}(?![\d,])/;

function lastYears(sentence: string): number | null {
  const match = LAST_N_YEARS.exec(sentence);
  return match ? toNumber(match[1]) : null;
}

/** The year a project completed, or null when the record does not say. */
function yearOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

function verdictText(verdict: QualificationVerdict, companyName: string, missing: string): string {
  if (verdict === "PASS") return "Met by the evidence on file.";
  if (verdict === "FAIL") return `${companyName} cannot presently satisfy this mandatory requirement from the evidence on file.`;
  return `${companyName} may satisfy this requirement, but the evidence on file does not prove it until the following is supplied: ${missing}`;
}

// ── Turnover ────────────────────────────────────────────────────────────────

const TURNOVER = /\b(?:turnover|revenues?|gross\s+(?:annual\s+)?(?:income|receipts|sales)|annual\s+sales)\b/i;
const OTHER_FINANCIAL_CAPACITY = /\b(?:liquid\s+assets|credit\s+(?:lines?|facilit\w*)|working\s+capital|bid\s+(?:security|bond|guarantee)|net\s+worth|cash\s+flow|line\s+of\s+credit|bank\s+guarantee)\b/i;
const TURNOVER_RECORD = /\b(?:turnover|revenues?|gross\s+(?:income|receipts|sales)|sales|total\s+income)\b/i;
const NOT_TURNOVER_RECORD = /\b(?:net\s+(?:income|profit)|profit|tax|assets?|liabilit\w*|equity|credit|cash|expenses?)\b/i;

type TurnoverMode = "AVERAGE" | "EACH" | "ANY" | "UNSPECIFIED";

function turnoverMode(sentence: string): TurnoverMode {
  if (/\b(?:average|mean)\b/i.test(sentence)) return "AVERAGE";
  if (/\b(?:any\s+(?:one\s+)?(?:of\s+the\s+)?(?:last|past|preceding|year)|at\s+least\s+one\s+(?:of\s+the\s+)?(?:last|past|year)|highest|best)\b/i.test(sentence)) return "ANY";
  if (/\b(?:each|every)\s+(?:of\s+the\s+)?(?:last|past|preceding|year|fiscal|financial)\b|\bin\s+each\b/i.test(sentence)) return "EACH";
  return "UNSPECIFIED";
}

function assessTurnover(text: string, evidence: QualificationEvidence, referenceYear: number): QualificationAssessment | null {
  // The sentence that states the figure, not the title that names the topic.
  const sentence = sentencesOf(text).find((s) => TURNOVER.test(s) && moneyIn(s).length > 0);
  if (!sentence || OTHER_FINANCIAL_CAPACITY.test(sentence)) return null;
  const amounts = moneyIn(sentence);
  if (amounts.length !== 1) return null;
  const threshold = amounts[0]!;
  const years = lastYears(sentence);
  // Named fiscal years ("for 2021, 2022 and 2023") are not a rolling window;
  // reading them as one would compare the wrong years.
  if (years === null && NAMED_YEAR.test(sentence.replace(MONEY_CURRENCY_FIRST, "").replace(MONEY_FIGURE_FIRST, ""))) return null;
  const mode = turnoverMode(sentence);
  const companyName = evidence.companyName?.trim() || "The firm";
  const span = years ?? 1;
  const required = `${mode === "AVERAGE" ? "Average annual" : "Annual"} turnover of at least ${formatMoney(threshold)}${years ? ` ${mode === "EACH" ? "in each of" : mode === "ANY" ? "in any of" : "over"} the last ${years} year(s)` : ""}`;

  const turnoverRecords = evidence.financialRecords.filter((record) => {
    const kind = String(record.recordType ?? "").replace(/[_-]+/g, " ");
    return TURNOVER_RECORD.test(kind) && !NOT_TURNOVER_RECORD.test(kind)
      && Number.isFinite(Number(record.amount)) && Number(record.amount) > 0
      && Number.isInteger(Number(record.fiscalYear));
  });
  const otherCurrencies = [...new Set(turnoverRecords.map((r) => currencyCode(r.currency)).filter((c) => c && c !== threshold.currency))];
  // One value range per fiscal year: duplicates that disagree are kept as a
  // range, so a PASS needs the lowest and a FAIL the highest to agree.
  const byYear = new Map<number, { low: number; high: number }>();
  for (const record of turnoverRecords) {
    if (currencyCode(record.currency) !== threshold.currency) continue;
    const year = Number(record.fiscalYear);
    // Audited accounts trail the calendar by up to a year; a window one year
    // wider than the tender's never discards the latest audited year.
    if (year > referenceYear || year < referenceYear - span - 1) continue;
    const amount = Number(record.amount);
    const range = byYear.get(year);
    byYear.set(year, range ? { low: Math.min(range.low, amount), high: Math.max(range.high, amount) } : { low: amount, high: amount });
  }
  const recent = [...byYear.entries()].sort((a, b) => b[0] - a[0]).slice(0, span);
  const onFile = recent.map(([year, r]) => `FY${year} ${formatMoney({ amount: r.low, currency: threshold.currency })}${r.high !== r.low ? `–${r.high.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}`);
  const complete = recent.length >= span;
  const lows = recent.map(([, r]) => r.low);
  const highs = recent.map(([, r]) => r.high);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);

  let verdict: QualificationVerdict;
  if (recent.length === 0) verdict = "CONDITIONAL_PASS";
  else if (mode === "AVERAGE") verdict = !complete ? "CONDITIONAL_PASS" : avg(lows) >= threshold.amount ? "PASS" : avg(highs) < threshold.amount ? "FAIL" : "CONDITIONAL_PASS";
  else if (mode === "EACH") verdict = highs.some((h) => h < threshold.amount) ? "FAIL" : complete ? "PASS" : "CONDITIONAL_PASS";
  else if (mode === "ANY") verdict = lows.some((l) => l >= threshold.amount) ? "PASS" : complete ? "FAIL" : "CONDITIONAL_PASS";
  // The tender does not say whether it means each year or the average: PASS
  // only if every year clears it, FAIL only if no year does.
  else verdict = complete && lows.every((l) => l >= threshold.amount) ? "PASS" : complete && highs.every((h) => h < threshold.amount) ? "FAIL" : "CONDITIONAL_PASS";

  const averageNote = recent.length > 1 ? `; average ${formatMoney({ amount: avg(lows), currency: threshold.currency })}` : "";
  const evidenceLine = recent.length > 0
    ? `Turnover on file: ${onFile.join("; ")}${averageNote}.`
    : turnoverRecords.length > 0 && otherCurrencies.length > 0
      ? `Turnover on file is stated in ${otherCurrencies.join(", ")} only; no exchange rate is assumed.`
      : turnoverRecords.length > 0
        ? `No turnover figure on file for the last ${span} year(s).`
        : "No turnover figure is on file in the Company Vault.";
  const missingYears = complete ? "" : `audited turnover in ${threshold.currency} for ${span - recent.length} more year(s) of the last ${span}.`;
  const missing = verdict === "PASS"
    ? ""
    : verdict === "FAIL"
      ? `${required}; the figures on file fall short.`
      : missingYears || `${required} — the figures on file meet it under one reading of the tender's wording but not another.`;
  return { kind: "TURNOVER", verdict, required, evidence: evidenceLine, missing, decision: verdictText(verdict, companyName, missing) };
}

// ── Similar assignments ─────────────────────────────────────────────────────

const SIMILAR = /\b(?:similar|comparable|relevant)\b[^.;]{0,60}\b(?:assignments?|projects?|contracts?|works?|services?|engagements?)\b|\b(?:assignments?|projects?|contracts?)\b[^.;]{0,40}\bof\s+(?:a\s+)?(?:similar|comparable)\s+(?:nature|size|scope|complexity)\b/i;
const PERSONAL = /\b(?:team\s+leader|key\s+(?:experts?|staff|personnel)|experts?|cvs?|curriculum)\b/i;
const CUMULATIVE = /\b(?:total|cumulative|combined|aggregate|sum)\b/i;
const COUNT = new RegExp(String.raw`\b(?:at\s+least|minimum\s+(?:of\s+)?|a\s+minimum\s+of|not\s+less\s+than|no\s+fewer\s+than)\s*${NUMBER}${ECHO}`, "i");
const SINCE_YEAR = /\bsince\s+((?:19|20)\d{2})\b/i;

function assessSimilarAssignments(req: QualificationRequirement, text: string, evidence: QualificationEvidence, referenceYear: number): QualificationAssessment | null {
  if (String(req.requirementType ?? "").toUpperCase() === "EXPERT") return null;
  // The sentence with the most stated conditions: "Similar assignments", the
  // title, names the topic; the description states the count, value and period.
  const conditions = (s: string) => Number(moneyIn(s).length > 0) + Number(COUNT.test(s)) + Number(LAST_N_YEARS.test(s) || SINCE_YEAR.test(s));
  const sentence = sentencesOf(text)
    .filter((s) => SIMILAR.test(s) && !PERSONAL.test(s))
    .reduce<string | null>((best, s) => (best === null || conditions(s) > conditions(best) ? s : best), null);
  if (!sentence || CUMULATIVE.test(sentence)) return null;
  const amounts = moneyIn(sentence);
  if (amounts.length > 1) return null;
  const minValue = amounts[0] ?? null;
  const countMatch = COUNT.exec(sentence);
  const count = (countMatch ? toNumber(countMatch[1]) : null) ?? (Number.isInteger(req.requiredQuantity) ? Number(req.requiredQuantity) : null) ?? 1;
  const windowYears = lastYears(sentence);
  const sinceYear = SINCE_YEAR.exec(sentence);
  const earliestYear = windowYears !== null ? referenceYear - windowYears : sinceYear ? Number(sinceYear[1]) : null;
  // A bare "similar experience" with no count, value or period is a scored
  // judgement the matching already makes, not a figure to check.
  if (count < 2 && !minValue && earliestYear === null) return null;

  const companyName = evidence.companyName?.trim() || "The firm";
  const required = `${count} similar assignment(s)${minValue ? `, each of at least ${formatMoney(minValue)}` : ""}${windowYears !== null ? `, completed in the last ${windowYears} year(s)` : sinceYear ? `, completed since ${sinceYear[1]}` : ""}`;
  const checks = evidence.projects.map((project) => {
    const value = Number(project.contractValue);
    const currency = currencyCode(project.currency);
    const valueOk: boolean | null = !minValue
      ? true
      : Number.isFinite(value) && value > 0 && currency === minValue.currency ? value >= minValue.amount : null;
    const completed = yearOf(project.endDate);
    const dateOk: boolean | null = earliestYear === null ? true : completed !== null ? completed >= earliestYear : null;
    return { project, valueOk, dateOk };
  });
  const qualifying = checks.filter((c) => c.project.selected && c.valueOk === true && c.dateOk === true);
  const possible = checks.filter((c) => c.valueOk !== false && c.dateOk !== false);
  const verdict: QualificationVerdict = qualifying.length >= count ? "PASS" : possible.length < count ? "FAIL" : "CONDITIONAL_PASS";

  const selected = checks.filter((c) => c.project.selected);
  const unstated = selected.filter((c) => c.valueOk === null || c.dateOk === null);
  const evidenceLine = `${selected.length} project(s) on file matched as similar to this tender, ${qualifying.length} of them meeting every stated condition`
    + `${qualifying.length > 0 ? ` (${qualifying.slice(0, 4).map((c) => c.project.name ?? "unnamed").join("; ")})` : ""}`
    + `; ${evidence.projects.length} project(s) on file in all.`;
  const missing = verdict === "PASS"
    ? ""
    : verdict === "FAIL"
      ? `${required}; ${possible.length === 0 ? "no project on file can meet these conditions" : `only ${possible.length} project(s) on file could meet these conditions`}.`
      : `${count - qualifying.length} more similar assignment(s) meeting the conditions${unstated.length > 0 ? `, or the ${minValue ? "contract value" : ""}${minValue && earliestYear !== null ? " and " : ""}${earliestYear !== null ? "completion date" : ""} of ${unstated.slice(0, 4).map((c) => c.project.name ?? "unnamed").join("; ")}` : ""}.`;
  return { kind: "SIMILAR_ASSIGNMENTS", verdict, required, evidence: evidenceLine, missing, decision: verdictText(verdict, companyName, missing) };
}

// ── Years in business ───────────────────────────────────────────────────────

const FIRM = /\b(?:firm|company|consultant|bidder|applicant|tenderer|organi[sz]ation|contractor|supplier|enterprise)\b/i;
const FIRM_STAFF = /\b(?:team\s+leader|key\s+(?:experts?|staff|personnel)|experts?|engineers?|architects?|specialists?|managers?|surveyors?|staff|personnel|cvs?)\b/i;
const FIRM_YEARS = new RegExp(String.raw`(?:\b(?:at\s+least|minimum\s+(?:of\s+)?|a\s+minimum\s+of|not\s+less\s+than|more\s+than|over)\s*${NUMBER}${ECHO}\s*\+?|\b(\d{1,2})\s*\+)\s*years?\s+(?:of\s+)?(?:(?:general|overall|professional|proven|operational|working|relevant|specific|consulting)\s+)?(?:experience|existence|operation|track\s+record)`, "i");

function assessFirmExperience(req: QualificationRequirement, text: string, evidence: QualificationEvidence, referenceYear: number): QualificationAssessment | null {
  if (String(req.requirementType ?? "").toUpperCase() === "EXPERT") return null;
  const founded = Number(evidence.foundingYear);
  if (!Number.isInteger(founded) || founded < 1800 || founded > referenceYear) return null;
  for (const sentence of sentencesOf(text)) {
    if (!FIRM.test(sentence) || FIRM_STAFF.test(sentence)) continue;
    const match = FIRM_YEARS.exec(sentence);
    if (!match) continue;
    const years = toNumber(match[1] ?? match[2]);
    if (!years) continue;
    const after = sentence.slice((match.index ?? 0) + match[0].length);
    // "10 years of experience in urban planning" counts the firm's years in
    // that field, which may be fewer than its years in business: the founding
    // year can only rule it out, never prove it.
    const specific = /^\s*(?:in|on|with|of|as)\s+\w/i.test(after) || /\b(?:relevant|specific)\b/i.test(match[0]);
    const inBusiness = referenceYear - founded;
    const companyName = evidence.companyName?.trim() || "The firm";
    const required = `At least ${years} years of ${specific ? "experience in the stated field" : "experience"}`;
    if (inBusiness >= years && specific) return null;
    const verdict: QualificationVerdict = inBusiness >= years ? "PASS" : "FAIL";
    const missing = verdict === "PASS" ? "" : `${required}; the firm has ${inBusiness} year(s) since its founding in ${founded}.`;
    return {
      kind: "FIRM_EXPERIENCE",
      verdict,
      required,
      evidence: `Founded in ${founded} (${inBusiness} year(s)), as recorded in the Company Profile.`,
      missing,
      decision: verdictText(verdict, companyName, missing),
    };
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

const RANK: Record<QualificationVerdict, number> = { PASS: 0, CONDITIONAL_PASS: 1, FAIL: 2 };

/** The title suffix of the compliance gap a FAIL raises. */
export const QUALIFICATION_NOT_MET = "mandatory qualification not met";
export const QUALIFICATION_NOT_PROVEN = "mandatory qualification not yet proven";

/** The gap a FAIL raised: the compliance matrix prints its row NOT MET. */
export function isQualificationShortfallGap(gap: { title?: string | null }): boolean {
  return String(gap.title ?? "").endsWith(` — ${QUALIFICATION_NOT_MET}`);
}

/** Every figure-based qualification a mandatory requirement states, assessed. Empty when there is none to check. */
export function assessMandatoryQualifications(
  req: QualificationRequirement,
  evidence: QualificationEvidence,
  now: Date = new Date(),
): QualificationAssessment[] {
  if (!isMandatoryPriority(req.priority)) return [];
  const text = [req.title, req.description, req.restrictions].filter(Boolean).join(". ");
  const referenceYear = now.getUTCFullYear();
  return [
    assessTurnover(text, evidence, referenceYear),
    assessSimilarAssignments(req, text, evidence, referenceYear),
    assessFirmExperience(req, text, evidence, referenceYear),
  ].filter((a): a is QualificationAssessment => a !== null);
}

/** The deciding assessment: the worst verdict among them. */
export function decidingAssessment(assessments: readonly QualificationAssessment[]): QualificationAssessment | null {
  return [...assessments].sort((a, b) => RANK[b.verdict] - RANK[a.verdict])[0] ?? null;
}

/** FAILURE / EVIDENCE / MISSING / DECISION, for the owner. */
export function formatQualificationAssessment(assessment: QualificationAssessment): string {
  const head = assessment.verdict === "FAIL" ? "FAILURE" : assessment.verdict === "CONDITIONAL_PASS" ? "CONDITIONAL PASS" : "PASS";
  return [
    `${head}: ${assessment.required}.`,
    `EVIDENCE: ${assessment.evidence}`,
    ...(assessment.missing ? [`MISSING: ${assessment.missing}`] : []),
    `DECISION: ${assessment.decision}`,
  ].join(" ");
}
