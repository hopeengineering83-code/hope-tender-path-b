import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments, isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../../../../../lib/engine/final-zip-scope";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function generatedFileName(name: string): string {
  return `${String(name || "generated-document").replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function text(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function docxMime(filename: string): string {
  return filename.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function internalDoc(title: string, lines: string[]): Document {
  const children = [
    new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 36 })], spacing: { after: 240 } }),
    ...lines.map((line) => new Paragraph({ children: [new TextRun({ text: text(line) || "-" })], spacing: { after: 100 } })),
  ];
  return new Document({
    sections: [{ properties: {}, children }],
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
  });
}

async function assertReadyForFinalPackage(userId: string, tender: any) {
  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false as const, response: jsonError("Company profile required before final export.", 422, { code: "COMPANY_PROFILE_REQUIRED" }) };

  const ingestion = await getCompanyIngestionReadiness(company.id, {
    requireDocuments: true,
    requireReviewedExperts: tender.requirements.some((r: any) => r.requirementType === "EXPERT"),
    requireReviewedProjects: tender.requirements.some((r: any) => r.requirementType === "PROJECT_EXPERIENCE"),
  });
  if (!ingestion.ingestionReady) {
    return { ok: false as const, response: jsonError("Final export blocked: company knowledge ingestion is not ready.", 422, { code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }) };
  }

  const generationReadiness = await getTenderGenerationReadiness(prisma, userId, tender.id);
  if (!generationReadiness?.ready) {
    return { ok: false as const, response: jsonError("Final export blocked by generation-readiness blockers.", 409, { blockers: generationReadiness?.blockers ?? [], warnings: generationReadiness?.warnings ?? [], nextAction: "OPEN_GENERATION_READINESS" }) };
  }

  const critical = tender.complianceGaps.filter((g: any) => !g.isResolved && g.severity === "CRITICAL");
  if (critical.length > 0) {
    return { ok: false as const, response: jsonError("Final export blocked by unresolved CRITICAL compliance gaps.", 409, { reasons: critical.map((g: any) => g.title) }) };
  }

  return { ok: true as const, companyId: company.id };
}

async function handleInternalReport(userId: string, tender: any, type: string) {
  const lines: string[] = [];
  if (type === "compliance") {
    lines.push(`Tender: ${tender.title}`);
    if (tender.complianceGaps.length === 0) lines.push("No compliance gaps identified.");
    for (const gap of tender.complianceGaps) {
      lines.push(`[${gap.severity}] ${gap.title}`);
      lines.push(gap.description);
      if (gap.mitigationPlan) lines.push(`Mitigation: ${gap.mitigationPlan}`);
    }
  } else if (type === "requirements") {
    lines.push(`Tender: ${tender.title}`);
    for (const req of tender.requirements) {
      lines.push(`[${req.priority}] ${req.requirementType}: ${req.title}`);
      lines.push(req.description);
    }
  } else {
    return jsonError("Unsupported download type", 400);
  }

  const buffer = await Packer.toBuffer(internalDoc(`Internal ${type} report`, lines));
  const filename = `${safeFileBaseName(tender.title)}-${type}-internal.docx`;
  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: tender.id, description: `Downloaded internal ${type} report for "${tender.title}"` });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function handleSingleDocument(userId: string, tender: any, docId: string) {
  const doc = tender.generatedDocuments.find((d: any) => d.id === docId);
  if (!doc || doc.generationStatus !== "GENERATED") return jsonError("Document not found or not yet generated.", 404);
  if (!isFinalExportCandidateDocument(doc)) return jsonError("This workspace draft is not a final export file. Use Generate Docs to create final DOCX/PDF outputs before downloading.", 409, { code: "INTERNAL_DRAFT_NOT_EXPORTABLE" });
  if (!generatedDocumentHasContent(doc)) return jsonError("Document content is unavailable.", 409, { code: "MISSING_CONTENT" });

  const readiness = checkExportReadiness([doc], { requireFileContent: false });
  if (!readiness.ok) return jsonError(exportReadinessError(readiness.failures), 409, { failures: readiness.failures });

  const content = await readGeneratedDocumentContent(doc);
  const signature = validateFileSignature(content.filename, content.base64);
  if (!signature.ok) return jsonError(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: signature.reason });

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: doc.id, description: `Downloaded generated document "${content.filename}"` });
  return new NextResponse(new Uint8Array(content.buffer), {
    headers: { "Content-Type": content.mimeType || docxMime(content.filename), "Content-Disposition": `attachment; filename="${content.filename}"` },
  });
}

async function handleZip(userId: string, tender: any) {
  const readinessGate = await assertReadyForFinalPackage(userId, tender);
  if (!readinessGate.ok) return readinessGate.response;

  const generatedDocs = filterFinalExportCandidateDocuments(tender.generatedDocuments)
    .filter((d: any) => d.generationStatus === "GENERATED")
    .sort((a: any, b: any) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));

  if (generatedDocs.length === 0) return jsonError("No final exportable generated documents to package. Quick drafts and internal markdown records are not ZIP package files.", 400, { code: "NO_FINAL_EXPORT_CANDIDATES" });

  const readiness = await checkFullExportReadiness({ tenderId: tender.id, docs: generatedDocs, requireFileContent: false });
  if (!readiness.ok) return jsonError(exportReadinessError(readiness.failures, readiness.tenderLevelBlockers), 409, { failures: readiness.failures, tenderLevelBlockers: readiness.tenderLevelBlockers ?? [] });

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const zipScope = buildFinalZipEntries({
    tender: {
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      requirements: tender.requirements.map((r: any) => ({ exactFileName: r.exactFileName ?? null })),
    },
    generatedDocs: generatedDocs.map((d: any) => ({ id: d.id, name: d.name, exactFileName: d.exactFileName, exactOrder: d.exactOrder, documentType: d.documentType })),
  });

  const docById = new Map(generatedDocs.map((d: any) => [d.id, d]));
  const entries = zipScope.entries.filter((entry) => Boolean(entry.generatedDocId && docById.get(entry.generatedDocId)));
  if (entries.length === 0) return jsonError("Final ZIP has no entries after scope filtering.", 409, { exclusions: zipScope.exclusions });

  for (const entry of entries) {
    const doc = docById.get(entry.generatedDocId!) as any;
    const content = await readGeneratedDocumentContent(doc);
    const signature = validateFileSignature(content.filename, content.base64);
    if (!signature.ok) return jsonError(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: signature.reason });
    zip.file(entry.name, content.buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${safeFileBaseName(tender.title)}-submission-package.zip`;
  const fileList = entries.map((entry) => entry.name);
  const existingPackage = tender.exportPackages[0];
  if (existingPackage) await prisma.exportPackage.update({ where: { id: existingPackage.id }, data: { status: "READY", fileList: JSON.stringify(fileList), downloadCount: { increment: 1 } } });
  else await prisma.exportPackage.create({ data: { tenderId: tender.id, status: "READY", fileList: JSON.stringify(fileList), downloadCount: 1 } });

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: tender.id, description: `Downloaded ZIP package for "${tender.title}" (${entries.length} file(s))`, metadata: { fileCount: entries.length, exclusionCount: zipScope.exclusions.length } });
  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName}"` },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "proposal";
    const docId = searchParams.get("docId");

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: true,
        complianceGaps: true,
        generatedDocuments: true,
        exportPackages: true,
      },
    });
    if (!tender) return jsonError("Tender not found", 404);

    if (docId) return await handleSingleDocument(actor.id, tender, docId);
    if (type === "zip") return await handleZip(actor.id, tender);
    if (type === "compliance" || type === "requirements") return await handleInternalReport(actor.id, tender, type);

    return jsonError("Direct proposal export is disabled. Generate and download final documents or the ZIP package instead.", 409);
  } catch (error) {
    console.error("Tender download route failed", error);
    return jsonError("Download route failed. Check server logs for details.", 500, { code: "DOWNLOAD_ROUTE_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
