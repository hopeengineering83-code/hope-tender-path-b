import type { EvaluatorMatrixInput } from "./proposal-evaluator-matrix";
import { buildTenderFormStrategy } from "./tender-form-strategy";
import { statesFinancialSeparation } from "./financial-separation-rule";
import { containsPricingLeakage } from "./pricing-hygiene";

const TECHNICAL_ENVELOPE = { name: "Technical Proposal", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" } as const;

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
  // Same predicate the submission-plan classifier uses to decide the rule is a
  // rule and not a deliverable. One definition: a phrasing that stops a phantom
  // file being planned must also arm the guard that enforces the rule, or the
  // app drops the constraint entirely while believing it handled it.
  return strategy.isTwoEnvelope || statesFinancialSeparation(joined);
}

function isAllowedControlLine(line: string): boolean {
  return /no\s+price|price[-\s]?free|price[-\s]?leakage|commercial\s+controls?|financial\s+envelope|financial\/commercial\s+envelope|technical\s+proposal\s+must\s+remain|confirm\s+no|where\s+the\s+tender\s+explicitly\s+requests|commercial\s+content\s+controls|financial\s+(?:proposal|offer)\s+(?:is\s+)?(?:submitted|provided|delivered)\s+separately|(?:separate|separately)\s+(?:submitted|provided|delivered)?\s*financial\s+(?:proposal|offer)/i.test(line);
}

function containsCommercialAmount(line: string): boolean {
  const value = clean(line);
  if (!value || isAllowedControlLine(value)) return false;
  const currencyAmount = /(?:ETB|USD|EUR|GBP|AED|SAR|KES|UGX|TZS|ZAR|NGN|\$|€|£)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:ETB|USD|EUR|GBP|AED|SAR|KES|UGX|TZS|ZAR|NGN)/i.test(value);
  // The priced terms carry word boundaries on both sides. Without them "rate"
  // matched inside "St(rate)gy", and because a heading like "C.7 Risk Register
  // and Mitigation Strategy" also supplies a digit, this guard silently deleted
  // it from every generated proposal — the Risk Register's tables were left
  // sitting under the previous sub-section with nothing to say they were a
  // different one. The same unanchored match reaches "corpo(rate)",
  // "accu(rate)", "sepa(rate)", "gene(rate)", "ope(rate)" and "mode(rate)",
  // all ordinary words in a methodology beside an ordinary number.
  const pricedTermWithNumber = /\b(?:fee|fees|price|pricing|priced|quotation|quote|quoted|rate|rates|unit\s+rate|amount|grand\s+total|subtotal|discount|commercial\s+offer|financial\s+offer|boq)\b\D{0,40}\d[\d,]*(?:\.\d+)?/i.test(value);
  const numberWithPricedTerm = /\d[\d,]*(?:\.\d+)?\D{0,40}\b(?:fee|fees|price|pricing|priced|quotation|quote|quoted|rate|rates|unit\s+rate|amount|grand\s+total|subtotal|discount|commercial\s+offer|financial\s+offer|boq)\b/i.test(value);
  return currencyAmount || pricedTermWithNumber || numberWithPricedTerm;
}

function tableRowAsRead(row: string): string {
  return row.split("|").map((cell) => cell.trim()).filter(Boolean).join(", ");
}

function containsCommercialCommitment(line: string): boolean {
  const value = clean(line);
  if (!value || isAllowedControlLine(value)) return false;
  return /(?:our|the)\s+\b(?:fee|price|rate|quotation|quote|commercial\s+offer|financial\s+offer)\b\s+(?:is|shall\s+be|will\s+be)|we\s+quote\b|we\s+offer\s+(?:a\s+)?\b(?:fee|price|rate)\b/i.test(value);
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
    .filter((line) => {
      if (containsCommercialCommitment(line)) return false;
      // A table row is judged the way the export gate reads it, cell by cell
      // in its row. Read as one line, the row number beside "BOQ" in a QA
      // checklist, and a past project's labelled construction value in the
      // team-mapping and client-reference tables, all looked like a price:
      // on 2026-09-27 A.4 and B.1 reached the client as headers with no rows,
      // and the QA checklist skipped row 4, in a document the gate scored 100.
      if (/^\s*\|/.test(line)) return !containsPricingLeakage(tableRowAsRead(line), TECHNICAL_ENVELOPE);
      return !containsCommercialAmount(line);
    })
    .join("\n")
    .trim();
}
