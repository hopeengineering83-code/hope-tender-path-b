/**
 * The owner's pricing rate card: sourced, dated rates stored once per firm and
 * read by the estimator for every tender. Each entry passes validateBenchmark,
 * so an untraceable figure never enters a bid.
 *
 * The table arrives with migration 20261007120000_pricing_benchmark_rate_card.
 * Until a database has it, reads return the shipped public benchmarks alone and
 * writes answer RATE_CARD_UNAVAILABLE instead of failing the estimate.
 */

import { prisma as defaultPrisma } from "../prisma";
import { SEED_BENCHMARKS, validateBenchmark, type PricingBenchmark } from "./pricing-benchmarks";

function tableMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2010";
}

function toBenchmark(row: any): PricingBenchmark {
  return {
    id: row.id, origin: "OWNER", market: row.market, category: row.category, serviceKey: row.serviceKey, label: row.label,
    seniority: row.seniority ?? null, unit: row.unit, currency: row.currency, low: row.low, median: row.median, high: row.high,
    rateBasis: row.rateBasis === "COST" ? "COST" : "FEE", effectiveDate: row.effectiveDate, source: row.source,
    sourceUrl: row.sourceUrl ?? null, sourceType: row.sourceType, confidence: row.confidence, notes: row.notes ?? null,
    lastVerified: row.lastVerified,
  };
}

export type RateCard = { available: boolean; owner: PricingBenchmark[]; seed: readonly PricingBenchmark[] };

export async function loadRateCard(userId: string, db: any = defaultPrisma): Promise<RateCard> {
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } }).catch(() => null);
  if (!company) return { available: true, owner: [], seed: SEED_BENCHMARKS };
  try {
    const rows = await db.pricingBenchmark.findMany({ where: { companyId: company.id }, orderBy: [{ category: "asc" }, { label: "asc" }], take: 1000 });
    return { available: true, owner: rows.map(toBenchmark), seed: SEED_BENCHMARKS };
  } catch (error) {
    if (tableMissing(error)) return { available: false, owner: [], seed: SEED_BENCHMARKS };
    throw error;
  }
}

/** Every benchmark the estimator may use: the owner's rate card first in rank, then the public figures. */
export async function loadBenchmarks(userId: string, db: any = defaultPrisma): Promise<PricingBenchmark[]> {
  const card = await loadRateCard(userId, db);
  return [...card.owner, ...card.seed];
}

export type RateCardWrite =
  | { ok: true; added: PricingBenchmark[]; rejected: Array<{ index: number; error: string }> }
  | { ok: false; status: number; code: string; error: string; rejected?: Array<{ index: number; error: string }> };

/**
 * Add entries. All-or-nothing: if any entry fails validation, none is written
 * and every failure is listed, so a half-imported rate card never prices a bid.
 */
export async function addRateCardEntries(userId: string, entries: unknown[], db: any = defaultPrisma): Promise<RateCardWrite> {
  if (entries.length === 0) return { ok: false, status: 400, code: "NO_ENTRIES", error: "No rate-card entries were sent." };
  if (entries.length > 500) return { ok: false, status: 400, code: "TOO_MANY_ENTRIES", error: "At most 500 entries per import." };
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false, status: 404, code: "COMPANY_NOT_FOUND", error: "Set up the company profile first." };
  const rejected: Array<{ index: number; error: string }> = [];
  const valid: Array<NonNullable<ReturnType<typeof validateBenchmark> & { ok: true }>["value"]> = [];
  entries.forEach((raw, index) => {
    const v = raw && typeof raw === "object" && !Array.isArray(raw) ? validateBenchmark(raw as Record<string, unknown>) : { ok: false as const, error: "entry must be an object" };
    if (v.ok) valid.push(v.value);
    else rejected.push({ index, error: v.error });
  });
  if (rejected.length > 0) return { ok: false, status: 422, code: "INVALID_ENTRIES", error: `${rejected.length} entr${rejected.length === 1 ? "y is" : "ies are"} invalid; nothing was saved.`, rejected };
  try {
    const added = await db.$transaction(valid.map((v) => db.pricingBenchmark.create({ data: { ...v, companyId: company.id, createdById: userId } })));
    return { ok: true, added: added.map(toBenchmark), rejected: [] };
  } catch (error) {
    if (tableMissing(error)) return { ok: false, status: 503, code: "RATE_CARD_UNAVAILABLE", error: "The rate card needs the latest database migration; the estimator still uses the public benchmarks." };
    throw error;
  }
}

/** Remove one entry; returns what was removed so the audit trail can say. */
export async function deleteRateCardEntry(userId: string, id: string, db: any = defaultPrisma): Promise<{ ok: boolean; status: number; removed?: PricingBenchmark }> {
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false, status: 404 };
  try {
    const row = await db.pricingBenchmark.findFirst({ where: { id, companyId: company.id } });
    if (!row) return { ok: false, status: 404 };
    const result = await db.pricingBenchmark.deleteMany({ where: { id, companyId: company.id } });
    return result.count > 0 ? { ok: true, status: 200, removed: toBenchmark(row) } : { ok: false, status: 404 };
  } catch (error) {
    if (tableMissing(error)) return { ok: false, status: 503 };
    throw error;
  }
}

export type RateCardUpdate =
  | { ok: true; before: PricingBenchmark; after: PricingBenchmark }
  | { ok: false; status: number; code: string; error: string };

/**
 * Change one entry: the merged entry passes the same validator as an import,
 * so an edit can no more drop the source or date than an import can. The
 * caller records before and after in the audit trail.
 */
export async function updateRateCardEntry(userId: string, id: string, changes: Record<string, unknown>, db: any = defaultPrisma): Promise<RateCardUpdate> {
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false, status: 404, code: "COMPANY_NOT_FOUND", error: "Set up the company profile first." };
  try {
    const row = await db.pricingBenchmark.findFirst({ where: { id, companyId: company.id } });
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND", error: "Rate-card entry not found." };
    const before = toBenchmark(row);
    const editable = ["label", "serviceKey", "seniority", "unit", "currency", "market", "low", "median", "high", "rateBasis", "effectiveDate", "source", "sourceUrl", "sourceType", "confidence", "notes", "lastVerified"];
    const merged: Record<string, unknown> = { ...before };
    for (const key of editable) if (key in changes) merged[key] = changes[key];
    // A changed rate with no new spread becomes a single figure, rather than
    // a new median sitting inside the old rate's low/high.
    if ("median" in changes && !("low" in changes) && !("high" in changes)) {
      merged.low = changes.median;
      merged.high = changes.median;
    }
    const v = validateBenchmark(merged);
    if (!v.ok) return { ok: false, status: 422, code: "INVALID_ENTRY", error: v.error };
    const updated = await db.pricingBenchmark.update({ where: { id: row.id }, data: v.value });
    return { ok: true, before, after: toBenchmark(updated) };
  } catch (error) {
    if (tableMissing(error)) return { ok: false, status: 503, code: "RATE_CARD_UNAVAILABLE", error: "Rate card unavailable until the database migration runs." };
    throw error;
  }
}

export type OwnerRateEntry = {
  category: PricingBenchmark["category"];
  serviceKey: string;
  seniority: PricingBenchmark["seniority"];
  label: string;
  unit: string;
  currency: string;
  market: string;
  rate: number;
  source: string;
};

/**
 * File rates the owner entered at approval. One entry per slot (market,
 * category, role/service, seniority, unit, currency): a newer rate for the
 * same slot replaces the older one rather than piling up beside it, so the
 * card always holds the owner's latest word. Tolerates a database without the
 * table: the approval itself never depends on this.
 */
export async function saveOwnerRates(userId: string, entries: readonly OwnerRateEntry[], db: any = defaultPrisma, now = new Date()): Promise<{ saved: PricingBenchmark[]; unavailable: boolean }> {
  if (entries.length === 0) return { saved: [], unavailable: false };
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } }).catch(() => null);
  if (!company) return { saved: [], unavailable: false };
  const today = now.toISOString().slice(0, 10);
  const saved: PricingBenchmark[] = [];
  try {
    for (const e of entries) {
      const v = validateBenchmark({
        category: e.category, serviceKey: e.serviceKey, seniority: e.seniority ?? "", label: e.label, unit: e.unit, currency: e.currency,
        market: e.market, median: e.rate, low: e.rate, high: e.rate, rateBasis: "FEE", source: e.source, sourceType: "OWNER_RATE_CARD",
        confidence: "HIGH", effectiveDate: today, lastVerified: today,
      });
      if (!v.ok) continue;
      const slot = { companyId: company.id, market: v.value.market, category: v.value.category, serviceKey: v.value.serviceKey, seniority: v.value.seniority ?? null, unit: v.value.unit, currency: v.value.currency };
      const existing = await db.pricingBenchmark.findFirst({ where: slot, orderBy: { updatedAt: "desc" }, select: { id: true } });
      const row = existing
        ? await db.pricingBenchmark.update({ where: { id: existing.id }, data: v.value })
        : await db.pricingBenchmark.create({ data: { ...v.value, companyId: company.id, createdById: userId } });
      saved.push(toBenchmark(row));
    }
    return { saved, unavailable: false };
  } catch (error) {
    if (tableMissing(error)) return { saved, unavailable: true };
    throw error;
  }
}
