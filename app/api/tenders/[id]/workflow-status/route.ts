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
          // Cheap scalars that say whether content exists, without loading it.
          // storagePath alone cannot answer that: a document whose bytes live
          // in the fileContent column has storagePath null, so testing only
          // storagePath reported every DB-stored document as having no
          // content. These three columns are integers/short strings, not the
          // multi-MB blob this select exists to avoid.
          contentByteLength: true, contentSha256: true, integrityStatus: true,
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
    // The byte-level integrity check stays with the download route, which
    // loads and verifies the bytes in full before serving. This route asks
    // only the cheap question: does this document have content at all?
    //
    // It used to ask that as `!doc.storagePath`, which is only one of the two
    // places content lives. Every document whose bytes are held in the
    // fileContent column has storagePath null, so three VERIFIED, non-empty,
    // downloadable documents were each reported as
    // "Generated document has no stored content" and blocked this route while
    // the ZIP built from those same rows returned 200.
    //
    // contentByteLength answers it directly and costs nothing to select. A
    // GENERATED document with neither a storage path nor any recorded bytes is
    // still reported, so the case this check was written for is unchanged.
    const hasStoredBytes = (doc.contentByteLength ?? 0) > 0;
    return doc.generationStatus === "GENERATED" && !doc.storagePath && !hasStoredBytes
      ? [{ documentId: doc.id, filename: doc.exactFileName ?? doc.name, problem: "Generated document has no stored content" }]
      : [];
  });

  // The select above deliberately omits fileContent, so the manifest is built
  // with contentLoaded: false. Passing fileContent: null without saying so made
  // the builder measure every document as zero bytes with an empty hash, and
  // the strict validation turned that into three hard blockers per document —
  //
  //   "<file>: required file invalid" / "zero-byte file" / "invalid sha256"
  //
  // — for documents that were VERIFIED, non-empty and downloadable. Those
  // blockers went into this route's public readiness envelope, so a complete
  // package published BLOCKED here while export-readiness, readiness-score,
  // authority-review, the Export Hub and the ZIP itself all said it was ready.
  //
  // Nothing is loosened: the byte-level check still runs wherever the bytes are
  // loaded, and the download route verifies them in full before serving.
  const manifest = buildFinalPackageManifest(
    tender.generatedDocuments.map((doc) => ({
      id: doc.id,
      exactFileName: doc.exactFileName,
      name: doc.name,
      fileContent: null, // Not loaded — download route fetches lazily
      exactOrder: doc.exactOrder,
      generationStatus: doc.generationStatus,
    })),
    { contentLoaded: false },
  );

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
