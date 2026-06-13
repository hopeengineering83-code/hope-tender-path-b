import type { AIRequirement } from "./ai";

export type TenderSourceFile = {
  id: string;
  fileName: string;
  originalFileName: string;
  extractedText?: string | null;
  extractionMethod?: string | null;
  ocrPages?: number | null;
};

type SourceAwareRequirement = Partial<AIRequirement> & {
  sourceTenderFileId?: string | null;
  sourceFileToken?: string | null;
  sourceFileName?: string | null;
  sourceExtractionMethod?: "text" | "ocr" | "mixed" | "manual" | null;
  sourceConfidence?: number | null;
  sourceLinkageWarning?: string | null;
};

export type SourceLinkageResolution = {
  sourceTenderFileId: string | null;
  sourceFileName: string | null;
  sourceExtractionMethod: "text" | "ocr" | "mixed" | null;
  sourceConfidence: number;
  sourceLinkageWarning: string | null;
};

const TOKEN_PREFIX = "TFILE:";

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\\/g, "/").replace(/^.*\//, "").replace(/\s+/g, " ");
}

function normalizedQuote(value: string | null | undefined): string {
  return normalized(value).replace(/[^a-z0-9]+/gi, " ").trim();
}

export function tenderFileSourceToken(fileId: string): string {
  return `${TOKEN_PREFIX}${fileId}`;
}

export function buildTenderFileSourceHeader(file: Pick<TenderSourceFile, "id" | "fileName" | "originalFileName">): string {
  const name = file.originalFileName || file.fileName;
  return `[TENDER_FILE|TOKEN=${tenderFileSourceToken(file.id)}|ID=${file.id}|NAME=${encodeURIComponent(name)}]`;
}

function tokenToId(token: string | null | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  if (trimmed.startsWith(TOKEN_PREFIX)) return trimmed.slice(TOKEN_PREFIX.length) || null;
  const embedded = trimmed.match(/(?:TOKEN=TFILE:|ID=)([a-zA-Z0-9_-]+)/);
  return embedded?.[1] ?? null;
}

function extractionMethod(file: TenderSourceFile): "text" | "ocr" | "mixed" {
  if (file.extractionMethod === "mixed") return "mixed";
  if (file.extractionMethod === "ocr" || (file.ocrPages ?? 0) > 0) return "ocr";
  return "text";
}

export function resolveRequirementSourceFile(requirement: SourceAwareRequirement, files: TenderSourceFile[]): SourceLinkageResolution {
  const requestedId = requirement.sourceTenderFileId || tokenToId(requirement.sourceFileToken);
  if (requestedId) {
    const exact = files.find((file) => file.id === requestedId);
    if (exact) {
      return {
        sourceTenderFileId: exact.id,
        sourceFileName: exact.originalFileName || exact.fileName,
        sourceExtractionMethod: extractionMethod(exact),
        sourceConfidence: requirement.sourcePage && requirement.sourceQuote ? 0.98 : 0.92,
        sourceLinkageWarning: null,
      };
    }
    return {
      sourceTenderFileId: null,
      sourceFileName: requirement.sourceFileName ?? null,
      sourceExtractionMethod: null,
      sourceConfidence: 0.15,
      sourceLinkageWarning: `AI returned an unknown tender-file token (${requestedId}); source linkage requires review.`,
    };
  }

  const requestedName = normalized(requirement.sourceFileName);
  if (requestedName) {
    const matches = files.filter((file) => normalized(file.originalFileName) === requestedName || normalized(file.fileName) === requestedName);
    if (matches.length === 1) {
      const match = matches[0];
      return {
        sourceTenderFileId: match.id,
        sourceFileName: match.originalFileName || match.fileName,
        sourceExtractionMethod: extractionMethod(match),
        sourceConfidence: requirement.sourcePage && requirement.sourceQuote ? 0.94 : 0.84,
        sourceLinkageWarning: null,
      };
    }
    if (matches.length > 1) {
      return {
        sourceTenderFileId: null,
        sourceFileName: requirement.sourceFileName ?? null,
        sourceExtractionMethod: null,
        sourceConfidence: 0.2,
        sourceLinkageWarning: `Tender-file name "${requirement.sourceFileName}" is ambiguous; no file ID was fabricated.`,
      };
    }
  }

  const quote = normalizedQuote(requirement.sourceQuote);
  if (quote.length >= 24) {
    const quoteMatches = files.filter((file) => normalizedQuote(file.extractedText).includes(quote));
    if (quoteMatches.length === 1) {
      const match = quoteMatches[0];
      return {
        sourceTenderFileId: match.id,
        sourceFileName: match.originalFileName || match.fileName,
        sourceExtractionMethod: extractionMethod(match),
        sourceConfidence: requirement.sourcePage ? 0.88 : 0.78,
        sourceLinkageWarning: null,
      };
    }
    if (quoteMatches.length > 1) {
      return {
        sourceTenderFileId: null,
        sourceFileName: null,
        sourceExtractionMethod: null,
        sourceConfidence: 0.2,
        sourceLinkageWarning: "The source quote appears in multiple tender files; no file ID was fabricated.",
      };
    }
  }

  return {
    sourceTenderFileId: null,
    sourceFileName: requirement.sourceFileName ?? null,
    sourceExtractionMethod: null,
    sourceConfidence: requirement.sourcePage || requirement.sourceQuote ? 0.3 : 0,
    sourceLinkageWarning: "Requirement has no unambiguous tender-file source; manual traceability review is required.",
  };
}

export function enrichRequirementsWithSourceLinkage(requirements: AIRequirement[], files: TenderSourceFile[]): AIRequirement[] {
  return requirements.map((requirement) => {
    const sourceAwareRequirement = requirement as SourceAwareRequirement;
    const resolution = resolveRequirementSourceFile(sourceAwareRequirement, files);
    return {
      ...sourceAwareRequirement,
      sourceTenderFileId: resolution.sourceTenderFileId,
      sourceFileName: resolution.sourceFileName,
      sourceExtractionMethod: resolution.sourceExtractionMethod,
      sourceConfidence: resolution.sourceConfidence,
      sourceLinkageWarning: resolution.sourceLinkageWarning,
    } as AIRequirement;
  });
}
