/** Print validateBuildPlanItemsAtRuntime blockers (diagnostic harness). */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const t = await p.tender.findUnique({ where: { id: tenderId }, select: { userId: true } });
const bp = await import("../lib/engine/build-plan.ts");
const c = await bp.getCurrentConfirmedBuildPlan(p, tenderId, t.userId);
console.log("confirmed ok:", c.ok, c.reason ?? "");
const v = await bp.validateBuildPlanItemsAtRuntime(p, tenderId, t.userId, c.items ?? []);
console.log("items valid:", v.ok);
for (const b of v.blockers ?? []) console.log("  BLOCKER:", b);
await p.$disconnect();
