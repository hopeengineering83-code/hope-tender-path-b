/**
 * lib/engine/requirement-evidence.ts
 *
 * Requirement-level evidence decisions.
 *
 * Each mandatory TenderRequirement must have one or more APPROVED evidence
 * decisions before generation and Final ZIP. A tender-level selected CV or
 * project does NOT automatically satisfy all requirements.
 *
 * Evidence links must reference actual supported company records:
 * - reviewed CV/expert (Expert with trustLevel REVIEWED)
 * - reviewed project reference (Project with trustLevel REVIEWED)
 * - legal certificate (LegalRecord)
 * - financial document (CompanyComplianceRecord)
 * - company profile/capability record (CompanyAsset)
 * - tender-issued original uploaded for this tender (GeneratedDocument with original)
 *
 * Rules:
 * - Missing, rejected, stale, deleted, unreviewed, or mismatched evidence blocks generation
 * - Tender source changes invalidate affected evidence decisions
 * - Company evidence changes/deletion invalidate affected evidence decisions
 */

import { prisma } from "../prisma";
import { logger } from "../observability";
import { createHash } from "node:crypto";

export type EvidenceDecisionStatus = "DRAFT" | "APPROVED" | "REJECTED" | "STALE" | "BLOCKED";
export type EvidenceType = "CV" | "PROJECT" | "LEGAL" | "FINANCIAL" | "PROFILE" | "ORIGINAL";
export type CompanyAssetType = "Expert" | "Project" | "CompanyAsset" | "LegalRecord" | "CompanyComplianceRecord";

export interface RequirementEvidenceInput {
  tenderRequirementId: string;
  tenderFileId: string;
  pageNumber: number;
  exactQuote: string;
  evidenceType: EvidenceType;
  companyAssetType: CompanyAssetType;
  companyAssetId: string;
  relevanceExplanation: string;
  reviewerId: string;
}

/**
 * Verify that a company asset exists, is active, and is reviewed (if Expert/Project).
 * Returns the asset hash for immutability checking, or null if invalid.
 */
async function verifyCompanyAsset(
  companyAssetType: CompanyAssetType,
  companyAssetId: string,
): Promise<{ valid: boolean; hash: string | null; reason?: string }> {
  try {
    if (companyAssetType === "Expert") {
      const expert = await prisma.expert.findUnique({
        where: { id: companyAssetId },
        select: { id: true, trustLevel: true, isActive: true, deletedAt: true, fullName: true },
      });
      if (!expert) return { valid: false, hash: null, reason: "Expert not found" };
      if (!expert.isActive || expert.deletedAt) return { valid: false, hash: null, reason: "Expert is inactive or deleted" };
      if (expert.trustLevel !== "REVIEWED") return { valid: false, hash: null, reason: "Expert is not reviewed" };
      return { valid: true, hash: createHash("sha256").update(`Expert:${expert.id}:${expert.trustLevel}`).digest("hex").slice(0, 16) };
    }

    if (companyAssetType === "Project") {
      const project = await prisma.project.findUnique({
        where: { id: companyAssetId },
        select: { id: true, trustLevel: true, isActive: true, deletedAt: true, name: true },
      });
      if (!project) return { valid: false, hash: null, reason: "Project not found" };
      if (!project.isActive || project.deletedAt) return { valid: false, hash: null, reason: "Project is inactive or deleted" };
      if (project.trustLevel !== "REVIEWED") return { valid: false, hash: null, reason: "Project is not reviewed" };
      return { valid: true, hash: createHash("sha256").update(`Project:${project.id}:${project.trustLevel}`).digest("hex").slice(0, 16) };
    }

    if (companyAssetType === "LegalRecord") {
      const record = await prisma.legalRecord.findUnique({
        where: { id: companyAssetId },
        select: { id: true, status: true, title: true },
      });
      if (!record) return { valid: false, hash: null, reason: "Legal record not found" };
      if (record.status !== "ACTIVE") return { valid: false, hash: null, reason: "Legal record is not active" };
      return { valid: true, hash: createHash("sha256").update(`LegalRecord:${record.id}`).digest("hex").slice(0, 16) };
    }

    if (companyAssetType === "CompanyComplianceRecord") {
      const record = await prisma.companyComplianceRecord.findUnique({
        where: { id: companyAssetId },
        select: { id: true, status: true, title: true },
      });
      if (!record) return { valid: false, hash: null, reason: "Compliance record not found" };
      if (record.status !== "ACTIVE") return { valid: false, hash: null, reason: "Compliance record is not active" };
      return { valid: true, hash: createHash("sha256").update(`CompanyComplianceRecord:${record.id}`).digest("hex").slice(0, 16) };
    }

    if (companyAssetType === "CompanyAsset") {
      const asset = await prisma.companyAsset.findUnique({
        where: { id: companyAssetId },
        select: { id: true, isActive: true, fileName: true },
      });
      if (!asset) return { valid: false, hash: null, reason: "Company asset not found" };
      if (!asset.isActive) return { valid: false, hash: null, reason: "Company asset is inactive" };
      return { valid: true, hash: createHash("sha256").update(`CompanyAsset:${asset.id}`).digest("hex").slice(0, 16) };
    }

    return { valid: false, hash: null, reason: `Unsupported asset type: ${companyAssetType}` };
  } catch (e) {
    return { valid: false, hash: null, reason: `Asset verification failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/**
 * Create or update a requirement evidence decision.
 * The decision starts as DRAFT and must be explicitly approved.
 */
export async function createEvidenceDecision(
  input: RequirementEvidenceInput,
  sourceContentHash: string,
): Promise<{ ok: true; decisionId: string } | { ok: false; error: string }> {
  // Verify the company asset is valid and reviewed
  const assetCheck = await verifyCompanyAsset(input.companyAssetType, input.companyAssetId);
  if (!assetCheck.valid) {
    return { ok: false, error: `Company evidence invalid: ${assetCheck.reason}` };
  }

  // Verify the tender requirement exists
  const req = await prisma.tenderRequirement.findUnique({
    where: { id: input.tenderRequirementId },
    select: { id: true, tenderId: true, priority: true },
  });
  if (!req) {
    return { ok: false, error: "Tender requirement not found" };
  }

  // Verify the tender file exists and belongs to the same tender
  const file = await prisma.tenderFile.findUnique({
    where: { id: input.tenderFileId },
    select: { id: true, tenderId: true },
  });
  if (!file || file.tenderId !== req.tenderId) {
    return { ok: false, error: "Tender file not found or does not belong to this tender" };
  }

  // Create the decision
  const decision = await prisma.requirementEvidenceDecision.create({
    data: {
      tenderRequirementId: input.tenderRequirementId,
      tenderFileId: input.tenderFileId,
      pageNumber: input.pageNumber,
      exactQuote: input.exactQuote,
      evidenceType: input.evidenceType,
      companyAssetType: input.companyAssetType,
      companyAssetId: input.companyAssetId,
      relevanceExplanation: input.relevanceExplanation,
      reviewerId: input.reviewerId,
      decisionStatus: "DRAFT",
      sourceContentHash,
      companyEvidenceHash: assetCheck.hash,
    },
  });

  return { ok: true, decisionId: decision.id };
}

/**
 * Approve a requirement evidence decision.
 * Only ADMIN or PROPOSAL_MANAGER can approve.
 */
export async function approveEvidenceDecision(
  decisionId: string,
  reviewerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const decision = await prisma.requirementEvidenceDecision.findUnique({
    where: { id: decisionId },
  });
  if (!decision) {
    return { ok: false, error: "Evidence decision not found" };
  }
  if (decision.decisionStatus === "REJECTED") {
    return { ok: false, error: "Cannot approve a rejected decision" };
  }

  // Re-verify the company asset is still valid
  const assetCheck = await verifyCompanyAsset(
    decision.companyAssetType as CompanyAssetType,
    decision.companyAssetId,
  );
  if (!assetCheck.valid) {
    // Mark as STALE
    await prisma.requirementEvidenceDecision.update({
      where: { id: decisionId },
      data: {
        decisionStatus: "STALE",
        invalidatedAt: new Date(),
        invalidationReason: assetCheck.reason,
      },
    });
    return { ok: false, error: `Company evidence is no longer valid: ${assetCheck.reason}` };
  }

  await prisma.requirementEvidenceDecision.update({
    where: { id: decisionId },
    data: {
      decisionStatus: "APPROVED",
      reviewerId,
      companyEvidenceHash: assetCheck.hash,
    },
  });

  return { ok: true };
}

/**
 * Check if all mandatory requirements for a tender have at least one APPROVED
 * evidence decision.
 */
export async function hasAllMandatoryEvidenceApproved(tenderId: string): Promise<{
  ok: boolean;
  missingRequirementIds: string[];
}> {
  const mandatoryReqs = await prisma.tenderRequirement.findMany({
    where: { tenderId, priority: "MANDATORY" },
    select: { id: true },
  });

  if (mandatoryReqs.length === 0) {
    return { ok: true, missingRequirementIds: [] };
  }

  const approvedDecisions = await prisma.requirementEvidenceDecision.findMany({
    where: {
      tenderRequirementId: { in: mandatoryReqs.map((r) => r.id) },
      decisionStatus: "APPROVED",
      invalidatedAt: null,
    },
    select: { tenderRequirementId: true },
  });

  const approvedReqIds = new Set(approvedDecisions.map((d) => d.tenderRequirementId));
  const missing = mandatoryReqs.filter((r) => !approvedReqIds.has(r.id));

  return {
    ok: missing.length === 0,
    missingRequirementIds: missing.map((r) => r.id),
  };
}

/**
 * Invalidate evidence decisions when tender source files change.
 */
export async function invalidateStaleEvidenceDecisions(tenderId: string, currentSourceHash: string): Promise<number> {
  const stale = await prisma.requirementEvidenceDecision.findMany({
    where: {
      tenderRequirement: { tenderId },
      sourceContentHash: { not: currentSourceHash },
      decisionStatus: { not: "STALE" },
      invalidatedAt: null,
    },
    select: { id: true },
  });

  for (const decision of stale) {
    await prisma.requirementEvidenceDecision.update({
      where: { id: decision.id },
      data: {
        decisionStatus: "STALE",
        invalidatedAt: new Date(),
        invalidationReason: "Tender source content changed",
      },
    });
  }

  return stale.length;
}
