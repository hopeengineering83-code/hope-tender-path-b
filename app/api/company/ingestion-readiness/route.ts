import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../lib/company-ingestion-readiness";
import { scheduleRequestScopedWorkerWake } from "../../../../lib/ai-jobs/request-scoped-worker-wake";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);
  const readiness = await getCompanyIngestionReadiness(company.id);

  if (readiness.totals.pendingDocuments > 0) {
    // Recovery for CompanyDocuments whose durable VAULT_INGEST job was stored
    // before a Preview worker could be started. The worker claim remains
    // scoped to this authenticated tenant.
    scheduleRequestScopedWorkerWake(req, "VAULT_INGEST");
  }

  return NextResponse.json(readiness);
}
