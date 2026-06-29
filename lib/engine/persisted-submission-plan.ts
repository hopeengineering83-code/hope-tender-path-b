/**
 * lib/engine/persisted-submission-plan.ts
 *
 * Persisted, versioned submission plan service.
 *
 * This replaces the virtual Build Plan as the authoritative generation
 * authorization source. A virtual preview may remain for the UI, but only
 * a CONFIRMED persisted plan can authorize generation.
 *
 * Key rules:
 * - Build Plan creates a DRAFT revision with persisted items (zero GeneratedDocument rows)
 * - Confirmation requires ADMIN/PROPOSAL_MANAGER + current hashes + all mandatory requirements mapped
 * - Confirmed plans are immutable — any edit creates a new DRAFT revision
 * - Source/requirement changes invalidate the active plan
 */

import { prisma } from "../prisma";
import { logger } from "../observability";
import { createHash } from "node:crypto";

export type PlanRevisionStatus = "DRAFT" | "REVIEW_REQUIRED" | "CONFIRMED" | "SUPERSEDED";
export type PlanItemEnvelope = "TECHNICAL" | "FINANCIAL" | "ADMIN";

export interface PlannedFile {
  exactFileName: string;
  exactOrder: number;
  documentType: string;
  format: string;
  envelope: PlanItemEnvelope;
  sourceRequirementIds: string[];
  sourceFileCitations: Array<{ fileId: string; page: number; quote: string }>;
  requiresOriginalUpload: boolean;
}

export interface BuildPlanResult {
  planId: string;
  revision: number;
  status: PlanRevisionStatus;
  sourceContentHash: string;
  requirementsHash: string;
  itemCount: number;
  confirmationRequired: boolean;
  virtualOnly: boolean;
}

/**
 * Compute a hash of the tender source content (file IDs + extracted text lengths).
 * Used to detect when source files change and invalidate the plan.
 */
export async function computeSourceContentHash(tenderId: string): Promise<string> {
  const files = await prisma.tenderFile.findMany({
    where: { tenderId },
    select: { id: true, fileName: true, extractedText: true, extractionScore: true },
    orderBy: { id: "asc" },
  });
  const data = files.map((f) => `${f.id}:${f.fileName}:${(f.extractedText ?? "").length}:${f.extractionScore}`).join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Compute a hash of the tender requirements (IDs + titles + source refs).
 * Used to detect when requirements change and invalidate the plan.
 */
export async function computeRequirementsHash(tenderId: string): Promise<string> {
  const reqs = await prisma.tenderRequirement.findMany({
    where: { tenderId },
    select: { id: true, title: true, priority: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true },
    orderBy: { id: "asc" },
  });
  const data = reqs.map((r) => `${r.id}:${r.title}:${r.priority}:${r.sourceTenderFileId}:${r.sourcePageNumber}:${r.sourceExactQuote}`).join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/**
 * Build or rebuild the persisted submission plan for a tender.
 * Creates a new DRAFT revision and supersedes any existing active DRAFT.
 * Does NOT create any GeneratedDocument rows.
 * Does NOT automatically confirm the plan.
 */
export async function buildPersistedSubmissionPlan(
  tenderId: string,
  createdById: string,
  plannedFiles: PlannedFile[],
): Promise<BuildPlanResult> {
  const sourceContentHash = await computeSourceContentHash(tenderId);
  const requirementsHash = await computeRequirementsHash(tenderId);

  // Supersede any existing active DRAFT or REVIEW_REQUIRED plan
  const existingActive = await prisma.submissionPlanRevision.findFirst({
    where: { tenderId, status: { in: ["DRAFT", "REVIEW_REQUIRED"] } },
    select: { id: true, revision: true },
  });

  let nextRevision = 1;
  if (existingActive) {
    await prisma.submissionPlanRevision.update({
      where: { id: existingActive.id },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });
    nextRevision = existingActive.revision + 1;
  }

  // Also check if there's a CONFIRMED plan — we can still create a new DRAFT
  // (the CONFIRMED plan remains valid until explicitly invalidated)
  const existingConfirmed = await prisma.submissionPlanRevision.findFirst({
    where: { tenderId, status: "CONFIRMED" },
    select: { revision: true },
  });
  if (existingConfirmed && existingConfirmed.revision >= nextRevision) {
    nextRevision = existingConfirmed.revision + 1;
  }

  // Create the new DRAFT revision
  const revision = await prisma.submissionPlanRevision.create({
    data: {
      tenderId,
      revision: nextRevision,
      status: "DRAFT",
      sourceContentHash,
      requirementsHash,
      createdById,
    },
  });

  // Create persisted plan items (zero GeneratedDocument rows)
  for (const file of plannedFiles) {
    await prisma.submissionPlanItem.create({
      data: {
        submissionPlanId: revision.id,
        exactFileName: file.exactFileName,
        exactOrder: file.exactOrder,
        documentType: file.documentType,
        format: file.format,
        envelope: file.envelope,
        status: "PLANNED",
        sourceRequirementIds: JSON.stringify(file.sourceRequirementIds),
        sourceFileCitations: JSON.stringify(file.sourceFileCitations),
        requiresOriginalUpload: file.requiresOriginalUpload,
      },
    });
  }

  logger.info("[persisted-submission-plan] Built DRAFT plan", {
    tenderId, planId: revision.id, revision: nextRevision, itemCount: plannedFiles.length,
  });

  return {
    planId: revision.id,
    revision: nextRevision,
    status: "DRAFT",
    sourceContentHash,
    requirementsHash,
    itemCount: plannedFiles.length,
    confirmationRequired: true,
    virtualOnly: true, // UI compatibility — no GeneratedDocument rows created
  };
}

/**
 * Confirm a submission plan revision.
 * Only ADMIN or PROPOSAL_MANAGER can confirm.
 * Confirmation requires current sourceContentHash and requirementsHash.
 * Confirmation fails closed when hashes are stale.
 */
export async function confirmSubmissionPlan(
  tenderId: string,
  confirmedById: string,
  expectedSourceContentHash: string,
  expectedRequirementsHash: string,
): Promise<{ ok: true; planId: string; revision: number } | { ok: false; error: string }> {
  const currentSourceHash = await computeSourceContentHash(tenderId);
  const currentRequirementsHash = await computeRequirementsHash(tenderId);

  if (currentSourceHash !== expectedSourceContentHash) {
    return { ok: false, error: "Source content hash mismatch — tender files have changed. Rebuild the plan." };
  }
  if (currentRequirementsHash !== expectedRequirementsHash) {
    return { ok: false, error: "Requirements hash mismatch — requirements have changed. Rebuild the plan." };
  }

  // Find the active DRAFT or REVIEW_REQUIRED plan
  const draftPlan = await prisma.submissionPlanRevision.findFirst({
    where: { tenderId, status: { in: ["DRAFT", "REVIEW_REQUIRED"] } },
    include: { items: true },
    orderBy: { revision: "desc" },
  });

  if (!draftPlan) {
    return { ok: false, error: "No active draft plan found. Build the plan first." };
  }

  // Validate: all mandatory requirements must have a plan mapping
  const mandatoryReqs = await prisma.tenderRequirement.findMany({
    where: { tenderId, priority: "MANDATORY" },
    select: { id: true },
  });
  const mappedReqIds = new Set<string>();
  for (const item of draftPlan.items) {
    try {
      const ids = JSON.parse(item.sourceRequirementIds) as string[];
      ids.forEach((id) => mappedReqIds.add(id));
    } catch { /* ignore parse errors */ }
  }
  const unmapped = mandatoryReqs.filter((r) => !mappedReqIds.has(r.id));
  if (unmapped.length > 0) {
    return { ok: false, error: `${unmapped.length} mandatory requirement(s) have no plan mapping.` };
  }

  // Validate: each plan item must have exactFileName, exactOrder, documentType, envelope
  for (const item of draftPlan.items) {
    if (!item.exactFileName || !item.exactOrder || !item.documentType || !item.envelope) {
      return { ok: false, error: `Plan item "${item.exactFileName}" is missing required fields.` };
    }
  }

  // Validate: no duplicate filenames or orders
  const fileNames = draftPlan.items.map((i) => i.exactFileName.toLowerCase());
  const orders = draftPlan.items.map((i) => i.exactOrder);
  if (new Set(fileNames).size !== fileNames.length) {
    return { ok: false, error: "Duplicate exact filenames in plan." };
  }
  if (new Set(orders).size !== orders.length) {
    return { ok: false, error: "Duplicate exact orders in plan." };
  }

  // Validate: envelope values must be valid
  for (const item of draftPlan.items) {
    if (!["TECHNICAL", "FINANCIAL", "ADMIN"].includes(item.envelope)) {
      return { ok: false, error: `Invalid envelope "${item.envelope}" for item "${item.exactFileName}".` };
    }
  }

  // Supersede any existing CONFIRMED plan
  const existingConfirmed = await prisma.submissionPlanRevision.findFirst({
    where: { tenderId, status: "CONFIRMED" },
  });
  if (existingConfirmed) {
    await prisma.submissionPlanRevision.update({
      where: { id: existingConfirmed.id },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });
  }

  // Confirm the plan
  const confirmationHash = createHash("sha256")
    .update(`${draftPlan.id}:${currentSourceHash}:${currentRequirementsHash}:${confirmedById}`)
    .digest("hex").slice(0, 16);

  await prisma.submissionPlanRevision.update({
    where: { id: draftPlan.id },
    data: {
      status: "CONFIRMED",
      confirmedById,
      confirmedAt: new Date(),
      confirmationHash,
    },
  });

  logger.info("[persisted-submission-plan] Confirmed plan", {
    tenderId, planId: draftPlan.id, revision: draftPlan.revision,
  });

  return { ok: true, planId: draftPlan.id, revision: draftPlan.revision };
}

/**
 * Get the active CONFIRMED plan for a tender, if one exists and is current.
 * Returns null if no confirmed plan exists or if hashes are stale.
 */
export async function getActiveConfirmedPlan(tenderId: string) {
  const confirmed = await prisma.submissionPlanRevision.findFirst({
    where: { tenderId, status: "CONFIRMED" },
    include: { items: true },
    orderBy: { revision: "desc" },
  });
  if (!confirmed) return null;

  // Check if hashes are still current
  const currentSourceHash = await computeSourceContentHash(tenderId);
  const currentRequirementsHash = await computeRequirementsHash(tenderId);

  if (confirmed.sourceContentHash !== currentSourceHash || confirmed.requirementsHash !== currentRequirementsHash) {
    // Stale — invalidate
    await prisma.submissionPlanRevision.update({
      where: { id: confirmed.id },
      data: {
        status: "SUPERSEDED",
        invalidatedAt: new Date(),
        invalidationReason: "Source content or requirements changed",
      },
    });
    return null;
  }

  return confirmed;
}

/**
 * Check if a tender has a current CONFIRMED persisted plan.
 * This is the authoritative generation authorization check.
 */
export async function hasConfirmedPersistedPlan(tenderId: string): Promise<boolean> {
  const plan = await getActiveConfirmedPlan(tenderId);
  return plan !== null;
}
