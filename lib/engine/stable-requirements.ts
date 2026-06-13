import type { Prisma } from "@prisma/client";
import type { RequirementDraft } from "./types";

export function stableRequirementKey(type: string | null | undefined, title: string | null | undefined): string {
  return `${(type ?? "UNKNOWN").trim().toUpperCase()}::${(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()}`;
}

export async function upsertRequirements(
  tx: Prisma.TransactionClient,
  tenderId: string,
  newReqs: RequirementDraft[],
  options: { deleteMissing?: boolean } = {},
) {
  const existing = await tx.tenderRequirement.findMany({
    where: { tenderId },
    select: { id: true, title: true, requirementType: true, _count: { select: { complianceMatrixRows: true } } },
  });
  const byKey = new Map(existing.map((row) => [stableRequirementKey(row.requirementType, row.title), row.id]));
  const processedIds = new Set<string>();
  const created: string[] = [];
  const updated: string[] = [];

  for (const req of newReqs) {
    const existingId = byKey.get(stableRequirementKey(req.requirementType, req.title));
    const data = {
      description: req.description,
      priority: req.priority,
      ...(req.requiredQuantity != null ? { requiredQuantity: req.requiredQuantity } : {}),
      ...(req.pageLimit != null ? { pageLimit: req.pageLimit } : {}),
      ...(req.exactFileName != null ? { exactFileName: req.exactFileName } : {}),
      ...(req.exactOrder != null ? { exactOrder: req.exactOrder } : {}),
      ...(req.restrictions != null ? { restrictions: req.restrictions } : {}),
      ...(req.sectionReference != null ? { sectionReference: req.sectionReference } : {}),
      ...(req.sourcePageNumber != null ? { sourcePageNumber: req.sourcePageNumber } : {}),
      ...(req.sourceExactQuote != null ? { sourceExactQuote: req.sourceExactQuote } : {}),
      ...(req.sourceTenderFileId != null ? { sourceTenderFileId: req.sourceTenderFileId } : {}),
      ...(req.sourceConfidence != null ? { sourceConfidence: req.sourceConfidence } : {}),
      ...(req.sourceExtractionMethod != null ? { sourceExtractionMethod: req.sourceExtractionMethod } : {}),
      ...(req.sourceSectionHeading != null ? { sourceSectionHeading: req.sourceSectionHeading } : {}),
    };

    if (existingId) {
      await tx.tenderRequirement.update({ where: { id: existingId }, data });
      processedIds.add(existingId);
      updated.push(existingId);
    } else {
      const createdReq = await tx.tenderRequirement.create({
        data: {
          tenderId,
          title: req.title,
          requirementType: req.requirementType,
          requiredQuantity: req.requiredQuantity ?? null,
          pageLimit: req.pageLimit ?? null,
          exactFileName: req.exactFileName ?? null,
          exactOrder: req.exactOrder ?? null,
          restrictions: req.restrictions ?? null,
          sectionReference: req.sectionReference ?? null,
          sourcePageNumber: req.sourcePageNumber ?? null,
          sourceExactQuote: req.sourceExactQuote ?? null,
          sourceTenderFileId: req.sourceTenderFileId ?? null,
          sourceConfidence: req.sourceConfidence ?? 0,
          sourceExtractionMethod: req.sourceExtractionMethod ?? null,
          sourceSectionHeading: req.sourceSectionHeading ?? null,
          description: req.description,
          priority: req.priority,
        },
      });
      processedIds.add(createdReq.id);
      created.push(createdReq.id);
    }
  }

  const missing = existing.filter((row) => !processedIds.has(row.id));
  const deletable = options.deleteMissing ? missing.filter((row) => row._count.complianceMatrixRows === 0) : [];
  if (deletable.length > 0) {
    await tx.tenderRequirement.deleteMany({ where: { id: { in: deletable.map((row) => row.id) } } });
  }

  return {
    created,
    updated,
    deleted: deletable.map((row) => row.id),
    retainedMissing: missing.filter((row) => !deletable.some((item) => item.id === row.id)).map((row) => row.id),
    total: processedIds.size,
  };
}
