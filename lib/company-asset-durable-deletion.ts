import type { PrismaClient } from "@prisma/client";
import { logger } from "./observability";
import type { StorageAdapter } from "./storage";

export const COMPANY_ASSET_PENDING_DELETE_MARKER =
  '"deletionStatus":"PENDING_DELETE"';

export type CompanyAssetDeletionResult =
  | { ok: true; code: "DELETED" }
  | { ok: false; code: "NOT_FOUND"; status: 404; retryable: false }
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

function tombstone(
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

export function isCompanyAssetPendingDeletion(
  metadata: string | null | undefined,
): boolean {
  return parseObject(metadata).deletionStatus === "PENDING_DELETE";
}

export async function deleteCompanyAssetDurably(args: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  companyId: string;
  assetId: string;
  now?: Date;
}): Promise<CompanyAssetDeletionResult> {
  const now = args.now ?? new Date();

  const staged = await args.prisma.$transaction(async (tx) => {
    const asset = await tx.companyAsset.findFirst({
      where: { id: args.assetId, companyId: args.companyId },
      select: {
        id: true,
        originalFileName: true,
        storagePath: true,
        fileContent: true,
        metadata: true,
      },
    });
    if (!asset) return null;

    const metadata = tombstone(asset.metadata, now, {
      deletionFailureCode: null,
    });
    await tx.companyAsset.update({
      where: { id: asset.id },
      data: {
        isActive: false,
        metadata,
      },
    });
    return { ...asset, metadata };
  });

  if (!staged) {
    return { ok: false, code: "NOT_FOUND", status: 404, retryable: false };
  }

  try {
    if (staged.storagePath || staged.fileContent) {
      await args.storage.deleteFile({
        storagePath: staged.storagePath,
        fileContent: staged.fileContent,
        fileName: staged.originalFileName,
      });
    }
  } catch (error) {
    const previous = parseObject(staged.metadata);
    const attempts =
      typeof previous.deletionAttempts === "number"
        ? previous.deletionAttempts + 1
        : 1;
    await args.prisma.companyAsset.updateMany({
      where: { id: args.assetId, companyId: args.companyId },
      data: {
        metadata: tombstone(staged.metadata, now, {
          deletionAttempts: attempts,
          deletionFailureCode: "STORAGE_DELETE_FAILED",
          deletionLastAttemptAt: now.toISOString(),
        }),
      },
    }).catch((updateError) => {
      logger.error("[company-asset-delete] failed to persist storage deletion failure", {
        assetId: args.assetId,
        errorClass:
          updateError instanceof Error
            ? updateError.constructor.name
            : "UnknownError",
      });
    });
    logger.warn("[company-asset-delete] storage deletion deferred", {
      assetId: args.assetId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return {
      ok: false,
      code: "STORAGE_DELETE_FAILED",
      status: 502,
      retryable: true,
    };
  }

  try {
    await args.prisma.companyAsset.updateMany({
      where: { id: args.assetId, companyId: args.companyId },
      data: {
        storagePath: "",
        fileContent: null,
        integrityStatus: "MISSING",
        integrityVerifiedAt: now,
        integrityFailureCode: "ASSET_BYTES_DELETED_PENDING_ROW_DELETE",
        metadata: tombstone(staged.metadata, now, {
          deletionFailureCode: null,
          storageDeletedAt: now.toISOString(),
        }),
      },
    });
    await args.prisma.companyAsset.delete({ where: { id: args.assetId } });
  } catch (error) {
    logger.error("[company-asset-delete] row finalization deferred", {
      assetId: args.assetId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return {
      ok: false,
      code: "DELETE_FINALIZATION_FAILED",
      status: 502,
      retryable: true,
    };
  }

  return { ok: true, code: "DELETED" };
}
