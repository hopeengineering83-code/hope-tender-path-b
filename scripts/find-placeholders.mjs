/** List every placeholder-pattern hit in a generated document (diagnostic). */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const { extractDocxVisibleText } = await import("../lib/engine/export-readiness.ts");
const { PLACEHOLDER_PATTERNS } = await import("../lib/engine/detection-patterns.ts");
const [tenderId, fileName] = process.argv.slice(2);
const d = await p.generatedDocument.findFirst({
  where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
  select: { fileContent: true, exactFileName: true },
});
const t = await extractDocxVisibleText(d.fileContent, d.exactFileName);
for (const pat of PLACEHOLDER_PATTERNS) {
  const m = t.match(new RegExp(pat.source, pat.flags));
  if (m) {
    const i = t.indexOf(m[0]);
    console.log(`HIT ${pat} -> ${JSON.stringify(m[0])}`);
    console.log(`   ctx: ${JSON.stringify(t.slice(Math.max(0,i-140), i+160))}`);
  }
}
await p.$disconnect();
