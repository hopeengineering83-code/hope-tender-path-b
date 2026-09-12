/**
 * Print stored requirement quote lengths/tails for a tender.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rs = await p.tenderRequirement.findMany({
  where: { tenderId: process.argv[2] },
  select: { id: true, title: true, priority: true, sourceExactQuote: true, sourceTenderFileId: true },
});
for (const r of rs) {
  const q = r.sourceExactQuote ?? "";
  console.log(JSON.stringify({
    title: r.title,
    priority: r.priority,
    hasFile: Boolean(r.sourceTenderFileId),
    len: q.length,
    endsEllipsis: q.endsWith("…"),
    hasNewline: q.includes("\n"),
    tail: q.slice(-45),
  }));
}
await p.$disconnect();
