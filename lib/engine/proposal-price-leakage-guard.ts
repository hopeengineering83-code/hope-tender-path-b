import type { EvaluatorMatrixInput } from "./proposal-evaluator-matrix";
import { buildTenderFormStrategy } from "./tender-form-strategy";

function clean(value?: string | null): string {
  return (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function shouldEnforceTechnicalPriceSeparation(input: EvaluatorMatrixInput): boolean {
  const joined = clean([input.tenderTitle, input.clientName, ...input.requirements, ...input.complianceLines].join("\n"));
  const strategy = buildTenderFormStrategy({
    tenderTitle: input.tenderTitle,
    requirements: input.requirements,
    submissionLines: input.complianceLines,
    extraText: input.clientName,
  });
  return strategy.isTwoEnvelope
    || /technical\s+(?:proposal|offer)\s+only|no\s+financial|financial\s+(?:proposal|offer)\s+(?:separate|separately)|separate\s+financial|without\s+prices?|price[-\s]?free/i.test(joined);
}

function isAllowedControlLine(line: string): boolean {
  return /no\s+price|price[-\s]?free|price[-\s]?leakage|commercial\s+controls?|financial\s+envelope|financial\/commercial\s+envelope|technical\s+proposal\s+must\s+remain|confirm\s+no|where\s+the\s+tender\s+explicitly\s+requests|commercial\s+content\s+controls|financial\s+(?:proposal|offer)\s+(?:is\s+)?(?:submitted|provided|delivered)\s+separately|(?:separate|separately)\s+(?:submitted|provided|delivered)?\s*financial\s+(?:proposal|offer)/i.test(line);
}

function containsCommercialAmount(line: string): boolean {
  const value = clean(line);
  if (!value || isAllowedControlLine(value)) return false;
  const currencyAmount = /(?:ETB|USD|EUR|GBP|AED|SAR|KES|UGX|TZS|ZAR|NGN|\$|€|£)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:ETB|USD|EUR|GBP|AED|SAR|KES|UGX|TZS|ZAR|NGN)/i.test(value);
  const pricedTermWithNumber = /(?:fee|fees|price|pricing|priced|quotation|quote|quoted|rate|rates|unit\s+rate|amount|grand\s+total|subtotal|discount|commercial\s+offer|financial\s+offer|boq)\D{0,40}\d[\d,]*(?:\.\d+)?/i.test(value);
  const numberWithPricedTerm = /\d[\d,]*(?:\.\d+)?\D{0,40}(?:fee|fees|price|pricing|priced|quotation|quote|quoted|rate|rates|unit\s+rate|amount|grand\s+total|subtotal|discount|commercial\s+offer|financial\s+offer|boq)/i.test(value);
  return currencyAmount || pricedTermWithNumber || numberWithPricedTerm;
}

function containsCommercialCommitment(line: string): boolean {
  const value = clean(line);
  if (!value || isAllowedControlLine(value)) return false;
  return /(?:our|the)\s+(?:fee|price|rate|quotation|quote|commercial\s+offer|financial\s+offer)\s+(?:is|shall\s+be|will\s+be)|we\s+quote|we\s+offer\s+(?:a\s+)?(?:fee|price|rate)/i.test(value);
}

/**
 * Remove client-facing commercial leakage from a technical/two-envelope
 * proposal. This function is deliberately a PURE SANITISER: it must never
 * append internal QA narration to the proposal it is cleaning.
 *
 * Previously the guard removed unsafe lines and then appended a visible
 * "Technical Price-Separation Guard" section containing phrases such as
 * "priced BOQ", "fee quotations", "financial/commercial envelope" and
 * "quotation form". The canonical technical-envelope validator correctly
 * classified those high-signal terms as pricing leakage, so the cleaner could
 * re-contaminate its own output and leave AUTO_FINALIZE permanently blocked.
 *
 * Safe tender-facing control wording such as "the financial offer is submitted
 * separately" must also survive. It describes envelope separation and contains
 * no commercial amount or commitment; deleting it can erase a genuine tender
 * compliance statement and made the sanitizer disagree with canonical hygiene.
 *
 * Audit/telemetry about removed lines belongs in logs or structured diagnostics,
 * never in the client deliverable. The canonical validator remains unchanged.
 */
export function enforceTechnicalPriceSeparation(markdown: string, input: EvaluatorMatrixInput): string {
  if (!shouldEnforceTechnicalPriceSeparation(input)) return markdown;

  return markdown
    .split("\n")
    .filter((line) => !containsCommercialAmount(line) && !containsCommercialCommitment(line))
    .join("\n")
    .trim();
}
