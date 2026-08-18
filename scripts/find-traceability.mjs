/** Show which internal-traceability pattern hits a document (diagnostic). */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
const { __testing__ } = await import("../lib/engine/document-quality-gate.ts");
const [tenderId, fileName] = process.argv.slice(2);
const d = await p.generatedDocument.findFirst({ where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } }, select: { fileContent: true, exactFileName: true } });
const t = await extractDocxVisibleText(d.fileContent, d.exactFileName);
const pats = __testing__?.INTERNAL_TRACEABILITY_PATTERNS ?? [];
console.log("patterns available:", pats.length);
for (const rx of pats) {
  const m = t.match(new RegExp(rx.source, rx.flags));
  if (m) {
    const i = t.indexOf(m[0]);
    console.log(`HIT ${rx} -> ${JSON.stringify(m[0])}`);
    console.log("   ctx:", JSON.stringify(t.slice(Math.max(0,i-160), i+180)));
  }
}
await p.$disconnect();
