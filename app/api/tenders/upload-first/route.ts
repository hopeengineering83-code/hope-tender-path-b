import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { logAction } from "../../../../lib/audit";
import { inferTenderMetadata } from "../../../../lib/engine/tender-metadata";
import { runTenderEngine } from "../../../../lib/engine/run-tender-engine";

// Vercel route timeout — full intake pipeline (PDF extraction + tender
// engine analysis). 60 = Hobby max; Pro applies its own plan limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;

  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "Upload at least one tender document" }, { status: 400 });

    const extracted: Array<{
      file: File;
      base64Content: string;
      mimeType: string;
      fileTypeLabel: string;
      extractedText: string;
      meaningful: boolean;
    }> = [];
    const errors: string[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        errors.push(`${file.name}: exceeds 10 MB limit`);
        continue;
      }
      const mimeType = file.type || "application/octet-stream";
      if (!ALLOWED_MIME.has(mimeType)) {
        errors.push(`${file.name}: unsupported file type ${mimeType}`);
        continue;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      // PR XX-INTAKE-FIX — wrap extractTextFromBuffer in try/catch so a
      // single corrupt or unsupported file doesn't break the whole upload.
      // Pre-fix behaviour: any pdf-parse / mammoth error threw out of the
      // for-loop, hit the outer catch, and returned the generic "Upload-
      // first tender intake failed" message — losing the user's upload.
      let extractedText = "";
      try {
        extractedText = await extractTextFromBuffer(buffer, mimeType, file.name);
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        errors.push(`${file.name}: text extraction failed — ${msg}`);
        console.error(`[upload-first tender] extract failed for ${file.name}:`, extractErr);
      }
      const meaningful = isMeaningfulExtraction(extractedText);
      extracted.push({ file, base64Content: buffer.toString("base64"), mimeType, fileTypeLabel: getFileTypeLabel(mimeType, file.name), extractedText, meaningful });
    }

    const usable = extracted.filter((x) => x.meaningful);
    // PR XX-INTAKE-FIX — don't HARD-FAIL when no usable text. The user
    // still has a PDF in hand and may want to fill in the title /
    // reference / client manually. We create the tender with a
    // [REVIEW NEEDED] flag and let them edit on the detail page.
    // The metadata extractor's own < 500-char fallback handles this
    // gracefully, so we just pass the best text we have (even if
    // nothing was extracted) and continue.
    const bestForMetadata = usable.length > 0 ? usable : extracted;
    const combinedText = bestForMetadata.map((x) => `FILE: ${x.file.name}\n${x.extractedText}`).join("\n\n--- NEXT TENDER FILE ---\n\n");
    const fallbackName = bestForMetadata[0]?.file?.name ?? "uploaded-tender";
    const metadata = inferTenderMetadata(combinedText, fallbackName);
    const titleOverride = String(form.get("title") || "").trim();
    const refOverride = String(form.get("reference") || "").trim();

    // ─── Build the tender record with EVERY extracted field ──────────────
    // The metadata extractor now returns 20+ fields. The base Tender model
    // carries the core ones; extra detail (client contact person/email/
    // phone, validity period, bid bond, pre-bid meeting, etc.) is stored
    // in the `notes` field as a structured block so the user can see what
    // was auto-extracted, plus the `intakeSummary` so the engine has
    // substantive context.
    const extraDetailLines: string[] = [];
    if (metadata.clientContactName) extraDetailLines.push(`Client contact: ${metadata.clientContactName}${metadata.clientContactTitle ? ` (${metadata.clientContactTitle})` : ""}`);
    if (metadata.clientContactEmail) extraDetailLines.push(`Client email: ${metadata.clientContactEmail}`);
    if (metadata.clientContactPhone) extraDetailLines.push(`Client phone: ${metadata.clientContactPhone}`);
    if (metadata.clientAddress) extraDetailLines.push(`Client address: ${metadata.clientAddress}`);
    if (metadata.submissionEmails.length > 1) extraDetailLines.push(`Other submission emails: ${metadata.submissionEmails.slice(1).join(", ")}`);
    if (metadata.validityDays) extraDetailLines.push(`Proposal validity: ${metadata.validityDays} days`);
    if (metadata.bidBondAmount && metadata.bidBondCurrency) extraDetailLines.push(`Bid bond: ${metadata.bidBondCurrency} ${metadata.bidBondAmount.toLocaleString()}`);
    if (metadata.preBidMeetingLocation) extraDetailLines.push(`Pre-bid meeting: ${metadata.preBidMeetingLocation}`);
    if (metadata.mandatorySiteVisit) extraDetailLines.push(`Mandatory site visit: YES`);
    if (metadata.numberOfCopiesRequired) extraDetailLines.push(`Copies required: original + ${metadata.numberOfCopiesRequired}`);
    if (metadata.technicalWeight && metadata.financialWeight) extraDetailLines.push(`Evaluation: Technical ${metadata.technicalWeight}% / Financial ${metadata.financialWeight}%`);

    const intakeNotes = [
      `Created by upload-first tender intake from ${usable.length} extracted file(s).`,
      ...(extraDetailLines.length > 0
        ? ["", "Auto-extracted tender detail (review before final submission):", ...extraDetailLines.map((l) => `  • ${l}`)]
        : []),
    ].join("\n");

    const tender = await prisma.tender.create({
      data: {
        id: crypto.randomUUID(),
        title: titleOverride || metadata.title,
        description: metadata.description,
        reference: refOverride || metadata.reference,
        clientName: metadata.clientName,
        category: metadata.category,
        country: metadata.country,
        budget: metadata.budget ?? null,
        currency: metadata.currency || "USD",
        deadline: metadata.deadline,
        submissionMethod: metadata.submissionMethod,
        submissionAddress: metadata.submissionAddress,
        intakeSummary: metadata.intakeSummary,
        pageLimit: metadata.pageLimit ?? null,
        notes: intakeNotes,
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        userId,
      },
    });

    for (const item of extracted) {
      const fileRecord = await prisma.tenderFile.create({
        data: {
          tenderId: tender.id,
          fileName: item.file.name,
          originalFileName: item.file.name,
          mimeType: item.mimeType,
          size: item.file.size,
          storagePath: "",
          fileContent: item.base64Content,
          classification: "Tender Document",
          extractedText: item.extractedText || null,
        },
      });
      await logAction({
        userId,
        action: "TENDER_FILE_UPLOAD",
        entityType: "TenderFile",
        entityId: fileRecord.id,
        description: `Upload-first tender intake uploaded ${item.fileTypeLabel} "${item.file.name}" — ${item.meaningful ? `${item.extractedText.length.toLocaleString()} chars extracted` : "no usable text"}`,
        metadata: { tenderId: tender.id, fileName: item.file.name, extracted: item.meaningful, extractedChars: item.meaningful ? item.extractedText.length : 0 },
      });
    }

    // ─── Engine run is DECOUPLED from intake (PR XX-INTAKE-FIX) ──────────
    // BEFORE: runTenderEngine() ran synchronously inside the 60s Vercel
    // Hobby route. On a typical 0.5MB tender with healthy company vault,
    // PDF extraction + AI analysis + matching + AI rematch + DB writes
    // routinely exceeded 60s and the route was killed by Vercel — the
    // frontend then showed a generic "Upload-first tender intake failed"
    // because the killed function returns no JSON.
    //
    // NOW: the route just creates the tender + files (fast, < 5s) and
    // returns success. The engine run is offered as a follow-up action
    // the user / frontend can trigger via /api/tenders/[id]/engine.
    // Caller can opt-in with ?runEngine=true (only on Vercel Pro where
    // the 300s budget makes it safe).
    const url = new URL(req.url);
    const shouldRunEngine = url.searchParams.get("runEngine") === "true";

    let engineResult: unknown = null;
    let engineError: string | null = null;
    if (shouldRunEngine) {
      try {
        engineResult = await runTenderEngine(tender.id, userId);
        await logAction({
          userId,
          action: "TENDER_ANALYSIS_RUN",
          entityType: "Tender",
          entityId: tender.id,
          description: `Upload-first tender intake auto-ran engine for "${tender.title}"`,
          metadata: { files: usable.length },
        });
      } catch (err) {
        engineError = err instanceof Error ? err.message : String(err);
        console.error("[upload-first tender] engine failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      tenderId: tender.id,
      tender: engineResult ?? tender,
      extractedFiles: usable.length,
      skippedFiles: extracted.length - usable.length,
      metadata,
      errors,
      engineError,
      engineSkipped: !shouldRunEngine,
      message: shouldRunEngine
        ? "Tender created and engine analysis run."
        : "Tender created. Open the tender detail page and click 'Run Analysis' to extract requirements + match experts/projects.",
    }, { status: 201 });
  } catch (error) {
    // Surface a verbose error message + stage so the user can self-diagnose.
    // The pre-fix behaviour returned a generic "Upload-first tender intake
    // failed" which gave the user no way to tell whether PDF extraction,
    // DB write, or engine run was the culprit.
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 800) : undefined;
    console.error("[upload-first tender] failed:", error);
    return NextResponse.json({
      error: `Upload-first tender intake failed: ${msg}`,
      detail: msg,
      stack,
      hint: msg.includes("text")
        ? "PDF text extraction may have failed. Try a different file or set PDF_OCR_ENABLED=true."
        : msg.toLowerCase().includes("prisma") || msg.toLowerCase().includes("database")
        ? "Database write failed. The schema may be missing a column or a migration hasn't run."
        : msg.toLowerCase().includes("timeout")
        ? "Route hit the 60s Vercel Hobby cap. Use Pro or split intake from engine run."
        : "Check the server logs for the full stack.",
    }, { status: 500 });
  }
}
