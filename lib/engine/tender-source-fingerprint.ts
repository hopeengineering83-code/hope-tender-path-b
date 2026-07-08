import { computeStableHash } from "./tender-workflow-runner";

export type TenderSourceFingerprintInput = {
  sourceFiles: Array<{ id: string; contentHash?: string | null; updatedAt?: Date | string | null; extractionStatus?: string | null }>;
  extractionRevision?: string | number | null;
  analysisRevision?: string | number | null;
  buildPlanRevision?: string | number | null;
  companyRevision?: string | number | null;
  assetRevision?: string | number | null;
  templateRevision?: string | number | null;
};

export function computeTenderSourceFingerprint(input: TenderSourceFingerprintInput): string {
  return computeStableHash({
    sourceFiles: input.sourceFiles
      .map((f) => ({ id: f.id, contentHash: f.contentHash ?? null, updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : null, extractionStatus: f.extractionStatus ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    extractionRevision: input.extractionRevision ?? null,
    analysisRevision: input.analysisRevision ?? null,
    buildPlanRevision: input.buildPlanRevision ?? null,
    companyRevision: input.companyRevision ?? null,
    assetRevision: input.assetRevision ?? null,
    templateRevision: input.templateRevision ?? null,
  });
}

export function isWorkflowOutputStale(storedFingerprint: string | null | undefined, currentFingerprint: string): boolean {
  return Boolean(storedFingerprint && storedFingerprint !== currentFingerprint);
}
