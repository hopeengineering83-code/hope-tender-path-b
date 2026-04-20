import { mkdir, writeFile } from "fs/promises";
import path from "path";

export async function saveUploadedFile(file: File) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const uploadDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadDir, { recursive: true });

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = path.join(uploadDir, safeName);

  await writeFile(filePath, buffer);

  return {
    originalName: file.name,
    savedName: safeName,
    path: filePath,
    size: file.size,
    type: file.type,
  };
}
