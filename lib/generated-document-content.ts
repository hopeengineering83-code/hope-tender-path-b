import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

function generatedStorageRoot(): string {
  if (process.env.GENERATED_DOCUMENT_STORAGE_ROOT) return process.env.GENERATED_DOCUMENT_STORAGE_ROOT;
  if (process.env.STORAGE_ROOT) return path.join(process.env.STORAGE_ROOT, "generated-documents");
  if (process.env.VERCEL || process.env.NOW_REGION) return path.join(tmpdir(), "hope-tender-generated-documents");
  return path.join(process.cwd(), ".storage", "generated-documents");
}

export async function saveGeneratedDocumentBuffer(buffer: Buffer, extension = ".docx"): Promise<string> {
  const root = generatedStorageRoot();
  await mkdir(root, { recursive: true });
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  const fileName = `${randomUUID()}${safeExt.replace(/[^.a-zA-Z0-9]/g, "") || ".docx"}`;
  const storagePath = path.join(root, fileName);
  await writeFile(storagePath, buffer);
  return storagePath;
}

export async function loadGeneratedDocumentBuffer(doc: { storagePath?: string | null; fileContent?: string | null }): Promise<Buffer | null> {
  if (doc.storagePath) {
    try {
      return await readFile(doc.storagePath);
    } catch (error) {
      // Fall back to legacy inline content if available. This preserves
      // backward compatibility for rows created before storagePath was wired.
      if (!doc.fileContent) throw error;
    }
  }
  if (!doc.fileContent) return null;
  return Buffer.from(doc.fileContent, "base64");
}

export function shouldInlineGeneratedDocumentContent(): boolean {
  // Development keeps inline content for easy local debugging. Production
  // should store binary content outside the row and read via storagePath.
  if (process.env.INLINE_GENERATED_DOCUMENT_CONTENT === "true") return true;
  if (process.env.INLINE_GENERATED_DOCUMENT_CONTENT === "false") return false;
  return process.env.NODE_ENV !== "production" && !(process.env.VERCEL || process.env.NOW_REGION);
}
