import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

function defaultStorageRoot(): string {
  if (process.env.STORAGE_ROOT) return process.env.STORAGE_ROOT;

  // Vercel serverless deployments expose a read-only application directory.
  // Only /tmp is writable, so default there instead of process.cwd()/.storage.
  if (process.env.VERCEL || process.env.NOW_REGION) {
    return path.join(tmpdir(), "hope-tender-storage");
  }

  return path.join(process.cwd(), ".storage");
}

const STORAGE_ROOT = defaultStorageRoot();

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function saveUploadedFile(file: File, scope: "company" | "tender" | "generated" | "assets" = "tender") {
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
