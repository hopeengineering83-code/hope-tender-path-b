/**
 * Package positions come from the confirmed Build Plan, never from the order a
 * generator happened to write files in.
 *
 * The technical-proposal writer used to create its row at position 1 whatever
 * the plan said. A tender that lists the financial proposal first (WHH
 * feasibility study, 2026-10-07: Financial Proposal.docx = 1, Technical
 * Proposal.docx = 2) then held two documents at position 1, the export gate
 * refused the package with DUPLICATE_EXACT_ORDER, validation was blocked
 * behind it, and finalization stopped even after the owner approved the price.
 */

export type PlanOrderItem = { exactFileName: string; exactOrder: number };
export type OrderedDocument = { id: string; exactFileName: string | null; name: string | null; exactOrder: number | null };

const base = (name: string) => name.trim().toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[\s._-]+/g, " ").trim();

/**
 * The position each active document should hold. A document named exactly as
 * a plan file takes that file's position; a document in another format of a
 * plan file (the DOCX a required PDF is finalized from) takes it only when no
 * document holds the plan's exact name.
 */
export function planPositions(plan: PlanOrderItem[], docs: OrderedDocument[]): Map<string, number> {
  const exact = new Map(plan.map((item) => [item.exactFileName.trim().toLowerCase(), item.exactOrder]));
  const byBase = new Map(plan.map((item) => [base(item.exactFileName), item]));
  const heldExactly = new Set(docs.map((d) => (d.exactFileName ?? "").trim().toLowerCase()).filter((n) => exact.has(n)));
  const out = new Map<string, number>();
  for (const doc of docs) {
    const name = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
    if (!name) continue;
    const direct = exact.get(name);
    if (direct !== undefined) {
      out.set(doc.id, direct);
      continue;
    }
    const item = byBase.get(base(name));
    if (item && !heldExactly.has(item.exactFileName.trim().toLowerCase())) out.set(doc.id, item.exactOrder);
  }
  return out;
}

/** Move every active document to its confirmed-plan position. Returns how many moved. */
export async function alignDocumentOrderToPlan(db: any, tenderId: string, userId: string): Promise<number> {
  const { getCurrentConfirmedBuildPlan } = await import("./build-plan");
  const plan = await getCurrentConfirmedBuildPlan(db, tenderId, userId).catch(() => null);
  if (!plan || !plan.ok) return 0;
  const items = (plan.items as Array<{ exactFileName?: unknown; exactOrder?: unknown }>)
    .filter((i) => typeof i.exactFileName === "string" && Number.isFinite(Number(i.exactOrder)))
    .map((i) => ({ exactFileName: String(i.exactFileName), exactOrder: Number(i.exactOrder) }));
  if (items.length === 0) return 0;
  const docs: OrderedDocument[] = await db.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: { id: true, exactFileName: true, name: true, exactOrder: true },
  });
  let moved = 0;
  for (const [id, order] of planPositions(items, docs)) {
    const doc = docs.find((d) => d.id === id)!;
    if (doc.exactOrder === order) continue;
    await db.generatedDocument.update({ where: { id }, data: { exactOrder: order } });
    moved += 1;
  }
  return moved;
}
