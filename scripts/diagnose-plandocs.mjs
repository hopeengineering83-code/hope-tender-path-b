/**
 * Print validateConfirmedPlanDocuments blockers and the key each side computes.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const t = await p.tender.findUnique({ where: { id: tenderId }, select: { userId: true } });
const bp = await import("../lib/engine/build-plan.ts");
const confirmed = await bp.getCurrentConfirmedBuildPlan(p, tenderId, t.userId);
console.log("confirmed.ok:", confirmed.ok, "items:", confirmed.items?.length);
for (const i of confirmed.items ?? []) console.log("  item:", JSON.stringify(i));
const v = await bp.validateConfirmedPlanDocuments(p, tenderId, t.userId, confirmed.items ?? []);
console.log("\nvalidation ok:", v.ok, "exportReadyDocumentCount:", v.exportReadyDocumentCount);
for (const b of v.blockers) console.log("  BLOCKER:", b);
const docs = await p.generatedDocument.findMany({
  where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
  select: { name: true, exactFileName: true, exactOrder: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, contentByteLength: true },
});
console.log("\ndocs:");
for (const d of docs) console.log("  ", JSON.stringify(d));
await p.$disconnect();
