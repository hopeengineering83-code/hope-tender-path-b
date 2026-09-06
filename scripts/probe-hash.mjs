/**
 * Upload a fresh tender, snapshot the analysis hash-input content, run AI
 * Analyze, snapshot again, and print the exact difference.
 * Development/diagnostic harness, not production code.
 */
import { writeFileSync } from "node:fs";
import { TENDER_TEXT } from "./pipeline-drive-fixture.mjs";

const BASE = "http://127.0.0.1:3100";
const COOKIE = process.env.DRIVE_COOKIE;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import(
  "../lib/engine/tender-analysis-content.ts"
);

async function snapshot(tenderId, label) {
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
  writeFileSync(`/tmp/hc-${label}.txt`, content);
  console.log(`${label}: hash=${computeAnalysisContentHash(content)} len=${content.length} files=${activeFiles.length} vault=${company?.documents?.length}`);
  return content;
}

const form = new FormData();
form.append("title", "Hash Probe Tender");
form.append("reference", "MOWE/CS/RWS/2026/0117");
form.append("file", new Blob([TENDER_TEXT], { type: "text/plain" }), "probe.txt");
const up = await fetch(`${BASE}/api/tenders/upload-first`, {
  method: "POST", headers: { cookie: `hope_session=${COOKIE}` }, body: form,
});
const upJson = await up.json();
const tenderId = upJson.tenderId;
console.log("tender:", tenderId, "status:", up.status);

const before = await snapshot(tenderId, "before");

const an = await fetch(`${BASE}/api/tenders/${tenderId}/ai-analyze?force=true`, {
  method: "POST", headers: { cookie: `hope_session=${COOKIE}` },
});
const anJson = await an.json();
console.log("analyze:", an.status, "source:", anJson.analysisSource);

const after = await snapshot(tenderId, "after");

const job = await prisma.aiJob.findFirst({
  where: { tenderId, jobType: "AI_ANALYZE" }, orderBy: { createdAt: "desc" },
  select: { analysisInputHash: true, status: true },
});
console.log("stored job hash:", job?.analysisInputHash, "status:", job?.status);

if (before === after) {
  console.log("\n>>> hash-input content IDENTICAL before/after analyze");
} else {
  console.log("\n>>> hash-input content CHANGED. First divergence:");
  let i = 0;
  while (i < Math.min(before.length, after.length) && before[i] === after[i]) i += 1;
  console.log(`  at char ${i} (before len=${before.length}, after len=${after.length})`);
  console.log("  before: ..." + JSON.stringify(before.slice(Math.max(0, i - 120), i + 200)));
  console.log("  after : ..." + JSON.stringify(after.slice(Math.max(0, i - 120), i + 200)));
}
await prisma.$disconnect();
