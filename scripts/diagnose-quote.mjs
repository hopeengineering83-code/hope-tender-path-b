/**
 * Show which requirement quotes are not contained in their referenced source
 * file's extracted text, and why.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const tenderId = process.argv[2];

const reqs = await prisma.tenderRequirement.findMany({
  where: { tenderId },
  select: { id: true, title: true, priority: true, sourceExactQuote: true, sourceTenderFileId: true, sourcePageNumber: true },
});
const files = await prisma.tenderFile.findMany({
  where: { tenderId },
  select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true },
});
const byId = Object.fromEntries(files.map((f) => [f.id, f]));

console.log(`requirements: ${reqs.length}, files: ${files.length}`);
for (const f of files) console.log(`  file ${f.id} ${f.originalFileName} textLen=${f.extractedText?.length} ${f.deletionStatus}`);

for (const r of reqs) {
  const f = r.sourceTenderFileId ? byId[r.sourceTenderFileId] : null;
  const text = f?.extractedText ?? "";
  const q = r.sourceExactQuote ?? "";
  const contained = q && text.includes(q);
  if (contained) continue;
  console.log(`\n--- NOT CONTAINED: ${r.id} [${r.priority}] ${r.title}`);
  console.log(`    file: ${f?.originalFileName ?? "(none)"} page=${r.sourcePageNumber}`);
  console.log(`    quote: ${JSON.stringify(q)}`);
  // Try to locate a near match to explain the difference.
  const firstWords = q.split(/\s+/).slice(0, 6).join(" ");
  const idx = text.indexOf(firstWords);
  if (idx >= 0) {
    console.log(`    text near: ${JSON.stringify(text.slice(idx, idx + q.length + 60))}`);
  } else {
    console.log(`    (first 6 words not found either: ${JSON.stringify(firstWords)})`);
  }
}
await prisma.$disconnect();
