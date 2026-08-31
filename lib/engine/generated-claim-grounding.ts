/**
 * Does the proposal we are about to send assert anything the sources do not?
 *
 * WHY THIS EXISTS
 * ---------------
 * The repository already grounds the INPUT side thoroughly: a requirement
 * carries a page + quote and `evidence-grounding.ts` refuses it unless that
 * quote is contained in an active tender file. Driving a tender whose analysis
 * came from a provider that had never seen it, the Build Plan stopped exactly
 * as designed with REQUIREMENT_QUOTE_NOT_IN_FILE.
 *
 * Nothing applied the same standard to the OUTPUT side. Once a real provider
 * writes the evaluator-facing depth a competitive proposal needs — "ETB 550
 * million", "350+ completed projects", "TIN 0064637886", "completed 2023" —
 * those are load-bearing factual assertions the client will rely on, and no
 * check asked whether they appear anywhere in the tender or in the reviewed
 * company evidence. Depth is precisely where fabrication risk lives: a model
 * asked for specificity will supply specificity, invented or not.
 *
 * This module answers one question and no other: for the material factual
 * tokens the delivered document asserts, is each one present in at least one
 * allowed source?
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is not a second grounding authority. Containment is decided by
 * `normalizeForContainment` from evidence-grounding.ts — the module whose own
 * comment says anything deciding whether text is grounded must compare through
 * it, "or two checks will disagree about the same requirement". This extends
 * that one rule to a surface it did not cover; it does not restate it.
 *
 * It is not a quality score, and it does not read well-formedness, tone or
 * persuasiveness. A fluent proposal full of invented figures must fail here
 * while a plain one that only cites real evidence passes.
 *
 * It is not a style rule: prose numbers that carry no factual weight ("three
 * phases", "24 hours", section numbering, percentages of a total) are not
 * claims about the world and are not checked. Over-flagging would push callers
 * to disable the check, which is worse than not having it.
 */

import { normalizeForContainment } from "./evidence-grounding";

export type GeneratedClaimKind =
  /** A currency amount: "ETB 550 million", "USD 4,250,000", "12.4M birr". */
  | "MONETARY_VALUE"
  /** A registration/licence identifier: TIN, VAT, licence or certificate number. */
  | "REGISTRATION_ID"
  /** A calendar year asserted as fact ("completed 2023", "since 2009"). */
  | "CALENDAR_YEAR"
  /** A counted track-record claim: "350+ completed projects", "116 certified". */
  | "TRACK_RECORD_COUNT";

export type GeneratedClaim = {
  kind: GeneratedClaimKind;
  /** The exact text matched in the document. */
  text: string;
  /** The comparison token looked for in the sources. */
  token: string;
  /** Surrounding sentence, for an actionable message. */
  context: string;
};

export type ClaimGroundingSource = {
  /** Where this text came from, for the caller's message ("tender", a vault doc name). */
  label: string;
  text: string | null | undefined;
};

export type ClaimGroundingResult = {
  ok: boolean;
  claims: GeneratedClaim[];
  ungrounded: GeneratedClaim[];
};

/** Sentence split that keeps the fragment boundaries a table produces. */
function sentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?:[.!?]\s+|\n+)/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const CURRENCY = "(?:ETB|USD|EUR|GBP|Birr|birr)";
const AMOUNT = "[0-9][0-9,]*(?:\\.[0-9]+)?\\s*(?:[KkMmBb]\\b|million|billion)?";

/**
 * A currency amount, in either order ("ETB 550 million" / "550 million ETB").
 * The digits are the token: a source may write the same amount with a
 * different currency placement, and it is the VALUE that must be real.
 */
const MONETARY_RE = new RegExp(`(?:${CURRENCY}\\s*${AMOUNT}|${AMOUNT}\\s*${CURRENCY})`, "g");

/**
 * TIN / VAT / licence / registration / certificate identifiers.
 *
 * Bounded to an explicit label because a bare long digit run is as likely to
 * be a phone number, a page reference or a quantity, and flagging those would
 * make the check noise rather than signal.
 */
const REGISTRATION_RE =
  /\b(?:TIN|VAT|licence|license|registration|certificate|reg\.)\b\s*(?:no\.?|number|#|:)?\s*([A-Z0-9][A-Z0-9/-]{4,})/gi;

/**
 * A year asserted about the firm's own record. Requires a verb or preposition
 * that makes it a factual assertion rather than a deadline the tender itself
 * set or an ordinary date in running text.
 */
const CALENDAR_YEAR_RE =
  /\b(?:completed|delivered|established|founded|commissioned|awarded|since|in)\s+(?:in\s+)?((?:19|20)\d{2})\b/gi;

/** "350+ completed projects", "116 certified", "2 hospitals designed". */
const TRACK_RECORD_RE =
  /\b(\d[\d,]*)\s*\+?\s*(?:completed\s+|certified\s+|delivered\s+|licensed\s+)?(?:projects?|hospitals?|clinics?|assignments?|contracts?|facilities|schemes?|buildings?)\b/gi;

function pushClaim(
  out: GeneratedClaim[],
  seen: Set<string>,
  kind: GeneratedClaimKind,
  text: string,
  token: string,
  context: string,
): void {
  const normalized = normalizeForContainment(token);
  if (!normalized) return;
  const key = `${kind}:${normalized}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind, text: text.trim(), token: normalized, context });
}

/** Digits only, so "ETB 550 million" and "550 Million ETB" compare equal. */
function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * Reject an "amount" that is really two values run together.
 *
 * Adjacent table cells lose their boundary in some extraction paths, so
 * "ETB 98,600,000" beside "1,300 Ha" can reach a detector as
 * "ETB 98,600,0001,300". Flagging that as an invented figure would be a false
 * accusation about a document that states two perfectly real numbers, and a
 * check that cries wolf gets switched off.
 *
 * A genuine grouped amount has 1-3 digits before the first comma and exactly
 * three after every comma. Anything else is fused text, not a claim.
 */
function hasWellFormedDigitGrouping(raw: string): boolean {
  const numeric = raw.match(/[0-9][0-9,]*(?:\.[0-9]+)?/)?.[0] ?? "";
  if (!numeric.includes(",")) return true;
  const [head, ...rest] = numeric.split(".")[0]!.split(",");
  if (!/^\d{1,3}$/.test(head!)) return false;
  return rest.every((group) => /^\d{3}$/.test(group));
}

/**
 * The material factual claims a delivered proposal asserts.
 *
 * Exported so a caller can report WHAT was checked, not only that something
 * failed — a bare "ungrounded claim" with no list is not actionable.
 */
export function extractMaterialClaims(markdown: string): GeneratedClaim[] {
  const claims: GeneratedClaim[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(markdown ?? "")) {
    for (const match of sentence.matchAll(MONETARY_RE)) {
      const digits = digitsOf(match[0]);
      // A bare "ETB" with no digits, or a year-like 4-digit run already covered
      // by the year rule, is not a monetary claim worth pinning.
      if (digits.length === 0) continue;
      if (!hasWellFormedDigitGrouping(match[0])) continue;
      pushClaim(claims, seen, "MONETARY_VALUE", match[0], digits, sentence);
    }
    for (const match of sentence.matchAll(REGISTRATION_RE)) {
      // An identifier contains a digit. Without this, the label alternatives
      // match ordinary prose — "drawing registers" yielded the "identifier"
      // "registers" — and every such hit is a false accusation.
      if (!/\d/.test(match[1]!)) continue;
      pushClaim(claims, seen, "REGISTRATION_ID", match[0], match[1], sentence);
    }
    for (const match of sentence.matchAll(CALENDAR_YEAR_RE)) {
      pushClaim(claims, seen, "CALENDAR_YEAR", match[0], match[1], sentence);
    }
    for (const match of sentence.matchAll(TRACK_RECORD_RE)) {
      pushClaim(claims, seen, "TRACK_RECORD_COUNT", match[0], digitsOf(match[1]), sentence);
    }
  }
  return claims;
}

/**
 * True when `token` appears in the source text.
 *
 * Digit tokens are compared against the source with its own separators
 * stripped, so a source writing "12,750,000" grounds a proposal writing
 * "12750000" and vice versa — the same value, formatted differently, is not a
 * fabrication. Non-digit tokens (identifiers) compare through the canonical
 * containment normalization.
 */
function sourceContains(token: string, sourceText: string): boolean {
  const normalizedSource = normalizeForContainment(sourceText);
  if (normalizedSource.includes(token)) return true;
  if (/^\d+$/.test(token)) {
    if (normalizedSource.replace(/[,\s.]/g, "").includes(token)) return true;
    return scaledFormsOf(token).some((form) => normalizedSource.includes(form));
  }
  return false;
}

/**
 * The scaled ways a source may legitimately write the same amount.
 *
 * A proposal writing "ETB 27,500,000,000" and evidence writing "ETB 27.5
 * Billion" state one identical fact. Comparing digit runs alone calls the
 * second unsupported, which is a false accusation against a properly
 * evidenced figure — checked against the real portfolio export, this was two
 * of the three amounts the first version flagged.
 *
 * The unit is always required: bare "27.5" appearing somewhere in a large
 * document proves nothing, so only "27.5 billion" / "27.5b" counts.
 */
function scaledFormsOf(digits: string): string[] {
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return [];
  const units: Array<[number, string[]]> = [
    [1_000_000_000, ["billion", "b", "bn"]],
    [1_000_000, ["million", "m"]],
    [1_000, ["thousand", "k"]],
  ];
  const forms: string[] = [];
  for (const [factor, names] of units) {
    if (value < factor) continue;
    const scaled = value / factor;
    // Only forms a person would actually write: 27.5, not 27.4999999.
    const rendered = Number.isInteger(scaled)
      ? String(scaled)
      : (Math.round(scaled * 100) / 100).toString();
    if (!/^\d+(?:\.\d{1,2})?$/.test(rendered)) continue;
    for (const name of names) {
      forms.push(`${rendered} ${name}`, `${rendered}${name}`);
    }
  }
  return forms;
}

/**
 * Check every material claim in a generated proposal against the allowed
 * sources.
 *
 * `sources` must be ONLY what the proposal is permitted to rely on: the
 * controlling tender text and reviewed company evidence. A benchmark or
 * example document must never be passed in — grounding a claim against a
 * sample proposal is how a sample's facts become the submission's facts.
 */
export function checkGeneratedClaimGrounding(
  markdown: string,
  sources: ReadonlyArray<ClaimGroundingSource>,
): ClaimGroundingResult {
  const claims = extractMaterialClaims(markdown);
  const texts = sources.map((s) => s.text ?? "").filter((t) => t.trim().length > 0);
  const ungrounded = claims.filter((claim) => !texts.some((text) => sourceContains(claim.token, text)));
  return { ok: ungrounded.length === 0, claims, ungrounded };
}

/** One line per ungrounded claim, naming the value and where it was asserted. */
export function formatUngroundedClaims(result: ClaimGroundingResult): string[] {
  return result.ungrounded.map(
    (claim) => `${claim.kind}: "${claim.text}" is not present in any allowed source — asserted in: "${claim.context.slice(0, 160)}"`,
  );
}
