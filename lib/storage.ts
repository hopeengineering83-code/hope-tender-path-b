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

function allowDatabaseStorage(): boolean {
  return !isProduction() || process.env.ALLOW_DB_FILE_STORAGE === "true";
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

export function isProductionStorageReady(): boolean {
  if (!isProduction()) return true;
  return hasBlobToken() || allowDatabaseStorage();
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

class DbBase64Storage implements StorageAdapter {
  async putFile(buffer: Buffer, _metadata: StorageMetadata) {
    if (!allowDatabaseStorage()) {
      throw new Error("Durable production storage is not configured");
    }
    if (buffer.byteLength > DB_BASE64_MAX_BYTES) {
      throw new Error(`Database file storage limit exceeded (${DB_BASE64_MAX_BYTES} bytes)`);
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

class BlobStorage implements StorageAdapter {
  private readonly fallback = new DbBase64Storage();

  async putFile(buffer: Buffer, metadata: StorageMetadata) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return this.fallback.putFile(buffer, metadata);
    const { put } = await import("@vercel/blob");
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
      const { get } = await import("@vercel/blob");
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
      const { del } = await import("@vercel/blob");
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
