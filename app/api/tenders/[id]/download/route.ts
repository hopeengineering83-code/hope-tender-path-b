import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, exportReadinessError, type ExportReadyDocument } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments, isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../../../../../lib/engine/final-zip-scope";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";
import { inferEnvelope, type SubmissionEnvelope } from "../../../../../lib/engine/submission-plan";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "DOWNLOAD_ROUTE_ERROR";
  return NextResponse.json({ success: false, ok: false, code, error: message, message, ...extra }, { status });
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

async function readContentOrError(doc: ExportReadyDocument) {
  try {
    return { ok: true as const, content: await readGeneratedDocumentContent(doc) };
  } catch (error) {
    return {
      ok: false as const,
      response: err("Document bytes are unavailable. Regenerate the document or reattach the final file before export.", 409, {
        code: "STORAGE_CONTENT_UNAVAILABLE",
        documentId: doc.id,
        fileName: doc.exactFileName ?? fileName(doc.name),
        hasStoragePath: Boolean(doc.storagePath),
        hasInlineFileContent: Boolean(doc.fileContent),
        detail: error instanceof Error ? error.message : String(error),
      }),
    };
  }
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
  if (!generation?.ready) return { ok: false as const, response: err("Final export blocked by generation-readiness blockers.", 409, { code: "GENERATION_NOT_READY", blockers: generation?.blockers ?? [], warnings: generation?.warnings ?? [], nextAction: "OPEN_GENERATION_READINESS" }) };

  const critical = tender.complianceGaps.filter((g: any) => !g.isResolved && g.severity === "CRITICAL");
  if (critical.length) return { ok: false as const, response: err("Final export blocked by unresolved CRITICAL compliance gaps.", 409, { code: "CRITICAL_COMPLIANCE_GAPS", reasons: critical.map((g: any) => g.title) }) };

  return { ok: true as const, companyId: company.id };
}

async function internalReport(userId: string, tender: any, type: string) {
  const lines: string[] = [`Tender: ${tender.title}`];
  if (type === "compliance") {
    if (!tender.complianceGaps.length) lines.push("No compliance gaps identified.");
    for (const gap of tender.complianceGaps) lines.push(`[${gap.severity}] ${gap.title}`, gap.description, gap.mitigationPlan ? `Mitigation: ${gap.mitigationPlan}` : "");
  } else if (type === "requirements") {
    for (const req of tender.requirements) lines.push(`[${req.priority}] ${req.requirementType}: ${req.title}`, req.description);
  } else return err("Unsupported download type", 400, { code: "UNSUPPORTED_DOWNLOAD_TYPE" });

  const buffer = await Packer.toBuffer(makeInternalDoc(`Internal ${type} report`, lines.filter(Boolean)));
  const name = `${safeFileBaseName(tender.title)}-${type}-internal.docx`;
  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: tender.id, description: `Downloaded internal ${type} report for "${tender.title}"` });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${name}"` } });
}

async function singleDocument(userId: string, tender: any, docId: string) {
  const raw = tender.generatedDocuments.find((d: any) => d.id === docId);
  if (!raw || raw.generationStatus !== "GENERATED") return err("Document not found or not yet generated.", 404, { code: "DOCUMENT_NOT_FOUND" });
  if (!isFinalExportCandidateDocument(raw)) return err("This workspace draft is not a final export file.", 409, { code: "INTERNAL_DRAFT_NOT_EXPORTABLE" });
  if (!generatedDocumentHasContent(raw)) return err("Document content is unavailable.", 409, { code: "MISSING_CONTENT" });

  const doc = asReadyDoc(raw);
  const readiness = checkExportReadiness([doc], { requireFileContent: false });
  if (!readiness.ok) return err(exportReadinessError(readiness.failures), 409, { code: "DOCUMENT_NOT_READY", failures: readiness.failures });

  const contentResult = await readContentOrError(doc);
  if (!contentResult.ok) return contentResult.response;
  const content = contentResult.content;
  const sig = validateFileSignature(content.filename, content.base64);
  if (!sig.ok) return err(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: doc.id, description: `Downloaded generated document "${content.filename}"` });
  return new NextResponse(new Uint8Array(content.buffer), { headers: { "Content-Type": content.mimeType, "Content-Disposition": `attachment; filename="${content.filename}"` } });
}

type EnvelopeFilter = SubmissionEnvelope | null;

function parseEnvelopeQuery(value: string | null): EnvelopeFilter | "INVALID" {
  if (!value) return null;
  const up = value.trim().toUpperCase();
  if (up === "TECHNICAL" || up === "FINANCIAL" || up === "ADMIN") return up;
  return "INVALID";
}

async function zipPackage(userId: string, tender: any, envelopeFilter: EnvelopeFilter) {
  const gate = await finalPackageGate(userId, tender);
  if (!gate.ok) return gate.response;

  // Canonical readiness gate — same helper used by Export Readiness API,
  // Bid Control, and Final Submission Control Center. Backend MUST reject
  // direct ZIP downloads when canonical ok === false so a user cannot
  // bypass blockers by hitting /download?type=zip directly.
  const canonical = await getFinalSubmissionReadiness(prisma, { tenderId: tender.id, userId, requireFileContent: false });
  if (!canonical) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });
  if (!canonical.ok) {
    return err(
      canonical.message,
      409,
      {
        code: "EXPORT_READINESS_BLOCKED",
        documentBlockers: canonical.documentBlockers,
        tenderLevelBlockers: canonical.tenderLevelBlockers,
        advisoryWarnings: canonical.advisoryWarnings,
        summary: canonical.summary,
      },
    );
  }

  // Strict two-envelope tenders: the canonical helper sets
  // summary.strictTwoEnvelope when the tender requires SEPARATE technical
  // and financial envelopes. In that case we MUST NOT produce one mixed
  // ZIP. Either:
  //   (a) reject the unqualified request with a clear 409 and instruct the
  //       caller to specify ?envelope=technical or ?envelope=financial, or
  //   (b) build one ZIP per envelope when the caller specifies the
  //       envelope= query.
  const docs: ExportReadyDocument[] = filterFinalExportCandidateDocuments(tender.generatedDocuments as any[])
    .filter((d: any) => d.generationStatus === "GENERATED")
    .map(asReadyDoc)
    .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER));

  if (!docs.length) return err("No final exportable generated documents to package.", 400, { code: "NO_FINAL_EXPORT_CANDIDATES" });

  // Annotate each doc with its envelope and filter when ?envelope= is set.
  const docEnvelopes = new Map(docs.map((d) => [d.id, inferEnvelope(d.documentType ?? "TECHNICAL", d.exactFileName ?? d.name ?? "")]));
  const fullEnvelopeCounts: Record<SubmissionEnvelope, number> = { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 };
  for (const env of docEnvelopes.values()) fullEnvelopeCounts[env] = (fullEnvelopeCounts[env] ?? 0) + 1;

  if (canonical.summary.strictTwoEnvelope && envelopeFilter === null) {
    return err(
      "This tender requires SEPARATE sealed technical and financial envelopes. Use /download?type=zip&envelope=technical and /download?type=zip&envelope=financial to download each package separately. Submitting one mixed ZIP would be non-compliant.",
      409,
      {
        code: "SEPARATE_ENVELOPE_REQUIRED",
        envelopeBreakdown: fullEnvelopeCounts,
        suggestedRequests: [
          `?type=zip&envelope=technical`,
          `?type=zip&envelope=financial`,
          ...(fullEnvelopeCounts.ADMIN > 0 ? [`?type=zip&envelope=admin`] : []),
        ],
      },
    );
  }

  const scopedDocs = envelopeFilter ? docs.filter((d) => docEnvelopes.get(d.id) === envelopeFilter) : docs;
  if (envelopeFilter && scopedDocs.length === 0) {
    return err(`No generated documents in the ${envelopeFilter} envelope.`, 409, { code: "NO_DOCUMENTS_IN_ENVELOPE", envelopeBreakdown: fullEnvelopeCounts });
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const scope = buildFinalZipEntries({
    tender: { exactFileNaming: tender.exactFileNaming, exactFileOrder: tender.exactFileOrder, requirements: tender.requirements.map((r: any) => ({ exactFileName: r.exactFileName ?? null })) },
    generatedDocs: scopedDocs.map((d) => ({ id: d.id, name: d.name, exactFileName: d.exactFileName, exactOrder: d.exactOrder ?? null, documentType: d.documentType ?? null })),
  });

  const byId = new Map(scopedDocs.map((d) => [d.id, d]));
  const entries = scope.entries.filter((entry) => Boolean(entry.generatedDocId && byId.get(entry.generatedDocId)));
  if (!entries.length) return err("Final ZIP has no entries after scope filtering.", 409, { code: "NO_ZIP_ENTRIES_AFTER_SCOPE_FILTERING", exclusions: scope.exclusions });

  // Pre-check: identify entries whose document has no file content before attempting ZIP.
  // This gives a clear structured error listing exactly which documents need regenerating,
  // rather than a generic storage error mid-loop.
  const noContent = entries
    .map((entry) => byId.get(entry.generatedDocId!))
    .filter((doc): doc is ExportReadyDocument => !!doc && !doc.fileContent && !doc.storagePath);
  if (noContent.length) {
    const names = noContent.map((d) => d.exactFileName ?? d.name ?? d.id);
    return err(
      `${noContent.length} document(s) have no file content and cannot be exported: ${names.join(", ")}. Run auto-finalize or regenerate these documents first.`,
      409,
      { code: "DOCUMENTS_MISSING_CONTENT", documents: noContent.map((d) => ({ id: d.id, name: d.exactFileName ?? d.name })) },
    );
  }

  // Duplicate filename guard — two docs with the same ZIP path would silently overwrite each other.
  const seenNames = new Set<string>();
  const dupes: string[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (seenNames.has(name)) dupes.push(entry.name);
    seenNames.add(name);
  }
  if (dupes.length) return err(`Duplicate filenames in export package: ${dupes.join(", ")}. Ensure each document has a unique exactFileName.`, 409, { code: "DUPLICATE_FILENAMES_IN_ZIP", duplicates: dupes });

  for (const entry of entries) {
    const doc = byId.get(entry.generatedDocId!);
    if (!doc) continue;
    const contentResult = await readContentOrError(doc);
    if (!contentResult.ok) return contentResult.response;
    const content = contentResult.content;
    const sig = validateFileSignature(content.filename, content.base64);
    if (!sig.ok) return err(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });
    zip.file(entry.name || fileName(doc.name), content.buffer);
  }

  // ── Envelope breakdown — annotate the response so clients know how many
  // TECHNICAL / FINANCIAL / ADMIN files are in this ZIP. For two-envelope
  // tenders the caller should submit the FINANCIAL files in a separate
  // sealed envelope; they are included here for single-envelope submissions
  // (and split into separate ZIPs when ?envelope=… is used).
  const envelopeCounts: Record<SubmissionEnvelope, number> = { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 };
  for (const entry of entries) {
    const doc = byId.get(entry.generatedDocId!);
    if (!doc) continue;
    const env = docEnvelopes.get(doc.id) ?? "TECHNICAL";
    envelopeCounts[env] = (envelopeCounts[env] ?? 0) + 1;
  }
  const envelopeBreakdown = `TECHNICAL=${envelopeCounts.TECHNICAL},FINANCIAL=${envelopeCounts.FINANCIAL},ADMIN=${envelopeCounts.ADMIN}`;
  const hasFinancialDocs = envelopeCounts.FINANCIAL > 0;

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // Name the ZIP after the envelope when scoped, so the user has clarity:
  //   submission-package.zip                  — single combined
  //   submission-package-technical.zip        — technical envelope only
  //   submission-package-financial.zip        — financial envelope only
  const baseLabel = `${safeFileBaseName(tender.title)}-submission-package`;
  const zipName = envelopeFilter
    ? `${baseLabel}-${envelopeFilter.toLowerCase()}.zip`
    : `${baseLabel}.zip`;
  const fileList = entries.map((entry) => entry.name);
  // Fresh read before create/update to avoid stale-object race on concurrent requests.
  const freshPkg = await prisma.exportPackage.findFirst({ where: { tenderId: tender.id }, orderBy: { createdAt: "desc" } });
  if (freshPkg) await prisma.exportPackage.update({ where: { id: freshPkg.id }, data: { status: "READY", fileList: JSON.stringify(fileList), downloadCount: { increment: 1 } } });
  else await prisma.exportPackage.create({ data: { tenderId: tender.id, status: "READY", fileList: JSON.stringify(fileList), downloadCount: 1 } });

  await logAction({
    userId,
    action: "EXPORT_PACKAGE_DOWNLOAD",
    entityType: "Tender",
    entityId: tender.id,
    description: `Downloaded ${envelopeFilter ? envelopeFilter + " envelope " : ""}ZIP package for "${tender.title}" (${entries.length} file(s); ${envelopeBreakdown})`,
  });
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${zipName}"`,
    "X-Envelope-Breakdown": envelopeBreakdown,
  };
  if (envelopeFilter) responseHeaders["X-Envelope-Scope"] = envelopeFilter;
  if (hasFinancialDocs && !envelopeFilter) {
    responseHeaders["X-Envelope-Note"] =
      "FINANCIAL documents are included. If this tender requires separate technical and financial envelopes, submit the financial files in a separate sealed package per the tender instructions.";
  }
  return new NextResponse(new Uint8Array(zipBuffer), { headers: responseHeaders });
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
    const envelopeRaw = parseEnvelopeQuery(searchParams.get("envelope"));
    if (envelopeRaw === "INVALID") {
      return err("Invalid envelope query parameter. Use technical, financial, or admin.", 400, { code: "INVALID_ENVELOPE_QUERY" });
    }

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true, complianceGaps: true, generatedDocuments: true, exportPackages: true } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    if (docId) return await singleDocument(actor.id, tender, docId);
    if (type === "zip") return await zipPackage(actor.id, tender, envelopeRaw);
    if (type === "compliance" || type === "requirements") return await internalReport(actor.id, tender, type);
    return err("Direct proposal export is disabled. Generate and download final documents or the ZIP package instead.", 409, { code: "DIRECT_PROPOSAL_EXPORT_DISABLED" });
  } catch (error) {
    console.error("Tender download route failed", error);
    return err("Download route failed.", 500, { code: "DOWNLOAD_ROUTE_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
