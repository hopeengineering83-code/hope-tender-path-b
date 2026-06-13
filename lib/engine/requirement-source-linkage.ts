export type RequirementSourceCandidate = {
  id: string;
  tenderId: string;
  originalFileName: string;
  fileName?: string | null;
  extractedText?: string | null;
  extractionMethod?: string | null;
};

export type RequirementSourceInput = {
  tenderId: string;
  sourceTenderFileId?: string | null;
  sourceFileName?: string | null;
  sourceExactQuote?: string | null;
  sourcePageNumber?: number | null;
  sourceConfidence?: number | null;
};

export type RequirementSourceResolution = {
  sourceTenderFileId: string | null;
  sourceExtractionMethod: string | null;
  sourceConfidence: number;
  status: "RESOLVED" | "AMBIGUOUS" | "MISSING" | "INVALID_EXPLICIT_ID";
  warning: string | null;
};

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\s+/g, " ");
}

function boundedUnresolvedConfidence(input: RequirementSourceInput): number {
  const hasCoordinate = Boolean(input.sourcePageNumber || input.sourceExactQuote?.trim());
  if (!hasCoordinate) return 0;
  return Math.min(0.45, Math.max(0.25, input.sourceConfidence ?? 0));
}

function resolvedConfidence(input: RequirementSourceInput): number {
  const floor = input.sourcePageNumber && input.sourceExactQuote?.trim() ? 0.95 : 0.85;
  return Math.max(floor, Math.min(1, input.sourceConfidence ?? 0));
}

/**
 * Resolve a requirement to one uploaded TenderFile without guessing.
 * Resolution order:
 * 1. Explicit file id, validated against the same tender.
 * 2. Unique normalized file-name match.
 * 3. Unique exact-quote match in extracted text.
 * Ambiguous or missing matches stay null and are capped below high-confidence.
 */
export function resolveRequirementSource(
  input: RequirementSourceInput,
  candidates: RequirementSourceCandidate[],
): RequirementSourceResolution {
  const sameTender = candidates.filter((file) => file.tenderId === input.tenderId);

  if (input.sourceTenderFileId) {
    const explicit = sameTender.find((file) => file.id === input.sourceTenderFileId);
    if (explicit) {
      return {
        sourceTenderFileId: explicit.id,
        sourceExtractionMethod: explicit.extractionMethod ?? null,
        sourceConfidence: resolvedConfidence(input),
        status: "RESOLVED",
        warning: null,
      };
    }
    return {
      sourceTenderFileId: null,
      sourceExtractionMethod: null,
      sourceConfidence: boundedUnresolvedConfidence(input),
      status: "INVALID_EXPLICIT_ID",
      warning: "The supplied source file id does not belong to this tender.",
    };
  }

  const normalizedRequestedName = normalizeName(input.sourceFileName);
  if (normalizedRequestedName) {
    const nameMatches = sameTender.filter((file) => {
      const names = [file.originalFileName, file.fileName].map(normalizeName).filter(Boolean);
      return names.includes(normalizedRequestedName);
    });
    if (nameMatches.length === 1) {
      const match = nameMatches[0];
      return {
        sourceTenderFileId: match.id,
        sourceExtractionMethod: match.extractionMethod ?? null,
        sourceConfidence: resolvedConfidence(input),
        status: "RESOLVED",
        warning: null,
      };
    }
    if (nameMatches.length > 1) {
      return {
        sourceTenderFileId: null,
        sourceExtractionMethod: null,
        sourceConfidence: boundedUnresolvedConfidence(input),
        status: "AMBIGUOUS",
        warning: `More than one uploaded tender file matches ${input.sourceFileName}.`,
      };
    }
  }

  const quote = input.sourceExactQuote?.trim();
  if (quote && quote.length >= 16) {
    const normalizedQuote = quote.toLocaleLowerCase();
    const quoteMatches = sameTender.filter((file) =>
      (file.extractedText ?? "").toLocaleLowerCase().includes(normalizedQuote),
    );
    if (quoteMatches.length === 1) {
      const match = quoteMatches[0];
      return {
        sourceTenderFileId: match.id,
        sourceExtractionMethod: match.extractionMethod ?? null,
        sourceConfidence: resolvedConfidence(input),
        status: "RESOLVED",
        warning: null,
      };
    }
    if (quoteMatches.length > 1) {
      return {
        sourceTenderFileId: null,
        sourceExtractionMethod: null,
        sourceConfidence: boundedUnresolvedConfidence(input),
        status: "AMBIGUOUS",
        warning: "The source quote appears in more than one uploaded tender file.",
      };
    }
  }

  return {
    sourceTenderFileId: null,
    sourceExtractionMethod: null,
    sourceConfidence: boundedUnresolvedConfidence(input),
    status: "MISSING",
    warning: "No unambiguous uploaded tender file could be linked to this requirement.",
  };
}

export function formatTenderFileAnalysisMarker(file: Pick<RequirementSourceCandidate, "id" | "originalFileName">): string {
  return `[FILE_ID:${file.id}|FILE_NAME:${file.originalFileName}]`;
}
