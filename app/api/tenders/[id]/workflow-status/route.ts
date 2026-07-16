import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resultFromRunRow } from "../../../../../lib/engine/tender-workflow-runner";
import { buildFinalPackageManifest } from "../../../../../lib/engine/final-package-manifest";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { buildPublicReadinessEnvelope } from "../../../../../lib/engine/public-readiness-envelope";

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
    include: {
      // Only load non-SUPERSEDED docs, and use explicit select to avoid
      // loading the base64 fileContent blob (can be multi-MB per doc).
      // The file-integrity check at line 39 fetches bytes lazily via
      // readGeneratedDocumentContent when needed.
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true, name: true, exactFileName: true, exactOrder: true,
          format: true, generationStatus: true, validationStatus: true,
          reviewStatus: true, storagePath: true, documentType: true,
          reviewNotes: true, updatedAt: true,
        },
      },
      exportPackages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!tender) {
    return NextResponse.json({ ok: false, operation: "WORKFLOW_STATUS", warnings: [], blockers: ["Tender not found"], errorCode: "TENDER_NOT_FOUND", recoverable: false }, { status: 404 });
  }

  const company = await prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!company) {
    return NextResponse.json({ ok: false, operation: "WORKFLOW_STATUS", warnings: [], blockers: ["Company profile required"], errorCode: "TENANT_MISMATCH", recoverable: false }, { status: 403 });
  }

  const runs = await prisma.tenderWorkflowRun.findMany({
    where: { companyId: company.id, tenderId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const fileIntegrityProblems = tender.generatedDocuments.flatMap((doc) => {
    // fileContent is not loaded in the select (to avoid loading multi-MB blobs).
    // Skip the byte-level integrity check here — the download route does a
    // full integrity check before serving. This route only needs status-level
    // info (GENERATED / FAILED / SUPERSEDED).
    return doc.generationStatus === "GENERATED" && !doc.storagePath
      ? [{ documentId: doc.id, filename: doc.exactFileName ?? doc.name, problem: "Generated document has no stored content" }]
      : [];
  });

  const manifest = buildFinalPackageManifest(tender.generatedDocuments.map((doc) => ({
    id: doc.id,
    exactFileName: doc.exactFileName,
    name: doc.name,
    fileContent: null, // Not loaded — download route fetches lazily
    exactOrder: doc.exactOrder,
    generationStatus: doc.generationStatus,
  })));

  const finalPackage = await getFinalPackageReadinessModel(prisma, tenderId, actor.id);
  const blockers = [
    ...manifest.blockers,
    ...finalPackage.documents.blockers,
    ...finalPackage.export.blockers,
    ...fileIntegrityProblems.map((p) => `${p.filename ?? p.documentId}: ${p.problem}`),
  ];
  const envelope = buildPublicReadinessEnvelope({
    ok: manifest.ok && finalPackage.export.zipReady,
    blockers,
    warnings: manifest.warnings,
    primaryFixAction: blockers.length > 0 ? "Resolve final package blockers before export." : null,
    requiredDocumentsTotal: finalPackage.documents.required.length,
    generatedDocumentsTotal: finalPackage.documents.generated.length,
    exportReadyDocumentsTotal: finalPackage.documents.exportReady.length,
  });

  return NextResponse.json({
    ...envelope,
    operation: "WORKFLOW_STATUS",
    tenderId,
    latestRuns: runs.map(resultFromRunRow),
    recoverableFailures: runs.filter((run) => run.status === "FAILED").map((run) => ({ runId: run.id, operation: run.operation, errorCode: run.errorCode, nextAction: "Retry with a new idempotency key after reviewing blockers." })),
    staleGeneratedDocuments: tender.generatedDocuments.filter((doc) => doc.generationStatus === "STALE").map((doc) => ({ documentId: doc.id, filename: doc.exactFileName ?? doc.name })),
    finalPackageReadiness: { ok: manifest.ok && finalPackage.export.zipReady, blockers, warnings: manifest.warnings, latestPackageStatus: tender.exportPackages[0]?.status ?? null },
    fileIntegrityProblems,
    providerFailureSummary: runs.filter((run) => run.errorCode === "PROVIDER_FAILURE").map((run) => ({ runId: run.id, operation: run.operation, status: run.status, recoverable: true })),
    recoverable: true,
  });
}
