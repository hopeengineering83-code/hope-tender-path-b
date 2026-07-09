// GET /api/tenders/[id]/source-evidence
//
// Returns source evidence records for extracted facts.
// Sanitized: only returns safe previews of quotes (≤80 chars).

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { extractEvidenceFromText, type TenderSourceEvidence } from "../../../../../lib/extraction/tender-source-evidence-ledger";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const files = await prisma.tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: { id: true, originalFileName: true, extractedText: true, totalPages: true },
    orderBy: { createdAt: "asc" },
  });

  // Extract evidence from each file's text
  const allEvidence: TenderSourceEvidence[] = [];
  for (const file of files) {
    if (!file.extractedText) continue;
    const evidence = extractEvidenceFromText({
      tenderId,
      fileId: file.id,
      fileName: file.originalFileName,
      text: file.extractedText,
      pageNumber: 1, // Would be per-page in production
    });
    allEvidence.push(...evidence);
  }

  // Sanitize: truncate quotes to safe preview
  const safeEvidence = allEvidence.map((e) => ({
    evidenceId: e.evidenceId,
    fileId: e.fileId,
    fileName: e.fileName,
    pageNumber: e.pageNumber,
    sheetName: e.sheetName,
    rowNumber: e.rowNumber,
    quotePreview: e.quote.length > 80 ? e.quote.slice(0, 77) + "..." : e.quote,
    quoteHash: e.quoteHash,
    evidenceType: e.evidenceType,
    confidence: e.confidence,
  }));

  return NextResponse.json({
    ok: true,
    tenderId,
    evidence: safeEvidence,
    summary: {
      total: safeEvidence.length,
      byType: safeEvidence.reduce((acc, e) => {
        acc[e.evidenceType] = (acc[e.evidenceType] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    },
  });
}
