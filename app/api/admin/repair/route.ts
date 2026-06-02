import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { cleanTenderTitle, cleanClientName } from "../../../../lib/engine/proposal-labels";
import { getStorageAdapter } from "../../../../lib/storage";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/repair
 * Full repair workflow:
 *  1. Re-extract text from ALL stored documents (not just failed ones)
 *  2. Run AI extraction + knowledge import
 *  3. Return diagnostic summary
 *
 * Query params:
 *   ?step=extract      — only re-extract text (skip import)
 *   ?step=import       — only run import (skip re-extraction)
 *   ?step=labels       — clean tender titles and client names for all tenders
 *   ?step=requirements — clear false-positive expert/project quantities (e.g. "Section 29 Expert")
 *   ?step=appsettings  — ensure AppSettings row exists for every Company (safe after new DB)
 *   ?step=prune-superseded — delete GeneratedDocument rows with generationStatus=SUPERSEDED older than
 *                            ?cutoffDays (default 7). Frees DB transfer. Never deletes active docs.
 *   ?step=schema-drift     — idempotent ALTER TABLE SQL that adds correct column names to DocumentReview
 *                            and DocumentComment tables created by the old bootstrap (which used
 *                            generatedDocumentId/reviewNotes/reviewStatus instead of documentId/notes/action).
 *                            Safe to run multiple times. Copies data from old columns to new ones.
 *   ?step=all (default) — extract + import + appsettings (labels/requirements/prune must be run separately)
 */
export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const { searchParams } = new URL(req.url);
  const step = searchParams.get("step") ?? "all";

  try {
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Company not found. Create your company profile first." }, { status: 404 });

  const results = {
    step,
    reextraction: null as null | { total: number; success: number; failed: number; skipped: number; details: Array<{ name: string; chars: number; status: string; error?: string }> },
    import: null as null | { docsProcessed: number; expertsCreated: number; projectsCreated: number; aiUsed: boolean; aiFailures: number },
    labels: null as null | { total: number; updated: number; details: Array<{ id: string; before: string; after: string }> },
    requirements: null as null | { scanned: number; cleared: number },
    appsettings: null as null | { ensured: number },
    pruneSuperseded: null as null | { deleted: number; cutoffDays: number },
    schemaDrift: null as null | { repairs: string[] },
    timestamp: new Date().toISOString(),
  };

  // ── Step 1: Re-extract text from all documents ────────────────────────────
  if (step === "extract" || step === "all") {
    const docs = await prisma.companyDocument.findMany({
      where: { companyId: company.id, OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }] },
      select: { id: true, originalFileName: true, mimeType: true, fileContent: true, storagePath: true, metadata: true },
    });

    let success = 0, failed = 0, skipped = 0;
    const details: Array<{ name: string; chars: number; status: string; error?: string }> = [];
    const deadline = Date.now() + 45_000; // leave headroom before 60s maxDuration

    for (const doc of docs) {
      if (Date.now() > deadline) {
        details.push({ name: "…aborted", chars: 0, status: "timeout", error: "Deadline reached — run again to process remaining documents" });
        break;
      }
      if (!doc.fileContent && !doc.storagePath) { skipped++; continue; }
      try {
        let buffer: Buffer;
        if (doc.fileContent) {
          buffer = Buffer.from(doc.fileContent, "base64");
        } else {
          buffer = await getStorageAdapter().getFile({ storagePath: doc.storagePath, fileContent: null, fileName: doc.originalFileName });
        }
        const extractedText = await extractTextFromBuffer(buffer, doc.mimeType, doc.originalFileName);
        const fileType = getFileTypeLabel(doc.mimeType, doc.originalFileName);
        const meaningful = isMeaningfulExtraction(extractedText);
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(doc.metadata || "{}"); } catch { metadata = {}; }

        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: {
            extractedText: extractedText || null,
            // Reset AI extraction status so it gets re-processed
            aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
            aiExtractionError: meaningful ? null : "No text extracted from document",
            metadata: JSON.stringify({ ...metadata, fileType, reExtractedAt: new Date().toISOString(), extracted: meaningful, extractedChars: meaningful ? extractedText.length : 0 }),
            updatedAt: new Date(),
          },
        });

        details.push({ name: doc.originalFileName, chars: meaningful ? extractedText.length : 0, status: meaningful ? "extracted" : "no-text" });
        if (meaningful) success++; else skipped++;
      } catch (err) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        details.push({ name: doc.originalFileName, chars: 0, status: "error", error: errMsg.slice(0, 200) });
        await prisma.companyDocument.update({
          where: { id: doc.id },
          data: { aiExtractionStatus: "FAILED", aiExtractionError: errMsg.slice(0, 500), updatedAt: new Date() },
        });
      }
    }

    results.reextraction = { total: docs.length, success, failed, skipped, details };
  }

  // ── Step 2: AI extraction + knowledge import ──────────────────────────────
  if (step === "import" || step === "all") {
    const importResult = await importCompanyKnowledgeFromDocuments(company.id);
    results.import = importResult;
  }

  // ── Step 3: Clean tender titles and client names ───────────────────────────
  if (step === "labels") {
    const tenders = await prisma.tender.findMany({
      where: { userId: actor.id },
      select: { id: true, title: true, clientName: true, description: true },
    });

    let updated = 0;
    const details: Array<{ id: string; before: string; after: string }> = [];

    for (const t of tenders) {
      const cleanedClient = cleanClientName(t.clientName, t.description);
      const cleanedTitle = cleanTenderTitle(t.title, { clientName: cleanedClient, description: t.description ?? undefined });

      const titleChanged = cleanedTitle !== (t.title ?? "");
      const clientChanged = cleanedClient !== (t.clientName ?? "");

      if (titleChanged || clientChanged) {
        await prisma.tender.update({
          where: { id: t.id },
          data: {
            ...(titleChanged ? { title: cleanedTitle } : {}),
            ...(clientChanged ? { clientName: cleanedClient } : {}),
            updatedAt: new Date(),
          },
        });
        updated++;
        details.push({ id: t.id, before: `"${t.title}" / "${t.clientName}"`, after: `"${cleanedTitle}" / "${cleanedClient}"` });
      }
    }

    results.labels = { total: tenders.length, updated, details };
  }

  // ── Step 4: Clear false-positive requirement quantities ───────────────────
  // Fixes over-extraction of section/page numbers into requiredQuantity (e.g. "Section 29 Expert
  // Requirements" → requiredQuantity=29). Caps EXPERT at 20, PROJECT_EXPERIENCE at 15.
  if (step === "requirements") {
    const tenderIds = (await prisma.tender.findMany({ where: { userId: actor.id }, select: { id: true } })).map((t) => t.id);
    const oversized = await prisma.tenderRequirement.findMany({
      where: {
        tenderId: { in: tenderIds },
        OR: [
          { requirementType: "EXPERT", requiredQuantity: { gt: 20 } },
          { requirementType: "PROJECT_EXPERIENCE", requiredQuantity: { gt: 15 } },
        ],
      },
      select: { id: true },
    });
    if (oversized.length > 0) {
      await prisma.tenderRequirement.updateMany({ where: { id: { in: oversized.map((r: { id: string }) => r.id) } }, data: { requiredQuantity: null } });
    }
    const allReqs = await prisma.tenderRequirement.count({ where: { tenderId: { in: tenderIds } } });
    results.requirements = { scanned: allReqs, cleared: oversized.length };
  }

  // ── Step 5: Ensure AppSettings row exists for every Company ──────────────
  // After switching to a new Neon DB, existing companies may have no AppSettings
  // row. This creates one with safe defaults so branding/export settings work.
  if (step === "appsettings" || step === "all") {
    const companies = await prisma.company.findMany({ select: { id: true } });
    let ensured = 0;
    for (const co of companies) {
      await prisma.appSettings.upsert({
        where: { companyId: co.id },
        update: {},
        create: {
          companyId: co.id,
          defaultCurrency: "USD",
          aiStrictMode: true,
          allowBrandingDefault: true,
          allowSignatureDefault: true,
          allowStampDefault: true,
          exportFormat: "DOCX",
          pageNumbering: true,
          includeTableOfContents: false,
          language: "en",
        },
      });
      ensured++;
    }
    results.appsettings = { ensured };
  }

  // ── Step 6: Schema-drift repair ──────────────────────────────────────────
  if (step === "schema-drift") {
    const repairs: string[] = [];
    const sqlSteps = [
      // DocumentReview: add correct columns if missing (old bootstrap used wrong names)
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "documentId" TEXT`,
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "reviewerId" TEXT`,
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "action" TEXT`,
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "priorStatus" TEXT`,
      `ALTER TABLE "DocumentReview" ADD COLUMN IF NOT EXISTS "newStatus" TEXT`,
      // Copy data from old column names to new ones (idempotent)
      `UPDATE "DocumentReview" SET "documentId" = "generatedDocumentId" WHERE "documentId" IS NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='DocumentReview' AND column_name='generatedDocumentId')`,
      `UPDATE "DocumentReview" SET "notes" = "reviewNotes" WHERE "notes" IS NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='DocumentReview' AND column_name='reviewNotes')`,
      `UPDATE "DocumentReview" SET "action" = "reviewStatus" WHERE "action" IS NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='DocumentReview' AND column_name='reviewStatus')`,
      // DocumentComment: same fix
      `ALTER TABLE "DocumentComment" ADD COLUMN IF NOT EXISTS "documentId" TEXT`,
      `ALTER TABLE "DocumentComment" ADD COLUMN IF NOT EXISTS "authorId" TEXT`,
      `UPDATE "DocumentComment" SET "documentId" = "generatedDocumentId" WHERE "documentId" IS NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='DocumentComment' AND column_name='generatedDocumentId')`,
      // Correct indexes
      `CREATE INDEX IF NOT EXISTS "DocumentReview_documentId_createdAt_idx" ON "DocumentReview"("documentId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "DocumentReview_reviewerId_idx" ON "DocumentReview"("reviewerId")`,
      `CREATE INDEX IF NOT EXISTS "DocumentComment_documentId_idx" ON "DocumentComment"("documentId")`,
    ];
    for (const sql of sqlSteps) {
      try {
        await prisma.$executeRawUnsafe(sql);
        repairs.push(`OK: ${sql.slice(0, 80)}`);
      } catch (err) {
        repairs.push(`SKIP: ${sql.slice(0, 80)} — ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
      }
    }
    results.schemaDrift = { repairs };
  }

  // ── Step 7: Prune SUPERSEDED generated documents ─────────────────────────
  if (step === "prune-superseded") {
    const cutoffDays = Math.max(1, parseInt(searchParams.get("cutoffDays") ?? "7", 10) || 7);
    const cutoffDate = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000);
    const tenderIds = (await prisma.tender.findMany({ where: { userId: actor.id }, select: { id: true } })).map((t) => t.id);
    const { count } = await prisma.generatedDocument.deleteMany({
      where: {
        tenderId: { in: tenderIds },
        generationStatus: "SUPERSEDED",
        updatedAt: { lt: cutoffDate },
      },
    });
    results.pruneSuperseded = { deleted: count, cutoffDays };
  }

  return NextResponse.json(results);
  } catch (error) {
    console.error("Admin repair route error:", error);
    const raw = error instanceof Error ? error.message : "Repair failed";
    const safe = raw
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")
      .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DB_URL_REDACTED]")
      .slice(0, 300);
    return NextResponse.json({ error: safe, step }, { status: 500 });
  }
}
