/**
 * Compare the confirmed BuildPlan's required files against the
 * GeneratedDocument rows actually produced.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];

const t = await p.tender.findUnique({ where: { id: tenderId }, select: { exactFileNaming: true, exactFileOrder: true } });
console.log("tender.exactFileNaming:", t.exactFileNaming);
console.log("tender.exactFileOrder :", t.exactFileOrder);

const bp = await p.buildPlan.findUnique({ where: { tenderId }, select: { status: true, itemsJson: true } });
const items = bp?.itemsJson ? JSON.parse(bp.itemsJson) : [];
console.log(`\nBuildPlan status=${bp?.status} items=${items.length}`);
for (const it of items) {
  console.log(`  - ${JSON.stringify({ exactFileName: it.exactFileName, required: it.required, documentType: it.documentType, source: it.source, plannedOutput: it.plannedOutput })}`);
}

const docs = await p.generatedDocument.findMany({
  where: { tenderId },
  select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, format: true, contentByteLength: true, exactOrder: true },
  orderBy: { createdAt: "asc" },
});
console.log(`\nGeneratedDocuments: ${docs.length}`);
for (const d of docs) {
  console.log(`  - name=${JSON.stringify(d.name)} exactFileName=${JSON.stringify(d.exactFileName)} type=${d.documentType} gen=${d.generationStatus} val=${d.validationStatus} rev=${d.reviewStatus} fmt=${d.format} bytes=${d.contentByteLength}`);
}
await p.$disconnect();
