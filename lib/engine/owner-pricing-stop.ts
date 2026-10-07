/**
 * A financial proposal that waits for the owner's prices.
 *
 * missing-plan-file-generation writes a priced financial proposal from the
 * tender's pricing workbook, or — with no priced line — a CONTROL row marked
 * REPLACE_WITH_ORIGINAL, because the app never sets a price. Every gate keeps
 * refusing that row (it is not exportable), but the owner was told to "replace
 * it with the tender-issued original" or to "generate the missing documents",
 * neither of which is what they must do (2026-10-07, a feasibility-study ToR).
 * Each surface that explains the stop asks this module what the row is and
 * says the one thing that completes it.
 */

export const OWNER_PRICING_ACTION =
  "Enter the required prices in the pricing workbook or attach the completed financial proposal.";

const FINANCIAL_PROPOSAL_NAME = /financial[\s._-]+proposal|commercial[\s._-]+proposal|price[\s._-]+(?:proposal|offer)/i;

/** A file that is the tender's financial proposal (by type or by name). */
export function isFinancialProposalFile(fileName: string, documentType: string): boolean {
  return /^FINANCIAL_PROPOSAL$/i.test(documentType) || FINANCIAL_PROPOSAL_NAME.test(fileName);
}

export type PricingRowLike = {
  exactFileName?: string | null;
  name?: string | null;
  documentType?: string | null;
  reviewStatus?: string | null;
};

/** The row is a financial proposal still waiting for the owner's prices. */
export function isAwaitingOwnerPricing(row: PricingRowLike | null | undefined): boolean {
  if (!row || String(row.reviewStatus ?? "").toUpperCase() !== "REPLACE_WITH_ORIGINAL") return false;
  return isFinancialProposalFile(`${row.exactFileName ?? ""} ${row.name ?? ""}`, String(row.documentType ?? ""));
}
