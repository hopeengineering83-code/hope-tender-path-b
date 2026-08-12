/**
 * POST /api/tenders/[id]/finalize-pdf
 *
 * Finalizes the tender's REQUIRED PDF file(s) (e.g. "Technical Proposal.pdf")
 * by rendering a real PDF from the matching approved generated DOCX source
 * document, and persisting it as a new GeneratedDocument with the exact
 * required filename.
 *
 * Fail-closed guarantees:
 *   • the central generation/export gate must pass first,
 *   • the source document must be GENERATED + validated + approved + current
 *     (enforced inside finalizeRequiredPdf),
 *   • the rendered bytes are %PDF-validated before persisting,
 *   • the persisted PDF starts at validationStatus=PENDING /
 *     reviewStatus=PENDING — it must pass the same validation + approval
 *     pipeline as every other document before it can reach the final ZIP,
 *   • when no eligible source exists the response is the structured
 *     PDF_REQUIRED_CONVERSION_UNAVAILABLE blocker, never a fake success.
 */
import { NextResponse } from "next/server";
import { logger } from "../../../../../lib/observability";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";
import { verifiedIntegrityDataFromBase64 } from "../../../../../lib/engine/persisted-byte-integrity";
import { withTransactionalGenerationGate } from "../../../../../lib/engine/transactional-generation-gate";
import { detectTenderFormatPolicy } from "../../../../../lib/engine/export-format-policy";
import { isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";
import { finalizeRequiredPdf, isBase64PdfContent, normalizeFileBaseName } from "../../../../../lib/engine/workflow/pdf-finalizer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "PDF_FINALIZE_ERROR";
  return NextResponse.json({ success: false, ok: false, code, error: message, message, ...extra }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;
    let body: { docId?: unknown; requiredFileName?: unknown } = {};
    try { body = await req.json(); } catch { body = {}; }
    const docId = typeof body.docId === "string" && body.docId.trim() ? body.docId.trim() : null;
    const requestedName = typeof body.requiredFileName === "string" && body.requiredFileName.trim() ? body.requiredFileName.trim() : null;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: {
        requirements: true,
        generatedDocuments: true,
        // Tender has no direct `company` relation — company is reached via
        // tender.user.company. Including a nonexistent relation throws a
        // PrismaClientValidationError at runtime (HTTP 500) which broke the
        // cross-user-isolation E2E test (foreign docId → expected 404, got 500).
        user: {
          select: {
            company: {
              select: { name: true, legalName: true, address: true, phone: true, email: true, website: true },
            },
          },
        },
      },
    });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const activeDocs = tender.generatedDocuments.filter((document: any) =>
      isFinalExportCandidateDocument(document),
    );
    // Resolve an explicitly supplied nested ID before exposing any tender
    // readiness state. Foreign and nonexistent IDs are indistinguishable.
    if (docId && !activeDocs.some((document: any) => document.id === docId)) {
      return err("Source document not found", 404, { code: "PDF_SOURCE_NOT_FOUND" });
    }

    // Central authoritative gate — PDF finalization produces a final-package
    // artifact, so it must hold the same fail-closed gate as the ZIP path
    // (current content hash, grounding, confirmed non-empty submission plan).
    // Purpose "generate-missing-plan-files": this route CREATES a missing
    // required plan file, so it must not run the final-zip completeness check
    // (validateConfirmedPlanDocuments) — that check requires the very PDF this
    // route produces to already exist, which made the route always return
    // CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE. The draft-purpose gate still
    // enforces ownership, extraction, analysis hash/state, requirement
    // grounding, and a confirmed valid Build Plan; final-level assurance is
    // preserved because the finalizer requires a validated + approved source
    // and the produced PDF must itself pass validation + approval + the
    // final-zip gate before it can be exported.
    const gate = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId: actor.id, purpose: "generate-missing-plan-files" });
    if (!gate.ok) return err(`PDF finalization blocked: ${gate.blockerDetail}`, 409, { code: gate.blockerCode });

    const policy = detectTenderFormatPolicy({
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      requirements: tender.requirements.map((r: { exactFileName: string | null }) => ({ exactFileName: r.exactFileName ?? null })),
    });
    const requiredPdfNames = policy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName);
    if (requiredPdfNames.length === 0) {
      return err("This tender's submission plan does not name any required PDF file, so there is nothing to finalize.", 409, { code: "PDF_NOT_REQUIRED" });
    }

    // A required PDF counts as satisfied only when the row's REAL bytes carry
    // the %PDF signature. A DOCX accidentally stored under the .pdf name, or
    // junk bytes, must stay eligible for (re)finalization — otherwise this
    // route refuses to replace the bad row while final export stays blocked,
    // leaving no in-app recovery. Storage-backed rows are NOT trusted blindly:
    // their bytes are loaded and signature-checked the same way (unreadable
    // storage bytes count as NOT satisfied — fail closed toward regeneration).
    const satisfiedNames = new Set<string>();
    for (const name of requiredPdfNames) {
      const row = activeDocs.find(
        (d: any) =>
          (d.exactFileName ?? "").trim().toLowerCase() === name.toLowerCase() &&
          d.generationStatus === "GENERATED" &&
          generatedDocumentHasContent(d),
      );
      if (!row) continue;
      if (row.fileContent) {
        if (isBase64PdfContent(row.fileContent)) satisfiedNames.add(name.toLowerCase());
        continue;
      }
      try {
        const stored = await readGeneratedDocumentContent({
          id: String(row.id),
          name: row.name ?? name,
          exactFileName: row.exactFileName ?? null,
          fileContent: null,
          storagePath: row.storagePath ?? null,
          contentSha256: row.contentSha256 ?? null,
          contentByteLength: row.contentByteLength ?? null,
          contentMimeType: row.contentMimeType ?? null,
          detectedFormat: row.detectedFormat ?? null,
          integrityStatus: row.integrityStatus ?? "UNKNOWN",
        }, { requireVerifiedIntegrity: true });
        if (isBase64PdfContent(stored.base64)) satisfiedNames.add(name.toLowerCase());
      } catch (error) {
        logger.warn("finalize-pdf: storage-backed required PDF bytes unreadable — treating as not satisfied", { documentId: row.id, detail: error instanceof Error ? error.constructor.name : "UnknownError" });
      }
    }
    let targets = requiredPdfNames.filter((name) => !satisfiedNames.has(name.toLowerCase()));
    if (requestedName) {
      targets = targets.filter((n) => n.toLowerCase() === requestedName.toLowerCase());
      if (!targets.length) {
        return err(`"${requestedName}" is not a missing required PDF for this tender.`, 400, { code: "PDF_TARGET_NOT_MISSING", requiredPdfFiles: requiredPdfNames });
      }
    }
    if (targets.length === 0) {
      return NextResponse.json({
        ok: true,
        success: true,
        created: [],
        blocked: [],
        requiredPdfFiles: requiredPdfNames,
        message: "All required PDF files already have an active generated PDF document.",
      });
    }
    if (docId && targets.length > 1) {
      return err("docId was provided but multiple required PDF files are missing. Pass requiredFileName to pick one.", 400, { code: "PDF_TARGET_AMBIGUOUS", missing: targets });
    }

    const created: Array<{ id: string; fileName: string; sourceDocumentId: string; byteLength: number }> = [];
    const blocked: Array<{ requiredFileName: string; code: string; message: string }> = [];

    for (const requiredName of targets) {
      // Source: the explicitly requested document, or the active generated
      // DOCX whose base name matches the required PDF name
      // ("Technical Proposal.docx" → "Technical Proposal.pdf").
      const source = docId
        ? activeDocs.find((d: any) => d.id === docId)
        : activeDocs.find(
            (d: any) =>
              d.generationStatus === "GENERATED" &&
              (d.exactFileName ?? d.name ?? "").toLowerCase().endsWith(".docx") &&
              normalizeFileBaseName(d.exactFileName ?? d.name ?? "") === normalizeFileBaseName(requiredName),
          );
      // An explicitly requested source must match the required PDF's base name
      // just like the automatic lookup — otherwise a technical DOCX could be
      // rendered and saved as "Financial Proposal.pdf": a correctly named
      // final artifact with the wrong document body.
      if (docId && source && normalizeFileBaseName(source.exactFileName ?? source.name ?? "") !== normalizeFileBaseName(requiredName)) {
        blocked.push({
          requiredFileName: requiredName,
          code: "PDF_SOURCE_NAME_MISMATCH",
          message: `The selected source document does not match "${requiredName}". Pick the document whose filename matches the required PDF, or omit docId to use the automatic match.`,
        });
        continue;
      }
      if (!source) {
        blocked.push({
          requiredFileName: requiredName,
          code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE",
          message: `No approved generated source document matches "${requiredName}". Generate, validate, and approve the matching document first, or upload the tender-issued PDF.`,
        });
        continue;
      }

      let base64: string | null = source.fileContent ?? null;
      if (!base64 && source.storagePath) {
        try {
          base64 = (await readGeneratedDocumentContent({
            id: String(source.id),
            name: source.name ?? requiredName,
            exactFileName: source.exactFileName ?? null,
            fileContent: source.fileContent ?? null,
            storagePath: source.storagePath ?? null,
            contentSha256: source.contentSha256 ?? null,
            contentByteLength: source.contentByteLength ?? null,
            contentMimeType: source.contentMimeType ?? null,
            detectedFormat: source.detectedFormat ?? null,
            integrityStatus: source.integrityStatus ?? "UNKNOWN",
          }, { requireVerifiedIntegrity: true })).base64;
        } catch (error) {
          logger.error("finalize-pdf: storage-backed source bytes unavailable", { documentId: source.id, errorName: error instanceof Error ? error.constructor.name : typeof error });
          blocked.push({
            requiredFileName: requiredName,
            code: "PDF_SOURCE_CONTENT_MISSING",
            message: `The source document for "${requiredName}" has no readable content bytes. Regenerate it before finalizing the PDF.`,
          });
          continue;
        }
      }

      const finalized = await finalizeRequiredPdf({
        requiredFileName: requiredName,
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
          id: String(source.id),
          name: source.name ?? null,
          exactFileName: source.exactFileName ?? null,
          documentType: source.documentType ?? null,
          format: source.format ?? null,
          generationStatus: source.generationStatus ?? null,
          validationStatus: source.validationStatus ?? null,
          reviewStatus: source.reviewStatus ?? null,
          fileContent: base64,
          storagePath: source.storagePath ?? null,
        },
      });
      if (!finalized.ok) {
        blocked.push({ requiredFileName: requiredName, code: finalized.code, message: finalized.publicMessage });
        continue;
      }

      const pdfFileContent = finalized.bytes.toString("base64");
      const pdfIntegrity = verifiedIntegrityDataFromBase64({
        fileContent: pdfFileContent,
        filename: requiredName,
        claimedMimeType: "application/pdf",
      });

      // Supersede and create atomically while holding a stable filename lock.
      // A failed create rolls back the supersede, so no request can leave the
      // tender without its previously active PDF row.
      let createdDoc;
      try {
        createdDoc = await prisma.$transaction(async (tx) =>
          withTransactionalGenerationGate({
            prisma,
            tx,
            tenderId: tender.id,
            userId: actor.id,
            purpose: "generate-missing-plan-files",
            write: async (lockedTx) => {
          await lockedTx.generatedDocument.updateMany({
            where: {
              tenderId: tender.id,
              exactFileName: requiredName,
              NOT: { generationStatus: "SUPERSEDED" },
            },
            data: {
              generationStatus: "SUPERSEDED",
              validationStatus: "SUPERSEDED",
              reviewStatus: "SUPERSEDED",
            },
          });
          return lockedTx.generatedDocument.create({
            data: {
              tenderId: tender.id,
              name: requiredName,
              documentType: source.documentType ?? "TECHNICAL_PROPOSAL",
              format: "PDF",
              exactFileName: requiredName,
              exactOrder: source.exactOrder ?? null,
              contentSummary: `Finalized PDF rendered in-engine from the approved source document "${source.exactFileName ?? source.name}".`,
              fileContent: pdfFileContent,
              ...pdfIntegrity,
              // Deliberately PENDING: content creation never implies approval.
              generationStatus: "GENERATED",
              validationStatus: "PENDING",
              reviewStatus: "PENDING",
            },
          });
            },
          }),
        );
      } catch (error) {
        if ((error as { code?: string })?.code === "P2002") {
          logger.warn("finalize-pdf: concurrent finalization detected", { tenderId: tender.id });
          blocked.push({
            requiredFileName: requiredName,
            code: "PDF_FINALIZE_CONFLICT",
            message: `"${requiredName}" was finalized by another request at the same time. Refresh to see the current document.`,
          });
          continue;
        }
        throw error;
      }
      created.push({ id: createdDoc.id, fileName: requiredName, sourceDocumentId: String(source.id), byteLength: finalized.bytes.length });
    }

    await logAction({
      userId: actor.id,
      action: "DOCUMENT_GENERATE",
      entityType: "Tender",
      entityId: tender.id,
      description: `Finalized ${created.length} required PDF file(s) for "${tender.title}"${blocked.length ? `; ${blocked.length} blocked` : ""}`,
    }).catch((error) => logger.warn(`finalize-pdf: failed to log action: ${error instanceof Error ? error.constructor.name : "UnknownError"}`));

    const ok = blocked.length === 0;
    // Gap 4: re-query the canonical final-export authority after the mutation.
    const canonicalReadiness = await getCanonicalReadinessSummary(prisma, actor.id, tender.id);
    return NextResponse.json(
      {
        ok,
        success: ok,
        created,
        blocked,
        requiredPdfFiles: requiredPdfNames,
        canonicalReadiness,
        ...(created.length
          ? { nextStep: "Canonical validation runs next; a passing machine validation makes the finalized PDF export-eligible without impersonating human/legal release approval." }
          : {}),
      },
      { status: ok ? 200 : 422 },
    );
  } catch (error) {
    logger.error("finalize-pdf route failed", { detail: error });
    return err("PDF finalization failed.", 500, { code: "PDF_FINALIZE_ROUTE_RUNTIME_ERROR" });
  }
}
