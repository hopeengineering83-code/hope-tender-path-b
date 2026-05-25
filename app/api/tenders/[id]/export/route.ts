import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments } from "../../../../../lib/engine/document-output-state";
import { logAction } from "../../../../../lib/audit";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  await prismaReady;

  try {
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        complianceGaps: true,
        requirements: true,
        generatedDocuments: true,
      },
    });

    if (!tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
    if (!company) return NextResponse.json({ error: "Company profile required before export." }, { status: 422 });
    const ingestion = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: tender.requirements.some((r) => r.requirementType === "EXPERT"), requireReviewedProjects: tender.requirements.some((r) => r.requirementType === "PROJECT_EXPERIENCE") });
    if (!ingestion.ingestionReady) return NextResponse.json({ error: "Export blocked: company knowledge ingestion is not ready.", code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }, { status: 422 });

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && gap.severity === "CRITICAL",
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json(
        { error: `Resolve ${blockingGaps.length} CRITICAL compliance gap(s) before marking as exported.` },
        { status: 400 },
      );
    }

    const untracedMandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY" && ((req.sourceConfidence ?? 0) <= 0));
    if (untracedMandatoryRequirements.length > 0) return NextResponse.json({ error: `Export blocked: ${untracedMandatoryRequirements.length} mandatory requirement(s) are not source-grounded yet.`, code: "UNTRACED_MANDATORY_REQUIREMENTS", requirements: untracedMandatoryRequirements.slice(0, 20).map((req) => ({ id: req.id, title: req.title })) }, { status: 422 });

    if (tender.generatedDocuments.length === 0) {
      return NextResponse.json({ error: "Run the tender engine before export preparation." }, { status: 400 });
    }

    const report = await validateTender(id);
    const blockingIssues = report.issues.filter((issue) => issue.severity === "BLOCK");
    if (blockingIssues.length > 0) {
      return NextResponse.json(
        {
          error: `Validation failed — resolve ${blockingIssues.length} blocking issue(s) before export.`,
          issues: blockingIssues,
        },
        { status: 400 },
      );
    }

    // Only count final export candidates (not internal drafts, SUPERSEDED, etc.)
    const generatedDocuments = filterFinalExportCandidateDocuments(
      tender.generatedDocuments.filter((doc) => doc.generationStatus === "GENERATED"),
    );
    if (generatedDocuments.length === 0) {
      return NextResponse.json({ error: "No generated documents are available for export." }, { status: 400 });
    }

    // PR XX-G4 — full readiness check: per-document + tender-level blockers
    // (HIGH evaluator objections, pricing workbook leakage). The export
    // gate now closes when EITHER set of blockers is non-empty.
    const readiness = await checkFullExportReadiness({ tenderId: tender.id, docs: generatedDocuments });
    if (!readiness.ok) {
      return NextResponse.json(
        {
          error: exportReadinessError(readiness.failures, readiness.tenderLevelBlockers),
          failures: readiness.failures,
          tenderLevelBlockers: readiness.tenderLevelBlockers ?? [],
        },
        { status: 409 },
      );
    }

    const generatedFileNames = generatedDocuments
      .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER))
      .map((doc) => doc.exactFileName ?? doc.name);

    const existingPackage = await prisma.exportPackage.findFirst({ where: { tenderId: id }, orderBy: { createdAt: "desc" } });
    const exportPackage = existingPackage
      ? await prisma.exportPackage.update({
          where: { id: existingPackage.id },
          data: { status: "READY", fileList: JSON.stringify(generatedFileNames) },
        })
      : await prisma.exportPackage.create({
          data: { tenderId: id, status: "READY", fileList: JSON.stringify(generatedFileNames), downloadCount: 0 },
        });

    await prisma.tender.update({
      where: { id },
      data: { status: "EXPORTED", stage: "EXPORT" },
    });

    await logAction({
      userId,
      action: "EXPORT_PACKAGE_CREATE",
      entityType: "Tender",
      entityId: id,
      description: `Prepared export package for "${tender.title}" — ${generatedFileNames.length} file(s)`,
      metadata: { exportPackageId: exportPackage.id, fileCount: generatedFileNames.length, validationPassed: true, reviewGatePassed: true },
    });

    return NextResponse.json(
      {
        success: true,
        exportPackage: {
          id: exportPackage.id,
          tenderId: tender.id,
          status: exportPackage.status,
          fileList: generatedFileNames,
          name: `${tender.title} Submission Package`,
          format: "ZIP",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Export preparation failed:", error);
    return NextResponse.json({ error: "Export preparation failed" }, { status: 500 });
  }
}
