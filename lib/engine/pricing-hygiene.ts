import type { ExportReadyDocument } from "./export-readiness";

function labelOf(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): string {
  return `${doc?.name ?? ""} ${doc?.exactFileName ?? ""} ${doc?.documentType ?? ""} ${doc?.format ?? ""}`.toLowerCase();
}

export function isCommercialOrFinancialDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(financial|commercial|pricing|price schedule|fee schedule|rate card|bank|audited|turnover)\b/i.test(labelOf(doc));
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

function isTechnicalEnvelopeDoc(doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  return /\b(technical|methodology|approach|workplan|work\s+plan|strategic|scope\s+of\s+work|implementation|execution\s+plan)\b/i.test(labelOf(doc));
}

export function containsPricingLeakage(text: string, doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): boolean {
  // Only flag pricing leakage in technical/methodology envelope documents.
  // CVs, project references, company profiles, cover letters, and declarations
  // may legitimately reference project values or fee expectations.
  if (!isTechnicalEnvelopeDoc(doc)) return false;
  if (isCommercialOrFinancialDoc(doc)) return false;

  const scanText = sentences(text).filter((s) => !isSafeNoPriceSentence(s)).join(" ");
  if (!scanText) return false;

  const currencyAmount = /(?:\b(?:EUR|USD|ETB|GBP|Birr)\s*[0-9][0-9,]*(?:\.\d+)?\b|\b[0-9][0-9,]*(?:\.\d+)?\s*(?:EUR|USD|ETB|GBP|Birr)\b|[$€£]\s*[0-9][0-9,]*(?:\.\d+)?\b)/i;
  const pricedTermNumber = /\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value)\b.{0,90}\b[0-9][0-9,]*(?:\.\d+)?\b/i;
  const numberPricedTerm = /\b[0-9][0-9,]*(?:\.\d+)?\b.{0,90}\b(total price|unit price|price schedule|fee schedule|commercial offer|financial proposal|daily rate|monthly rate|hourly rate|consultancy fee|professional fee|lump sum|contract amount|contract value)\b/i;

  return currencyAmount.test(scanText) || pricedTermNumber.test(scanText) || numberPricedTerm.test(scanText);
}
