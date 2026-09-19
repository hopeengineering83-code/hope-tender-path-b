/**
 * Track requirement rows across the analyze -> engine steps to see where the
 * AI's source-grounded requirements are replaced.
 * Development/diagnostic harness, not production code.
 */
import { TENDER_TEXT } from "./pipeline-drive-fixture.mjs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:3100";
const COOKIE = process.env.DRIVE_COOKIE;
const prisma = new PrismaClient();

async function dump(tenderId, label) {
  const rs = await prisma.tenderRequirement.findMany({
    where: { tenderId },
    select: { id: true, title: true, priority: true, sourceExactQuote: true, sourceTenderFileId: true, sourcePageNumber: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== ${label}: ${rs.length} requirements ===`);
  for (const r of rs) {
    console.log(`  [${r.priority}] ${r.title.slice(0, 58).padEnd(58)} file=${r.sourceTenderFileId ? "Y" : "N"} page=${r.sourcePageNumber ?? "-"} quoteLen=${(r.sourceExactQuote ?? "").length}`);
  }
}

const form = new FormData();
form.append("title", "Requirement Probe");
form.append("reference", "MOWE/CS/RWS/2026/0117");
form.append("file", new Blob([TENDER_TEXT], { type: "text/plain" }), "probe.txt");
const up = await fetch(`${BASE}/api/tenders/upload-first`, {
  method: "POST", headers: { cookie: `hope_session=${COOKIE}` }, body: form,
});
const tenderId = (await up.json()).tenderId;
console.log("tender:", tenderId);

const an = await fetch(`${BASE}/api/tenders/${tenderId}/ai-analyze?force=true`, {
  method: "POST", headers: { cookie: `hope_session=${COOKIE}` },
});
const anJson = await an.json();
console.log("analyze:", an.status, "source:", anJson.analysisSource, "reported reqCount:", anJson.requirementCount);
await dump(tenderId, "AFTER ai-analyze");

const en = await fetch(`${BASE}/api/tenders/${tenderId}/engine`, {
  method: "POST",
  headers: { cookie: `hope_session=${COOKIE}`, "content-type": "application/json" },
  body: JSON.stringify({ action: "run" }),
});
console.log("\nengine:", en.status);
await dump(tenderId, "AFTER engine/run");

await prisma.$disconnect();
