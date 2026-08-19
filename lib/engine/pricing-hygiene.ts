import type { ExportReadyDocument } from "./export-readiness";

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

function sentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?:[.!?]\s+|\n+)/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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
    .replace(/(?<!\b(?:EUR|USD|ETB|GBP|Birr)\s{0,3})\b(?:19|20)\d{2}\b(?!\s{0,3}(?:EUR|USD|ETB|GBP|Birr))/gi, " ");
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

/** A fragment carrying a currency amount and essentially nothing else. */
function isValueOnlyFragment(sentence: string): boolean {
  return /^[^A-Za-z0-9]*(?:(?:EUR|USD|ETB|GBP|Birr)\s*)?[$€£]?\s*[0-9][0-9,]*(?:\.\d+)?\s*(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr)?[^A-Za-z0-9]*$/i.test(sentence.trim());
}

function isHistoricalReferenceValueSentence(sentence: string): boolean {
  const hasCurrencyValue = /(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\b|\b[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?)/i.test(sentence);
  if (!hasCurrencyValue) return false;

  const currentOfferPricing = /\b(this\s+(?:proposal|bid|assignment|tender)|our\s+(?:fee|price|rate|quotation|financial|commercial)|bid\s+price|proposal\s+price|total\s+price|unit\s+price|consultancy\s+fee|professional\s+fee|daily\s+rate|monthly\s+rate|hourly\s+rate|lump\s+sum|price\s+schedule|fee\s+schedule|rate\s+card|quotation|quoted\s+(?:amount|price)|amount\s+payable|payment\s+amount|budget\s+allocated|financial\s+proposal\s+(?:includes|totals|amount)|commercial\s+proposal\s+(?:includes|totals|amount))\b/i.test(sentence);
  if (currentOfferPricing) return false;

  const strongHistoricCue = /\b(previous|prior|past|completed|delivered|managed|supervised|designed|implemented|reference\s+project|project\s+reference|relevant\s+experience|comparable\s+project|similar\s+project|portfolio|track\s+record)\b/i.test(sentence);
  const datedReference = /\b(?:19|20)\d{2}\b/.test(sentence)
    && /\b(project|assignment|client|contract|hospital|building|road|bridge|water|master\s+plan|design|supervision|consultancy)\b/i.test(sentence);
  const labelledHistoricValue = /\b(project|contract)\s+value\b/i.test(sentence)
    && /\b(client|completed|completion|duration|location|reference|experience|project)\b/i.test(sentence);

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

  return strongHistoricCue || datedReference || labelledHistoricValue || namesClientOrganisation;
}

/**
 * Reference-project prose is frequently split immediately before a labelled
 * value (for example "completed 2023 for the client. Contract value: ETB …").
 * Preserve that narrowly-scoped historical context across at most the preceding
 * two sentence fragments without weakening current-bid price detection.
 */
function isHistoricalReferenceValueContinuation(sentence: string, priorContext: string): boolean {
  const hasCurrencyValue = /(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\b|\b[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?)/i.test(sentence);
  if (!hasCurrencyValue) return false;
  // A labelled value ("Contract value: ETB …"), or a table cell that holds the
  // amount and nothing else. The second case appears once DOCX extraction
  // preserves cell boundaries: a comparable-projects row puts the project, the
  // client and the value in separate cells, so the value arrives with no
  // wording of its own and only its neighbours can say what it is.
  const labelled = /^\s*(?:project|contract)\s+value\b/i.test(sentence);
  if (!labelled && !isValueOnlyFragment(sentence)) return false;

  const currentOfferContext = /\b(this\s+(?:proposal|bid|assignment|tender)|our\s+(?:fee|price|rate|quotation|financial|commercial)|current\s+(?:proposal|bid|assignment|tender))\b/i.test(priorContext);
  if (currentOfferContext) return false;

  const explicitReferenceCue = /\b(previous|prior|past|reference\s+project|project\s+reference|relevant\s+experience|comparable\s+project|similar\s+project|portfolio|track\s+record)\b/i.test(priorContext);
  const datedPastProjectCue = /\b(?:19|20)\d{2}\b/.test(priorContext)
    && /\b(completed|delivered|managed|supervised|designed|implemented|project|assignment|client|contract|hospital|building|road|bridge|water|master\s+plan|design|supervision|consultancy)\b/i.test(priorContext);
  // A named client beside the value is the reference-table shape.
  const clientRowCue = CLIENT_ORGANISATION_RE.test(priorContext);

  return explicitReferenceCue || datedPastProjectCue || clientRowCue;
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

export function containsPricingLeakage(text: string, doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  if (!isTechnicalEnvelopeDoc(doc)) return false;
  if (isCommercialOrFinancialDoc(doc)) return false;
  if (isSensitiveFinancialOrLegalDoc(doc)) return false;
  if (isCvOrProfileDoc(doc)) return false;

  const textSentences = sentences(text);
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
  const scanText = textSentences
    .filter((s, index) => {
      if (isSafeNoPriceSentence(s)) return false;
      if (isHistoricalReferenceValueSentence(s)) return false;
      const priorContext = textSentences
        .slice(Math.max(0, index - REFERENCE_CONTEXT_FRAGMENTS), index)
        .join(" ");
      return !isHistoricalReferenceValueContinuation(s, priorContext);
    })
    .join(" ");
  if (!scanText) return false;

  const currencyAmount = /(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\b|\b[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?)/i;
  const pricedTermNumber = /\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b.{0,90}\b[0-9][0-9,]*(?:\.\d+)?\b/i;
  const numberPricedTerm = /\b[0-9][0-9,]*(?:\.\d+)?\b.{0,90}\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b/i;
  const standaloneFinancialTerm = /\b(bill of quantities|BoQ|commercial proposal|financial proposal|rate card|price schedule|fee schedule|quotation|quoted price|lump sum price|contract price|contract fee|reimbursable\s+(?:cost|expense)|percentage.{0,5}based\s+fee|unit\s+price\s+list|price\s+breakdown|cost\s+breakdown|budget\s+breakdown|payment\s+schedule|invoice\s+schedule|commercial\s+envelope|financial\s+envelope)\b/i;
  const percentageFeeRef = /\b(fee|rate|charge|commission|pricing)\b.{0,60}\b\d+\s*%|\b\d+\s*%.{0,60}\b(fee|rate|charge|commission|pricing|cost)\b/i;
  const currencyCodeAlone = /\b(USD|ETB|EUR|GBP)\b.{0,40}\b(price|fee|rate|cost|amount|budget|payment|quotation|invoice)\b|\b(price|fee|rate|cost|amount|budget|payment|quotation|invoice)\b.{0,40}\b(USD|ETB|EUR|GBP)\b/i;

  return (
    currencyAmount.test(scanText) ||
    pricedTermNumber.test(scanText) ||
    numberPricedTerm.test(scanText) ||
    standaloneFinancialTerm.test(scanText) ||
    percentageFeeRef.test(scanText) ||
    currencyCodeAlone.test(scanText)
  );
}
