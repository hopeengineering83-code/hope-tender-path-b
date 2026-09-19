import type { PrismaClient } from "@prisma/client";

export type VaultDeduplicationResult = {
  mergedExperts: number;
  mergedProjects: number;
  ambiguousExpertGroups: number;
  ambiguousProjectGroups: number;
};

function canonicalIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:mr|mrs|ms|dr|prof|professor|eng|engr|engineer)\.?\s+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nonEmpty(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function trustRank(value: string | null | undefined): number {
  if (value === "REVIEWED") return 4;
  if (value === "SOURCE_VERIFIED") return 3;
  if (value === "AI_DRAFT") return 2;
  if (value === "REGEX_DRAFT") return 1;
  return 0;
}

function jsonUnion(values: Array<string | null | undefined>): string {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        for (const item of parsed) if (String(item).trim()) out.add(String(item).trim());
        continue;
      }
    } catch {
      // Fall through to comma-separated legacy values.
    }
    for (const item of value.split(",")) if (item.trim()) out.add(item.trim());
  }
  return JSON.stringify([...out]);
}

function bestText(values: Array<string | null | undefined>): string | null {
  return values
    .map(nonEmpty)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

function hasConflictingExpertIdentifiers(rows: Array<{ email: string | null; phone: string | null }>): boolean {
  const emails = new Set(rows.map((row) => nonEmpty(row.email)?.toLowerCase()).filter(Boolean));
  const phones = new Set(rows.map((row) => nonEmpty(row.phone)?.replace(/\D+/g, "")).filter(Boolean));
  return emails.size > 1 || phones.size > 1;
}

/**
 * Consolidate only deterministic duplicate groups. Uncertain people with the
 * same display name but conflicting email/phone identifiers are left intact
 * and counted as ambiguous; no fuzzy automatic merge is performed.
 */
export async function deduplicateCompanyVaultRecords(
  prisma: PrismaClient,
  companyId: string,
): Promise<VaultDeduplicationResult> {
  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);

  let mergedExperts = 0;
  let mergedProjects = 0;
  let ambiguousExpertGroups = 0;
  let ambiguousProjectGroups = 0;

  const expertGroups = new Map<string, typeof experts>();
  for (const expert of experts) {
    const key = canonicalIdentity(expert.fullName);
    if (!key) continue;
    expertGroups.set(key, [...(expertGroups.get(key) ?? []), expert]);
  }

  for (const rows of expertGroups.values()) {
    if (rows.length < 2) continue;
    if (hasConflictingExpertIdentifiers(rows)) {
      ambiguousExpertGroups += 1;
      continue;
    }

    const ordered = [...rows].sort(
      (left, right) => trustRank(right.trustLevel) - trustRank(left.trustLevel)
        || left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const survivor = ordered[0];
    const duplicates = ordered.slice(1);
    const sourceOwner = ordered.find((row) => row.sourceDocumentId);
    const reviewOwner = ordered.find((row) => row.reviewedBy || row.reviewedAt);

    await prisma.$transaction(async (tx) => {
      await tx.expert.update({
        where: { id: survivor.id },
        data: {
          title: bestText(ordered.map((row) => row.title)),
          email: bestText(ordered.map((row) => row.email)),
          phone: bestText(ordered.map((row) => row.phone)),
          yearsExperience: Math.max(...ordered.map((row) => row.yearsExperience ?? 0)) || null,
          disciplines: jsonUnion(ordered.map((row) => row.disciplines)),
          sectors: jsonUnion(ordered.map((row) => row.sectors)),
          certifications: jsonUnion(ordered.map((row) => row.certifications)),
          profile: bestText(ordered.map((row) => row.profile)),
          trustLevel: ordered[0].trustLevel,
          reviewedBy: reviewOwner?.reviewedBy ?? null,
          reviewedAt: reviewOwner?.reviewedAt ?? null,
          reviewNotes: bestText(ordered.map((row) => row.reviewNotes)),
          sourceDocumentId: sourceOwner?.sourceDocumentId ?? null,
          isActive: true,
          deletedAt: null,
          deletedBy: null,
        },
      });

      for (const duplicate of duplicates) {
        const matches = await tx.tenderExpertMatch.findMany({ where: { expertId: duplicate.id } });
        for (const match of matches) {
          const existing = await tx.tenderExpertMatch.findUnique({
            where: { tenderId_expertId: { tenderId: match.tenderId, expertId: survivor.id } },
          });
          if (existing) {
            await tx.tenderExpertMatch.update({
              where: { id: existing.id },
              data: {
                score: Math.max(existing.score, match.score),
                isSelected: existing.isSelected || match.isSelected,
                rationale: bestText([existing.rationale, match.rationale]),
              },
            });
            await tx.tenderExpertMatch.delete({ where: { id: match.id } });
          } else {
            await tx.tenderExpertMatch.update({ where: { id: match.id }, data: { expertId: survivor.id } });
          }
        }
        await tx.expert.delete({ where: { id: duplicate.id } });
        mergedExperts += 1;
      }
    });
  }

  const projectGroups = new Map<string, typeof projects>();
  for (const project of projects) {
    const name = canonicalIdentity(project.name);
    if (!name) continue;
    const key = [name, canonicalIdentity(project.clientName), canonicalIdentity(project.country)].join("|");
    projectGroups.set(key, [...(projectGroups.get(key) ?? []), project]);
  }

  for (const rows of projectGroups.values()) {
    if (rows.length < 2) continue;
    const distinctNames = new Set(rows.map((row) => canonicalIdentity(row.name)));
    if (distinctNames.size !== 1) {
      ambiguousProjectGroups += 1;
      continue;
    }

    const ordered = [...rows].sort(
      (left, right) => trustRank(right.trustLevel) - trustRank(left.trustLevel)
        || left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const survivor = ordered[0];
    const duplicates = ordered.slice(1);
    const sourceOwner = ordered.find((row) => row.sourceDocumentId);
    const reviewOwner = ordered.find((row) => row.reviewedBy || row.reviewedAt);

    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: survivor.id },
        data: {
          clientName: bestText(ordered.map((row) => row.clientName)),
          country: bestText(ordered.map((row) => row.country)),
          sector: bestText(ordered.map((row) => row.sector)),
          serviceAreas: jsonUnion(ordered.map((row) => row.serviceAreas)),
          summary: bestText(ordered.map((row) => row.summary)),
          contractValue: ordered.find((row) => row.contractValue != null)?.contractValue ?? null,
          currency: ordered.find((row) => row.currency)?.currency ?? null,
          startDate: ordered.find((row) => row.startDate)?.startDate ?? null,
          endDate: ordered.find((row) => row.endDate)?.endDate ?? null,
          trustLevel: ordered[0].trustLevel,
          reviewedBy: reviewOwner?.reviewedBy ?? null,
          reviewedAt: reviewOwner?.reviewedAt ?? null,
          reviewNotes: bestText(ordered.map((row) => row.reviewNotes)),
          sourceDocumentId: sourceOwner?.sourceDocumentId ?? null,
          deletedAt: null,
          deletedBy: null,
        },
      });

      for (const duplicate of duplicates) {
        const matches = await tx.tenderProjectMatch.findMany({ where: { projectId: duplicate.id } });
        for (const match of matches) {
          const existing = await tx.tenderProjectMatch.findUnique({
            where: { tenderId_projectId: { tenderId: match.tenderId, projectId: survivor.id } },
          });
          if (existing) {
            await tx.tenderProjectMatch.update({
              where: { id: existing.id },
              data: {
                score: Math.max(existing.score, match.score),
                isSelected: existing.isSelected || match.isSelected,
                rationale: bestText([existing.rationale, match.rationale]),
              },
            });
            await tx.tenderProjectMatch.delete({ where: { id: match.id } });
          } else {
            await tx.tenderProjectMatch.update({ where: { id: match.id }, data: { projectId: survivor.id } });
          }
        }
        await tx.projectEvidence.updateMany({ where: { projectId: duplicate.id }, data: { projectId: survivor.id } });
        await tx.project.delete({ where: { id: duplicate.id } });
        mergedProjects += 1;
      }
    });
  }

  return { mergedExperts, mergedProjects, ambiguousExpertGroups, ambiguousProjectGroups };
}
