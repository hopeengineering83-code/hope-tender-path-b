import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { extractTextFromBuffer, getFileTypeLabel, isMeaningfulExtraction } from "../../../../lib/extract-text";
import { importCompanyKnowledgeFromDocuments } from "../../../../lib/company-knowledge-import-safe";
import { cleanTenderTitle, cleanClientName } from "../../../../lib/engine/proposal-labels";
import { getStorageAdapter } from "../../../../lib/storage";
import { logAction } from "../../../../lib/audit";
import { rateLimit } from "../../../../lib/rate-limit";
import { extractRequestId } from "../../../../lib/request-id";
import { inspectActualFileBytes } from "../../../../lib/engine/persisted-byte-integrity";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AdminRepairStep =
  | "all"
  | "extract"
  | "import"
  | "labels"
  | "requirements"
  | "appsettings"
  | "prune-superseded"
  // Defect 3: restore official bytes / hash / MIME on CompanyDocument rows
  // that were previously overwritten by a Plan B synthetic JSON import, and
  // invalidate stale provenance on dependent Expert/Project/Legal/Financial/
  // Compliance rows so they re-run the source-verification gate against
  // the restored bytes.
  | "restore-vault-bytes";

const ADMIN_REPAIR_STEPS = new Set<AdminRepairStep>([
  "all",
  "extract",
  "import",
  "labels",
  "requirements",
  "appsettings",
  "prune-superseded",
  "restore-vault-bytes",
]);

/**
 * POST /api/admin/repair
 *
 * Administrative data-repair operations only. Database schema changes are
 * deliberately excluded: production schema is owned by Prisma migrations and
 * must never be altered from a request-handling route.
 */
export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const limit = rateLimit(`admin-repair:${actor.id}`, { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1_000));
    return NextResponse.json(
      {
        error: "Rate limited. Too many repair requests. Please wait before retrying.",
        code: "RATE_LIMITED",
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const requestedStep = searchParams.get("step") ?? "all";

  if (requestedStep === "schema-drift") {
    return NextResponse.json(
      {
        error: "Runtime schema repair is disabled. Apply the reviewed Prisma migration through the deployment pipeline.",
        code: "RUNTIME_SCHEMA_REPAIR_DISABLED",
        requestId,
      },
      { status: 410 },
    );
  }

  if (!ADMIN_REPAIR_STEPS.has(requestedStep as AdminRepairStep)) {
    return NextResponse.json(
      {
        error: "Unsupported repair step.",
        code: "INVALID_REPAIR_STEP",
        supportedSteps: Array.from(ADMIN_REPAIR_STEPS),
      },
      { status: 400 },
    );
  }

  const step = requestedStep as AdminRepairStep;

  try {
    await prismaReady;

    const company = await prisma.company.findUnique({ where: { userId: actor.id } });
    if (!company) {
      return NextResponse.json(
        { error: "Company not found. Create your company profile first.", code: "COMPANY_NOT_FOUND" },
        { status: 404 },
      );
    }

    const results = {
      step,
      reextraction: null as null | {
        total: number;
        success: number;
        failed: number;
        skipped: number;
        details: Array<{ name: string; chars: number; status: string; error?: string }>;
      },
      import: null as null | {
        docsProcessed: number;
        expertsCreated: number;
        projectsCreated: number;
        aiUsed: boolean;
        aiFailures: number;
      },
      labels: null as null | {
        total: number;
        updated: number;
        details: Array<{ id: string; before: string; after: string }>;
      },
      requirements: null as null | { scanned: number; cleared: number },
      appsettings: null as null | { ensured: number },
      pruneSuperseded: null as null | { deleted: number; cutoffDays: number },
      // Defect 3: result of the restore-vault-bytes step.
      restoreVaultBytes: null as null | {
        total: number;
        restored: number;
        bytesLost: number;
        provenanceInvalidated: number;
        details: Array<{ name: string; status: string; error?: string }>;
      },
      timestamp: new Date().toISOString(),
    };

    if (step === "extract" || step === "all") {
      const documents = await prisma.companyDocument.findMany({
        where: {
          companyId: company.id,
          OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }],
        },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          fileContent: true,
          storagePath: true,
          metadata: true,
        },
      });

      let success = 0;
      let failed = 0;
      let skipped = 0;
      const details: Array<{ name: string; chars: number; status: string; error?: string }> = [];
      const deadline = Date.now() + 45_000;

      for (const document of documents) {
        if (Date.now() > deadline) {
          details.push({
            name: "…aborted",
            chars: 0,
            status: "timeout",
            error: "Deadline reached — run again to process remaining documents",
          });
          break;
        }
        if (!document.fileContent && !document.storagePath) {
          skipped += 1;
          continue;
        }

        try {
          const buffer = document.fileContent
            ? Buffer.from(document.fileContent, "base64")
            : await getStorageAdapter().getFile({
                storagePath: document.storagePath,
                fileContent: null,
                fileName: document.originalFileName,
              });
          const extractedText = await extractTextFromBuffer(
            buffer,
            document.mimeType,
            document.originalFileName,
          );
          const fileType = getFileTypeLabel(document.mimeType, document.originalFileName);
          const meaningful = isMeaningfulExtraction(extractedText);
          let metadata: Record<string, unknown> = {};
          try {
            metadata = JSON.parse(document.metadata || "{}") as Record<string, unknown>;
          } catch {
            metadata = {};
          }

          await prisma.companyDocument.update({
            where: { id: document.id },
            data: {
              extractedText: extractedText || null,
              aiExtractionStatus: meaningful ? "PENDING" : "FAILED",
              aiExtractionError: meaningful ? null : "No text extracted from document",
              metadata: JSON.stringify({
                ...metadata,
                fileType,
                reExtractedAt: new Date().toISOString(),
                extracted: meaningful,
                extractedChars: meaningful ? extractedText.length : 0,
              }),
              updatedAt: new Date(),
            },
          });

          details.push({
            name: document.originalFileName,
            chars: meaningful ? extractedText.length : 0,
            status: meaningful ? "extracted" : "no-text",
          });
          if (meaningful) success += 1;
          else skipped += 1;
        } catch (error) {
          failed += 1;
          logger.error("[admin/repair] document failed", {
            requestId,
            documentId: document.id,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
          details.push({
            name: document.originalFileName,
            chars: 0,
            status: "error",
            error: "Processing failed",
          });
          await prisma.companyDocument.update({
            where: { id: document.id },
            data: {
              aiExtractionStatus: "FAILED",
              aiExtractionError: "Processing failed",
              updatedAt: new Date(),
            },
          });
        }
      }

      results.reextraction = {
        total: documents.length,
        success,
        failed,
        skipped,
        details,
      };
    }

    if (step === "import" || step === "all") {
      results.import = await importCompanyKnowledgeFromDocuments(company.id);
    }

    if (step === "labels") {
      const tenders = await prisma.tender.findMany({
        where: { userId: actor.id },
        select: { id: true, title: true, clientName: true, description: true },
      });
      let updated = 0;
      const details: Array<{ id: string; before: string; after: string }> = [];

      for (const tender of tenders) {
        const cleanedClient = cleanClientName(tender.clientName, tender.description);
        const cleanedTitle = cleanTenderTitle(tender.title, {
          clientName: cleanedClient,
          description: tender.description ?? undefined,
        });
        const titleChanged = cleanedTitle !== (tender.title ?? "");
        const clientChanged = cleanedClient !== (tender.clientName ?? "");

        if (titleChanged || clientChanged) {
          await prisma.tender.update({
            where: { id: tender.id },
            data: {
              ...(titleChanged ? { title: cleanedTitle } : {}),
              ...(clientChanged ? { clientName: cleanedClient } : {}),
              updatedAt: new Date(),
            },
          });
          updated += 1;
          details.push({
            id: tender.id,
            before: `"${tender.title}" / "${tender.clientName}"`,
            after: `"${cleanedTitle}" / "${cleanedClient}"`,
          });
        }
      }
      results.labels = { total: tenders.length, updated, details };
    }

    if (step === "requirements") {
      const tenderIds = (
        await prisma.tender.findMany({
          where: { userId: actor.id },
          select: { id: true },
        })
      ).map((tender) => tender.id);
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
        await prisma.tenderRequirement.updateMany({
          where: { id: { in: oversized.map((requirement) => requirement.id) } },
          data: { requiredQuantity: null },
        });
      }
      const scanned = await prisma.tenderRequirement.count({
        where: { tenderId: { in: tenderIds } },
      });
      results.requirements = { scanned, cleared: oversized.length };
    }

    if (step === "appsettings" || step === "all") {
      const companies = await prisma.company.findMany({ select: { id: true } });
      let ensured = 0;
      for (const currentCompany of companies) {
        await prisma.appSettings.upsert({
          where: { companyId: currentCompany.id },
          update: {},
          create: {
            companyId: currentCompany.id,
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
        ensured += 1;
      }
      results.appsettings = { ensured };
    }

    if (step === "restore-vault-bytes") {
      // Defect 3: Repair already-corrupted Vault rows.
      //
      // For each tenant-owned CompanyDocument:
      //   1. Read persisted bytes from fileContent (base64) or storagePath.
      //   2. Re-run inspectActualFileBytes against those bytes — restores the
      //      correct contentSha256, contentByteLength, contentMimeType,
      //      detectedFormat, integrityStatus.
      //   3. Re-extract text using the DETECTED mime type (not the persisted,
      //      possibly tampered one).
      //   4. Detect the "official bytes lost" case: if the persisted row
      //      looks like a Plan B synthetic JSON artifact (mimeType ===
      //      "application/json" AND metadata.planB === true AND the
      //      originalFileName ends in .pdf/.docx), the original upload's
      //      bytes have been overwritten. Surface OFFICIAL_BYTES_LOST so
      //      the user knows they must re-upload.
      //   5. Invalidate stale provenance on all dependent Expert/Project/
      //      Legal/Financial/Compliance rows that point at this document:
      //      reset trustLevel to AI_DRAFT, null out reviewedBy/reviewedAt/
      //      reviewNotes. The next autoVerifyCompanyKnowledge pass re-runs
      //      the source-verification gate against the restored bytes.
      const documents = await prisma.companyDocument.findMany({
        where: {
          companyId: company.id,
          OR: [{ fileContent: { not: null } }, { storagePath: { not: "" } }],
        },
        select: {
          id: true,
          originalFileName: true,
          fileName: true,
          mimeType: true,
          fileContent: true,
          storagePath: true,
          metadata: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
        },
      });

      let restored = 0;
      let bytesLost = 0;
      let provenanceInvalidated = 0;
      const details: Array<{ name: string; status: string; error?: string }> = [];
      const deadline = Date.now() + 45_000;

      for (const document of documents) {
        if (Date.now() > deadline) {
          details.push({ name: "…aborted", status: "timeout", error: "Deadline reached — run again to process remaining documents" });
          break;
        }
        const displayName = document.originalFileName ?? document.fileName ?? document.id;

        // Detect the "official bytes lost" case.
        let isPlanBArtifact = false;
        try {
          const meta = JSON.parse(document.metadata ?? "{}") as Record<string, unknown>;
          isPlanBArtifact = meta.planB === true;
        } catch {
          isPlanBArtifact = false;
        }
        const originalName = (document.originalFileName ?? "").toLowerCase();
        const wasOfficialUpload = /\.(pdf|docx?|xlsx?|pptx?)$/.test(originalName);
        if (isPlanBArtifact && wasOfficialUpload && (document.mimeType ?? "").includes("json")) {
          // The original PDF/DOCX upload's bytes were overwritten by a Plan B
          // synthetic JSON artifact (Defect 1's corruption case). Original
          // bytes are gone — cannot restore. Surface the failure.
          bytesLost += 1;
          details.push({
            name: displayName,
            status: "OFFICIAL_BYTES_LOST",
            error: "Original uploaded bytes were overwritten by a Plan B synthetic JSON artifact. Re-upload the document through the Company Vault to restore it.",
          });
          // Still invalidate provenance on dependent rows — they must not keep
          // claiming SOURCE_VERIFIED against the corrupted row.
          const invalidated = await invalidateDependentProvenance(prisma, company.id, document.id);
          provenanceInvalidated += invalidated;
          continue;
        }

        try {
          const buffer = document.fileContent
            ? Buffer.from(document.fileContent, "base64")
            : await getStorageAdapter().getFile({
                storagePath: document.storagePath,
                fileContent: null,
                fileName: document.originalFileName,
              });

          // Re-run byte-integrity inspection against the actual bytes.
          const integrity = inspectActualFileBytes({
            bytes: buffer,
            filename: document.originalFileName ?? document.fileName ?? "document",
            claimedMimeType: document.mimeType ?? undefined,
          });

          // Re-extract text using the DETECTED mime type, not the persisted one.
          const detectedMime = integrity.contentMimeType ?? document.mimeType;
          const extractedText = await extractTextFromBuffer(
            buffer,
            detectedMime,
            document.originalFileName,
          );
          const meaningful = isMeaningfulExtraction(extractedText);

          let existingMetadata: Record<string, unknown> = {};
          try {
            existingMetadata = JSON.parse(document.metadata || "{}") as Record<string, unknown>;
          } catch {
            existingMetadata = {};
          }

          await prisma.companyDocument.update({
            where: { id: document.id },
            data: {
              // Restore byte-integrity fields from the actual bytes.
              ...integrity,
              // Restore extracted text using the detected mime type.
              extractedText: extractedText || null,
              aiExtractionStatus: meaningful ? "EXTRACTED" : "FAILED",
              aiExtractionError: meaningful ? null : "No text extracted from document after byte restore",
              aiExtractedAt: meaningful ? new Date() : null,
              metadata: JSON.stringify({
                ...existingMetadata,
                byteRestoredAt: new Date().toISOString(),
                byteRestorePreviousHash: document.contentSha256 ?? null,
                byteRestorePreviousMime: document.mimeType ?? null,
                byteRestorePreviousIntegrity: document.integrityStatus ?? null,
              }),
              updatedAt: new Date(),
            },
          });

          // Invalidate stale provenance on dependent rows. Only do this when
          // the hash actually changed (otherwise the provenance is still
          // valid and we avoid an unnecessary reset).
          const hashChanged = (document.contentSha256 ?? "") !== (integrity.contentSha256 ?? "");
          if (hashChanged) {
            const invalidated = await invalidateDependentProvenance(prisma, company.id, document.id);
            provenanceInvalidated += invalidated;
          }

          restored += 1;
          details.push({
            name: displayName,
            status: hashChanged ? "restored+reverified" : "verified-unchanged",
          });
        } catch (error) {
          details.push({
            name: displayName,
            status: "error",
            error: "Processing failed",
          });
          logger.error("[admin/repair] restore-vault-bytes failed", {
            requestId,
            documentId: document.id,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
        }
      }

      results.restoreVaultBytes = {
        total: documents.length,
        restored,
        bytesLost,
        provenanceInvalidated,
        details: details.slice(0, 200),
      };
    }

    if (step === "prune-superseded") {
      const cutoffDays = Math.max(
        1,
        Number.parseInt(searchParams.get("cutoffDays") ?? "7", 10) || 7,
      );
      const cutoffDate = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1_000);
      const tenderIds = (
        await prisma.tender.findMany({
          where: { userId: actor.id },
          select: { id: true },
        })
      ).map((tender) => tender.id);
      const { count } = await prisma.generatedDocument.deleteMany({
        where: {
          tenderId: { in: tenderIds },
          generationStatus: "SUPERSEDED",
          updatedAt: { lt: cutoffDate },
        },
      });
      results.pruneSuperseded = { deleted: count, cutoffDays };
    }

    await logAction({
      userId: actor.id,
      action: "ADMIN_REPAIR_EXECUTED",
      description: `Admin repair executed (step: ${step})`,
      metadata: {
        step,
        reextractionCount: results.reextraction?.total ?? 0,
        reextractionSuccess: results.reextraction?.success ?? 0,
        labelsUpdated: results.labels?.updated ?? 0,
        requirementsCleaned: results.requirements?.cleared ?? 0,
        documentsDeleted: results.pruneSuperseded?.deleted ?? 0,
        vaultBytesRestored: results.restoreVaultBytes?.restored ?? 0,
        vaultBytesLost: results.restoreVaultBytes?.bytesLost ?? 0,
        vaultProvenanceInvalidated: results.restoreVaultBytes?.provenanceInvalidated ?? 0,
      },
      requestId,
    }).catch((error) => {
      logger.warn("[admin/repair] audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json(results);
  } catch (error) {
    logger.error("Admin repair route failed", {
      requestId,
      step,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Admin repair failed. Retry or contact support with the request ID.",
        code: "ADMIN_REPAIR_RUNTIME_ERROR",
        step,
        requestId,
      },
      { status: 500 },
    );
  }
}

/**
 * Defect 3: invalidate stale provenance on all Expert/Project/Legal/
 * Financial/Compliance rows whose sourceDocumentId points at the given
 * CompanyDocument.
 *
 * After a byte-restore, the source bytes have a new SHA-256. Any dependent
 * record that was previously SOURCE_VERIFIED or REVIEWED against the old
 * bytes is now carrying stale provenance — its reviewNotes encodes the old
 * sourceContentHash / sourceTextHash. Reset trustLevel to AI_DRAFT and null
 * out reviewer identity so the next autoVerifyCompanyKnowledge pass re-runs
 * the source-verification gate against the restored bytes.
 *
 * Returns the total number of dependent rows invalidated.
 */
async function invalidateDependentProvenance(
  client: typeof prisma,
  companyId: string,
  sourceDocumentId: string,
): Promise<number> {
  const expertResult = await client.expert.updateMany({
    where: { companyId, sourceDocumentId, trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] } },
    data: { trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null, reviewNotes: null },
  });
  const projectResult = await client.project.updateMany({
    where: { companyId, sourceDocumentId, trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] } },
    data: { trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null, reviewNotes: null },
  });
  const legalResult = await client.legalRecord.updateMany({
    where: { companyId, sourceDocumentId, trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] } },
    data: { trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null, reviewNotes: null },
  });
  const financialResult = await client.financialRecord.updateMany({
    where: { companyId, sourceDocumentId, trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] } },
    data: { trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null, reviewNotes: null },
  });
  const complianceResult = await client.companyComplianceRecord.updateMany({
    where: { companyId, sourceDocumentId, trustLevel: { in: ["REVIEWED", "SOURCE_VERIFIED"] } },
    data: { trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null, reviewNotes: null },
  });
  return (
    expertResult.count +
    projectResult.count +
    legalResult.count +
    financialResult.count +
    complianceResult.count
  );
}
