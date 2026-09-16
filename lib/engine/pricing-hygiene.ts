import type { ExportReadyDocument } from "./export-readiness";
import { segmentSentences } from "./sentence-segmentation";
import { CURRENCY_TOKEN_ALTERNATION } from "./currency-reference";

function labelOf(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): string {
  return `${doc?.name ?? ""} ${doc?.exactFileName ?? ""} ${doc?.documentType ?? ""} ${doc?.format ?? ""}`.toLowerCase();
}

export function isCommercialOrFinancialDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(financial|commercial|pricing|price schedule|fee schedule|rate card|bank|audited|turnover)\b/i.test(labelOf(doc));
}

/**
 * Documents that are inherently financial/legal sensitive — pricing leakage
 * does not apply to them. This must match the SENSITIVE_DOC_RX in auto-finalize.
 */
export function isSensitiveFinancialOrLegalDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(audited|financial\s+statement|tax\s+clearance|vat\s+cert|vat\s+certificate|tin\s+cert|tin\s+certificate|bank\s+statement|bid\s+form|tender\s+form|declaration\s+form|undertaking|integrity\s+pact|rate\s+card|business\s+license|registration\s+cert|incorporation)\b/i.test(labelOf(doc));
}

/** Documents that are CVs or company profiles — pricing leakage does not apply to them. */
export function isCvOrProfileDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(cv|curriculum\s+vitae|resume|biography|company\s+profile|cover\s+letter|organizational\s+profile)\b/i.test(labelOf(doc));
}

/**
 * A list ordinal is not a sentence terminator.
 *
 * Fragment independence is this module's central rule, so where a fragment
 * ends decides what context an exemption may read. The split used to treat
 * every ". " as a boundary, which includes the "1. ", "2. ", "3. " of an
 * enumerated list — and a Company Vault project reference is written exactly
 * that way:
 *
 *   … Ref: … Date: 19/01/2018 E.C. Author: Tariku Abebaw (Building Officer,
 *   Gimba City Admin) 1. Construction Cost: 550,074,678.02 ETB 2. Feasibility
 *   Study, Geotechnical & New Design Cost: 1,100,000 ETB 3. Contract
 *   Administration & Construction Supervision Cost: 110,000 ETB/month
 *   2015-2018 E.C.
 *
 * Cutting at the ordinals severed each amount from the project heading, the
 * client and the years that identify it as a PAST project, so
 * isHistoricalReferenceValueSentence saw a bare "Construction Cost:
 * 550,074,678.02 ETB 2" with no historic cue and the row was reported as this
 * bid's price. Whether that happened at all depended on where the numbering
 * fell: the same two vault records passed in one generation and failed in the
 * next, and AUTO_FINALIZE could not converge on a proposal quoting no price.
 *
 * Keeping an enumerated list together is not a relaxation. The
 * currentOfferPricing veto and the priced-content guards run on the resulting
 * fragment too, so a merged fragment carrying "our fee" or "this proposal"
 * is still refused the historical exemption — it gains context, and the
 * context is judged.
 */
function sentences(text: string): string[] {
  // Judging, not rewriting: one unit per cell when a table is rendered one
  // cell per line, and terminators dropped because the fragment is matched
  // against detection patterns. The token rule (numbers, emails, URLs, dates,
  // abbreviations, list ordinals) is shared with export-gap-repair.
  return segmentSentences(text, { newlinesAreBoundaries: true, keepTerminators: false });
}

/**
 * Remove tokens whose digits identify something rather than price it.
 *
 * A procurement reference, a requirement ID, a page marker and a year all
 * carry digits and none of them is money. That distinction matters because
 * `isSafeNoPriceSentence` exempts a sentence that merely NAMES the financial
 * envelope — but only while the sentence carries no priced content, and the
 * priced-content test treats any digit as evidence.
 *
 * A two-envelope tender defeats that exemption with its own reference number.
 * The generated technical proposal must quote the submission instructions it
 * is complying with, so it contains, verbatim:
 *
 *   The email subject line must read exactly
 *   "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal".
 *
 * That names the financial envelope and contains digits, so the exemption did
 * not apply, `financial proposal` then matched as a standalone financial term,
 * and export was refused with "Possible financial/pricing language appears in
 * a technical document" — on a proposal containing no price whatsoever. Every
 * compliant two-envelope submission hit it, because quoting the required
 * subject line is exactly what compliance means here.
 *
 * Stripping is deliberately narrow. A year is kept whenever a currency word
 * sits next to it, so "ETB 2026" is still priced content; only a bare year is
 * removed. Amounts, percentages and currency symbols are never touched.
 */
function withoutIdentifiers(sentence: string): string {
  return sentence
    // Provenance markers the generator emits: "[p.2]", "(§ SECTION II ...)".
    .replace(/\[p\.\s*\d+\]/gi, " ")
    // Reference numbers: two or more slash-separated alphanumeric segments,
    // e.g. MOWE/CS/RWS/2026/0117.
    .replace(/\b[A-Za-z0-9]+(?:\/[A-Za-z0-9]+){2,}\b/g, " ")
    // Requirement and clause IDs: TRB-10, ITB-4, SEC-12.
    .replace(/\b[A-Za-z]{2,6}-\d+\b/g, " ")
    // A bare year, only when no currency token is adjacent.
    //
    // The adjacency guard is what keeps "ETB 2026" from being stripped as a
    // year when it is priced content. It listed five tokens, so "KES 2026" or
    // "NGN 2026" lost that protection and the amount was scrubbed. The tokens
    // now come from the canonical ISO 4217 reference; see the note on
    // VALUE_ONLY_FRAGMENT below for why no `i` flag may be used with it.
    .replace(BARE_YEAR_WITHOUT_ADJACENT_CURRENCY, " ")
    // Deliverable codes: D1, D7, A4. A single letter with one or two digits
    // names an item; it never states a price.
    .replace(/\b[A-Za-z]\d{1,2}\b/g, " ")
    // Schedule markers: "Week 20", "Month 3", "Day 5", "Q1". A deliverables
    // table pairs each item with WHEN it is due, and a due date is not money.
    // Without this a timeline column made every row look priced.
    .replace(/\b(?:week|month|day|quarter|phase|stage|year)s?\s*\d{1,3}\b/gi, " ")
    .replace(/\bQ[1-4]\b/g, " ");
}

function isSafeNoPriceSentence(sentence: string): boolean {
  const namesSeparateEnvelope =
    /\b(financial|commercial|price|pricing|fee)\s+(proposal|offer|envelope|submission|document|annex)\b/i.test(sentence);
  // Identifiers are stripped before the digit test, so a reference number or a
  // requirement ID cannot masquerade as a price. See withoutIdentifiers().
  const withoutIds = withoutIdentifiers(sentence);
  const carriesPricedContent =
    /[0-9%$€£]/.test(withoutIds)
    || /\b(rate|rates|itemi[sz]ed|bill of quantities|BoQ|breakdown|lump sum|total|amount|amounts|quotation|quoted|invoice|unit price|price list|costing)\b/i.test(withoutIds);
  if (namesSeparateEnvelope && !carriesPricedContent) return true;

  // "appear" / "be present" / "be included" belong beside include|contain|show.
  // The proposal generator writes its own assurance line — "Pricing, rates,
  // BOQ, and commercial terms must not appear in a technical-envelope
  // document." — which states that pricing is ABSENT. Without these verbs it
  // was read as pricing leakage, so repair-export-gaps reported the file as
  // blockedByHygiene and could not clean it (the sentence is the document's
  // own compliance statement), leaving the tender unable to reach a final
  // package. Sentences carrying an actual figure are still caught: the
  // priced-content guard above and the amount patterns below are unchanged.
  return /\b(does not|do not|must not|shall not|should not|will not)\b.{0,140}\b(include|contain|show|disclose|present|submit|appear|feature|be\s+included|be\s+present|be\s+shown|be\s+disclosed)\b.{0,180}\b(financial|commercial|price|pricing|fee|fees|rate|rates|cost|amount|offer|unit price|total price)\b/i.test(sentence)
    || /\b(pricing|price|prices|financial|commercial|fee|fees|rate|rates|cost|costs|BOQ|bill of quantities)\b.{0,180}\b(does not|do not|must not|shall not|should not|will not)\b.{0,60}\b(appear|include|contain|show|disclose|be\s+included|be\s+present)\b/i.test(sentence)
    || /\b(no price leakage|financial offer is submitted separately|commercial offer is submitted separately|no financial offer included|price[sd]?\s+separately|submitted\s+separately|as\s+a\s+separate\s+(?:financial|commercial|price))\b/i.test(sentence)
    || /\b(financial|commercial|price|pricing|fee|fees|rate|rates|cost|amount|offer|unit price|total price)\b.{0,180}\b(not included|not shown|not disclosed|excluded|separate|separately)\b/i.test(sentence);
}

/**
 * A technical proposal is also an evidence document. Comparable-project tables
 * and experience narratives legitimately carry historic contract/project values
 * (for example "Hospital Expansion — ETB 312M — completed 2023"). Those values
 * are not the price of the current bid and must not deadlock finalization.
 *
 * Keep this exemption intentionally narrow: it requires clear past/reference
 * context and rejects any sentence containing present-offer pricing language.
 */
/**
 * Words that name a CLIENT organisation rather than describe a price.
 *
 * Defined once and shared by the reference-value tests below. Two copies of a
 * vocabulary drift apart, and a pricing gate that disagrees with itself either
 * blocks a clean document or passes a leaky one.
 */
const CLIENT_ORGANISATION_RE =
  /\b(enterprise|authority|ministry|bureau|commission|administration|agency|corporation|municipality|directorate|water\s+works|city\s+council|UNICEF|UNDP|UNOPS|World\s+Bank|African\s+Development\s+Bank|GIZ|USAID)\b/i;

/**
 * How many preceding fragments may establish that a value is historical.
 *
 * Two was enough while a whole table collapsed into one fragment. Now that
 * DOCX extraction preserves cell boundaries, a comparable-projects row arrives
 * as several fragments — project, client, country, sector, value — and the
 * client that identifies the row as historical sits three or four back from
 * the amount. A window narrower than a row cannot see it.
 *
 * Widening is safe in both directions: the same window feeds the current-offer
 * veto, so more context also makes that veto harder to slip past, and only a
 * fragment holding an amount and nothing else can appeal to context at all.
 */
const REFERENCE_CONTEXT_FRAGMENTS = 5;

const BARE_YEAR_WITHOUT_ADJACENT_CURRENCY = new RegExp(
  `(?<!\\b(?:${CURRENCY_TOKEN_ALTERNATION})\\s{0,3})\\b(?:19|20)\\d{2}\\b`
  + `(?!\\s{0,3}(?:${CURRENCY_TOKEN_ALTERNATION}))`,
  "g",
);

/**
 * A fragment carrying a currency amount and essentially nothing else.
 *
 * The currency tokens come from the canonical ISO 4217 reference rather than a
 * five-token list. An unrecognised currency did not make this stricter, it made
 * it LOOSER: a fragment holding only "KES 45,000,000" failed this test, and the
 * comment above records that only a value-only fragment is barred from
 * appealing to context. So the narrow list quietly let non-ETB amounts argue
 * their way past the leakage veto.
 *
 * CURRENCY_TOKEN_ALTERNATION is case-sensitive by contract -- several ISO codes
 * are also ordinary lower-case English words -- so this pattern carries no `i`
 * flag, and the magnitude suffix spells its own cases instead.
 */
const VALUE_ONLY_FRAGMENT = new RegExp(
  `^[^A-Za-z0-9]*(?:(?:${CURRENCY_TOKEN_ALTERNATION})\\s*)?[$€£]?\\s*[0-9][0-9,]*(?:\\.\\d+)?`
  + `\\s*(?:[KkMmBb](?:[Ii][Ll][Ll][Ii][Oo][Nn])?)?\\s*(?:${CURRENCY_TOKEN_ALTERNATION})?[^A-Za-z0-9]*$`,
);

function isValueOnlyFragment(sentence: string): boolean {
  return VALUE_ONLY_FRAGMENT.test(sentence.trim());
}
/**
 * "This sentence contains a money amount" — used by the leakage guards below.
 *
 * The same regex was written inline three times with a five-token currency
 * list, so an amount in KES, NGN or TZS was not seen as money at all by a guard
 * whose whole job is to see money. Detection is the safe direction to widen: a
 * guard that misses an amount fails open.
 *
 * Two vocabularies, deliberately. CURRENCY_TOKEN_ALTERNATION is the canonical
 * ISO 4217 set, which excludes ambiguous NAMES ("dollar" could be USD, AUD,
 * CAD...) because naming the wrong currency would be a fabricated figure. That
 * exclusion is right when IDENTIFYING a currency and wrong when merely
 * DETECTING one, so the ambiguous words are kept here as extra detection terms.
 * Nothing downstream reads a currency identity from this pattern.
 *
 * No `i` flag: the alternation is case-sensitive by contract, so the English
 * words and the magnitude suffix spell their own cases.
 */
const AMBIGUOUS_MONEY_WORDS = "[Dd]ollars?|[Ee]uros?|[Pp]ounds?";
const MONEY_TOKEN = `(?:${CURRENCY_TOKEN_ALTERNATION}|${AMBIGUOUS_MONEY_WORDS})`;
const MAGNITUDE = "(?:[KkMmBb](?:[Ii][Ll][Ll][Ii][Oo][Nn])?)?";
const NUMBER = "[0-9][0-9,]*(?:\\.\\d+)?";
const CURRENCY_AMOUNT = new RegExp(
  `(?:\\b${MONEY_TOKEN}\\s*${NUMBER}${MAGNITUDE}\\b`
  + `|\\b${NUMBER}${MAGNITUDE}\\s*${MONEY_TOKEN}\\b`
  + `|[$€£]\\s*${NUMBER}${MAGNITUDE})`,
);


/**
 * Naming the engagement is not quoting a price for it.
 *
 * THE DEFECT THIS FIXES.
 * ----------------------
 * Both current-offer vetoes below tested for a bare
 * `this (proposal|bid|assignment|tender)`. So an evidence sentence explaining
 * why its past references are relevant —
 *
 *   "…presents 3 project reference(s) directly relevant to THIS ASSIGNMENT:
 *    G+6 General Hospital … Construction Value of Works ETB 550.1M"
 *
 * — was vetoed out of the comparable-projects exemption written for exactly
 * that shape, and the package was refused PRICING_LEAKAGE on 2026-09-16
 * (run 35136711233). The document quotes no price: "Construction Value of
 * Works" is the cost of a delivered asset, already named in
 * DELIVERED_WORK_VALUE_LABEL. Deleting the three words "relevant to this
 * assignment" flipped the identical sentence to clean, which is how the veto
 * was identified rather than guessed.
 *
 * WHAT DISTINGUISHES THE TWO, and it is not distance from a price word.
 * A first attempt required the engagement noun to travel WITH pricing
 * vocabulary, and tests/a-past-projects-construction-cost-is-not-this-bids-price
 * immediately caught it letting through
 *
 *   "Construction Value of Works FOR THIS PROPOSAL is ETB 550,000,000"
 *
 * — a current-offer price wearing a historical label, which is the precise
 * hazard this area exists to prevent. The real difference is GRAMMATICAL ROLE:
 * there the engagement is what the amount BELONGS TO; in the evidence sentence
 * it is merely the TARGET OF A RELEVANCE CLAIM about other, past work.
 *
 * So the veto is not narrowed at all. Every existing alternative still fires
 * exactly as before. Only the relevance construction is removed from the text
 * first, so a sentence is judged on what remains. A sentence that does both —
 * "…relevant to this assignment. The price for this proposal is ETB 4.5M" —
 * keeps its second occurrence and is still vetoed.
 */
const ENGAGEMENT_AS_RELEVANCE_TARGET = new RegExp(
  String.raw`\b(?:relevant|relevance|applicable|pertinent|suited|suitable|related|comparable|similar|analogous|transferable|aligned|responsive)\b[^.]{0,40}?\b(?:to|for|with)\s+th(?:is|e\s+present)\s+(?:proposal|bid|assignment|tender)\b`,
  "gi",
);

const BARE_ENGAGEMENT = /\bthis\s+(?:proposal|bid|assignment|tender)\b/i;

/**
 * Does this text name the CURRENT engagement other than as a relevance target?
 */
function namesCurrentEngagementAsItsOwn(text: string): boolean {
  return BARE_ENGAGEMENT.test(text.replace(ENGAGEMENT_AS_RELEVANCE_TARGET, " "));
}

function isHistoricalReferenceValueSentence(sentence: string): boolean {
  const hasCurrencyValue = CURRENCY_AMOUNT.test(sentence);
  if (!hasCurrencyValue) return false;

  const currentOfferPricing = namesCurrentEngagementAsItsOwn(sentence)
    || /\b(our\s+(?:fee|price|rate|quotation|financial|commercial)|bid\s+price|proposal\s+price|total\s+price|unit\s+price|consultancy\s+fee|professional\s+fee|daily\s+rate|monthly\s+rate|hourly\s+rate|lump\s+sum|price\s+schedule|fee\s+schedule|rate\s+card|quotation|quoted\s+(?:amount|price)|amount\s+payable|payment\s+amount|budget\s+allocated|financial\s+proposal\s+(?:includes|totals|amount)|commercial\s+proposal\s+(?:includes|totals|amount))\b/i.test(sentence);
  if (currentOfferPricing) return false;

  const strongHistoricCue = /\b(previous|prior|past|completed|delivered|managed|supervised|designed|implemented|reference\s+project|project\s+reference|relevant\s+experience|comparable\s+project|similar\s+project|portfolio|track\s+record)\b/i.test(sentence);
  const datedReference = /\b(?:19|20)\d{2}\b/.test(sentence)
    && /\b(project|assignment|client|contract|hospital|building|road|bridge|water|master\s+plan|design|supervision|consultancy)\b/i.test(sentence);
  const labelledHistoricValue = /\b(project|contract)\s+value\b/i.test(sentence)
    && /\b(client|completed|completion|duration|location|reference|experience|project)\b/i.test(sentence);

  // Labels that state, in themselves, that the amount belongs to work already
  // delivered.
  //
  // "Construction Value of Works" is the label this codebase gives the cost of
  // the ASSET a past project built — never this firm's fee and never this
  // bid's price. portfolio-card-repair and benchmark-tables both emit it under
  // that role, deliberately, precisely so a construction cost is not mistaken
  // for a consultancy contract. A project card carrying it was nevertheless
  // scored PRICING_LEAKAGE [HIGH] and failed the rubric at 75, because the
  // label was outside the historical vocabulary above: that vocabulary knew
  // "project value" and "contract value" and not the one the cards actually
  // print. The document quoted no price at all.
  //
  // This does not relax technical/financial separation. currentOfferPricing has
  // already vetoed "our fee", "this proposal", "bid price", "lump sum" and the
  // rest before this line is reached, so a sentence that frames the amount as
  // an offer cannot reach the exemption however it is labelled.
  const labelledDeliveredWorkValue = DELIVERED_WORK_VALUE_LABEL.test(sentence);

  // A comparable-projects table row names the client organisation next to the
  // value, and carries none of the prose cues above: no verb, no year, no
  // "contract value" label — just
  //
  //   Adama Town Water Supply Distribution Network — Detailed Design and
  //   Construction Supervision — Oromia Water Works Design and Supervision
  //   Enterprise Ethiopia Water and sanitation ETB 18.4M
  //
  // so the past project's value was read as this bid's price and export was
  // refused. Requiring a named client organisation keeps this narrow: bare
  // prose such as "Construction supervision: ETB 2,000,000" names no client
  // and is still caught, and any current-bid phrasing has already been vetoed
  // by currentOfferPricing above before this point is reached.
  const namesClientOrganisation = CLIENT_ORGANISATION_RE.test(sentence);

  return strongHistoricCue || datedReference || labelledHistoricValue || labelledDeliveredWorkValue || namesClientOrganisation;
}

/**
 * Reference-project prose is frequently split immediately before a labelled
 * value (for example "completed 2023 for the client. Contract value: ETB …").
 * Preserve that narrowly-scoped historical context across at most the preceding
 * two sentence fragments without weakening current-bid price detection.
 */
/**
 * Labels that describe the cost of a DELIVERED ASSET rather than anyone's
 * price. One definition, so the single-line exemption and the cell-per-line
 * continuation rule cannot drift apart.
 */
const DELIVERED_WORK_VALUE_LABEL = /\b(construction\s+value(?:\s+of\s+works)?|value\s+of\s+(?:the\s+)?works|aggregate\s+value\s+of\s+projects(?:\s+delivered)?)\b/i;

/**
 * Labels the portfolio cards actually print for a PAST project's itemised
 * costs.
 *
 * DELIVERED_WORK_VALUE_LABEL knows "construction value of works". The delivered
 * PDF states the same facts as a numbered list instead:
 *
 *   1. Construction Cost: 550,074,678.02 ETB
 *   2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB
 *   3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month  2015-2018
 *
 * Every one of those is a fact about work already delivered, and the document
 * separates the construction cost from the consultancy fee line by line —
 * exactly the distinction the standing rule requires. The vocabulary simply did
 * not know these labels.
 *
 * "cost" alone is deliberately NOT here: it is the most common word in a
 * technical proposal and would exempt almost anything.
 */
const PAST_PROJECT_COST_LABEL =
  /\b(construction\s+cost|design\s+cost|supervision\s+cost|feasibility\s+study[^.]{0,60}?cost|modification\s+design\s+cost|contract\s+administration[^.]{0,60}?cost)\b/i;

/**
 * The integer part of every amount in a fragment, as a comparable key.
 *
 * "550,074,678.02 ETB" and "ETB 550,074,678" are the same figure written twice;
 * the cents and the separators are presentation. Magnitude shorthand
 * ("ETB 550.1M") normalises too, and simply fails to match the exact form,
 * which is the safe direction: an amount only ever gains an exemption by
 * matching, never by failing to.
 */
function amountKeys(fragment: string): string[] {
  const keys: string[] = [];
  for (const match of fragment.matchAll(new RegExp(CURRENCY_AMOUNT.source, "g"))) {
    const raw = match[0];
    const numeric = raw.replace(/[^0-9.,]/g, "").replace(/,/g, "");
    if (!numeric) continue;
    const magnitude = /\b[Mm](?:illion)?\b/.test(raw) ? 1e6 : /\b[Bb](?:illion)?\b/.test(raw) ? 1e9 : 1;
    const value = Number.parseFloat(numeric);
    if (!Number.isFinite(value)) continue;
    keys.push(String(Math.trunc(value * magnitude)));
  }
  return keys;
}

/**
 * Amounts this document has ALREADY established, in its own words, as the cost
 * of work already delivered.
 *
 * THE DEFECT THIS FIXES.
 * ----------------------
 * The delivered technical proposal states every one of its 26 monetary figures
 * as a past-project fact, with named clients and dates, and separates
 * construction cost from consultancy fee on its own numbered lines. It quotes
 * no price for the current engagement anywhere. It was nevertheless refused
 * PRICING_LEAKAGE, because the text EXTRACTOR (lib/extract-text.ts) reconstructs
 * table columns imperfectly and emitted two rows in which the amount sits beside
 * unrelated cell text:
 *
 *   "workflow | patient-flow planning operate, reducing | ETB 550,074,678 —"
 *   "clinical brief | freeze at 30% gate; | ... USD 18,900,000 —"
 *
 * Those rows carry no label, no client, no year, and are neither a labelled
 * value nor a value-only cell — so both existing exemptions reject them before
 * prior context is even consulted (verified: they stay flagged with a historic
 * cue, a named client AND a delivered-work label placed directly above them).
 *
 * But ETB 550,074,678 and USD 18,900,000 are the SAME amounts the document
 * elsewhere states as "1. Construction Cost:". One figure is one fact, and a
 * gate that reads it as a past project's cost on one line and as this bid's
 * price on another is contradicting itself about the same number.
 *
 * WHY THIS DOES NOT WEAKEN THE CONTROL. An amount enters this set only from a
 * fragment that BOTH carries an explicit delivered-work or past-project cost
 * label AND survives the current-offer veto. A sentence that quotes a price for
 * the current engagement is vetoed on its own wording before the set is ever
 * consulted, so a live offer cannot borrow a past project's figure — and if a
 * document genuinely priced this bid, that price would appear in no
 * past-cost-labelled line and so would be in no set at all.
 */
function establishedPastProjectAmounts(fragments: string[]): Set<string> {
  const established = new Set<string>();
  for (const fragment of fragments) {
    const labelled = DELIVERED_WORK_VALUE_LABEL.test(fragment) || PAST_PROJECT_COST_LABEL.test(fragment);
    if (!labelled) continue;
    if (namesCurrentEngagementAsItsOwn(fragment)) continue;
    if (/\b(our\s+(?:fee|price|rate|quotation|financial|commercial)|bid\s+price|total\s+price|lump\s+sum|price\s+schedule)\b/i.test(fragment)) continue;
    for (const key of amountKeys(fragment)) established.add(key);
  }
  return established;
}

/**
 * A fragment whose every amount is one this document already established as a
 * delivered project's cost, and which says nothing about pricing the current
 * engagement, is restating a known past fact.
 */
function restatesEstablishedPastAmount(fragment: string, established: Set<string>): boolean {
  if (established.size === 0) return false;
  const keys = amountKeys(fragment);
  if (keys.length === 0) return false;
  if (!keys.every((key) => established.has(key))) return false;
  if (namesCurrentEngagementAsItsOwn(fragment)) return false;
  return !/\b(our\s+(?:fee|price|rate|quotation|financial|commercial)|bid\s+price|proposal\s+price|total\s+price|unit\s+price|consultancy\s+fee|professional\s+fee|daily\s+rate|monthly\s+rate|hourly\s+rate|lump\s+sum|price\s+schedule|fee\s+schedule|quoted\s+(?:amount|price)|amount\s+payable)\b/i.test(fragment);
}

function isHistoricalReferenceValueContinuation(sentence: string, priorContext: string): boolean {
  const hasCurrencyValue = CURRENCY_AMOUNT.test(sentence);
  if (!hasCurrencyValue) return false;
  // A labelled value ("Contract value: ETB …"), or a table cell that holds the
  // amount and nothing else. The second case appears once DOCX extraction
  // preserves cell boundaries: a comparable-projects row puts the project, the
  // client and the value in separate cells, so the value arrives with no
  // wording of its own and only its neighbours can say what it is.
  const labelled = /^\s*(?:project|contract)\s+value\b/i.test(sentence);
  if (!labelled && !isValueOnlyFragment(sentence)) return false;

  const currentOfferContext = namesCurrentEngagementAsItsOwn(priorContext)
    || /\b(our\s+(?:fee|price|rate|quotation|financial|commercial)|current\s+(?:proposal|bid|assignment|tender))\b/i.test(priorContext);
  if (currentOfferContext) return false;

  const explicitReferenceCue = /\b(previous|prior|past|reference\s+project|project\s+reference|relevant\s+experience|comparable\s+project|similar\s+project|portfolio|track\s+record)\b/i.test(priorContext);
  const datedPastProjectCue = /\b(?:19|20)\d{2}\b/.test(priorContext)
    && /\b(completed|delivered|managed|supervised|designed|implemented|project|assignment|client|contract|hospital|building|road|bridge|water|master\s+plan|design|supervision|consultancy)\b/i.test(priorContext);
  // A named client beside the value is the reference-table shape.
  const clientRowCue = CLIENT_ORGANISATION_RE.test(priorContext);
  // THE LABEL IS IN THE CELL NEXT DOOR.
  //
  // "Construction Value of Works ETB 550.1M" is already exempt on one line --
  // the label says the amount is the cost of a delivered asset, not a price.
  // DOCX extraction puts each table cell on its own line, so the same row
  // arrives as two fragments and the value stands alone as a bare amount. It
  // was then read as this bid's price, export-gap-repair recorded the document
  // blockedByHygiene, and AUTO_FINALIZE failed NON_RETRYABLE on run
  // 34771035906 -- for a row that is exempt when written as one line.
  //
  // This is consistency, not relaxation: the same vocabulary the single-line
  // exemption uses, reached only after the current-offer veto above has run,
  // so no wording of a live offer can borrow it.
  const deliveredWorkLabelCue = DELIVERED_WORK_VALUE_LABEL.test(priorContext);

  return explicitReferenceCue || datedPastProjectCue || clientRowCue || deliveredWorkLabelCue;
}

/**
 * Detects sentences that ONLY contain mixed technical-financial language (e.g.
 * "cost control methodology", "value for money"). These are candidates for
 * rewrite rather than deletion — the function still returns true so the document
 * is flagged, but callers that perform content cleaning should REWRITE, not drop.
 */
export function isMixedTechnicalFinancialSentence(sentence: string): boolean {
  const hasTechnicalContext = /\b(method|approach|implementation|control|management|delivery|quality|strategy|plan|execution|framework|assessment|review|capacity|performance|monitoring|reporting|evaluation)\b/i.test(sentence);
  const hasFinancialWord = /\b(cost|budget|value|price|fee|rate|financial|commercial)\b/i.test(sentence);
  return hasTechnicalContext && hasFinancialWord;
}

function isTechnicalEnvelopeDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(technical|methodology|approach|workplan|work\s+plan|strategic|scope\s+of\s+work|implementation|execution\s+plan)\b/i.test(labelOf(doc));
}

/**
 * A Bill of Quantities the consultant will PRODUCE is scope, not a price.
 *
 * "BOQ" appears in `standaloneFinancialTerm` below because a bill of
 * quantities in a technical envelope is usually a priced document that belongs
 * in the financial envelope. But preparing a BOQ for the client is also
 * ordinary consultancy scope, and every deliverables table in this codebase's
 * own deterministic fallback says so:
 *
 *   healthcare: … "Tender Documentation and BOQ Preparation" …
 *   building:   … "BOQ and Cost Planning" …
 *
 * On a real owner run the Technical Approach section fell back to that
 * deterministic content, and the healthcare deliverable above matched
 * `standaloneFinancialTerm` with no figure anywhere in the sentence. The
 * document was scored QUALITY_FAILED with PRICING_LEAKAGE on a proposal that
 * quoted no price at all, and AUTO_FINALIZE could not converge — the same
 * false-positive family as the compliance-statement and historical-value
 * exemptions above.
 *
 * Deliberately narrow, and it does NOT weaken technical/financial separation:
 *   - it covers ONLY the bill-of-quantities family, never "financial
 *     proposal", "rate card", "fee schedule" or the rest;
 *   - it requires explicit production/deliverable context, so "our BOQ is
 *     attached" is untouched;
 *   - it refuses any sentence carrying priced content — a currency amount, a
 *     percentage, or any figure once identifiers are stripped. A BOQ line with
 *     a number in it is still leakage.
 */
function isBoqDeliverableSentence(sentence: string): boolean {
  const namesBoq = /\b(bill\s+of\s+quantities|BoQ)\b/i.test(sentence);
  if (!namesBoq) return false;

  const producesIt =
    /\b(preparation|prepare|prepares|preparing|produce|produced|producing|production|develop|developed|developing|development|compile|compiled|compiling|documentation|deliverable|deliverables|scope\s+of\s+services|drawings|specifications|tender\s+documents?)\b/i
      .test(sentence);
  if (!producesIt) return false;

  // Same priced-content test the compliance exemption uses, so a BOQ
  // deliverable carrying an actual figure stays flagged.
  const withoutIds = withoutIdentifiers(sentence);
  const carriesPricedContent =
    /[0-9%$€£]/.test(withoutIds)
    || /\b(rate|rates|itemi[sz]ed|lump sum|total|amount|amounts|quotation|quoted|invoice|unit price|price list|costing|fee|fees)\b/i.test(withoutIds);
  return !carriesPricedContent;
}

/**
 * Remove the scaffolding the TEXT EXTRACTOR adds, which the document does not
 * say.
 *
 * lib/extract-text.ts serialises a table it recovers as
 *
 *   [Table: 3 rows]
 *   Row 1: Duration | Dates on file
 *   Row 2: Contract Value | Value detail in Appendix B (project reference)
 *
 * The row numbering is the extractor's, not the author's, and `numberPricedTerm`
 * pairs a digit with a priced term inside a 90-character window — so the "2" of
 * "Row 2" pairs with "Contract Value" and a row that states no amount at all,
 * and explicitly says the value lives in an appendix, was reported as pricing
 * leakage. The DOCX of the same proposal has no row numbering and is clean; the
 * finalized PDF, which must be re-extracted to be read, is not. One document,
 * two verdicts.
 *
 * This is the same principle `withoutIdentifiers` already applies to page
 * markers and reference numbers — digits that identify something rather than
 * price it — applied to the reader's own annotations. Cell text is untouched,
 * so an amount that really is in a table row is still read and still caught.
 */
function withoutExtractionScaffolding(text: string): string {
  return text
    .replace(/\[Table:\s*\d+\s*rows?\]/gi, " ")
    .replace(/\[Page\s*\d+\]/gi, " ")
    .replace(/(^|\n)[ \t]*Row\s+\d+\s*:[ \t]*/gi, "$1");
}

/**
 * WHY A FINDING CARRIES ITS EXCERPT
 * ---------------------------------
 * `containsPricingLeakage` answers yes/no, and every surface above it reported
 * that answer as "Possible financial/pricing language appears in a technical
 * document" with nothing quoted. On a 35-page proposal that is unactionable:
 * it cannot be told apart from a false positive, the owner has no word to
 * search for, and two AUTO_FINALIZE failures in a row were diagnosed by
 * guessing which sentence might have tripped it — the first guess was wrong.
 * The gate is fail-closed, so an unactionable message is an unactionable block.
 *
 * This is the same treatment the placeholder gate already applies (see
 * document-quality-gate.ts, "the message names the phrases it actually
 * matched"). Same trigger, same severity, same score impact; only the
 * diagnosis improves — `containsPricingLeakage` below is a thin wrapper over
 * this function and its verdict is unchanged.
 */
export type PricingLeakageFinding = {
  /** The text that produced the verdict, trimmed for display. */
  fragment: string;
  /** Which rule matched, so a false positive can be traced to its pattern. */
  rule: string;
  /**
   * True when no single fragment matches on its own and the verdict comes
   * from text joined across a fragment boundary. That difference is itself
   * the finding: it means no sentence in the document contains a price.
   */
  spansFragmentBoundary: boolean;
};

export function pricingLeakageFinding(text: string, doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): PricingLeakageFinding | null {
  if (!isTechnicalEnvelopeDoc(doc)) return null;
  if (isCommercialOrFinancialDoc(doc)) return null;
  if (isSensitiveFinancialOrLegalDoc(doc)) return null;
  if (isCvOrProfileDoc(doc)) return null;

  const textSentences = sentences(withoutExtractionScaffolding(text));
  // One pass, and the context window reads the ORIGINAL fragments.
  //
  // These were two chained filters, and the second received the array the
  // first had already thinned — so whether a value counted as historical
  // depended on which of its neighbours happened to survive exemption. That
  // is the wrong question: context is what the document says around a value,
  // not what is left after filtering. Exempting a comparable-projects row (a
  // good outcome) silently deleted the client name that the value cell in the
  // same row relied on to be recognised as historical, and the past project's
  // value was then read as this bid's price.
  //
  // The survivors are joined with a NEWLINE, never a space. The proximity
  // patterns below pair a number with a priced term through `.{0,90}` /
  // `.{0,40}` windows, and in JavaScript `.` does not match a line
  // terminator — so those windows are fragment-local by construction.
  // Joining with a space let a fragment ENDING in a number pair with a priced
  // term at the START of the next fragment, producing a "price" that exists
  // in no sentence of the document:
  //
  //   "The assignment will be delivered over 18 months."   (clean alone)
  //   "Consultancy fee terms are governed by the sealed
  //    companion envelope required by this tender."        (clean alone)
  //
  // Every fragment was individually clean, so the paragraph-level repair in
  // export-gap-repair.ts — which judges each sentence on its own — found
  // nothing it could remove, cleanDocxHygieneIssues left the bytes unchanged,
  // and export-gap-repair recorded the document as blockedByHygiene on every
  // AUTO_FINALIZE attempt. The blocker is classified NON_RETRYABLE, so the
  // tender died in a terminal AUTO_FINALIZE_NOT_CONVERGED loop while the
  // document contained no price anywhere. Reproduced against the real
  // extractor + detector + repair chain; see
  // tests/pricing-hygiene-fragment-boundary.test.ts.
  //
  // This is the same false-positive family the newline-aware
  // visibleXmlText() comment already documents (cells fused into one
  // "sentence"): a table is not a sentence, and neither are two adjacent
  // paragraphs. Fragment independence is the canonical rule; the join must
  // not quietly undo it.
  //
  // Currency pairing is NOT weakened: the currency patterns glue a number to
  // its code with `\s*`, and `\s` matches newlines, so "12,400,000" in one
  // fragment and "ETB" at the head of the next still reads as one amount.
  // Within-fragment detection is byte-for-byte unchanged, which keeps every
  // existing single-sentence leak test passing.
  // Computed from the ORIGINAL fragments, before any filtering, so what the
  // document establishes about a figure does not depend on which neighbours
  // happened to survive exemption — the same rule the context window follows.
  const established = establishedPastProjectAmounts(textSentences);
  const scanText = textSentences
    .filter((s, index) => {
      if (isSafeNoPriceSentence(s)) return false;
      if (isBoqDeliverableSentence(s)) return false;
      if (isHistoricalReferenceValueSentence(s)) return false;
      if (restatesEstablishedPastAmount(s, established)) return false;
      const priorContext = textSentences
        .slice(Math.max(0, index - REFERENCE_CONTEXT_FRAGMENTS), index)
        .join(" ");
      return !isHistoricalReferenceValueContinuation(s, priorContext);
    })
    .join("\n");
  if (!scanText) return null;

  const currencyAmount = CURRENCY_AMOUNT;
  const pricedTermNumber = /\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b.{0,90}\b[0-9][0-9,]*(?:\.\d+)?\b/i;
  const numberPricedTerm = /\b[0-9][0-9,]*(?:\.\d+)?\b.{0,90}\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b/i;
  const standaloneFinancialTerm = /\b(bill of quantities|BoQ|commercial proposal|financial proposal|rate card|price schedule|fee schedule|quotation|quoted price|lump sum price|contract price|contract fee|reimbursable\s+(?:cost|expense)|percentage.{0,5}based\s+fee|unit\s+price\s+list|price\s+breakdown|cost\s+breakdown|budget\s+breakdown|payment\s+schedule|invoice\s+schedule|commercial\s+envelope|financial\s+envelope)\b/i;
  const percentageFeeRef = /\b(fee|rate|charge|commission|pricing)\b.{0,60}\b\d+\s*%|\b\d+\s*%.{0,60}\b(fee|rate|charge|commission|pricing|cost)\b/i;
  const currencyCodeAlone = /\b(USD|ETB|EUR|GBP)\b.{0,40}\b(price|fee|rate|cost|amount|budget|payment|quotation|invoice)\b|\b(price|fee|rate|cost|amount|budget|payment|quotation|invoice)\b.{0,40}\b(USD|ETB|EUR|GBP)\b/i;

  // The verdict is unchanged: the same six patterns, tested against the same
  // joined text, in the same order. Only the RESULT is richer.
  const rules: ReadonlyArray<readonly [string, RegExp]> = [
    ["currency amount", currencyAmount],
    ["priced term followed by a number", pricedTermNumber],
    ["number followed by a priced term", numberPricedTerm],
    ["standalone financial term", standaloneFinancialTerm],
    ["percentage-based fee reference", percentageFeeRef],
    ["currency code beside a price word", currencyCodeAlone],
  ];

  const matched = rules.find(([, pattern]) => pattern.test(scanText));
  if (!matched) return null;
  const [rule, pattern] = matched;

  // Name the offender. A fragment that matches ON ITS OWN is the sentence the
  // owner has to fix, so it is quoted directly. When nothing matches alone,
  // the verdict came from text joined across a fragment boundary — the
  // false-positive family the long comment above describes — and saying so is
  // more useful than quoting a sentence that is individually clean, because it
  // tells the reader the document may contain no price at all.
  const survivors = scanText.split("\n");
  const guilty = survivors.find((fragment) => pattern.test(fragment));
  if (guilty) {
    return { fragment: displayFragment(guilty), rule, spansFragmentBoundary: false };
  }
  for (let index = 0; index + 1 < survivors.length; index += 1) {
    const pair = `${survivors[index]}\n${survivors[index + 1]}`;
    if (pattern.test(pair)) {
      return { fragment: displayFragment(pair.replace(/\n/g, " / ")), rule, spansFragmentBoundary: true };
    }
  }
  return { fragment: displayFragment(scanText.replace(/\n/g, " / ")), rule, spansFragmentBoundary: true };
}

/** Keeps a quoted excerpt short enough for a message and free of line breaks. */
function displayFragment(fragment: string): string {
  const flat = fragment.replace(/\s+/g, " ").trim();
  return flat.length > 220 ? `${flat.slice(0, 217)}...` : flat;
}

/**
 * The original boolean contract, preserved exactly. Every existing caller and
 * test keeps its behaviour; callers that want to say WHICH text tripped the
 * gate use `pricingLeakageFinding` instead.
 */
export function containsPricingLeakage(text: string, doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return pricingLeakageFinding(text, doc) !== null;
}
