// Financial separation: a RULE about the submission, never a deliverable.
//
// PROBLEM
// ───────
// The live tender's confirmed Build Plan required a file called
// "Financial Proposal Omission.docx". No such document exists in the tender.
// The tender says the financial proposal must be OMITTED from the technical
// envelope. The plan classifier read the requirement title, saw the words
// "financial proposal", and invented a deliverable from a prohibition. Every
// downstream gate then blocked on a missing document that must never be
// generated, so the package could not converge.
//
// THE DISTINCTION
// ───────────────
// A requirement that says the financial proposal must be omitted, excluded,
// separated, sent in its own envelope, or that the submission is technical-only,
// is a SUBMISSION / ENVELOPE CONSTRAINT. It is satisfied by the shape of the
// package — no financial content in the technical envelope, the right envelope
// structure — not by producing a file whose title restates the prohibition.
//
// ONE PREDICATE, TWO CONSUMERS
// ────────────────────────────
// Both halves of the rule now read this module:
//
//   submission-plan-classifier.ts  — decides the requirement is NOT a planned
//                                    file, so no phantom deliverable is created.
//   proposal-price-leakage-guard.ts — decides to ENFORCE technical/price
//                                    separation on the generated narrative.
//
// They previously carried separate, differently-written phrasing lists, so a
// phrasing could invent a phantom file while failing to arm the guard that
// actually enforces the rule — and vice versa. "technical proposal only" armed
// the guard but not the classifier; "Financial Proposal Omission" armed
// neither.
//
// The rule is not weakened by moving it: what used to be answered by generating
// a document is now answered by verifying the package.

/** Lower-case and normalise the punctuation that splits these phrases. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that mark the row as a real document the bidder hands over, even though
 * its title contains financial terms. A "Financial Proposal Form", a
 * "Schedule of Prices" or a "Bill of Quantities" is a deliverable the tender
 * issues and the bidder completes — never a separation rule.
 */
const DELIVERABLE_QUALIFIER =
  /\b(?:form|template|format|annex|appendix|schedule\s+of\s+(?:prices|rates)|bill\s+of\s+quantities|boq)\b/;

/** The financial artefact the rule is about. */
const FINANCIAL_DELIVERABLE =
  /\bfinancial\s+(?:proposal|offer|bid|quotation)\b|\bprice\s+(?:schedule|proposal|offer)\b|\bpricing\b|\bprices?\b/;

/**
 * Absence or separation language. "omission" is here because the live tender
 * used exactly that noun and every pattern in the old list wanted the verb
 * "omitted".
 */
const ABSENCE_OR_SEPARATION =
  /\b(?:omission|omitted|omit|exclusion|excluded|exclude|separation|separated|separately|separate|non[-\s]?submission|waiver|waived|prohibited|forbidden|not\s+(?:required|requested|applicable|submitted|included))\b/;

/**
 * Phrasings that state the rule outright. These are checked FIRST, before the
 * deliverable qualifier, because a tender may phrase an envelope rule using a
 * word like "envelope" or "format" that would otherwise read as a deliverable.
 */
const EXPLICIT_RULE_PHRASES: RegExp[] = [
  /\btechnical\s+(?:proposal\s+|submission\s+|offer\s+)?only\b/,
  /\bonly\s+the\s+technical\s+(?:proposal|submission|offer)\b/,
  /\bno\s+financial\s+(?:proposal|offer)\b/,
  /\btwo[-\s]envelopes?\b/,
  /\bseparate\s+envelopes?\b/,
  /\bsealed\s+envelopes?\b/,
  /\bfinancial\s+proposal\s+exclusion\b/,
  /\bdo\s+not\s+include\s+(?:price|financial)/,
  /\b(?:do\s+not|must\s+not|shall\s+not)\s+(?:generate|submit|include)\s+(?:a\s+)?financial\s+(?:proposal|offer)\b/,
  /\bwithout\s+(?:a\s+)?(?:financial\s+(?:proposal|offer)|prices?)\b/,
  /\bprice[-\s]?free\b/,
];

/**
 * True when the text states a financial/technical separation or no-financial
 * rule — something the submission must OBEY, not something it must CONTAIN.
 */
export function statesFinancialSeparation(value: string | null | undefined): boolean {
  const text = normalise(value ?? "");
  if (!text.trim()) return false;
  if (EXPLICIT_RULE_PHRASES.some((pattern) => pattern.test(text))) return true;
  // A row naming a form, template, annex or priced schedule is a deliverable.
  if (DELIVERABLE_QUALIFIER.test(text)) return false;
  return FINANCIAL_DELIVERABLE.test(text) && ABSENCE_OR_SEPARATION.test(text);
}
