import { RequirementDraft } from "./types";

const IDENTITY_STOP_WORDS = new Set("a an and bidder bidders company document documents evidence for from must of provide required requirement shall submit submission the to with".split(" "));

export function canonicalRequirementIdentity(requirement: Pick<RequirementDraft, "title" | "description" | "requirementType">): string {
  const normalized = requirement.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/curriculum vitae/g, " cv ")
    .replace(/past performance|project references?/g, " project experience ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !IDENTITY_STOP_WORDS.has(token));
  return `${requirement.requirementType ?? "UNKNOWN"}::${[...new Set(normalized)].sort().slice(0, 24).join("-")}`;
}

export function deduplicateRequirements(requirements: RequirementDraft[]): RequirementDraft[] {
  const byIdentity = new Map<string, RequirementDraft>();
  for (const requirement of requirements) {
    const identity = canonicalRequirementIdentity(requirement);
    const current = byIdentity.get(identity);
    if (!current || `${requirement.title} ${requirement.description}`.length > `${current.title} ${current.description}`.length) {
      byIdentity.set(identity, requirement);
    }
  }
  return [...byIdentity.values()];
}

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
    const key = canonicalRequirementIdentity({ ...e, description: "" });
    if (!existingMap.has(key)) existingMap.set(key, e.id);
  }

  // ─── BATCH PERSISTENCE ─────────────────────────────────────────────
  // Split into two phases to reduce transaction budget consumption:
  //   1. Updates: dispatched via Promise.all (still individual UPDATE
  //      statements, but dispatched concurrently through the tx client)
  //   2. Creates: batched into a single createMany call (one INSERT)
  const processedIds = new Set<string>();
  const created: string[] = [];
  const updated: string[] = [];

  const toCreate: Array<{
    tenderId: string;
    title: string;
    requirementType: string;
    description: string;
    priority: string;
    requiredQuantity: number | null;
    pageLimit: number | null;
    exactFileName: string | null;
    exactOrder: number | null;
    restrictions: string | null;
    sectionReference: string | null;
    sourcePageNumber: number | null;
    sourceExactQuote: string | null;
    sourceTenderFileId: string | null;
    sourceConfidence: number;
    sourceExtractionMethod: string | null;
    sourceSectionHeading: string | null;
  }> = [];
  const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const req of deduplicateRequirements(newReqs)) {
    const key = canonicalRequirementIdentity(req);
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
      toUpdate.push({ id: existingId, data });
      processedIds.add(existingId);
      updated.push(existingId);
    } else {
      toCreate.push({
        tenderId,
        title: req.title,
        requirementType: req.requirementType,
        ...data,
      });
    }
  }

  // Phase 1: updates. Each is a separate UPDATE statement but dispatched
  // via Promise.all so they are queued together.
  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map(({ id, data }) =>
        tx.tenderRequirement.update({ where: { id }, data })
      )
    );
  }

  // Batch 2: creates via createMany (single SQL INSERT).
  // createMany is the most efficient way to insert multiple rows — it
  // generates a single INSERT statement instead of N round-trips.
  if (toCreate.length > 0) {
    const result = await tx.tenderRequirement.createMany({
      data: toCreate,
    });
    // Note: createMany does not return created IDs on PostgreSQL by default.
    // The created count is available via result.count. The IDs are not
    // needed here because the requirements are matched by content hash
    // on subsequent runs, not by ID.
    created.push(`${result.count} created`);
  }

  if (options.deleteMissing) {
    const toDelete = existing.filter((e: { id: string }) => !processedIds.has(e.id)).map((e: { id: string }) => e.id);
    if (toDelete.length > 0) {
      await tx.tenderRequirement.deleteMany({
        where: { id: { in: toDelete } },
      });
    }
  }

  return { created, updated, total: processedIds.size };
}
