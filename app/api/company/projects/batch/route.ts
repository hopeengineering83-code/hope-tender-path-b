import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getSession } from "../../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { logAction } from "../../../../../lib/audit";

const VALID_TRUST_LEVELS = new Set(["REVIEWED", "AI_EXTRACTED", "IMPORTED"]);

export async function PATCH(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const ids: string[] = Array.isArray(body.ids) ? (body.ids as string[]).filter((x) => typeof x === "string") : [];

  if (ids.length === 0) return NextResponse.json({ error: "ids array is required and must not be empty" }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "Maximum 200 ids per batch" }, { status: 400 });

  const trustLevel = typeof body.trustLevel === "string" && VALID_TRUST_LEVELS.has(body.trustLevel) ? body.trustLevel : "REVIEWED";

  const company = await ensureCompanyForUser(prisma, userId);

  const result = await prisma.project.updateMany({
    where: { id: { in: ids }, companyId: company.id },
    data: {
      trustLevel,
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewNotes: `Batch ${trustLevel.toLowerCase()} by user`,
    },
  });

  await logAction({
    userId,
    action: "UPDATE",
    entityType: "Project",
    description: `Batch set ${result.count} project(s) to ${trustLevel}`,
    metadata: { ids, trustLevel, updated: result.count },
  });

  return NextResponse.json({ success: true, updated: result.count });
}
