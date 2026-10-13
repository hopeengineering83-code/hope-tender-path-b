/**
 * One calculation for a priced line and the offer it adds up to.
 *
 * The pricing panel, the approval that writes the workbook, and the financial
 * proposal read from it all use these functions, so the amount the owner sees
 * on an edited line is the amount approved and the amount the client reads.
 * The panel used to show the estimate's original amount beside an edited rate
 * or quantity while the approval wrote the edited one.
 *
 * Client-safe: no I/O and no document library.
 */

export type PricedLine = { category: string; label: string; quantity: number; unit: string; rate: number; total?: number | null };
export type WorkbookSettings = { currency: string; validityDays: number; vatPercent: number; contingencyPct: number; withholdingPct: number };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** quantity × rate, to the cent. */
export function pricedLineAmount(quantity: number, rate: number): number {
  return round2((Number(quantity) || 0) * (Number(rate) || 0));
}

/** A line's amount: its stored total when set, else quantity × rate. */
export function lineAmount(line: PricedLine): number {
  const stored = Number(line.total ?? 0);
  return stored > 0 ? round2(stored) : pricedLineAmount(line.quantity, line.rate);
}

/**
 * The offer price and what the client withholds from it.
 *
 * Withholding tax is deducted by the client from each payment; it is not a
 * discount on the offer. The pricing page used to subtract it from the "grand
 * total", so the price a bidder read — and would have quoted — was below the
 * contract sum it was offering.
 */
export function computeWorkbookTotals(lines: readonly PricedLine[], s: Pick<WorkbookSettings, "vatPercent" | "contingencyPct" | "withholdingPct">) {
  const subtotal = round2(lines.reduce((sum, l) => sum + lineAmount(l), 0));
  const contingency = round2(subtotal * (s.contingencyPct || 0) / 100);
  const beforeTax = round2(subtotal + contingency);
  const vat = round2(beforeTax * (s.vatPercent || 0) / 100);
  const offerTotal = round2(beforeTax + vat);
  const withholding = round2(beforeTax * (s.withholdingPct || 0) / 100);
  return { subtotal, contingency, beforeTax, vat, offerTotal, withholding, netAfterWithholding: round2(offerTotal - withholding) };
}

/**
 * What the owner typed into a rate or quantity box: nothing (keep the
 * estimate's value), a valid positive number, or an invalid entry that must be
 * corrected — never silently replaced by the estimate's value.
 */
export function ownerEdit(raw: string | number | null | undefined, max: number): { kind: "NONE" } | { kind: "VALUE"; value: number } | { kind: "INVALID" } {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return { kind: "NONE" };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 && n <= max ? { kind: "VALUE", value: n } : { kind: "INVALID" };
}

export const MAX_PRICED_RATE = 1_000_000_000_000;
export const MAX_PRICED_QUANTITY = 1_000_000_000;

/**
 * A line as the owner has edited it, by the same rules the approval applies:
 * a typed value replaces the estimate's, an invalid one is flagged (never
 * swapped for the estimate's), and a lump sum stays one item. The amount is
 * the one the workbook and the financial proposal will carry.
 */
export function editedLine(
  line: { quantity: number; unit: string; rate: number | null },
  rateRaw: string | number | null | undefined,
  quantityRaw: string | number | null | undefined,
): { rate: number | null; quantity: number; amount: number | null; invalid: boolean } {
  const rateEdit = ownerEdit(rateRaw, MAX_PRICED_RATE);
  const quantityEdit = ownerEdit(quantityRaw, MAX_PRICED_QUANTITY);
  const lumpSum = line.unit === "LUMP_SUM";
  const rate = rateEdit.kind === "VALUE" ? rateEdit.value : line.rate;
  const quantity = !lumpSum && quantityEdit.kind === "VALUE" ? quantityEdit.value : line.quantity;
  const invalid = rateEdit.kind === "INVALID" || quantityEdit.kind === "INVALID" || (lumpSum && quantityEdit.kind === "VALUE" && quantityEdit.value !== line.quantity);
  return { rate, quantity, invalid, amount: !invalid && rate !== null && rate > 0 ? pricedLineAmount(quantity, rate) : null };
}
