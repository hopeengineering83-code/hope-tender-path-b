import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessCanonicalTenderSourceReadiness } from "../../../../../lib/tender/canonical-source-files";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
  if (!actor) return unauthorizedResponse();

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: {
      id: true,
      files: {
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          deletionStatus: true,
          contentSha256: true,
          integrityStatus: true,
          extractionScore: true,
          extractionMethod: true,
          totalPages: true,
          extractedPages: true,
          failedPages: true,
          extractedText: true,
          createdAt: true,
        },
      },
    },
  });
  if (!tender) {
    return NextResponse.json(
      { error: "Tender not found", code: "TENDER_NOT_FOUND", terminal: true },
      { status: 404 },
    );
  }

  const readiness = assessCanonicalTenderSourceReadiness(tender.files);
  const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, actor.id).catch(() => null);

  return NextResponse.json({
    ok: true,
    ...readiness,
    canonicalFiles: readiness.canonicalFiles.map((file) => ({
      id: file.id,
      fileName: file.originalFileName || file.fileName,
      extractionScore: file.extractionScore,
      integrityStatus: file.integrityStatus,
    })),
    analysisCurrent: Boolean(
      snapshot?.analysis.state === "AI_SUCCEEDED"
      && snapshot.analysis.contentHashMatch
      && snapshot.analysis.canonicalJobId,
    ),
    analysisBlocker: snapshot?.analysis.blocker ?? null,
  });
}
