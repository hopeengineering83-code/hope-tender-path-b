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
 * A submission INSTRUCTION is not pricing leakage.
 *
 * The strongest example is the tender's mandated email subject line, which
 * routinely contains the words "Financial Proposal" — e.g.
 *   The email subject line must read exactly
 *   "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal".
 * That sentence quotes a packaging rule the bidder must obey; it discloses no
 * price. The standalone-term rule matched "financial proposal" inside it and
 * blocked the technical proposal from export, with no wording that could
 * satisfy both the tender (which mandates that exact subject) and the checker.
 *
 * Only sentences that carry no amount at all are treated as instructions, so a
 * genuine figure smuggled into a sentence about the subject line still trips
 * the detector.
 */
function isSubmissionInstructionSentence(sentence: string): boolean {
  const isInstruction = /\b(subject\s+line|email\s+subject|subject\s+must|file\s+name|named\s+and\s+ordered|envelope\s+label|separate\s+(?:sealed\s+)?(?:file|envelope)s?)\b/i.test(sentence);
  if (!isInstruction) return false;
  // Any real monetary amount disqualifies the exemption.
  return !/(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9]|[0-9][0-9,]*(?:\.\d+)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9])/i.test(sentence);
}

function isSafeNoPriceSentence(sentence: string): boolean {
  if (isSubmissionInstructionSentence(sentence)) return true;
  // "appear"/"be present"/"be included" belong beside include/contain/show:
  // the generator's own assurance line — "Pricing, rates, BOQ, and commercial
  // terms must not appear in a technical-envelope document." — is a statement
  // that pricing is ABSENT, yet without these verbs it was read as pricing
  // leakage and blocked the very document it was asserting was clean.
  return /\b(does not|do not|must not|shall not|should not|will not)\b.{0,140}\b(include|contain|show|disclose|present|submit|appear|feature|be\s+included|be\s+present|be\s+shown|be\s+disclosed)\b.{0,180}\b(financial|commercial|price|pricing|fee|fees|rate|rates|cost|amount|offer|unit price|total price)\b/i.test(sentence)
    || /\b(pricing|price|prices|financial|commercial|fee|fees|rate|rates|cost|costs|BOQ|bill of quantities)\b.{0,180}\b(does not|do not|must not|shall not|should not|will not)\b.{0,60}\b(appear|include|contain|show|disclose|be\s+included|be\s+present)\b/i.test(sentence)
    || /\b(no price leakage|financial offer is submitted separately|commercial offer is submitted separately|no financial offer included|price[sd]?\s+separately|submitted\s+separately|as\s+a\s+separate\s+(?:financial|commercial|price))\b/i.test(sentence)
    || /\b(financial|commercial|price|pricing|fee|fees|rate|rates|cost|amount|offer|unit price|total price)\b.{0,180}\b(not included|not shown|not disclosed|excluded|separate|separately)\b/i.test(sentence);
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
  // Only flag pricing leakage in technical/methodology envelope documents.
  // CVs, project references, company profiles, cover letters, and declarations
  // may legitimately reference project values or fee expectations.
  if (!isTechnicalEnvelopeDoc(doc)) return false;
  if (isCommercialOrFinancialDoc(doc)) return false;
  if (isSensitiveFinancialOrLegalDoc(doc)) return false;
  if (isCvOrProfileDoc(doc)) return false;

  const scanText = sentences(text).filter((s) => !isSafeNoPriceSentence(s)).join(" ");
  if (!scanText) return false;

  // Currency amounts: explicit symbols or named currency codes followed by numbers.
  // Covers USD, ETB, EUR, GBP, Birr, dollar, euro, £, $, € with or without amounts.
  const currencyAmount = /(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\b|\b[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?)/i;

  // Explicit priced terms directly paired with a number
  const pricedTermNumber = /\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b.{0,90}\b[0-9][0-9,]*(?:\.\d+)?\b/i;
  const numberPricedTerm = /\b[0-9][0-9,]*(?:\.\d+)?\b.{0,90}\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|quoted price|invoice amount|payment amount|VAT amount|reimbursable amount)\b/i;

  // Standalone high-signal financial/commercial terms — appearing alone in a
  // technical document is a strong leakage signal regardless of accompanying numbers.
  // Note: "bill of quantities", "BoQ", "quotation", "rate card", "commercial proposal",
  // "financial proposal", "price schedule", "fee schedule" are all high-signal.
  const standaloneFinancialTerm = /\b(bill of quantities|BoQ|commercial proposal|financial proposal|rate card|price schedule|fee schedule|quotation|quoted price|lump sum price|contract price|contract fee|reimbursable\s+(?:cost|expense)|percentage.{0,5}based\s+fee|unit\s+price\s+list|price\s+breakdown|cost\s+breakdown|budget\s+breakdown|payment\s+schedule|invoice\s+schedule|commercial\s+envelope|financial\s+envelope)\b/i;

  // Percentage-based fee references (e.g. "5% of contract value", "fee of 10%")
  const percentageFeeRef = /\b(fee|rate|charge|commission|pricing)\b.{0,60}\b\d+\s*%|\b\d+\s*%.{0,60}\b(fee|rate|charge|commission|pricing|cost)\b/i;

  // Standalone currency symbols or codes with no number context are low-signal
  // but explicit currency code references with price context are still leakage.
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
