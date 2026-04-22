import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), ".storage");

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
