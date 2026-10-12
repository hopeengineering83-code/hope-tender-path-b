import { logger } from "./observability";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".storage");
export const DB_BASE64_MAX_BYTES = 5 * 1024 * 1024;

export type StorageProvider = "local" | "db-base64" | "blob";
export type StorageMetadata = {
  fileName: string;
  mimeType: string;
  tenderId?: string;
  companyId?: string;
};
export type StoredRecord = {
  storagePath?: string | null;
  fileContent?: string | null;
  fileName: string;
};

export type StorageReadiness = {
  provider: StorageProvider;
  ready: boolean;
  durable: boolean;
  boundedFallback: boolean;
  detail: string;
};

export interface StorageAdapter {
  putFile(buffer: Buffer, metadata: StorageMetadata): Promise<{ storagePath: string; fileContent?: string; provider: StorageProvider }>;
  getFile(record: StoredRecord): Promise<Buffer>;
  deleteFile(record: StoredRecord): Promise<void>;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function parseBooleanSetting(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return null;
}

/**
 * Canonical production storage policy.
 *
 * Blob storage is preferred. When Blob is not configured, a bounded 5 MiB
 * database fallback remains available unless an operator explicitly disables
 * it with ALLOW_DB_FILE_STORAGE=false. This prevents one upload route from
 * working while another silently fails because of per-route environment
 * mutation or duplicated policy.
 */
export function isDatabaseStorageAllowed(): boolean {
  if (!isProduction()) return true;
  const explicit = parseBooleanSetting(process.env.ALLOW_DB_FILE_STORAGE);
  if (explicit !== null) return explicit;
  return !hasBlobToken();
}

function safeScope(metadata: StorageMetadata): string {
  const company = metadata.companyId?.replace(/[^a-zA-Z0-9_-]/g, "") || "unscoped";
  const resource = metadata.tenderId
    ? `tender-${metadata.tenderId.replace(/[^a-zA-Z0-9_-]/g, "")}`
    : "company";
  return `${company}/${resource}`;
}

function assertLocalPath(storagePath: string): void {
  const root = path.resolve(STORAGE_ROOT);
  const resolved = path.resolve(storagePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Storage path is outside the configured root");
  }
}

/**
 * Vercel Blob credentials must never be forwarded to an arbitrary URL stored
 * in the database. Private Blob URLs use a subdomain of blob.vercel-storage.com.
 */
export function isVercelBlobStorageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function resolveStorageProvider(): StorageProvider {
  if (hasBlobToken()) return "blob";
  if (!isProduction()) return "local";
  return "db-base64";
}

export function getStorageReadiness(): StorageReadiness {
  const provider = resolveStorageProvider();
  if (!isProduction()) {
    return {
      provider,
      ready: true,
      durable: provider !== "local",
      boundedFallback: false,
      detail: `Development storage provider: ${provider}.`,
    };
  }

  if (provider === "blob") {
    return {
      provider,
      ready: true,
      durable: true,
      boundedFallback: false,
      detail: "Private Vercel Blob storage is configured.",
    };
  }

  const allowed = isDatabaseStorageAllowed();
  return {
    provider,
    ready: allowed,
    durable: allowed,
    boundedFallback: allowed,
    detail: allowed
      ? `Using bounded database file storage fallback (maximum ${DB_BASE64_MAX_BYTES} bytes per file). Configure BLOB_READ_WRITE_TOKEN before larger-scale use.`
      : "No production file storage is available. Configure BLOB_READ_WRITE_TOKEN or allow the bounded database fallback.",
  };
}

export function isProductionStorageReady(): boolean {
  return getStorageReadiness().ready;
}

class LocalStorage implements StorageAdapter {
  async putFile(buffer: Buffer, metadata: StorageMetadata) {
    if (isProduction()) throw new Error("Local filesystem storage is not permitted in production");
    const ext = path.extname(metadata.fileName).replace(/[^.a-zA-Z0-9]/g, "");
    const dir = path.join(STORAGE_ROOT, safeScope(metadata));
    await ensureDir(dir);
    const storagePath = path.join(dir, `${randomUUID()}${ext}`);
    assertLocalPath(storagePath);
    await writeFile(storagePath, buffer, { flag: "wx" });
    return { storagePath, provider: "local" as const };
  }

  async getFile(record: StoredRecord): Promise<Buffer> {
    if ((!record.storagePath || record.storagePath.length === 0) && record.fileContent) {
      return Buffer.from(record.fileContent, "base64");
    }
    if (!record.storagePath) throw new Error("File record has no stored content");
    assertLocalPath(record.storagePath);
    return readFile(record.storagePath);
  }

  async deleteFile(record: StoredRecord): Promise<void> {
    if (!record.storagePath) return;
    assertLocalPath(record.storagePath);
    await unlink(record.storagePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

let warnedAboutDatabaseFallback = false;

class DbBase64Storage implements StorageAdapter {
  async putFile(buffer: Buffer, _metadata: StorageMetadata) {
    if (!isDatabaseStorageAllowed()) {
      throw new Error(
        "Durable production storage is not configured. " +
        "Configure BLOB_READ_WRITE_TOKEN for Vercel Blob Storage, " +
        "or set ALLOW_DB_FILE_STORAGE=true to enable bounded database storage."
      );
    }
    if (buffer.byteLength > DB_BASE64_MAX_BYTES) {
      throw new Error(`Database file storage limit exceeded (${DB_BASE64_MAX_BYTES} bytes). Configure Vercel Blob for larger files.`);
    }
    if (isProduction() && !warnedAboutDatabaseFallback) {
      warnedAboutDatabaseFallback = true;
      logger.warn("[storage] BLOB_READ_WRITE_TOKEN is not configured; using bounded database file storage fallback");
    }
    return { storagePath: "", fileContent: buffer.toString("base64"), provider: "db-base64" as const };
  }

  async getFile(record: StoredRecord): Promise<Buffer> {
    if (!record.fileContent) throw new Error("File record has no database content");
    return Buffer.from(record.fileContent, "base64");
  }

  async deleteFile(_record: StoredRecord): Promise<void> {
    // Database content is removed transactionally with its owning row.
  }
}

// Minimal shape of the @vercel/blob functions this adapter actually calls.
// Test-only injection point (see BlobStorage's constructor) — production
// code never passes this and always uses the real dynamic import below.
export type BlobClientOverrides = {
  put?: (key: string, body: Buffer, options: { access: "private"; token: string }) => Promise<{ url: string }>;
  get?: (url: string, options: { access: "private"; token: string }) => Promise<{ statusCode: number; stream: ReadableStream } | null>;
  del?: (url: string, options: { token: string }) => Promise<void>;
};

export class BlobStorage implements StorageAdapter {
  private readonly fallback = new DbBase64Storage();

  // The optional constructor argument exists solely so tests can exercise
  // the real put/get/delete logic (URL validation, error handling, fallback
  // behavior) against a fake client, without a live Blob store or the
  // --experimental-test-module-mocks flag this project's test runner does
  // not pass. getStorageAdapter() below never supplies this argument.
  constructor(private readonly overrides: BlobClientOverrides = {}) {}

  async putFile(buffer: Buffer, metadata: StorageMetadata) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return this.fallback.putFile(buffer, metadata);
    const put = this.overrides.put ?? (await import("@vercel/blob")).put;
    const ext = path.extname(metadata.fileName).replace(/[^.a-zA-Z0-9]/g, "");
    const key = `${safeScope(metadata)}/${randomUUID()}${ext}`;
    const result = await put(key, buffer, { access: "private", token });
    if (!isVercelBlobStorageUrl(result.url)) {
      throw new Error("Blob provider returned an unexpected storage URL");
    }
    return { storagePath: result.url, provider: "blob" as const };
  }

  async getFile(record: StoredRecord): Promise<Buffer> {
    if (record.storagePath && /^https:\/\//i.test(record.storagePath)) {
      if (!isVercelBlobStorageUrl(record.storagePath)) {
        throw new Error("Stored Blob URL is outside the trusted Vercel Blob domain");
      }
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) throw new Error("Blob storage token is not configured");
      const get = this.overrides.get ?? (await import("@vercel/blob")).get;
      const result = await get(record.storagePath, { access: "private", token });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error(`Blob read failed${result ? ` with status ${result.statusCode}` : ": object not found"}`);
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    }
    return this.fallback.getFile(record);
  }

  async deleteFile(record: StoredRecord): Promise<void> {
    if (!record.storagePath) return;
    if (/^https:\/\//i.test(record.storagePath)) {
      if (!isVercelBlobStorageUrl(record.storagePath)) {
        throw new Error("Stored Blob URL is outside the trusted Vercel Blob domain");
      }
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) throw new Error("Blob storage token is not configured");
      const del = this.overrides.del ?? (await import("@vercel/blob")).del;
      await del(record.storagePath, { token });
      return;
    }
    await this.fallback.deleteFile(record);
  }
}

let cached: StorageAdapter | null = null;
let cachedProvider: StorageProvider | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (cached) return cached;
  const provider = resolveStorageProvider();
  cached = provider === "blob" ? new BlobStorage() : provider === "local" ? new LocalStorage() : new DbBase64Storage();
  cachedProvider = provider;
  return cached;
}

export function getActiveStorageProvider(): StorageProvider {
  if (!cachedProvider) getStorageAdapter();
  return cachedProvider as StorageProvider;
}

export function resetStorageAdapter(): void {
  cached = null;
  cachedProvider = null;
  warnedAboutDatabaseFallback = false;
}

export async function saveUploadedFile(
  file: File,
  scope: "company" | "tender" | "generated" | "assets" = "tender",
) {
  if (isProduction()) throw new Error("Legacy local upload helper is disabled in production");
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name).replace(/[^.a-zA-Z0-9]/g, "");
  const dir = path.join(STORAGE_ROOT, scope);
  await ensureDir(dir);
  const storagePath = path.join(dir, `${randomUUID()}${ext}`);
  assertLocalPath(storagePath);
  await writeFile(storagePath, buffer, { flag: "wx" });
  return {
    fileName: path.basename(storagePath),
    originalFileName: path.basename(file.name),
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    storagePath,
  };
}

export async function ensureGeneratedDir() {
  if (isProduction()) throw new Error("Legacy generated-file directory is disabled in production");
  const dir = path.join(STORAGE_ROOT, "generated");
  await ensureDir(dir);
  return dir;
}
