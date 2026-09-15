/**
 * Capture the analysis hash-input content BEFORE and AFTER an AI Analyze run on
 * a real tender and print the exact character-level difference.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const tenderId = process.argv[2];
const label = process.argv[3] ?? "snap";
if (!tenderId) throw new Error("usage: node diagnose-hash-diff.mjs <tenderId> <label>");

const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import(
  "../lib/engine/tender-analysis-content.ts"
);

const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { files: true } });
const company = await prisma.company.findUnique({
  where: { userId: tender.userId },
  select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
});
const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");

const content = buildTenderAnalysisContent(
  { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: activeFiles },
  company ?? undefined,
);
const path = `/tmp/hashcontent-${label}.txt`;
writeFileSync(path, content);
console.log(`${label}: hash=${computeAnalysisContentHash(content)} len=${content.length} -> ${path}`);
console.log(`${label}: files=${activeFiles.length} vault=${company?.documents?.length}`);
for (const f of activeFiles) {
  console.log(`${label}: file ${f.originalFileName} textLen=${f.extractedText?.length} created=${f.createdAt.toISOString()}`);
}
await prisma.$disconnect();
