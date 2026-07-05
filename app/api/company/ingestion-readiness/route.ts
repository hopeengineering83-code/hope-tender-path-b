import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../lib/company-ingestion-readiness";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);
  return NextResponse.json(await getCompanyIngestionReadiness(company.id));
}
