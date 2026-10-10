// The priced financial proposal, from the owner's pricing workbook.
//
// A tender that asks for a financial proposal used to receive a narrative
// shell — the tender's requirement list, the key personnel and the project
// references, and not one price. The workbook the owner fills in on the
// pricing page (PricingWorkbook / CostLine) was never read by any document.
//
// Prices are the owner's business decision: nothing here invents a rate. With
// no priced line the file is not written at all; the caller leaves the row
// awaiting the owner. With priced lines, every figure in the document comes
// from the workbook, and the arithmetic is the single computation the pricing
// page also shows (computeWorkbookTotals).

import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, AlignmentType, HeadingLevel } from "docx";

export type PricedLine = { category: string; label: string; quantity: number; unit: string; rate: number; total?: number | null };
export type WorkbookSettings = { currency: string; validityDays: number; vatPercent: number; contingencyPct: number; withholdingPct: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A line's amount: its stored total when set, else quantity × rate. */
export function lineAmount(line: PricedLine): number {
  const stored = Number(line.total ?? 0);
  return round2(stored > 0 ? stored : (Number(line.quantity) || 0) * (Number(line.rate) || 0));
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

export { isFinancialProposalFile } from "./owner-pricing-stop";

export function pricedLines(lines: readonly PricedLine[]): PricedLine[] {
  return lines.filter((l) => lineAmount(l) > 0);
}

// The client reads words, not the workbook's stored codes.
const CATEGORY_LABEL: Record<string, string> = {
  PERSONNEL: "Personnel", REIMBURSABLE: "Reimbursable expenses", SUBCONSULTANT: "Subcontracted services",
  EQUIPMENT: "Equipment and vehicles", TRAVEL: "Travel and transport", OTHER: "Other",
};
const UNIT_LABEL: Record<string, string> = { DAY: "Day", MONTH: "Month", LUMP_SUM: "Lump sum", EACH: "Each", KM: "km" };
const categoryLabel = (code: string) => CATEGORY_LABEL[String(code).toUpperCase()] ?? String(code).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const unitLabel = (code: string) => UNIT_LABEL[String(code).toUpperCase()] ?? String(code).replace(/_/g, " ").toLowerCase();

const money = (n: number, currency: string) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (t: string, bold = false) => new Paragraph({ children: [new TextRun({ text: t, bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
const cell = (t: string, opts: { bold?: boolean; right?: boolean } = {}) => new TableCell({
  children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: t, bold: opts.bold, size: 20, font: "Calibri" })] })],
});

/** The priced financial proposal as DOCX (base64). Every figure is the workbook's. */
export async function buildFinancialProposalDocx(opts: {
  title: string;
  tenderTitle: string;
  reference?: string | null;
  clientName?: string | null;
  companyName: string;
  settings: WorkbookSettings;
  lines: readonly PricedLine[];
}): Promise<string> {
  const lines = pricedLines(opts.lines);
  const t = computeWorkbookTotals(lines, opts.settings);
  const cur = opts.settings.currency || "ETB";
  const header = new TableRow({ tableHeader: true, children: ["#", "Item", "Category", "Quantity", "Unit", "Rate", "Amount"].map((h) => cell(h, { bold: true })) });
  const rows = lines.map((l, i) => new TableRow({ children: [
    cell(String(i + 1)), cell(l.label), cell(categoryLabel(l.category)), cell(String(l.quantity), { right: true }), cell(unitLabel(l.unit)), cell(money(Number(l.rate) || 0, cur), { right: true }), cell(money(lineAmount(l), cur), { right: true }),
  ] }));
  const summary: Array<[string, number]> = [["Subtotal", t.subtotal]];
  if (t.contingency > 0) summary.push([`Contingency (${opts.settings.contingencyPct}%)`, t.contingency]);
  if (t.vat > 0) summary.push([`VAT (${opts.settings.vatPercent}%)`, t.vat]);
  summary.push(["Total offer price", t.offerTotal]);
  const summaryRows = summary.map(([label, value], i) => new TableRow({ children: [
    new TableCell({ columnSpan: 6, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: label, bold: i === summary.length - 1, size: 20, font: "Calibri" })] })] }),
    cell(money(value, cur), { right: true, bold: i === summary.length - 1 }),
  ] }));
  const children = [
    new Paragraph({ text: opts.title, heading: HeadingLevel.TITLE }),
    text(`Tender: ${opts.tenderTitle}${opts.reference ? ` (${opts.reference})` : ""}`),
    ...(opts.clientName ? [text(`To: ${opts.clientName}`)] : []),
    text(`Bidder: ${opts.companyName}`),
    new Paragraph({ text: "Financial Offer", heading: HeadingLevel.HEADING_1 }),
    text(`${opts.companyName} offers to carry out the services described in the tender for the total sum of ${money(t.offerTotal, cur)}${t.vat > 0 ? `, inclusive of VAT at ${opts.settings.vatPercent}%` : ""}. This offer is valid for ${opts.settings.validityDays} days from the submission deadline.`),
    ...(t.withholding > 0 ? [text(`Withholding tax at ${opts.settings.withholdingPct}% (${money(t.withholding, cur)}) is deducted by the client from payments in accordance with the applicable tax law; it is not deducted from the offer price.`)] : []),
    new Paragraph({ text: "Price Schedule", heading: HeadingLevel.HEADING_1 }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows, ...summaryRows] }),
    new Paragraph({ text: "Authorised Signature", heading: HeadingLevel.HEADING_1 }),
    text(`For and on behalf of ${opts.companyName}:`),
    // Blank cells to sign in, not underscore rules, which the document
    // validator rightly reads as unfilled placeholders.
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: ["Name", "Title", "Signature", "Stamp", "Date"].map((label) => new TableRow({ children: [cell(label, { bold: true }), cell(" ")] })) }),
  ];
  // File properties name the bidder; the library's default author is "Un-named".
  const buffer = await Packer.toBuffer(new Document({ creator: opts.companyName, lastModifiedBy: opts.companyName, title: `${opts.title} — ${opts.tenderTitle}`, sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}
