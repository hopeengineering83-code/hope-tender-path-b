/**
 * The owner's Approve / Adjust Price control.
 *
 * The estimate is recomputed here, server-side, from the same evidence the
 * owner was shown; the request only names a scenario and any rates or
 * quantities the owner adjusted. Approval refuses while any line still has no
 * rate, so nothing unpriced or invented reaches the financial proposal.
 *
 * Approval writes the scenario into the tender's pricing workbook (each line
 * keeps its basis, source date, confidence and assumptions in its notes),
 * records the approved estimate in the audit trail, returns an app-written
 * financial proposal to PLANNED so it is rebuilt from the approved prices, and
 * resumes AUTO_FINALIZE: workbook → financial proposal → arithmetic and tax
 * validation → financial envelope.
 */

import { prisma as defaultPrisma } from "../prisma";
import { logAction } from "../audit";
import { resumeAutoFinalizeAfterOwnerInput } from "../ai-jobs/auto-finalize-continuation-job";
import { loadPricingEstimate } from "./pricing-intelligence-loader";
import { approvedLineNotes, rateCardSlotFor, type PricingEstimate, type PricingScenarioId } from "./pricing-intelligence";
import { saveOwnerRates, type OwnerRateEntry } from "./pricing-rate-card";
import { computeWorkbookTotals } from "./financial-proposal";
import { isFinancialProposalFile } from "./owner-pricing-stop";

export type PricingApprovalRequest = {
  scenario: PricingScenarioId;
  /** Owner adjustments keyed by estimate line key. */
  rates?: Record<string, number>;
  quantities?: Record<string, number>;
  /** Lines the owner removes from the offer. */
  exclude?: string[];
  /**
   * File the rates the owner entered for lines no evidence priced in the rate
   * card, so the same line on a later tender is priced without asking again.
   */
  saveToRateCard?: boolean;
};

export type PricingApprovalResult =
  | { ok: true; scenario: PricingScenarioId; offerTotal: number; currency: string; lineCount: number; finalize: string; estimate: PricingEstimate; rateCard: { saved: number; unavailable: boolean } }
  | { ok: false; status: number; code: string; error: string; unpriced?: Array<{ key: string; label: string }> };

const MAX_RATE = 1_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000;
const APP_WRITTEN_FINANCIAL = /^(?:Priced financial proposal for|Owner pricing required for)/;

function positive(value: unknown, max: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

export async function approvePricingEstimate(
  args: { tenderId: string; userId: string; actorLabel: string; request: PricingApprovalRequest },
  db: any = defaultPrisma,
): Promise<PricingApprovalResult> {
  const { tenderId, userId, request } = args;
  if (!["AGGRESSIVE", "BALANCED", "CONSERVATIVE"].includes(request.scenario)) {
    return { ok: false, status: 400, code: "INVALID_SCENARIO", error: "scenario must be AGGRESSIVE, BALANCED or CONSERVATIVE" };
  }
  const estimate = await loadPricingEstimate(tenderId, userId, db);
  if (!estimate) return { ok: false, status: 404, code: "TENDER_NOT_FOUND", error: "Tender not found" };
  const scenario = estimate.scenarios.find((s) => s.id === request.scenario)!;
  const exclude = new Set(request.exclude ?? []);

  const lines = scenario.lines
    .filter((l) => !exclude.has(l.key))
    .map((l) => {
      const rateOverride = request.rates ? positive(request.rates[l.key], MAX_RATE) : null;
      // A lump sum is one item; only its amount (the rate) can be adjusted.
      const quantityOverride = request.quantities && l.unit !== "LUMP_SUM" ? positive(request.quantities[l.key], MAX_QUANTITY) : null;
      const rate = rateOverride ?? l.rate;
      const quantity = quantityOverride ?? l.quantity;
      const adjusted = rateOverride !== null || quantityOverride !== null;
      return {
        line: l,
        rate,
        quantity,
        notes: adjusted
          ? `${approvedLineNotes(l, scenario.id)} Adjusted by the owner at approval${rateOverride !== null ? ` (rate ${rateOverride})` : ""}${quantityOverride !== null ? ` (quantity ${quantityOverride})` : ""}.`.slice(0, 2000)
          : approvedLineNotes(l, scenario.id),
      };
    });
  const unpriced = lines.filter((l) => l.rate === null || !(l.rate > 0));
  if (unpriced.length > 0) {
    return {
      ok: false, status: 422, code: "PRICING_LINES_UNPRICED",
      error: `${unpriced.length} line(s) have no defensible rate. Enter a rate for each (or remove it) before approving.`,
      unpriced: unpriced.map((l) => ({ key: l.line.key, label: l.line.label })),
    };
  }
  if (lines.length === 0) {
    return { ok: false, status: 422, code: "PRICING_NO_LINES", error: "An approved price needs at least one line." };
  }

  const settings = {
    currency: estimate.currency,
    vatPercent: estimate.vatPercent,
    withholdingPct: estimate.withholdingPct,
    validityDays: estimate.validityDays,
    contingencyPct: scenario.contingencyPct,
  };
  const approvedAt = new Date();
  await db.$transaction(async (tx: any) => {
    const workbook = await tx.pricingWorkbook.upsert({
      where: { tenderId },
      update: { ...settings, scenario: scenario.id, notes: `Approved ${scenario.label} estimate on ${approvedAt.toISOString().slice(0, 10)} by ${args.actorLabel}.` },
      create: { tenderId, ...settings, scenario: scenario.id, notes: `Approved ${scenario.label} estimate on ${approvedAt.toISOString().slice(0, 10)} by ${args.actorLabel}.` },
      select: { id: true },
    });
    await tx.costLine.deleteMany({ where: { workbookId: workbook.id } });
    for (const l of lines) {
      await tx.costLine.create({
        data: {
          workbookId: workbook.id,
          category: l.line.category,
          label: l.line.label.slice(0, 200),
          quantity: l.quantity,
          unit: l.line.unit,
          rate: l.rate as number,
          total: Math.round((l.quantity * (l.rate as number) + Number.EPSILON) * 100) / 100,
          expertId: l.line.expertId ?? null,
          notes: l.notes,
        },
      });
    }
    // An app-written financial proposal (awaiting prices, or priced from an
    // earlier approval) is rebuilt from these prices. An original the owner
    // attached is theirs and is left alone.
    const rows = await tx.generatedDocument.findMany({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
      select: { id: true, name: true, exactFileName: true, documentType: true, contentSummary: true, reviewedBy: true },
    });
    const rebuild = rows.filter((r: any) =>
      isFinancialProposalFile(String(r.exactFileName ?? r.name ?? ""), String(r.documentType ?? ""))
      && !r.reviewedBy
      && APP_WRITTEN_FINANCIAL.test(String(r.contentSummary ?? "")));
    if (rebuild.length > 0) {
      await tx.generatedDocument.updateMany({
        where: { id: { in: rebuild.map((r: any) => r.id) } },
        data: { generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING" },
      });
    }
  });

  const totals = computeWorkbookTotals(lines.map((l) => ({ category: l.line.category, label: l.line.label, quantity: l.quantity, unit: l.line.unit, rate: l.rate as number })), settings);

  // Rates the owner typed for lines the evidence could not price. A rate that
  // only adjusts an evidence-priced line is already kept as an approved rate.
  const tenderTitle = await db.tender.findFirst({ where: { id: tenderId, userId }, select: { title: true } }).then((t: { title: string } | null) => t?.title ?? "a tender").catch(() => "a tender");
  const ownerRates: OwnerRateEntry[] = request.saveToRateCard
    ? lines.flatMap((l) => {
        if (l.line.rate !== null || !(Number(request.rates?.[l.line.key]) > 0)) return [];
        const slot = rateCardSlotFor(l.line);
        if (!slot) return [];
        return [{
          ...slot, unit: l.line.unit, currency: estimate.currency, market: estimate.market ?? "ET", rate: l.rate as number,
          source: `Rate entered by ${args.actorLabel} when approving the price for "${tenderTitle.slice(0, 160)}"`,
        }];
      })
    : [];
  const rateCard = await saveOwnerRates(userId, ownerRates, db, approvedAt);
  await logAction({
    userId,
    action: "PRICING_ESTIMATE_APPROVED",
    entityType: "Tender",
    entityId: tenderId,
    description: `${args.actorLabel} approved the ${scenario.label} price: ${estimate.currency} ${totals.offerTotal.toFixed(2)}.`,
    metadata: {
      scenario: scenario.id,
      offerTotal: totals.offerTotal,
      currency: estimate.currency,
      adjustedLines: lines.filter((l) => l.rate !== l.line.rate || l.quantity !== l.line.quantity).map((l) => l.line.key),
      excludedLines: Array.from(exclude),
      estimate: { status: estimate.status, generatedAt: estimate.generatedAt, evidenceUsed: estimate.evidenceUsed, lowConfidence: estimate.lowConfidence },
      rateCardSaved: rateCard.saved.map((b) => ({ id: b.id, category: b.category, serviceKey: b.serviceKey, seniority: b.seniority ?? null, unit: b.unit, currency: b.currency, market: b.market, median: b.median })),
    },
  }, db);
  if (rateCard.saved.length > 0) {
    await logAction({
      userId,
      action: "PRICING_RATE_CARD_UPDATED",
      entityType: "PricingBenchmark",
      description: `Filed ${rateCard.saved.length} rate(s) entered at price approval in the rate card`,
      metadata: { tenderId, saved: rateCard.saved.map((b) => ({ id: b.id, category: b.category, label: b.label, seniority: b.seniority ?? null, unit: b.unit, currency: b.currency, market: b.market, median: b.median, source: b.source })) },
    }, db);
  }

  const resumed = await resumeAutoFinalizeAfterOwnerInput({ tenderId, userId, reason: "PRICING_ESTIMATE_APPROVED" }, db);
  return { ok: true, scenario: scenario.id, offerTotal: totals.offerTotal, currency: estimate.currency, lineCount: lines.length, finalize: resumed.state, estimate, rateCard: { saved: rateCard.saved.length, unavailable: rateCard.unavailable } };
}
