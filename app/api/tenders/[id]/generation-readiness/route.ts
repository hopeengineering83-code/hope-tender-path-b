import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { getCanonicalTenderReadiness } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const [readiness, canonical] = await Promise.all([
    getTenderGenerationReadiness(prisma, userId, tenderId),
    getCanonicalTenderReadiness(prisma, userId, tenderId),
  ]);
  if (!readiness) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const readyForSupportPackage = Boolean(readiness.supportPackageReady);
  const readyForFullProposal = Boolean(readiness.fullProposalReady);

  return NextResponse.json({
    ...readiness,
    canonical,
    ready: readyForFullProposal,
    readyForSupportPackage,
    readyForFullProposal,
    readyForAnySafeGeneration: readyForSupportPackage || readyForFullProposal,
    finalExportReady: false,
    gateSemantics: {
      ready: "full proposal readiness only",
      supportPackageReady: "support/admin package readiness only; not final proposal/export readiness",
      fullProposalReady: "main proposal generation readiness",
      finalExportReady: "must be checked through export-readiness endpoint",
    },
  });
}
