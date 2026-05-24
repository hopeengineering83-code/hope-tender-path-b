import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError, type ExportReadyDocument } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments, isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../../../../../lib/engine/final-zip-scope";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function fileName(name: string): string {
  return `${String(name || "generated-document").replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function asReadyDoc(doc: any): ExportReadyDocument {
  return {
    id: String(doc.id),
    name: String(doc.name ?? doc.exactFileName ?? doc.id ?? "Generated document"),
    exactFileName: doc.exactFileName ?? null,
    exactOrder: doc.exactOrder ?? null,
    documentType: doc.documentType ?? null,
    format: doc.format ?? null,
    generationStatus: String(doc.generationStatus ?? ""),
    validationStatus: String(doc.validationStatus ?? ""),
    reviewStatus: String(doc.reviewStatus ?? ""),
    fileContent: doc.fileContent ?? null,
    storagePath: doc.storagePath ?? null,
  };
}

function makeInternalDoc(title: string, lines: string[]) {
  return new Document({
    sections: [{ properties: {}, children: [
      new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 36 })], spacing: { after: 240 } }),
      ...lines.map((line) => new Paragraph({ children: [new TextRun({ text: String(line ?? "").replace(/\s+/g, " ").trim() || "-" })], spacing: { after: 100 } })),
    ] }],
  });
}

async function finalPackageGate(userId: string, tender: any) {
  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return { ok: false as const, response: err("Company profile required before final export.", 422, { code: "COMPANY_PROFILE_REQUIRED" }) };

  const ingestion = await getCompanyIngestionReadiness(company.id, {
    requireDocuments: true,
    requireReviewedExperts: tender.requirements.some((r: any) => r.requirementType === "EXPERT"),
    requireReviewedProjects: tender.requirements.some((r: any) => r.requirementType === "PROJECT_EXPERIENCE"),
  });
  if (!ingestion.ingestionReady) return { ok: false as const, response: err("Final export blocked: company knowledge ingestion is not ready.", 422, { code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }) };

  const generation = await getTenderGenerationReadiness(prisma, userId, tender.id);
  if (!generation?.ready) return { ok: false as const, response: err("Final export blocked by generation-readiness blockers.", 409, { blockers: generation?.blockers ?? [], warnings: generation?.warnings ?? [], nextAction: "OPEN_GENERATION_READINESS" }) };

  const critical = tender.complianceGaps.filter((g: any) => !g.isResolved && g.severity === "CRITICAL");
  if (critical.length) return { ok: false as const, response: err("Final export blocked by unresolved CRITICAL compliance gaps.", 409, { reasons: critical.map((g: any) => g.title) }) };

  return { ok: true as const, companyId: company.id };
}

async function internalReport(userId: string, tender: any, type: string) {
  const lines: string[] = [`Tender: ${tender.title}`];
  if (type === "compliance") {
    if (!tender.complianceGaps.length) lines.push("No compliance gaps identified.");
    for (const gap of tender.complianceGaps) lines.push(`[${gap.severity}] ${gap.title}`, gap.description, gap.mitigationPlan ? `Mitigation: ${gap.mitigationPlan}` : "");
  } else if (type === "requirements") {
    for (const req of tender.requirements) lines.push(`[${req.priority}] ${req.requirementType}: ${req.title}`, req.description);
  } else return err("Unsupported download type", 400);

  const buffer = await Packer.toBuffer(makeInternalDoc(`Internal ${type} report`, lines.filter(Boolean)));
  const name = `${safeFileBaseName(tender.title)}-${type}-internal.docx`;
  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: tender.id, description: `Downloaded internal ${type} report for "${tender.title}"` });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${name}"` } });
}

async function singleDocument(userId: string, tender: any, docId: string) {
  const raw = tender.generatedDocuments.find((d: any) => d.id === docId);
  if (!raw || raw.generationStatus !== "GENERATED") return err("Document not found or not yet generated.", 404);
  if (!isFinalExportCandidateDocument(raw)) return err("This workspace draft is not a final export file.", 409, { code: "INTERNAL_DRAFT_NOT_EXPORTABLE" });
  if (!generatedDocumentHasContent(raw)) return err("Document content is unavailable.", 409, { code: "MISSING_CONTENT" });

  const doc = asReadyDoc(raw);
  const readiness = checkExportReadiness([doc], { requireFileContent: false });
  if (!readiness.ok) return err(exportReadinessError(readiness.failures), 409, { failures: readiness.failures });

  const content = await readGeneratedDocumentContent(doc);
  const sig = validateFileSignature(content.filename, content.base64);
  if (!sig.ok) return err(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: doc.id, description: `Downloaded generated document "${content.filename}"` });
  return new NextResponse(new Uint8Array(content.buffer), { headers: { "Content-Type": content.mimeType, "Content-Disposition": `attachment; filename="${content.filename}"` } });
}

async function zipPackage(userId: string, tender: any) {
  const gate = await finalPackageGate(userId, tender);
  if (!gate.ok) return gate.response;

  const docs: ExportReadyDocument[] = filterFinalExportCandidateDocuments(tender.generatedDocuments as any[])
    .filter((d: any) => d.generationStatus === "GENERATED")
    .map(asReadyDoc)
    .sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));

  if (!docs.length) return err("No final exportable generated documents to package.", 400, { code: "NO_FINAL_EXPORT_CANDIDATES" });

  const readiness = await checkFullExportReadiness({ tenderId: tender.id, docs, requireFileContent: false });
  if (!readiness.ok) return err(exportReadinessError(readiness.failures, readiness.tenderLevelBlockers), 409, { failures: readiness.failures, tenderLevelBlockers: readiness.tenderLevelBlockers ?? [] });

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const scope = buildFinalZipEntries({
    tender: { exactFileNaming: tender.exactFileNaming, exactFileOrder: tender.exactFileOrder, requirements: tender.requirements.map((r: any) => ({ exactFileName: r.exactFileName ?? null })) },
    generatedDocs: docs.map((d) => ({ id: d.id, name: d.name, exactFileName: d.exactFileName, exactOrder: d.exactOrder ?? null, documentType: d.documentType ?? null })),
  });

  const byId = new Map(docs.map((d) => [d.id, d]));
  const entries = scope.entries.filter((entry) => Boolean(entry.generatedDocId && byId.get(entry.generatedDocId)));
  if (!entries.length) return err("Final ZIP has no entries after scope filtering.", 409, { exclusions: scope.exclusions });

  for (const entry of entries) {
    const doc = byId.get(entry.generatedDocId!);
    if (!doc) continue;
    const content = await readGeneratedDocumentContent(doc);
    const sig = validateFileSignature(content.filename, content.base64);
    if (!sig.ok) return err(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });
    zip.file(entry.name || fileName(doc.name), content.buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${safeFileBaseName(tender.title)}-submission-package.zip`;
  const fileList = entries.map((entry) => entry.name);
  const pkg = tender.exportPackages[0];
  if (pkg) await prisma.exportPackage.update({ where: { id: pkg.id }, data: { status: "READY", fileList: JSON.stringify(fileList), downloadCount: { increment: 1 } } });
  else await prisma.exportPackage.create({ data: { tenderId: tender.id, status: "READY", fileList: JSON.stringify(fileList), downloadCount: 1 } });

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: tender.id, description: `Downloaded ZIP package for "${tender.title}" (${entries.length} file(s))` });
  return new NextResponse(new Uint8Array(zipBuffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName}"` } });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "proposal";
    const docId = searchParams.get("docId");

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true, complianceGaps: true, generatedDocuments: true, exportPackages: true } });
    if (!tender) return err("Tender not found", 404);

    if (docId) return await singleDocument(actor.id, tender, docId);
    if (type === "zip") return await zipPackage(actor.id, tender);
    if (type === "compliance" || type === "requirements") return await internalReport(actor.id, tender, type);
    return err("Direct proposal export is disabled. Generate and download final documents or the ZIP package instead.", 409);
  } catch (error) {
    console.error("Tender download route failed", error);
    return err("Download route failed.", 500, { code: "DOWNLOAD_ROUTE_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
