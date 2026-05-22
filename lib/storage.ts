import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Storage adapter (Gap 7).
 *
 * The codebase historically had two parallel storage paths:
 *
 *   1. lib/storage.ts wrote uploads into a local .storage filesystem
 *      directory and returned a `storagePath` for later reads.
 *   2. app/api/upload + app/api/tenders/upload-first persisted the file
 *      bytes as base64 inside the DB row's `fileContent` column with
 *      `storagePath=""`.
 *
 * Both call paths still need to work, but new writes are now routed
 * through a single adapter that picks the best provider for the current
 * deployment:
 *
 *   - "local"     — STORAGE_ROOT is writable; large files OK.
 *   - "blob"      — BLOB_READ_WRITE_TOKEN (Vercel Blob) is configured.
 *                   NOTE: the actual @vercel/blob SDK is not bundled; the
 *                   adapter falls back to "db-base64" with a small cap
 *                   when no blob backend is wired up.
 *   - "db-base64" — small files only; fileContent stored on the row.
 *
 * Legacy rows (storagePath="" + fileContent populated) read transparently
 * via getFile(). No automatic migration is performed — existing rows are
 * left in place to keep this change reversible.
 */

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".storage");
export const DB_BASE64_MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap when forced into base64

export type StorageProvider = "local" | "db-base64" | "blob";

export interface StorageAdapter {
  putFile(
    buffer: Buffer,
    metadata: { fileName: string; mimeType: string; tenderId?: string },
  ): Promise<{ storagePath: string; fileContent?: string; provider: StorageProvider }>;
  getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer>;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN.length > 0);
}

function canUseLocalDisk(): boolean {
  // In production serverless (Vercel) the writable filesystem is /tmp
  // only — and persistence across requests isn't guaranteed. We treat
  // local disk as unavailable in production unless STORAGE_ROOT is
  // explicitly configured to /tmp/... .
  if (!isProduction()) return true;
  return Boolean(process.env.STORAGE_ROOT);
}

/** Resolves the active provider for the current environment. */
export function resolveStorageProvider(): StorageProvider {
  if (hasBlobToken()) return "blob";
  if (canUseLocalDisk()) return "local";
  return "db-base64";
}

class LocalStorage implements StorageAdapter {
  async putFile(
    buffer: Buffer,
    metadata: { fileName: string; mimeType: string; tenderId?: string },
  ): Promise<{ storagePath: string; fileContent?: string; provider: StorageProvider }> {
    const ext = path.extname(metadata.fileName) || "";
    const scope = metadata.tenderId ? "tender" : "company";
    const dir = path.join(STORAGE_ROOT, scope);
    await ensureDir(dir);
    const fileName = `${randomUUID()}${ext}`;
    const storagePath = path.join(dir, fileName);
    await writeFile(storagePath, buffer);
    return { storagePath, provider: "local" };
  }

  async getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer> {
    // Legacy compatibility: row with empty storagePath but populated
    // fileContent (base64) — read from fileContent.
    if ((!record.storagePath || record.storagePath.length === 0) && record.fileContent) {
      return Buffer.from(record.fileContent, "base64");
    }
    if (!record.storagePath) {
      throw new Error(`getFile: record "${record.fileName}" has no storagePath or fileContent`);
    }
    return readFile(record.storagePath);
  }
}

class DbBase64Storage implements StorageAdapter {
  async putFile(
    buffer: Buffer,
    metadata: { fileName: string; mimeType: string; tenderId?: string },
  ): Promise<{ storagePath: string; fileContent?: string; provider: StorageProvider }> {
    if (buffer.byteLength > DB_BASE64_MAX_BYTES) {
      throw new Error(
        `db-base64 storage cannot accept files larger than ${DB_BASE64_MAX_BYTES} bytes (received ${buffer.byteLength}). Configure BLOB_READ_WRITE_TOKEN or STORAGE_ROOT to enable a real filesystem backend.`,
      );
    }
    return {
      storagePath: "",
      fileContent: buffer.toString("base64"),
      provider: "db-base64",
    };
  }

  async getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer> {
    if (!record.fileContent) {
      throw new Error(`db-base64 read: record "${record.fileName}" has no fileContent`);
    }
    return Buffer.from(record.fileContent, "base64");
  }
}

/**
 * Stub blob adapter — without the @vercel/blob SDK we can't actually
 * upload; instead, fall back to db-base64 for the put but still allow
 * reads from a `https://` storagePath URL if one was ever written by
 * an external system.
 */
class BlobStorage implements StorageAdapter {
  private readonly fallback = new DbBase64Storage();
  async putFile(
    buffer: Buffer,
    metadata: { fileName: string; mimeType: string; tenderId?: string },
  ): Promise<{ storagePath: string; fileContent?: string; provider: StorageProvider }> {
    // The @vercel/blob client is not bundled with this build. We delegate
    // to db-base64 (with its 5 MB cap) so the call still completes safely
    // and large uploads still error out clearly. Operators who need real
    // blob storage should add the @vercel/blob SDK + a real upload here.
    const result = await this.fallback.putFile(buffer, metadata);
    return { ...result, provider: "blob" };
  }

  async getFile(record: { storagePath?: string | null; fileContent?: string | null; fileName: string }): Promise<Buffer> {
    if (record.storagePath && /^https?:\/\//.test(record.storagePath)) {
      const res = await fetch(record.storagePath);
      if (!res.ok) throw new Error(`blob fetch failed: ${res.status} ${res.statusText}`);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
    return this.fallback.getFile(record);
  }
}

/**
 * Lazy singleton adapter, resolved at first use. Tests can call
 * resetStorageAdapter() to force re-resolution after mutating env.
 */
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

// ─── legacy helpers ──────────────────────────────────────────────────────────

export async function saveUploadedFile(
  file: File,
  scope: "company" | "tender" | "generated" | "assets" = "tender",
) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name);
  const dir = path.join(STORAGE_ROOT, scope);
  await ensureDir(dir);

  const fileName = `${randomUUID()}${ext}`;
  const storagePath = path.join(dir, fileName);
  await writeFile(storagePath, buffer);

  return {
    fileName,
    originalFileName: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    storagePath,
  };
}

export async function ensureGeneratedDir() {
  const dir = path.join(STORAGE_ROOT, "generated");
  await ensureDir(dir);
  return dir;
}
