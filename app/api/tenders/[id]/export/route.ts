import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { validateTender } from "../../../../../lib/engine/validate";
import { checkExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { logAction } from "../../../../../lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      include: {
        complianceGaps: true,
        generatedDocuments: true,
      },
    });

    if (!tender) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    const blockingGaps = tender.complianceGaps.filter(
      (gap) => !gap.isResolved && gap.severity === "CRITICAL",
    );

    if (blockingGaps.length > 0) {
      return NextResponse.json(
        { error: `Resolve ${blockingGaps.length} CRITICAL compliance gap(s) before marking as exported.` },
        { status: 400 },
      );
    }

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

    const generatedDocuments = tender.generatedDocuments.filter((doc) => doc.generationStatus === "GENERATED");
    if (generatedDocuments.length === 0) {
      return NextResponse.json({ error: "No generated documents are available for export." }, { status: 400 });
    }

    const readiness = checkExportReadiness(generatedDocuments);
    if (!readiness.ok) {
      return NextResponse.json(
        {
          error: exportReadinessError(readiness.failures),
          failures: readiness.failures,
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
