import type { AIRequirement } from "./ai";

export type TenderSourceFileReference = {
  id: string;
  fileName: string | null;
  originalFileName: string | null;
  extractionMethod?: string | null;
  ocrPages?: number | null;
};

export type RequirementSourceLinkage = {
  sourceTenderFileId: string | null;
  sourceExtractionMethod: "text" | "ocr" | "mixed" | "manual" | null;
  sourceConfidence: number;
  warnings: string[];
};

function normalizeFileName(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\s+/g, " ");
}

function parseFileToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\[?FILE_ID:([^\]|\s]+)(?:\]|\||\s|$)/i);
  return match?.[1]?.trim() || null;
}

function explicitSourceFileId(req: AIRequirement): string | null {
  const extended = req as AIRequirement & {
    sourceTenderFileId?: string | null;
    sourceFileId?: string | null;
    sourceFileToken?: string | null;
    sourceFileName?: string | null;
  };
  return (
    extended.sourceTenderFileId ??
    extended.sourceFileId ??
    parseFileToken(extended.sourceFileToken) ??
    parseFileToken(extended.exactFileName) ??
    null
  );
}

function candidateSourceFileNames(req: AIRequirement): string[] {
  const extended = req as AIRequirement & { sourceFileName?: string | null; sourceFileToken?: string | null };
  return [extended.sourceFileName, extended.exactFileName, extended.sourceFileToken]
    .map(normalizeFileName)
    .filter(Boolean);
}

function extractionMethodFor(file: TenderSourceFileReference | null): RequirementSourceLinkage["sourceExtractionMethod"] {
  if (!file) return null;
  if (file.extractionMethod === "ocr" || (file.ocrPages ?? 0) > 0) return "ocr";
  if (file.extractionMethod === "mixed") return "mixed";
  if (file.extractionMethod === "manual") return "manual";
  return "text";
}

export function resolveRequirementSourceLinkage(
  req: AIRequirement,
  files: TenderSourceFileReference[],
): RequirementSourceLinkage {
  const warnings: string[] = [];
  const byId = new Map(files.map((file) => [file.id, file]));
  const explicitId = explicitSourceFileId(req);

  if (explicitId) {
    const file = byId.get(explicitId) ?? null;
    if (file) {
      return {
        sourceTenderFileId: file.id,
        sourceExtractionMethod: extractionMethodFor(file),
        sourceConfidence: Math.max(typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.9 : 0.8, typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.85 : 0),
        warnings,
      };
    }
    warnings.push(`Unresolved source file id: ${explicitId}`);
    return { sourceTenderFileId: null, sourceExtractionMethod: null, sourceConfidence: 0.35, warnings };
  }

  const names = candidateSourceFileNames(req);
  if (names.length === 0) {
    warnings.push("Missing requirement source file reference");
    return {
      sourceTenderFileId: null,
      sourceExtractionMethod: null,
      sourceConfidence: typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.45 : 0,
      warnings,
    };
  }

  const matches = files.filter((file) => {
    const stored = [file.originalFileName, file.fileName].map(normalizeFileName).filter(Boolean);
    return names.some((name) => stored.includes(name));
  });

  if (matches.length === 1) {
    const file = matches[0];
    return {
      sourceTenderFileId: file.id,
      sourceExtractionMethod: extractionMethodFor(file),
      sourceConfidence: typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : 0.7,
      warnings,
    };
  }

  if (matches.length > 1) {
    warnings.push(`Ambiguous source file reference: ${names.join(", ")}`);
    return { sourceTenderFileId: null, sourceExtractionMethod: null, sourceConfidence: 0.25, warnings };
  }

  warnings.push(`Unmatched source file reference: ${names.join(", ")}`);
  return { sourceTenderFileId: null, sourceExtractionMethod: null, sourceConfidence: 0.35, warnings };
}

export function buildTenderFileSourceBlock(files: TenderSourceFileReference[]): string {
  return files
    .map((file) => `[FILE_ID:${file.id}|FILE_NAME:${file.originalFileName || file.fileName || "unnamed"}]`)
    .join("\n");
}
