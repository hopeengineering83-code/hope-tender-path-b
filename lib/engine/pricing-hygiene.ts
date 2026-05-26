import type { ExportReadyDocument } from "./export-readiness";

function labelOf(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): string {
  return `${doc?.name ?? ""} ${doc?.exactFileName ?? ""} ${doc?.documentType ?? ""} ${doc?.format ?? ""}`.toLowerCase();
}

export function isCommercialOrFinancialDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(financial|commercial|pricing|price schedule|fee schedule|rate card|bank|audited|turnover)\b/i.test(labelOf(doc));
}

/** Documents that are inherently financial/legal sensitive — pricing leakage does not apply to them. */
export function isSensitiveFinancialOrLegalDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(audited|financial\s+statement|tax\s+clearance|vat\s+cert|tin\s+cert|bank\s+statement|bid\s+form|tender\s+form|declaration\s+form|undertaking|integrity\s+pact|rate\s+card)\b/i.test(labelOf(doc));
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

function isSafeNoPriceSentence(sentence: string): boolean {
  return /\b(does not|do not|must not|shall not|should not|will not)\b.{0,140}\b(include|contain|show|disclose|present|submit)\b.{0,180}\b(financial|commercial|price|pricing|fee|fees|rate|rates|cost|amount|offer|unit price|total price)\b/i.test(sentence)
    || /\b(no price leakage|financial offer is submitted separately|commercial offer is submitted separately|no financial offer included)\b/i.test(sentence)
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

  // Currency amounts: explicit symbols or named currency codes followed by numbers
  const currencyAmount = /(?:\b(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\b|\b[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?\s*(?:EUR|USD|ETB|GBP|Birr|dollar|euro)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?(?:[KkMmBb](?:illion)?)?)/i;

  // Explicit priced terms directly paired with a number
  const pricedTermNumber = /\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|invoice amount|payment amount|VAT amount)\b.{0,90}\b[0-9][0-9,]*(?:\.\d+)?\b/i;
  const numberPricedTerm = /\b[0-9][0-9,]*(?:\.\d+)?\b.{0,90}\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|commercial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value|bill of quantities|BoQ|quoted amount|invoice amount|payment amount|VAT amount)\b/i;

  // Standalone high-signal financial/commercial terms without safe context
  // "bill of quantities", "BoQ", "quotation", "rate card", "commercial proposal" alone are enough
  const standaloneFinancialTerm = /\b(bill of quantities|commercial proposal|financial proposal|rate card|price schedule|fee schedule|quotation|quoted price|lump sum price|contract price|contract fee|reimbursable\s+(?:cost|expense)|percentage.based\s+fee)\b/i;

  // Percentage-based fee references (e.g. "5% of contract value", "fee of 10%")
  const percentageFeeRef = /\b(fee|rate|charge|commission)\b.{0,60}\b\d+\s*%|\b\d+\s*%.{0,60}\b(fee|rate|charge|commission)\b/i;

  return (
    currencyAmount.test(scanText) ||
    pricedTermNumber.test(scanText) ||
    numberPricedTerm.test(scanText) ||
    standaloneFinancialTerm.test(scanText) ||
    percentageFeeRef.test(scanText)
  );
}
