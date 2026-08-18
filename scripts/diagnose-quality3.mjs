/**
 * Reproduce assessGeneratedDocumentQuality verdicts (the report that drives
 * GENERATED_DOCUMENT_QUALITY_FAILED).
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const { assessGeneratedDocumentQuality } = await import("../lib/engine/document-quality-gate.ts");
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
const tender = await p.tender.findUnique({ where: { id: tenderId }, include: { requirements: true } });
const docs = await p.generatedDocument.findMany({
  where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
  select: { id: true, name: true, exactFileName: true, documentType: true, format: true, fileContent: true, storagePath: true },
});
for (const doc of docs) {
  const visible = await extractDocxVisibleText(doc.fileContent, doc.exactFileName ?? doc.name);
  const report = assessGeneratedDocumentQuality({
    doc,
    visibleText: visible,
    rawFileContent: doc.fileContent,
    hasStoragePath: Boolean(doc.storagePath),
    requirements: tender.requirements,
  });
  console.log(`\n- ${doc.exactFileName} type=${doc.documentType} words=${(visible ?? "").split(/\s+/).filter(Boolean).length}`);
  console.log(`  recommendedStatus=${report.recommendedStatus} score=${report.score ?? "-"}`);
  for (const i of report.issues ?? []) console.log(`    [${i.severity}] ${i.code}: ${i.message}`);
}
await p.$disconnect();
