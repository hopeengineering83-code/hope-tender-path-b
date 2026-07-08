import { computeFileHash, toBuffer, validatePackageManifest, type ManifestValidationItem } from "./generated-file-integrity";

export type FinalPackageManifestItem = {
  documentId: string;
  filename: string;
  required: boolean;
  source: "generated" | "uploaded" | "asset" | "manual";
  mimeType: string;
  byteSize: number;
  sha256: string;
  order: number;
  signatureRequired?: boolean;
  stampRequired?: boolean;
  valid: boolean;
  problem?: string;
};

export type ManifestSourceDocument = {
  id: string;
  exactFileName?: string | null;
  name?: string | null;
  documentType?: string | null;
  fileContent?: string | null;
  mimeType?: string | null;
  exactOrder?: number | null;
  required?: boolean | null;
  source?: FinalPackageManifestItem["source"] | null;
  stale?: boolean | null;
  generationStatus?: string | null;
};

export function buildFinalPackageManifest(docs: ManifestSourceDocument[]): { items: FinalPackageManifestItem[]; blockers: string[]; warnings: string[]; ok: boolean } {
  const items = docs.map((doc, index): FinalPackageManifestItem => {
    const filename = sanitizeFinalFilename(doc.exactFileName ?? doc.name ?? `document-${index + 1}.docx`);
    const bytes = doc.fileContent ? toBuffer(doc.fileContent) : Buffer.alloc(0);
    const valid = bytes.length > 0 && doc.generationStatus !== "STALE" && !doc.stale;
    return {
      documentId: doc.id,
      filename,
      required: doc.required !== false,
      source: doc.source ?? "generated",
      mimeType: doc.mimeType ?? inferMime(filename),
      byteSize: bytes.length,
      sha256: bytes.length ? computeFileHash(bytes) : "",
      order: doc.exactOrder ?? index + 1,
      valid,
      problem: bytes.length === 0 ? "missing or zero-byte content" : doc.stale || doc.generationStatus === "STALE" ? "stale document" : undefined,
    };
  }).sort((a, b) => a.order - b.order || a.filename.localeCompare(b.filename));
  const validation = validateStrictFinalPackageManifest(items);
  return { items, blockers: validation.blockers, warnings: validation.warnings, ok: validation.ok };
}

export function validateStrictFinalPackageManifest(items: FinalPackageManifestItem[]) {
  return validatePackageManifest(items.map((i): ManifestValidationItem => ({ ...i, stale: i.problem === "stale document" })), { requireAllRequired: true });
}

export function manifestFingerprint(items: FinalPackageManifestItem[]): string {
  return computeFileHash(JSON.stringify(items.map((i) => ({ documentId: i.documentId, filename: i.filename, required: i.required, source: i.source, mimeType: i.mimeType, byteSize: i.byteSize, sha256: i.sha256, order: i.order }))));
}

function sanitizeFinalFilename(filename: string): string {
  const cleaned = filename.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "document.docx";
}

function inferMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
