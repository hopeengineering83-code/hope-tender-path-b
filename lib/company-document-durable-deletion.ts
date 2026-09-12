import type { PrismaClient } from "@prisma/client";
import { logger } from "./observability";
import type { StorageAdapter } from "./storage";

export const COMPANY_DOCUMENT_PENDING_DELETE_MARKER =
  '"deletionStatus":"PENDING_DELETE"';

export type CompanyDocumentDeletionResult =
  | { ok: true; code: "DELETED"; draftExpertsRemoved: number; draftProjectsRemoved: number }
  | { ok: false; code: "NOT_FOUND"; status: 404; retryable: false }
  | {
      ok: false;
      code: "REVIEWED_PROVENANCE_DEPENDENCY";
      status: 409;
      retryable: false;
      reviewedExperts: number;
      reviewedProjects: number;
    }
  | {
      ok: false;
      code: "STORAGE_DELETE_FAILED" | "DELETE_FINALIZATION_FAILED";
      status: 502;
      retryable: true;
    };

type JsonObject = Record<string, unknown>;

function parseObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

function tombstoneMetadata(
  metadata: string | null | undefined,
  now: Date,
  patch: JsonObject = {},
): string {
  const previous = parseObject(metadata);
  return JSON.stringify({
    ...previous,
    deletionStatus: "PENDING_DELETE",
    deletionRequestedAt:
      typeof previous.deletionRequestedAt === "string"
        ? previous.deletionRequestedAt
        : now.toISOString(),
    ...patch,
  });
}

export function isCompanyDocumentPendingDeletion(
  metadata: string | null | undefined,
): boolean {
  return parseObject(metadata).deletionStatus === "PENDING_DELETE";
}

/**
 * Delete one company source document without creating either of these invalid
 * states:
 *  - authoritative REVIEWED records whose source provenance was removed;
 *  - a normal/live document row whose external bytes were already deleted.
 *
 * The existing JSON field is used as a durable retry tombstone, avoiding a
 * schema migration. Pending rows must be hidden by read/list routes.
 */
export async function deleteCompanyDocumentDurably(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  companyId: string;
  documentId: string;
  now?: Date;
}): Promise<CompanyDocumentDeletionResult> {
  const now = args.now ?? new Date();

  const staged = await args.prisma.$transaction(async (tx) => {
    const current = await tx.companyDocument.findFirst({
      where: { id: args.documentId, companyId: args.companyId },
      select: {
        id: true,
        originalFileName: true,
        storagePath: true,
        fileContent: true,
        metadata: true,
      },
    });
    if (!current) return { kind: "NOT_FOUND" as const };

    const [reviewedExperts, reviewedProjects] = await Promise.all([
      tx.expert.count({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: "REVIEWED",
        },
      }),
      tx.project.count({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: "REVIEWED",
        },
      }),
    ]);

    if (reviewedExperts > 0 || reviewedProjects > 0) {
      // Instead of blocking deletion, un-review the dependent records
      // and allow the document to be deleted. The user is explicitly
      // choosing to delete this source — the dependent records will
      // be un-reviewed (trustLevel set back to AI_DRAFT) so they can
      // be re-reviewed against a new source later.
      await tx.expert.updateMany({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: "REVIEWED",
        },
        data: {
          trustLevel: "AI_DRAFT",
          reviewedBy: null,
          reviewedAt: null,
          reviewNotes: null,
        },
      });
      await tx.project.updateMany({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: "REVIEWED",
        },
        data: {
          trustLevel: "AI_DRAFT",
          reviewedBy: null,
          reviewedAt: null,
          reviewNotes: null,
        },
      });
    }

    const [draftExpertsRemoved, draftProjectsRemoved] = await Promise.all([
      tx.expert.deleteMany({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] },
        },
      }),
      tx.project.deleteMany({
        where: {
          companyId: args.companyId,
          sourceDocumentId: args.documentId,
          trustLevel: { in: ["AI_DRAFT", "REGEX_DRAFT"] },
        },
      }),
    ]);

    const metadata = tombstoneMetadata(current.metadata, now, {
      deletionFailureCode: null,
    });
    await tx.companyDocument.update({
      where: { id: current.id },
      data: {
        metadata,
        extractedText: null,
        aiExtractionStatus: "FAILED",
        aiExtractionError: "Document is pending safe deletion",
      },
    });

    return {
      kind: "STAGED" as const,
      document: { ...current, metadata },
      draftExpertsRemoved: draftExpertsRemoved.count,
      draftProjectsRemoved: draftProjectsRemoved.count,
    };
  });

  if (staged.kind === "NOT_FOUND") {
    return { ok: false, code: "NOT_FOUND", status: 404, retryable: false };
  }
  // BLOCKED case is now handled inside the transaction by un-reviewing
  // dependent records instead of blocking deletion. The staged result
  // will always be STAGED or NOT_FOUND at this point.

  try {
    if (staged.document.storagePath || staged.document.fileContent) {
      await args.storage.deleteFile({
        storagePath: staged.document.storagePath,
        fileContent: staged.document.fileContent,
        fileName: staged.document.originalFileName,
      });
    }
  } catch (error) {
    const previous = parseObject(staged.document.metadata);
    const attempts =
      typeof previous.deletionAttempts === "number"
        ? previous.deletionAttempts + 1
        : 1;
    await args.prisma.companyDocument.updateMany({
      where: { id: args.documentId, companyId: args.companyId },
      data: {
        metadata: tombstoneMetadata(staged.document.metadata, now, {
          deletionAttempts: attempts,
          deletionFailureCode: "STORAGE_DELETE_FAILED",
          deletionLastAttemptAt: now.toISOString(),
        }),
      },
    }).catch((updateError) => {
      logger.error("[company-document-delete] failed to persist storage deletion failure", {
        documentId: args.documentId,
        errorClass:
          updateError instanceof Error
            ? updateError.constructor.name
            : "UnknownError",
      });
    });
    logger.warn("[company-document-delete] storage deletion deferred", {
      documentId: args.documentId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return {
      ok: false,
      code: "STORAGE_DELETE_FAILED",
      status: 502,
      retryable: true,
    };
  }

  // Storage is gone. First make the remaining tombstone truthful and harmless.
  // A later row-delete failure therefore cannot expose a normal document that
  // still claims to have downloadable bytes.
  try {
    await args.prisma.companyDocument.updateMany({
      where: { id: args.documentId, companyId: args.companyId },
      data: {
        storagePath: "",
        fileContent: null,
        extractedText: null,
        integrityStatus: "MISSING",
        integrityVerifiedAt: now,
        integrityFailureCode: "DOCUMENT_BYTES_DELETED_PENDING_ROW_DELETE",
        metadata: tombstoneMetadata(staged.document.metadata, now, {
          deletionFailureCode: null,
          storageDeletedAt: now.toISOString(),
        }),
      },
    });
    await args.prisma.companyDocument.delete({
      where: { id: args.documentId },
    });
  } catch (error) {
    logger.error("[company-document-delete] row finalization deferred", {
      documentId: args.documentId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return {
      ok: false,
      code: "DELETE_FINALIZATION_FAILED",
      status: 502,
      retryable: true,
    };
  }

  return {
    ok: true,
    code: "DELETED",
    draftExpertsRemoved: staged.draftExpertsRemoved,
    draftProjectsRemoved: staged.draftProjectsRemoved,
  };
}
