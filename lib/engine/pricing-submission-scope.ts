/**
 * Does this tender ask the bidder for a price? — the one answer every pricing
 * surface reads.
 *
 * A financial proposal, price schedule or priced bill of quantities exists
 * only when the tender requires the bidder to submit pricing. Financial
 * QUALIFICATION evidence is a different thing: audited statements, turnover,
 * bank references, a client budget, past contract values, payment terms and a
 * scoring weight all talk about money without asking for a price. Before this
 * module the Pricing Intelligence panel offered an estimate and asked for the
 * owner's rates on every tender — including a technical-only one whose Build
 * Plan held nothing but the Technical Proposal (Pharo, Preview 2026-10-10) —
 * and a planner fed by keywords could plan a "Financial Proposal" from the
 * word "budget".
 *
 * The confirmed Build Plan is the authority once it exists: pricing is needed
 * exactly when it plans a price submission. Before that, the tender's own
 * words decide, through readFinancialProposalRequirement(): a prohibition rules
 * pricing out, an obligation rules it in, and silence asks nothing.
 */

import { readFinancialProposalRequirement } from "./source-driven-tender-text-parser";

/** A file that IS the bidder's price submission (by type or by name). */
const PRICE_SUBMISSION_TYPE = /^(?:FINANCIAL_PROPOSAL|FINANCIAL|PRICE_SCHEDULE|BOQ|BILL_OF_QUANTITIES|QUOTATION|COMMERCIAL_PROPOSAL)$/i;
const PRICE_SUBMISSION_NAME =
  /\b(?:financial|commercial|price|cost|fee)[\s._-]+(?:proposal|offer|bid|quotation|schedule|breakdown)s?\b|\bpriced\b|\bquotation\b|\bbill[\s._-]+of[\s._-]+quantities\b|\bboq\b|\brate[\s._-]+card\b|\bschedule[\s._-]+of[\s._-]+(?:prices|rates)\b|\bremuneration[\s._-]+schedule\b|\breimbursable[\s._-]+(?:expenses?[\s._-]+)?schedule\b/i;
/** Financial qualification evidence named like a financial file. */
const QUALIFICATION_EVIDENCE =
  /\baudited\b|\bfinancial[\s._-]+(?:statements?|capacity|standing|situation|position|resources|records?|reports?|soundness|strength)\b|\bturnover\b|\bbalance[\s._-]+sheets?\b|\bbank[\s._-]+(?:statements?|references?)\b|\bannual[\s._-]+reports?\b|\bline[\s._-]+of[\s._-]+credit\b/i;

export function isPriceSubmissionFile(fileName: string | null | undefined, documentType?: string | null): boolean {
  const name = String(fileName ?? "");
  if (QUALIFICATION_EVIDENCE.test(name) && !/\b(?:financial|commercial|price)[\s._-]+(?:proposal|offer|bid)\b/i.test(name)) return false;
  return PRICE_SUBMISSION_TYPE.test(String(documentType ?? "").trim()) || PRICE_SUBMISSION_NAME.test(name);
}

export type PricingScope = {
  /** The tender asks the bidder for pricing in this submission. */
  required: boolean;
  /** Where the answer came from. */
  source: "CONFIRMED_BUILD_PLAN" | "TENDER_SOURCE";
  /** The planned price submission files (empty when not required). */
  files: string[];
  /** One sentence the owner can read. */
  basis: string;
};

/**
 * Pricing scope from the confirmed Build Plan when there is one, otherwise from
 * the tender's own text. Pure.
 */
export function resolvePricingScope(input: {
  confirmedPlanItems: Array<{ exactFileName?: string | null; documentType?: string | null }> | null;
  tenderText: string;
}): PricingScope {
  if (input.confirmedPlanItems) {
    const files = input.confirmedPlanItems
      .filter((item) => isPriceSubmissionFile(item.exactFileName, item.documentType))
      .map((item) => String(item.exactFileName ?? ""))
      .filter(Boolean);
    return files.length > 0
      ? { required: true, source: "CONFIRMED_BUILD_PLAN", files, basis: `The tender requires a price submission: the confirmed Build Plan includes ${files.map((f) => `"${f}"`).join(", ")}.` }
      : { required: false, source: "CONFIRMED_BUILD_PLAN", files: [], basis: "Not required by this tender: the confirmed Build Plan contains no financial proposal or price schedule, so no price is prepared or requested." };
  }
  const state = readFinancialProposalRequirement(input.tenderText);
  if (state === true) {
    return { required: true, source: "TENDER_SOURCE", files: [], basis: "The tender asks the bidder to submit pricing." };
  }
  return {
    required: false,
    source: "TENDER_SOURCE",
    files: [],
    basis: state === false
      ? "Not required by this tender: it rules out a financial proposal for this submission, so no price is prepared or requested."
      : "Not required by this tender: it does not ask the bidder for prices, so no price is prepared or requested.",
  };
}

/**
 * The scope for one tender: its confirmed Build Plan when there is one,
 * otherwise its own source text and requirement rows. The source text is read
 * only when no plan answers the question. Read-only.
 */
export async function loadPricingScope(tenderId: string, userId: string, db: any): Promise<PricingScope | null> {
  const owned = await db.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
  if (!owned) return null;
  const plan = await db.buildPlan?.findFirst?.({
    where: { tenderId, status: "CONFIRMED", tender: { userId } },
    orderBy: { updatedAt: "desc" },
    select: { itemsJson: true },
  }).catch(() => null);
  if (plan?.itemsJson) {
    try {
      const parsed = JSON.parse(plan.itemsJson);
      if (Array.isArray(parsed) && parsed.length > 0) return resolvePricingScope({ confirmedPlanItems: parsed, tenderText: "" });
    } catch {
      // An unreadable plan answers nothing; the tender's own words decide.
    }
  }
  const tender = await db.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      exactFileNaming: true,
      files: { where: { deletedAt: null }, select: { extractedText: true } },
      requirements: { select: { title: true, description: true, restrictions: true, sourceExactQuote: true } },
    },
  });
  const text = [
    String(tender?.exactFileNaming ?? ""),
    ...((tender?.files ?? []) as Array<{ extractedText: string | null }>).map((f) => f.extractedText ?? ""),
    ...((tender?.requirements ?? []) as Array<{ title: string; description: string | null; restrictions: string | null; sourceExactQuote: string | null }>)
      .map((r) => [r.title, r.description, r.restrictions, r.sourceExactQuote].filter(Boolean).join(". ")),
  ].join("\n");
  return resolvePricingScope({ confirmedPlanItems: null, tenderText: text });
}
