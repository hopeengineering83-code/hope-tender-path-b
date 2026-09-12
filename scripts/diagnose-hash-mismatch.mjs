/**
 * Diagnose ANALYSIS_HASH_MISMATCH on a real tender: compare the AiJob's stored
 * analysisInputHash against the hash recomputed from current tender state, and
 * show which hash-input field moved.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const tenderId = process.argv[2];
if (!tenderId) throw new Error("usage: node scripts/diagnose-hash-mismatch.mjs <tenderId>");

const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import(
  "../lib/engine/tender-analysis-content.ts"
);

const tender = await prisma.tender.findUnique({
  where: { id: tenderId },
  include: { files: true },
});
const company = await prisma.company.findUnique({
  where: { userId: tender.userId },
  select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
});
const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");

const content = buildTenderAnalysisContent(
  { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: activeFiles },
  company ?? undefined,
);
const current = computeAnalysisContentHash(content);

const jobs = await prisma.aiJob.findMany({
  where: { tenderId, jobType: "AI_ANALYZE" },
  orderBy: { createdAt: "desc" },
  select: { id: true, status: true, analysisInputHash: true, createdAt: true, finishedAt: true },
});

console.log("current recomputed hash :", current);
console.log("jobs:");
for (const j of jobs) {
  console.log(`  ${j.createdAt.toISOString()} status=${j.status} hash=${j.analysisInputHash} ${j.analysisInputHash === current ? "== MATCH" : "!= MISMATCH"}`);
}
console.log("\ntender.title       :", JSON.stringify(tender.title));
console.log("tender.description :", JSON.stringify(tender.description?.slice(0, 220)));
console.log("tender.intakeSummary:", JSON.stringify(tender.intakeSummary?.slice(0, 220)));
console.log("activeFiles        :", activeFiles.length);
console.log("vaultDocs          :", company?.documents?.length);

const chunks = await prisma.aiAnalyzeChunk.findMany({
  where: { tenderId },
  select: { contentHash: true, status: true, chunkIndex: true },
});
console.log("\nchunks by hash:");
for (const c of chunks) console.log(`  idx=${c.chunkIndex} status=${c.status} hash=${c.contentHash} ${c.contentHash === current ? "== MATCH" : "!= MISMATCH"}`);

await prisma.$disconnect();
