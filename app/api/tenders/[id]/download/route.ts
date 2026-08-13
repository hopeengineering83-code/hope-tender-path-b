import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, exportReadinessError, isReadyForFinalExport, type ExportReadyDocument } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments, isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../../../../../lib/engine/final-zip-scope";
import { assembleFinalSubmissionZip, FINAL_ZIP_MAX_INPUT_BYTES } from "../../../../../lib/engine/final-zip-assembly";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";
import { verifySourceFilesNotDeleted } from "../../../../../lib/engine/package-revision-safety";
import { inferEnvelope, type SubmissionEnvelope } from "../../../../../lib/engine/submission-plan";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";
import { runAuthorityReview } from "../../../../../lib/engine/authority-review";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { persistVerifiedExportPackageDownload } from "../../../../../lib/engine/export-package-persistence";

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
    contentSha256: doc.contentSha256 ?? null,
    contentByteLength: doc.contentByteLength ?? null,
    contentMimeType: doc.contentMimeType ?? null,
    detectedFormat: doc.detectedFormat ?? null,
    integrityStatus: doc.integrityStatus ?? "UNKNOWN",
    integrityVerifiedAt: doc.integrityVerifiedAt ?? null,
    integrityFailureCode: doc.integrityFailureCode ?? null,
  };
}

async function readContentOrError(doc: ExportReadyDocument) {
  try {
    return { ok: true as const, content: await readGeneratedDocumentContent(doc, { requireVerifiedIntegrity: true }) };
  } catch (error) {
    const safeCode =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "STORAGE_CONTENT_UNAVAILABLE";
    logger.error("readContentOrError: document bytes unavailable", {
      documentId: doc.id,
      errorName: error instanceof Error ? error.constructor.name : typeof error,
      code: safeCode,
    });
    return {
      ok: false as const,
      response: err("Document bytes are unavailable or their integrity is not verified. Regenerate the document or reattach the final file before export.", 409, {
        code: safeCode,
        documentId: doc.id,
        fileName: doc.exactFileName ?? fileName(doc.name),
        hasStoragePath: Boolean(doc.storagePath),
        hasInlineFileContent: Boolean(doc.fileContent),
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

  const centralGate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId, purpose: "final-zip" });
  if (!centralGate.ok) return { ok: false as const, response: err(`Final ZIP blocked: ${centralGate.blockerDetail}`, 409, { code: centralGate.blockerCode }) };

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

  const singleGate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId, purpose: "final-zip" });
  if (!singleGate.ok) return err(`Single-document export blocked: ${singleGate.blockerDetail}`, 409, { code: singleGate.blockerCode });

  const doc = asReadyDoc(raw);
  const readiness = checkExportReadiness([doc], { requireFileContent: false });
  if (!readiness.ok) return err(exportReadinessError(readiness.failures), 409, { code: "DOCUMENT_NOT_READY", failures: readiness.failures });

  const singleAuthorityResult = runAuthorityReview(
    [{
      id: String(raw.id),
      name: String(raw.name ?? raw.exactFileName ?? raw.id),
      documentType: String(raw.documentType ?? ""),
      contentSummary: raw.contentSummary ?? null,
      reviewNotes: raw.reviewNotes ?? null,
      exactFileName: raw.exactFileName ?? null,
    }],
    [],
    [],
  );
  if (singleAuthorityResult.status !== "AUTHORITY_READY") {
    return err(
      `Single-document download blocked by Authority Review (${singleAuthorityResult.status}): ${singleAuthorityResult.blockers.length} issue(s) must be resolved.`,
      422,
      {
        code: "AUTHORITY_REVIEW_BLOCKED",
        authorityStatus: singleAuthorityResult.status,
        blockers: singleAuthorityResult.blockers,
        overallScore: singleAuthorityResult.overallScore,
        affectedDocumentIds: singleAuthorityResult.affectedDocumentIds,
        recommendedFixes: singleAuthorityResult.recommendedFixes,
      },
    );
  }

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

  const finalBuildPlan = await getCurrentConfirmedBuildPlan(prisma, tender.id, userId);
  const finalOperationGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: (tender.requirements ?? []).map((r: any) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
    })),
    overrides: [],
    buildPlan: { ok: finalBuildPlan.ok, items: finalBuildPlan.ok ? finalBuildPlan.items : [] },
    operation: "FINAL_SUBMISSION_READY",
  });
  if (finalOperationGate.warnings.length > 0) {
    logger.info(`[download/zip] tender=${tender.id} operation-gate warnings: ${finalOperationGate.warnings.join("; ")}`);
  }
  if (finalOperationGate.blockers.length > 0) {
    return err(
      `Final submission blocked by operation gate: ${finalOperationGate.blockers.join("; ")}`,
      409,
      {
        code: "OPERATION_GATE_BLOCKED",
        blockers: finalOperationGate.blockers,
        warnings: finalOperationGate.warnings,
      },
    );
  }

  const { validateDocumentQuality } = await import("../../../../../lib/engine/document-quality-validator");
  const { extractDocxVisibleText: extractVisibleText } = await import("../../../../../lib/engine/export-readiness");
  const blockedDocs: any[] = [];
  for (const doc of tender.generatedDocuments) {
    if (!isFinalExportCandidateDocument(doc)) continue;
    let visibleText: string | null = null;
    const currentFileName = doc.exactFileName ?? doc.name ?? "";
    if (doc.fileContent && currentFileName.toLowerCase().endsWith(".docx")) {
      visibleText = await extractVisibleText(doc.fileContent, currentFileName);
    }
    const quality = validateDocumentQuality({
      name: doc.name,
      documentType: doc.documentType,
      fileContent: doc.fileContent,
      storagePath: doc.storagePath,
      visibleText,
    });
    if (quality.status === "BLOCKED") blockedDocs.push(doc);
  }

  if (blockedDocs.length > 0) {
    return err(
      `${blockedDocs.length} document(s) have blocking quality issues (placeholders, AI traces, or envelope mismatches). Fix these before export.`,
      409,
      {
        code: "QUALITY_VALIDATION_BLOCKED",
        blockedDocuments: blockedDocs.map((d: any) => d.exactFileName ?? d.name),
      },
    );
  }

  {
    const authorityDocs = tender.generatedDocuments
      .filter((doc: any) => isFinalExportCandidateDocument(doc) && doc.generationStatus === "GENERATED")
      .map((doc: any) => ({
        id: String(doc.id),
        name: String(doc.name ?? doc.exactFileName ?? doc.id),
        documentType: String(doc.documentType ?? ""),
        contentSummary: doc.contentSummary ?? null,
        reviewNotes: doc.reviewNotes ?? null,
        exactFileName: doc.exactFileName ?? null,
      }));

    const manifestEntries: Array<{ exactFileName: string; documentType: string }> = [];
    for (const req of (tender.requirements ?? [])) {
      if ((req as any).exactFileName) {
        manifestEntries.push({ exactFileName: (req as any).exactFileName, documentType: "TENDER_REQUIRED_FILE" });
      }
    }
    try {
      const parsed = JSON.parse(tender.exactFileNaming ?? "[]");
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string" && entry.trim()) {
            manifestEntries.push({ exactFileName: entry.trim(), documentType: "TENDER_REQUIRED_FILE" });
          } else if (entry && typeof entry === "object" && typeof entry.name === "string") {
            manifestEntries.push({ exactFileName: entry.name.trim(), documentType: entry.documentType ?? "TENDER_REQUIRED_FILE" });
          }
        }
      }
    } catch { /* ignore invalid JSON */ }

    const requiredSections: string[] = [];
    for (const raw of [tender.exactFileNaming, tender.exactFileOrder]) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === "string" && entry.trim()) requiredSections.push(entry.trim());
            else if (entry && typeof entry === "object" && typeof entry.name === "string") requiredSections.push(entry.name.trim());
          }
        }
      } catch { /* ignore */ }
    }

    const authorityResult = runAuthorityReview(authorityDocs, manifestEntries, requiredSections);
    if (authorityResult.status !== "AUTHORITY_READY") {
      if (authorityResult.status === "BLOCKED") {
        return err(
          `Export blocked by Authority Review: ${authorityResult.blockers.length} critical issue(s) must be resolved before export.`,
          422,
          {
            code: "AUTHORITY_REVIEW_BLOCKED",
            blockers: authorityResult.blockers,
            overallScore: authorityResult.overallScore,
            affectedDocumentIds: authorityResult.affectedDocumentIds,
            recommendedFixes: authorityResult.recommendedFixes,
          },
        );
      }
      return err(
        `Export blocked: Authority Review is pending (status: ${authorityResult.status}). Complete the authority review before downloading the final package.`,
        422,
        {
          code: "AUTHORITY_REVIEW_NEEDS_REVIEW",
          authorityStatus: authorityResult.status,
          authorityScore: authorityResult.overallScore,
          blockers: authorityResult.blockers,
          recommendedFixes: authorityResult.recommendedFixes,
        },
      );
    }
  }

  const docs: ExportReadyDocument[] = filterFinalExportCandidateDocuments(tender.generatedDocuments as any[])
    .filter((d: any) => d.generationStatus === "GENERATED")
    .map(asReadyDoc)
    .sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER));

  if (!docs.length) return err("No final exportable generated documents to package.", 400, { code: "NO_FINAL_EXPORT_CANDIDATES" });

  const { detectTenderFormatPolicy, checkTenderFormatCoverage } = await import("../../../../../lib/engine/export-format-policy");
  const zipFormatPolicy = detectTenderFormatPolicy({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    requirements: (tender.requirements ?? []).map((r: any) => ({ exactFileName: r.exactFileName ?? null })),
  });
  const generatedExtensions = docs
    .filter((d) => d.fileContent || d.storagePath)
    .map((d) => (d.exactFileName ?? d.name ?? "").split(".").pop() ?? "")
    .filter(Boolean);
  const formatCoverage = checkTenderFormatCoverage(zipFormatPolicy, generatedExtensions);
  if (!formatCoverage.ok) {
    return err(`Final ZIP blocked: ${formatCoverage.reason}`, 422, {
      code: formatCoverage.code,
      missing: formatCoverage.missing,
    });
  }

  const sourceCheck = await verifySourceFilesNotDeleted(prisma, tender.id);
  if (!sourceCheck.ok) {
    return err("Source files required for grounding have been deleted. Restore the genuine source and re-run AI Analyze, then Run Engine; downstream documents will be regenerated automatically.", 409, { code: "SOURCE_FILES_DELETED" });
  }

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
    const available = (Object.entries(fullEnvelopeCounts) as Array<[string, number]>).filter(([, count]) => count > 0).map(([env]) => env.toLowerCase());
    return err(
      `No generated documents in the ${envelopeFilter} envelope.${available.length ? ` Available: ${available.join(", ")}.` : ""}`,
      409,
      { code: "NO_DOCUMENTS_IN_ENVELOPE", requested: envelopeFilter, available, envelopeBreakdown: fullEnvelopeCounts },
    );
  }

  const scope = buildFinalZipEntries({
    tender: { exactFileNaming: tender.exactFileNaming, exactFileOrder: tender.exactFileOrder, requirements: tender.requirements.map((r: any) => ({ exactFileName: r.exactFileName ?? null })) },
    generatedDocs: scopedDocs.map((d) => ({
      id: d.id,
      name: d.name,
      exactFileName: d.exactFileName,
      exactOrder: d.exactOrder ?? null,
      documentType: d.documentType ?? null,
      format: d.format,
    })),
  });

  const byId = new Map(scopedDocs.map((d) => [d.id, d]));
  const entries = scope.entries.filter((entry) => Boolean(entry.generatedDocId && byId.get(entry.generatedDocId)));
  if (!entries.length) return err("Final ZIP has no entries after scope filtering.", 409, { code: "NO_ZIP_ENTRIES_AFTER_SCOPE_FILTERING", exclusions: scope.exclusions });

  const noContent = entries
    .map((entry) => byId.get(entry.generatedDocId!))
    .filter((doc): doc is ExportReadyDocument => !!doc && !doc.fileContent && !doc.storagePath);
  if (noContent.length) {
    const names = noContent.map((d) => d.exactFileName ?? d.name ?? d.id);
    return err(
      `${noContent.length} document(s) have no file content and cannot be exported: ${names.join(", ")}. Automatic post-Engine finalization must produce verified bytes before export.`,
      409,
      { code: "DOCUMENTS_MISSING_CONTENT", documents: noContent.map((d) => ({ id: d.id, name: d.exactFileName ?? d.name })) },
    );
  }

  const seenNames = new Set<string>();
  const dupes: string[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (seenNames.has(name)) dupes.push(entry.name);
    seenNames.add(name);
  }
  if (dupes.length) return err(`Duplicate filenames in export package: ${dupes.join(", ")}. Ensure each document has a unique exactFileName.`, 409, { code: "DUPLICATE_FILENAMES_IN_ZIP", duplicates: dupes });

  const zipContents: Array<{ generatedDocId: string; bytes: Buffer | Uint8Array }> = [];
  for (const entry of entries) {
    const doc = byId.get(entry.generatedDocId!);
    if (!doc) continue;
    const contentResult = await readContentOrError(doc);
    if (!contentResult.ok) return contentResult.response;
    const content = contentResult.content;
    const sig = validateFileSignature(content.filename, content.base64);
    if (!sig.ok) return err(`File signature mismatch on ${content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });

    const { verifyFileBytes } = await import("../../../../../lib/engine/file-byte-integrity");
    const integrityResult = verifyFileBytes({
      storedSha256: (doc as any).sha256 ?? (doc as any).contentSha256 ?? null,
      storedByteSize: (doc as any).byteSize ?? (doc as any).contentByteLength ?? null,
      buffer: content.buffer,
      fileName: content.filename,
    });
    if (!integrityResult.ok) {
      return err(`File integrity check failed: ${integrityResult.detail}`, 422, { code: integrityResult.code, fileName: content.filename });
    }

    zipContents.push({ generatedDocId: doc.id, bytes: content.buffer });
  }

  const totalZipInputBytes = zipContents.reduce(
    (sum, item) => sum + (item.bytes?.byteLength ?? 0),
    0,
  );
  if (totalZipInputBytes > FINAL_ZIP_MAX_INPUT_BYTES) {
    const limitMb = Math.floor(FINAL_ZIP_MAX_INPUT_BYTES / (1024 * 1024));
    const actualMb = (totalZipInputBytes / (1024 * 1024)).toFixed(1);
    return err(
      `Final ZIP package would exceed the ${limitMb}MB safety cap (PERF-003). The current package is ~${actualMb}MB of uncompressed document content. Reduce the package size by splitting envelopes or removing non-final documents before exporting.`,
      413,
      {
        code: "FINAL_ZIP_SIZE_CAP_EXCEEDED",
        limitBytes: FINAL_ZIP_MAX_INPUT_BYTES,
        actualBytes: totalZipInputBytes,
      },
    );
  }

  let assembledZip;
  try {
    assembledZip = await assembleFinalSubmissionZip(entries, zipContents);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error("Final ZIP assembly/verification failed", {
      errorName: error instanceof Error ? error.constructor.name : typeof error,
    });
    if (/PERF-003|safety cap/i.test(detail)) {
      return err(
        `Final ZIP package exceeds the ${Math.floor(FINAL_ZIP_MAX_INPUT_BYTES / (1024 * 1024))}MB safety cap (PERF-003). Reduce the package size by splitting envelopes or removing non-final documents.`,
        413,
        { code: "FINAL_ZIP_SIZE_CAP_EXCEEDED", limitBytes: FINAL_ZIP_MAX_INPUT_BYTES },
      );
    }
    return err("Final ZIP verification failed. Automatic post-Engine repair must recreate and verify the affected bytes before export.", 422, {
      code: "FINAL_ZIP_VERIFICATION_FAILED",
    });
  }

  const envelopeCounts: Record<SubmissionEnvelope, number> = { TECHNICAL: 0, FINANCIAL: 0, ADMIN: 0 };
  for (const entry of entries) {
    const doc = byId.get(entry.generatedDocId!);
    if (!doc) continue;
    const env = docEnvelopes.get(doc.id) ?? "TECHNICAL";
    envelopeCounts[env] = (envelopeCounts[env] ?? 0) + 1;
  }
  const envelopeBreakdown = `TECHNICAL=${envelopeCounts.TECHNICAL},FINANCIAL=${envelopeCounts.FINANCIAL},ADMIN=${envelopeCounts.ADMIN}`;
  const hasFinancialDocs = envelopeCounts.FINANCIAL > 0;

  const zipBuffer = assembledZip.buffer;
  const baseLabel = `${safeFileBaseName(tender.title)}-submission-package`;
  const zipName = envelopeFilter
    ? `${baseLabel}-${envelopeFilter.toLowerCase()}.zip`
    : `${baseLabel}.zip`;
  const fileList = assembledZip.fileList;

  // The exact verified ZIP snapshot and the tender lifecycle transition are a
  // single tenant-scoped transaction. The helper locks the tender row, reuses
  // an identical hash safely under concurrent downloads, and creates a distinct
  // snapshot when a technical/financial envelope produces different bytes.
  const exportPackage = await persistVerifiedExportPackageDownload(prisma, {
    tenderId: tender.id,
    userId,
    fileListJson: JSON.stringify(fileList),
    manifestJson: JSON.stringify(assembledZip.manifest),
    packageSha256: assembledZip.packageSha256,
    packageByteLength: zipBuffer.length,
    verifiedAt: new Date(),
  });

  await logAction({
    userId,
    action: "EXPORT_PACKAGE_DOWNLOAD",
    entityType: "Tender",
    entityId: tender.id,
    description: `Downloaded ${envelopeFilter ? envelopeFilter + " envelope " : ""}ZIP package for "${tender.title}" (${entries.length} file(s); ${envelopeBreakdown})`,
    metadata: {
      exportPackageId: exportPackage.id,
      packageSha256: assembledZip.packageSha256,
      packageByteLength: zipBuffer.length,
      envelopeScope: envelopeFilter ?? "COMBINED",
    },
  });
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${zipName}"`,
    "X-Envelope-Breakdown": envelopeBreakdown,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (envelopeFilter) responseHeaders["X-Envelope-Scope"] = envelopeFilter;
  if (hasFinancialDocs && !envelopeFilter) {
    responseHeaders["X-Envelope-Note"] =
      "FINANCIAL documents are included. If this tender requires separate technical and financial envelopes, submit the financial files in a separate sealed package per the tender instructions.";
  }
  responseHeaders["Content-Length"] = String(zipBuffer.length);
  const zipStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(zipBuffer));
      controller.close();
    },
  });
  return new NextResponse(zipStream, { headers: responseHeaders });
}

async function proposalPdf(userId: string, tender: any, docId: string | null) {
  const docs = (tender.generatedDocuments as any[]).filter(
    (d: any) => d.generationStatus === "GENERATED" && isFinalExportCandidateDocument(d) && generatedDocumentHasContent(d),
  );
  if (!docs.length) return err("No generated documents are available for PDF export. Automatic post-Engine generation must complete first.", 400, { code: "NO_DOCS_FOR_PDF" });

  const pdfGate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId, purpose: "final-zip" });
  if (!pdfGate.ok) return err(`PDF export blocked: ${pdfGate.blockerDetail}`, 409, { code: pdfGate.blockerCode });

  const technicalMatch = (d: any) => /technical.proposal|technical_proposal/i.test(d.exactFileName ?? d.name ?? "");
  const target = docId
    ? docs.find((d: any) => d.id === docId)
    : docs.find((d: any) => technicalMatch(d) && (d.exactFileName ?? d.name ?? "").toLowerCase().endsWith(".docx"))
      ?? docs.find((d: any) => technicalMatch(d))
      ?? docs[0];
  if (!target) return err("Target document not found or not yet generated.", 404, { code: "PDF_DOC_NOT_FOUND" });

  const targetFileName = (target.exactFileName ?? target.name ?? "").toLowerCase();
  if (targetFileName.endsWith(".pdf")) {
    if (!isReadyForFinalExport(asReadyDoc(target))) {
      return err(
        "This PDF exists but has not passed canonical machine validation and export eligibility. Automatic post-Engine processing must complete, or a specific fail-closed blocker must be resolved, before download.",
        409,
        { code: "PDF_DOC_NOT_EXPORT_READY", document: target.exactFileName ?? target.name },
      );
    }
    const pdfContent = await readContentOrError(asReadyDoc(target));
    if (!pdfContent.ok) return pdfContent.response;
    const sig = validateFileSignature(pdfContent.content.filename, pdfContent.content.base64);
    if (!sig.ok) return err(`File signature mismatch on ${pdfContent.content.filename}.`, 422, { code: "FILE_SIGNATURE_MISMATCH", reason: sig.reason });
    await logAction({
      userId,
      action: "EXPORT_PACKAGE_DOWNLOAD",
      entityType: "GeneratedDocument",
      entityId: target.id,
      description: `Downloaded finalized PDF "${pdfContent.content.filename}" for tender "${tender.title}"`,
    });
    return new NextResponse(new Uint8Array(pdfContent.content.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfContent.content.filename}"`,
      },
    });
  }

  const contentResult = await readContentOrError(asReadyDoc(target));
  if (!contentResult.ok) return contentResult.response;
  const content = contentResult.content;

  const { finalizeRequiredPdf, resolveRequiredPdfFileName } = await import("../../../../../lib/engine/workflow/pdf-finalizer");
  const { detectTenderFormatPolicy } = await import("../../../../../lib/engine/export-format-policy");
  const pdfPolicy = detectTenderFormatPolicy({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    requirements: (tender.requirements ?? []).map((r: any) => ({ exactFileName: r.exactFileName ?? null })),
  });
  const safeBase = (tender.title ?? "proposal").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 60) || "proposal";
  const pdfName = resolveRequiredPdfFileName(pdfPolicy, target) ?? `${safeBase}-proposal.pdf`;

  const finalized = await finalizeRequiredPdf({
    requiredFileName: pdfName,
    tender: {
      title: tender.title ?? null,
      clientName: (tender as any).clientName ?? (tender as any).procuringEntityName ?? null,
      reference: tender.reference ?? null,
      submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
    },
    company: (tender as any)?.user?.company
      ? {
          name: (tender as any).user.company.name ?? null,
          address: (tender as any).user.company.address ?? null,
          phone: (tender as any).user.company.phone ?? null,
          email: (tender as any).user.company.email ?? null,
          website: (tender as any).user.company.website ?? null,
        }
      : null,
    sourceDocument: {
      id: String(target.id),
      name: target.name ?? null,
      exactFileName: target.exactFileName ?? content.filename,
      documentType: target.documentType ?? null,
      format: target.format ?? null,
      generationStatus: target.generationStatus ?? null,
      validationStatus: target.validationStatus ?? null,
      reviewStatus: target.reviewStatus ?? null,
      fileContent: content.base64,
      storagePath: target.storagePath ?? null,
    },
  });
  if (!finalized.ok) {
    const status = finalized.code === "PDF_REQUIRED_CONVERSION_UNAVAILABLE" ? 422 : 409;
    return err(finalized.publicMessage, status, { code: finalized.code, document: target.exactFileName ?? target.name });
  }
  const pdfBytes = finalized.bytes;

  await logAction({
    userId,
    action: "EXPORT_PACKAGE_DOWNLOAD",
    entityType: "GeneratedDocument",
    entityId: target.id,
    description: `Downloaded PDF export of "${target.name ?? target.exactFileName}" for tender "${tender.title}"`,
  });
  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${finalized.fileName}"`,
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
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

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true, complianceGaps: true, generatedDocuments: true, exportPackages: true, user: { select: { company: { select: { name: true, legalName: true, address: true, phone: true, email: true, website: true } } } } } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    if (docId) return await singleDocument(actor.id, tender, docId);
    if (type === "zip") return await zipPackage(actor.id, tender, envelopeRaw);
    if (type === "compliance" || type === "requirements") return await internalReport(actor.id, tender, type);
    if (type === "pdf") return await proposalPdf(actor.id, tender, searchParams.get("docId") ?? null);
    return err("Direct proposal export is disabled. Generate and download final documents or the ZIP package instead.", 409, { code: "DIRECT_PROPOSAL_EXPORT_DISABLED" });
  } catch (error) {
    logger.error("Tender download route failed", { detail: error });
    return err("Download route failed.", 500, { code: "DOWNLOAD_ROUTE_RUNTIME_ERROR" });
  }
}
