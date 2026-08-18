/**
 * Show generated-document quality-gate results and evaluation-criteria state.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const t = await p.tender.findUnique({
  where: { id: tenderId },
  select: { evaluationMethodology: true, technicalWeight: true, financialWeight: true },
});
console.log("evaluationMethodology:", JSON.stringify(t.evaluationMethodology));
console.log("technicalWeight:", t.technicalWeight, "financialWeight:", t.financialWeight);

const docs = await p.generatedDocument.findMany({
  where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
  select: { id: true, name: true, exactFileName: true, documentType: true, contentByteLength: true, fileContent: true },
});
const { validateGeneratedDocumentQuality } = await import("../lib/document-generation/generated-document-quality-validator.ts");
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
for (const d of docs) {
  const text = await extractDocxVisibleText(d.fileContent, d.exactFileName ?? d.name);
  let verdict = "(validator not run)";
  try {
    const v = await validateGeneratedDocumentQuality({
      text: text ?? "",
      documentType: d.documentType,
      fileName: d.exactFileName ?? d.name,
    });
    verdict = JSON.stringify(v).slice(0, 600);
  } catch (e) { verdict = "validator error: " + e.message; }
  console.log(`\n- ${d.exactFileName} type=${d.documentType} bytes=${d.contentByteLength} textLen=${text?.length ?? 0}`);
  console.log("  ", verdict);
}
await p.$disconnect();
