/**
 * Print the sentences of a generated DOCX that trip the pricing-leakage rule.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const [tenderId, fileName] = process.argv.slice(2);
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
const { containsPricingLeakage } = await import("../lib/engine/pricing-hygiene.ts");

const doc = await p.generatedDocument.findFirst({
  where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
  select: { id: true, name: true, exactFileName: true, documentType: true, format: true, fileContent: true },
});
const text = await extractDocxVisibleText(doc.fileContent, doc.exactFileName);
console.log("doc:", doc.name, doc.documentType, "textLen:", text?.length);
console.log("flagged:", containsPricingLeakage(text ?? "", doc));
const sentences = (text ?? "").split(/(?<=[.!?])\s+/);
for (const s of sentences) {
  if (containsPricingLeakage(s, doc)) console.log("  TRIGGER >>", JSON.stringify(s.slice(0, 240)));
}
await p.$disconnect();
