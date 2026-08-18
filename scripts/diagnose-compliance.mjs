/**
 * Show ComplianceMatrix support levels per mandatory requirement.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const reqs = await p.tenderRequirement.findMany({ where: { tenderId }, select: { id: true, title: true, priority: true } });
const rows = await p.complianceMatrix.findMany({ where: { tenderId }, select: { requirementId: true, supportLevel: true } });
console.log("requirements:", reqs.length, "complianceRows:", rows.length);
const byReq = new Map(rows.map(r => [r.requirementId, r]));
for (const r of reqs) {
  const row = byReq.get(r.id);
  console.log(` [${r.priority}] ${r.title.slice(0,50).padEnd(50)} support=${row?.supportLevel ?? "(no row)"}`);
}
const levels = {};
for (const r of rows) levels[r.supportLevel] = (levels[r.supportLevel] ?? 0) + 1;
console.log("supportLevel distribution:", JSON.stringify(levels));
await p.$disconnect();
