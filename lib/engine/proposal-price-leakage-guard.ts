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
  return /no\s+price|price[-\s]?free|price[-\s]?leakage|commercial\s+controls?|financial\s+envelope|financial\/commercial\s+envelope|technical\s+proposal\s+must\s+remain|confirm\s+no|where\s+the\s+tender\s+explicitly\s+requests|commercial\s+content\s+controls/i.test(line);
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

export function enforceTechnicalPriceSeparation(markdown: string, input: EvaluatorMatrixInput): string {
  if (!shouldEnforceTechnicalPriceSeparation(input)) return markdown;

  const removed: string[] = [];
  const keptLines = markdown.split("\n").filter((line) => {
    const shouldRemove = containsCommercialAmount(line) || containsCommercialCommitment(line);
    if (shouldRemove) removed.push(clean(line).slice(0, 180));
    return !shouldRemove;
  });

  if (removed.length === 0) {
    return `${keptLines.join("\n").trim()}\n\n## Technical Price-Separation Guard\nNo commercial amounts, rates, priced BOQ totals, fee quotations or financial-offer commitments were detected in this technical/two-envelope output.`;
  }

  return [
    keptLines.join("\n").trim(),
    "## Technical Price-Separation Guard",
    `${removed.length} commercial/pricing line(s) were removed from this technical/two-envelope output. Put those details only in the financial/commercial envelope or quotation form, as applicable.`,
    "Removed content is intentionally not reproduced here to avoid leaking commercial values into the technical proposal.",
  ].join("\n\n");
}
