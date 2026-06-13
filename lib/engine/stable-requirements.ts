import { RequirementDraft } from "./types";

/**
 * Reconciles new requirements from analysis with existing ones in the DB.
 * Tries to match by normalized title and type to preserve IDs.
 * This ensures that ComplianceMatrix links (which depend on requirementId)
 * are not severed when AI Analyze is re-run.
 */
export async function upsertRequirements(
  tx: any, // Prisma transaction client
  tenderId: string,
  newReqs: RequirementDraft[],
  options: { deleteMissing: boolean } = { deleteMissing: true }
) {
  const existing = await tx.tenderRequirement.findMany({
    where: { tenderId },
    select: { id: true, title: true, requirementType: true },
  });

  const existingMap = new Map<string, string>();
  for (const e of existing) {
    const key = `${e.requirementType ?? "UNKNOWN"}::${(e.title ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (!existingMap.has(key)) existingMap.set(key, e.id);
  }

  const processedIds = new Set<string>();
  const created: string[] = [];
  const updated: string[] = [];

  for (const req of newReqs) {
    const key = `${req.requirementType ?? "UNKNOWN"}::${(req.title ?? "").toLowerCase().replace(/\s+/g, " ").trim()}`;
    const existingId = existingMap.get(key);

    const data = {
      description: req.description,
      priority: req.priority,
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
    };

    if (existingId) {
      await tx.tenderRequirement.update({
        where: { id: existingId },
        data,
      });
      processedIds.add(existingId);
      updated.push(existingId);
    } else {
      const createdReq = await tx.tenderRequirement.create({
        data: {
          tenderId,
          title: req.title,
          requirementType: req.requirementType,
          ...data,
        },
      });
      processedIds.add(createdReq.id);
      created.push(createdReq.id);
    }
  }

  if (options.deleteMissing) {
    const toDelete = existing.filter(e => !processedIds.has(e.id)).map(e => e.id);
    if (toDelete.length > 0) {
      await tx.tenderRequirement.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
  }

  return { created, updated, total: processedIds.size };
}
