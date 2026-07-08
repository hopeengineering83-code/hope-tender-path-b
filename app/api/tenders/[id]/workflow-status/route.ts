import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resultFromRunRow } from "../../../../../lib/engine/tender-workflow-runner";
import { buildFinalPackageManifest } from "../../../../../lib/engine/final-package-manifest";
import { validateGeneratedFileBytes } from "../../../../../lib/engine/generated-file-integrity";

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
    include: { generatedDocuments: true, exportPackages: { orderBy: { createdAt: "desc" }, take: 1 } },
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
    const bytes = doc.fileContent ?? null;
    const validation = validateGeneratedFileBytes({
      tenantId: company.id,
      tenderId,
      documentId: doc.id,
      filename: doc.exactFileName ?? doc.name ?? `${doc.id}.docx`,
      mimeType: doc.format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
      expectedExtension: doc.format === "PDF" ? "pdf" : "docx",
      minBytes: 16,
    });
    return validation.ok ? [] : [{ documentId: doc.id, filename: doc.exactFileName ?? doc.name, problem: validation.problem }];
  });

  const manifest = buildFinalPackageManifest(tender.generatedDocuments.map((doc) => ({
    id: doc.id,
    exactFileName: doc.exactFileName,
    name: doc.name,
    fileContent: doc.fileContent,
    exactOrder: doc.exactOrder,
    generationStatus: doc.generationStatus,
  })));

  return NextResponse.json({
    ok: true,
    operation: "WORKFLOW_STATUS",
    tenderId,
    latestRuns: runs.map(resultFromRunRow),
    recoverableFailures: runs.filter((run) => run.status === "FAILED").map((run) => ({ runId: run.id, operation: run.operation, errorCode: run.errorCode, nextAction: "Retry with a new idempotency key after reviewing blockers." })),
    staleGeneratedDocuments: tender.generatedDocuments.filter((doc) => doc.generationStatus === "STALE").map((doc) => ({ documentId: doc.id, filename: doc.exactFileName ?? doc.name })),
    finalPackageReadiness: { ok: manifest.ok, blockers: manifest.blockers, warnings: manifest.warnings, latestPackageStatus: tender.exportPackages[0]?.status ?? null },
    fileIntegrityProblems,
    providerFailureSummary: runs.filter((run) => run.errorCode === "PROVIDER_FAILURE").map((run) => ({ runId: run.id, operation: run.operation, status: run.status, recoverable: true })),
    warnings: manifest.warnings,
    blockers: [...manifest.blockers, ...fileIntegrityProblems.map((p) => `${p.filename ?? p.documentId}: ${p.problem}`)],
    recoverable: true,
  });
}
