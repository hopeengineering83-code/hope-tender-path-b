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
import { detectTenderFormatPolicy } from "../../../../../lib/engine/export-format-policy";
import { isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { generatedDocumentHasContent, readGeneratedDocumentContent } from "../../../../../lib/generated-document-content";
import { finalizeRequiredPdf, normalizeFileBaseName } from "../../../../../lib/engine/workflow/pdf-finalizer";

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
      include: { requirements: true, generatedDocuments: true },
    });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

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

    const activeDocs = tender.generatedDocuments.filter((d: any) => isFinalExportCandidateDocument(d));
    // A required PDF counts as satisfied only when the row's inline bytes are
    // a REAL PDF (%PDF signature). A DOCX accidentally stored under the .pdf
    // name, or junk bytes, must stay eligible for (re)finalization — otherwise
    // this route refuses to replace the bad row while final export stays
    // blocked, leaving no in-app recovery. Storage-backed rows (no inline
    // bytes) are trusted here; the download route revalidates their bytes.
    const isRealPdfContent = (value: string | null | undefined): boolean => {
      if (!value) return false;
      try {
        return Buffer.from(value.slice(0, 12), "base64").toString("latin1").startsWith("%PDF");
      } catch {
        return false;
      }
    };
    const isSatisfied = (name: string) =>
      activeDocs.some(
        (d: any) =>
          (d.exactFileName ?? "").trim().toLowerCase() === name.toLowerCase() &&
          d.generationStatus === "GENERATED" &&
          generatedDocumentHasContent(d) &&
          (d.fileContent ? isRealPdfContent(d.fileContent) : Boolean(d.storagePath)),
      );
    let targets = requiredPdfNames.filter((name) => !isSatisfied(name));
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
          })).base64;
        } catch (error) {
          logger.error("finalize-pdf: storage-backed source bytes unavailable", { documentId: source.id, detail: error });
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
        },
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

      // Supersede any active row still holding the required filename (e.g. a
      // PLANNED control row) so the partial unique index accepts the new PDF.
      await prisma.generatedDocument.updateMany({
        where: { tenderId: tender.id, exactFileName: requiredName, NOT: { generationStatus: "SUPERSEDED" } },
        data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED" },
      });
      const createdDoc = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: requiredName,
          documentType: source.documentType ?? "TECHNICAL_PROPOSAL",
          format: "PDF",
          exactFileName: requiredName,
          exactOrder: source.exactOrder ?? null,
          contentSummary: `Finalized PDF rendered in-engine from the approved source document "${source.exactFileName ?? source.name}".`,
          fileContent: finalized.bytes.toString("base64"),
          // Deliberately PENDING: the finalized PDF must pass the same
          // validation + approval pipeline as every other document before it
          // can reach the final ZIP. This route creates content, not approval.
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
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
    return NextResponse.json(
      {
        ok,
        success: ok,
        created,
        blocked,
        requiredPdfFiles: requiredPdfNames,
        ...(created.length
          ? { nextStep: "Run Validate and approve the finalized PDF before final export." }
          : {}),
      },
      { status: ok ? 200 : 422 },
    );
  } catch (error) {
    logger.error("finalize-pdf route failed", { detail: error });
    return err("PDF finalization failed.", 500, { code: "PDF_FINALIZE_ROUTE_RUNTIME_ERROR" });
  }
}
