type PlanBPayloadLike = {
  expectedCounts?: {
    experts?: number;
    projects?: number;
  };
};

type PlanBSourceDocumentLike = {
  fileName?: string;
  title?: string;
  parsedExperts?: number;
  parsedProjects?: number;
};

export function deriveExpectedCounts(payload: PlanBPayloadLike, sourceDocuments: PlanBSourceDocumentLike[]) {
  const explicitExperts = Number(payload.expectedCounts?.experts ?? 0);
  const explicitProjects = Number(payload.expectedCounts?.projects ?? 0);
  const docExperts = sourceDocuments.reduce((sum, doc) => sum + Number(doc.parsedExperts ?? 0), 0);
  const docProjects = sourceDocuments.reduce((sum, doc) => sum + Number(doc.parsedProjects ?? 0), 0);
  return {
    experts: explicitExperts > 0 ? explicitExperts : docExperts > 0 ? docExperts : null,
    projects: explicitProjects > 0 ? explicitProjects : docProjects > 0 ? docProjects : null,
  };
}

export function hasUsableText(value: string | null, requireRawText: boolean): boolean {
  if (!requireRawText) return true;
  return Boolean(value && value.length >= 50);
}

export function completenessStats(expected: number | null, imported: number) {
  if (!expected) return null;
  const missing = Math.max(expected - imported, 0);
  const excess = Math.max(imported - expected, 0);
  return { expected, imported, missing, excess, matched: missing === 0 && excess === 0 };
}
