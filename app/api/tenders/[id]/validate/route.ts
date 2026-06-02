import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`validate:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id, userId } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  let report;
  try {
    report = await validateTender(id);
  } catch (error) {
    console.error("[validate] error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation failed" }, { status: 500 });
  }

  // Persist the full issue list in audit metadata so we have a record of what
  // failed at each validation run. Previously only the count was stored, so a
  // reviewer could not see *which* issues blocked an export after the fact.
  const blockCount = report.issues.filter((i) => i.severity === "BLOCK").length;
  const warnCount = report.issues.filter((i) => i.severity === "WARN").length;

  await logAction({
    userId,
    action: "TENDER_VALIDATED",
    entityType: "Tender",
    entityId: id,
    description: `Validated tender "${tender.title}" — ${report.passed ? "PASSED" : "FAILED"} (${blockCount} block, ${warnCount} warn)`,
    metadata: {
      tenderId: id,
      passed: report.passed,
      checkedAt: report.checkedAt,
      blockCount,
      warnCount,
      issues: report.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })),
    },
  });

  if (report.passed) {
    await prisma.tender.update({
      where: { id },
      data: { status: "APPROVED" },
    });
  }

  return NextResponse.json({ report });
}
