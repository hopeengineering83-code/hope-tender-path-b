/**
 * Print extracted visible text of a generated document (diagnostic harness).
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
const [tenderId, fileName, needle] = process.argv.slice(2);
const d = await p.generatedDocument.findFirst({
  where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
  select: { fileContent: true, exactFileName: true, documentType: true },
});
const t = await extractDocxVisibleText(d.fileContent, d.exactFileName);
console.log("documentType:", d.documentType, "textLen:", t.length);
if (needle) {
  const i = t.toLowerCase().indexOf(needle.toLowerCase());
  console.log(`"${needle}" idx:`, i);
  if (i >= 0) console.log("context:", JSON.stringify(t.slice(Math.max(0, i - 220), i + 220)));
}
console.log("\nHEAD:", JSON.stringify(t.slice(0, 260)));
await p.$disconnect();
