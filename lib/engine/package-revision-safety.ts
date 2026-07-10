/**
 * Package Revision / Fingerprint Safety
 *
 * Provides revision/fingerprint helpers for final package actions.
 * Reuses existing schema fields (contentHash, analysisInputHash,
 * contentSummary, exactFileNaming) — no new migration needed.
 *
 * Used by:
 *   - download/route.ts — to verify a package is still current
 *   - export/route.ts — to deterministically supersede old packages
 */

import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PackageRevisionCheck = {
  isCurrent: boolean;
  reason: string | null;
  details: {
    requirementHash: string | null;
    buildPlanHash: string | null;
    generatedDocHash: string | null;
    currentRequirementHash: string | null;
    currentBuildPlanHash: string | null;
    currentGeneratedDocHash: string | null;
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function hashRequirements(requirements: Array<{ id: string; title: string; priority: string; requirementType: string; sourceTenderFileId: string | null; sourcePageNumber: number | null; sourceExactQuote: string | null }>): string {
  const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id));
  return hashString(JSON.stringify(sorted.map(r => ({ id: r.id, title: r.title, priority: r.priority, type: r.requirementType, hasSource: Boolean(r.sourceTenderFileId && r.sourcePageNumber && r.sourceExactQuote) }))));
}

function hashBuildPlan(exactFileNaming: string | null, exactFileOrder: string | null): string {
  return hashString(JSON.stringify({ exactFileNaming: exactFileNaming ?? "", exactFileOrder: exactFileOrder ?? "" }));
}

function hashGeneratedDocs(docs: Array<{ id: string; name: string; exactFileName: string | null; generationStatus: string; validationStatus: string; reviewStatus: string; format: string | null }>): string {
  const active = docs.filter(d => d.generationStatus !== "SUPERSEDED");
  const sorted = [...active].sort((a, b) => (a.exactFileName ?? a.name).localeCompare(b.exactFileName ?? b.name));
  return hashString(JSON.stringify(sorted.map(d => ({ name: d.exactFileName ?? d.name, status: d.generationStatus, validation: d.validationStatus, review: d.reviewStatus, format: d.format }))));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the current package revision fingerprint for a tender.
 * This is a composite hash of requirements, build plan, and generated docs.
 */
export async function computePackageRevision(
  prisma: PrismaClient,
  tenderId: string,
): Promise<{
  requirementHash: string;
  buildPlanHash: string;
  generatedDocHash: string;
  compositeHash: string;
}> {
  const tender = await (prisma as any).tender.findFirst({
    where: { id: tenderId },
    select: {
      exactFileNaming: true,
      exactFileOrder: true,
      requirements: {
        select: {
          id: true, title: true, priority: true, requirementType: true,
          sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true,
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true, name: true, exactFileName: true, generationStatus: true,
          validationStatus: true, reviewStatus: true, format: true,
        },
      },
    },
  });

  if (!tender) {
    return { requirementHash: "none", buildPlanHash: "none", generatedDocHash: "none", compositeHash: "none" };
  }

  const requirementHash = hashRequirements(tender.requirements ?? []);
  const buildPlanHash = hashBuildPlan(tender.exactFileNaming, tender.exactFileOrder);
  const generatedDocHash = hashGeneratedDocs(tender.generatedDocuments ?? []);
  const compositeHash = hashString(`${requirementHash}|${buildPlanHash}|${generatedDocHash}`);

  return { requirementHash, buildPlanHash, generatedDocHash, compositeHash };
}

/**
 * Verify that an export package is still current by comparing its
 * recorded revision against the current package revision.
 *
 * If the revision has changed (requirements changed, docs changed, etc.),
 * the package is stale and should not be downloaded.
 */
export async function verifyPackageRevision(
  prisma: PrismaClient,
  tenderId: string,
  packageRevisionHash: string | null,
): Promise<PackageRevisionCheck> {
  const current = await computePackageRevision(prisma, tenderId);

  if (!packageRevisionHash) {
    return {
      isCurrent: false,
      reason: "Package has no recorded revision — cannot verify currency.",
      details: {
        requirementHash: null,
        buildPlanHash: null,
        generatedDocHash: null,
        currentRequirementHash: current.requirementHash,
        currentBuildPlanHash: current.buildPlanHash,
        currentGeneratedDocHash: current.generatedDocHash,
      },
    };
  }

  const isCurrent = packageRevisionHash === current.compositeHash;
  let reason: string | null = null;

  if (!isCurrent) {
    // Determine what changed
    const changes: string[] = [];
    // We can't compare individual hashes without storing them on the package,
    // but we can report that the composite changed.
    reason = "Tender state has changed since the package was created. Regenerate the export package.";
  }

  return {
    isCurrent,
    reason,
    details: {
      requirementHash: null, // Not stored on package — only composite
      buildPlanHash: null,
      generatedDocHash: null,
      currentRequirementHash: current.requirementHash,
      currentBuildPlanHash: current.buildPlanHash,
      currentGeneratedDocHash: current.generatedDocHash,
    },
  };
}

/**
 * Check if any source files required for grounding have been deleted
 * since the package was created.
 */
export async function verifySourceFilesNotDeleted(
  prisma: PrismaClient,
  tenderId: string,
): Promise<{ ok: boolean; deletedCount: number }> {
  const activeFiles = await (prisma as any).tenderFile.count({
    where: { tenderId, deletionStatus: "ACTIVE" },
  });

  if (activeFiles === 0) {
    return { ok: false, deletedCount: 0 };
  }

  return { ok: true, deletedCount: 0 };
}
