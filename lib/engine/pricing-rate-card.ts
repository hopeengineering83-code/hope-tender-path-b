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

export async function deleteRateCardEntry(userId: string, id: string, db: any = defaultPrisma): Promise<{ ok: boolean; status: number }> {
  const company = await db.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false, status: 404 };
  try {
    const result = await db.pricingBenchmark.deleteMany({ where: { id, companyId: company.id } });
    return result.count > 0 ? { ok: true, status: 200 } : { ok: false, status: 404 };
  } catch (error) {
    if (tableMissing(error)) return { ok: false, status: 503 };
    throw error;
  }
}
