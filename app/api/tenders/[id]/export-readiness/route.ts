import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadiness, deriveTenderLevelExportHardBlockers, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function nextActionForReason(reason: string): string {
  if (/generationStatus/i.test(reason)) return "Regenerate this document or reconcile the submission plan.";
  if (/validationStatus/i.test(reason)) return "Run validation and fix reported document validation issues.";
  if (/reviewStatus/i.test(reason)) return "Complete human review and mark the document READY_FOR_EXPORT.";
  if (/fileContent/i.test(reason)) return "Regenerate or upload the missing DOCX/PDF file content.";
  return "Review and resolve this blocker before final export.";
}

function severityForReasons(reasons: string[]): "HIGH" | "MEDIUM" | "LOW" {
  if (reasons.some((r) => /fileContent|generationStatus/i.test(r))) return "HIGH";
  if (reasons.some((r) => /validationStatus|reviewStatus/i.test(r))) return "MEDIUM";
  return "LOW";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: {
      id: true,
      title: true,
      status: true,
      stage: true,
      readinessScore: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          exactFileName: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          fileContent: true,
        },
      },
    },
  });

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const generationReadiness = await getTenderGenerationReadiness(prisma, actor.id, id);

  const readiness = await checkFullExportReadiness({ tenderId: id, docs: tender.generatedDocuments, requireFileContent: true });
  const documentBlockers = readiness.failures.map((failure) => ({
    ...failure,
    severity: severityForReasons(failure.reasons),
    nextActions: failure.reasons.map(nextActionForReason),
  }));
  const tenderLevelBlockers = [
    ...(readiness.tenderLevelBlockers ?? []),
    ...deriveTenderLevelExportHardBlockers({
      activeDocuments: tender.generatedDocuments.length,
      tenderStatus: tender.status,
      tenderStage: tender.stage,
      readinessScore: tender.readinessScore,
    }),
    ...(generationReadiness && !generationReadiness.fullProposalReady
      ? [{
          category: "READINESS_GATE",
          severity: "HIGH" as const,
          title: "FULL_PROPOSAL_NOT_READY",
          recommendedAction: generationReadiness.fullProposalBlockers[0]?.nextAction ?? "Resolve generation-readiness blockers before final export.",
        }]
      : []),
  ];
  const exportOk = readiness.ok && tenderLevelBlockers.length === 0;
  const totalBlockers = documentBlockers.length + tenderLevelBlockers.length;

  return NextResponse.json({
    success: true,
    exportReadiness: {
      ok: exportOk,
      tender: {
        id: tender.id,
        title: tender.title,
        status: tender.status,
        stage: tender.stage,
        readinessScore: tender.readinessScore ?? 0,
      },
      summary: {
        activeDocuments: tender.generatedDocuments.length,
        documentBlockers: documentBlockers.length,
        tenderLevelBlockers: tenderLevelBlockers.length,
        totalBlockers,
      },
      documentBlockers,
      tenderLevelBlockers,
      message: exportOk ? "Export gate passed. All active generated documents and tender-level controls are ready." : exportReadinessError(readiness.failures, tenderLevelBlockers),
    },
  });
}
