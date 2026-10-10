import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { forbiddenResponse, getSession, requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { getStorageAdapter } from "../../../../lib/storage";
import {
  COMPANY_ASSET_PENDING_DELETE_MARKER,
  deleteCompanyAssetDurably,
} from "../../../../lib/company-asset-durable-deletion";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import {
  COMPANY_ASSET_MAX_BYTES,
  COMPANY_ASSET_TYPES,
  validateCompanyAsset,
} from "../../../../lib/company-asset-security";
import { inspectActualFileBytes } from "../../../../lib/engine/persisted-byte-integrity";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseBoundedInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parsePage(value: string | null): number {
  return parseBoundedInt(value, 1);
}

function parseLimit(value: string | null): number {
  return Math.min(parseBoundedInt(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json(body, { ...init, headers });
}

async function writableActor() {
  try {
    return { actor: await requireRole("ADMIN", "PROPOSAL_MANAGER"), response: null } as const;
  } catch (error) {
    return {
      actor: null,
      response: error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(),
    } as const;
  }
}

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return unauthorizedResponse();
  await prismaReady;

  const url = new URL(req.url);
  const page = parsePage(url.searchParams.get("page"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const company = await ensureCompanyForUser(prisma, userId);
  const where = {
    companyId: company.id,
    NOT: { metadata: { contains: COMPANY_ASSET_PENDING_DELETE_MARKER } },
  };
  const [assets, total] = await prisma.$transaction([
    prisma.companyAsset.findMany({
      where,
      select: {
        id: true,
        assetType: true,
        originalFileName: true,
        mimeType: true,
        size: true,
        isActive: true,
        createdAt: true,
        storagePath: true,
        integrityStatus: true,
        contentSha256: true,
        contentByteLength: true,
        detectedFormat: true,
        integrityVerifiedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.companyAsset.count({ where }),
  ]);

  const ids = assets.map((asset) => asset.id);
  const inlineLengths = ids.length > 0
    ? await prisma.$queryRaw<Array<{ id: string; fileContentLength: number }>>`
        SELECT id, ("fileContent" IS NOT NULL)::int AS "fileContentLength"
        FROM "CompanyAsset"
        WHERE id = ANY(${ids}::text[])
      `.catch(() => [] as Array<{ id: string; fileContentLength: number }>)
    : [];
  const inlineLengthById = Object.fromEntries(inlineLengths.map((asset) => [asset.id, asset.fileContentLength]));

  return privateJson({
    assets: assets.map((asset) => {
      const { storagePath: privateStoragePath, ...publicAsset } = asset;
      return {
        ...publicAsset,
        hasInlineFileContent: (inlineLengthById[asset.id] ?? 0) > 0,
        hasPrivateStorage: Boolean(privateStoragePath?.trim()),
      };
    }),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
}

export async function POST(req: Request) {
  const auth = await writableActor();
  if (!auth.actor) return auth.response;

  const limit = await rateLimitPersistent(`assets-upload:${auth.actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return privateJson(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, auth.actor.id);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return privateJson({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const assetType = String(formData.get("assetType") ?? "").trim().toUpperCase();
  if (!(file instanceof File)) return privateJson({ error: "Invalid file" }, { status: 400 });
  if (!(COMPANY_ASSET_TYPES as readonly string[]).includes(assetType)) {
    return privateJson({ error: `assetType must be one of: ${COMPANY_ASSET_TYPES.join(", ")}` }, { status: 400 });
  }
  if (file.size > COMPANY_ASSET_MAX_BYTES) {
    return privateJson(
      { error: `Company assets must not exceed ${Math.floor(COMPANY_ASSET_MAX_BYTES / (1024 * 1024))} MB` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = await validateCompanyAsset(
    { assetType, fileName: file.name, mimeType: file.type, size: file.size },
    buffer,
  );
  if (!validation.ok) {
    return privateJson({ error: validation.error ?? "Invalid company asset" }, { status: 415 });
  }
  const integrity = inspectActualFileBytes({
    bytes: buffer,
    filename: validation.safeFileName,
    claimedMimeType: validation.normalizedMime,
  });
  if (integrity.integrityStatus !== "VERIFIED") {
    return privateJson(
      {
        error: "Company asset byte integrity verification failed",
        code: integrity.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED",
      },
      { status: 415 },
    );
  }

  const storage = getStorageAdapter();
  let stored: Awaited<ReturnType<typeof storage.putFile>>;
  try {
    stored = await storage.putFile(buffer, {
      fileName: validation.safeFileName,
      mimeType: validation.normalizedMime,
      companyId: company.id,
    });
  } catch (error) {
    logger.error("[company-assets] storage write failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return privateJson({ error: "Company asset storage is unavailable" }, { status: 503 });
  }

  const previous = await prisma.companyAsset.findMany({
    where: { companyId: company.id, assetType, isActive: true },
    select: { id: true, storagePath: true, fileContent: true, originalFileName: true },
  });

  let asset;
  try {
    asset = await prisma.$transaction(async (tx) => {
      await tx.companyAsset.updateMany({
        where: { companyId: company.id, assetType, isActive: true },
        data: { isActive: false },
      });
      return tx.companyAsset.create({
        data: {
          companyId: company.id,
          assetType,
          fileName: validation.safeFileName,
          originalFileName: validation.safeFileName,
          mimeType: validation.normalizedMime,
          size: buffer.byteLength,
          storagePath: stored.storagePath,
          fileContent: stored.fileContent ?? null,
          ...integrity,
          isActive: true,
        },
        select: {
          id: true,
          assetType: true,
          originalFileName: true,
          mimeType: true,
          size: true,
          isActive: true,
          createdAt: true,
        },
      });
    });
  } catch (error) {
    await storage.deleteFile({
      storagePath: stored.storagePath,
      fileContent: stored.fileContent ?? null,
      fileName: validation.safeFileName,
    }).catch(() => undefined);
    logger.error("[company-assets] database write failed", {
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return privateJson({ error: "Company asset could not be saved" }, { status: 500 });
  }

  // Preserve inactive metadata for the audit trail, but remove superseded file
  // bytes where the storage provider can do so safely.
  for (const old of previous) {
    try {
      await storage.deleteFile({
        storagePath: old.storagePath,
        fileContent: old.fileContent,
        fileName: old.originalFileName,
      });
      await prisma.companyAsset.update({
        where: { id: old.id },
        data: {
          storagePath: "",
          fileContent: null,
          integrityStatus: "MISSING",
          integrityVerifiedAt: new Date(),
          integrityFailureCode: "SUPERSEDED_BYTES_DELETED",
        },
      });
    } catch (error) {
      logger.warn("[company-assets] superseded asset cleanup deferred", {
        assetId: old.id,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  }

  await logAction({
    userId: auth.actor.id,
    action: "COMPANY_ASSET_UPLOAD",
    entityType: "CompanyAsset",
    entityId: asset.id,
    description: `Uploaded ${assetType} company asset`,
    metadata: { assetType, companyId: company.id, storageProvider: stored.provider },
  });

  return privateJson({ success: true, asset }, { status: 201 });
}

export async function DELETE(req: Request) {
  const auth = await writableActor();
  if (!auth.actor) return auth.response;

  const limit = await rateLimitPersistent(`assets-delete:${auth.actor.id}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return privateJson(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  if (!id) return privateJson({ error: "Missing id" }, { status: 400 });

  const company = await ensureCompanyForUser(prisma, auth.actor.id);
  const result = await deleteCompanyAssetDurably({
    prisma,
    storage: getStorageAdapter(),
    companyId: company.id,
    assetId: id,
  });

  if (!result.ok) {
    return privateJson(
      {
        error: result.code === "NOT_FOUND"
          ? "Asset not found"
          : "Asset deletion is pending a safe retry.",
        ...result,
      },
      { status: result.status },
    );
  }

  await logAction({
    userId: auth.actor.id,
    action: "COMPANY_ASSET_DELETE",
    entityType: "CompanyAsset",
    entityId: id,
    description: "Deleted a company asset",
    metadata: { companyId: company.id },
  });

  return privateJson({ success: true, ...result });
}
