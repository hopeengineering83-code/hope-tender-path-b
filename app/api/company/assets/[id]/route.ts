import { logger } from "../../../../../lib/observability";
import { getSession, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getStorageAdapter } from "../../../../../lib/storage";
import { isCompanyAssetPendingDeletion } from "../../../../../lib/company-asset-durable-deletion";
import {
  isInlineSafeCompanyAssetMime,
  sanitizeCompanyAssetFileName,
  validateCompanyAsset,
} from "../../../../../lib/company-asset-security";

function safeAssetDownloadName(id: string, originalFileName: string): string {
  const extensionMatch = originalFileName.match(/\.([a-zA-Z0-9]{1,12})$/);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : "";
  return `company-asset-${id.slice(0, 8)}${extension}`;
}

function privateText(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return unauthorizedResponse();

  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return privateText("Not found", 404);

  const asset = await prisma.companyAsset.findFirst({
    where: { id, companyId: company.id, isActive: true },
    select: {
      id: true,
      assetType: true,
      fileContent: true,
      storagePath: true,
      mimeType: true,
      originalFileName: true,
      size: true,
      metadata: true,
    },
  });
  if (
    !asset ||
    isCompanyAssetPendingDeletion(asset.metadata) ||
    (!asset.fileContent && !asset.storagePath)
  ) return privateText("Not found", 404);

  let buffer: Buffer;
  try {
    buffer = await getStorageAdapter().getFile({
      storagePath: asset.storagePath,
      fileContent: asset.fileContent,
      fileName: asset.originalFileName,
    });
  } catch (error) {
    logger.error("[company-assets] storage read failed", {
      assetId: id,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return privateText("File content could not be retrieved from storage", 502);
  }

  const validation = await validateCompanyAsset(
    {
      assetType: asset.assetType,
      fileName: asset.originalFileName,
      mimeType: asset.mimeType,
      size: asset.size,
    },
    buffer,
  );
  if (!validation.ok) {
    logger.warn("[company-assets] blocked invalid stored asset", { assetId: id, assetType: asset.assetType });
    return privateText("Stored asset failed security validation and must be replaced", 422);
  }

  const safeFileName = sanitizeCompanyAssetFileName(safeAssetDownloadName(asset.id, validation.safeFileName)).replace(/["\\]/g, "_");
  const disposition = isInlineSafeCompanyAssetMime(validation.normalizedMime) ? "inline" : "attachment";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": validation.normalizedMime,
      "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
