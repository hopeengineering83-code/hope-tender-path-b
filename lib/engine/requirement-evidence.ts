import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { computeSourceContentHash } from "./persisted-submission-plan";

const MEANINGFUL_QUOTE_MIN = 12;
const APPROVER_ROLES = new Set(["ADMIN", "PROPOSAL_MANAGER"]);

type AssetRef = {
  expertId?: string | null;
  projectId?: string | null;
  legalRecordId?: string | null;
  companyComplianceRecordId?: string | null;
  companyAssetId?: string | null;
  originalUploadId?: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function selectedAssetCount(ref: AssetRef): number {
  return [ref.expertId, ref.projectId, ref.legalRecordId, ref.companyComplianceRecordId, ref.companyAssetId, ref.originalUploadId].filter(Boolean).length;
}

async function assertAssetBelongsToCompany(client: any, companyId: string, ref: AssetRef): Promise<string> {
  if (selectedAssetCount(ref) !== 1) throw new Error("EVIDENCE_ASSET_REFERENCE_INVALID");
  if (ref.expertId) {
    const row = await client.expert.findFirst({ where: { id: ref.expertId, companyId, isActive: true, trustLevel: "REVIEWED" }, select: { id: true, updatedAt: true, fullName: true } });
    if (!row) throw new Error("EVIDENCE_ASSET_NOT_REVIEWED_OR_WRONG_COMPANY");
    return sha256(`expert:${row.id}:${row.fullName}:${row.updatedAt?.toISOString?.() ?? ""}`);
  }
  if (ref.projectId) {
    const row = await client.project.findFirst({ where: { id: ref.projectId, companyId, deletedAt: null, trustLevel: "REVIEWED" }, select: { id: true, updatedAt: true, name: true } });
    if (!row) throw new Error("EVIDENCE_ASSET_NOT_REVIEWED_OR_WRONG_COMPANY");
    return sha256(`project:${row.id}:${row.name}:${row.updatedAt?.toISOString?.() ?? ""}`);
  }
  if (ref.legalRecordId) {
    const row = await client.legalRecord.findFirst({ where: { id: ref.legalRecordId, companyId, status: "ACTIVE" }, select: { id: true, updatedAt: true, title: true } });
    if (!row) throw new Error("EVIDENCE_ASSET_NOT_ACTIVE_OR_WRONG_COMPANY");
    return sha256(`legal:${row.id}:${row.title}:${row.updatedAt?.toISOString?.() ?? ""}`);
  }
  if (ref.companyComplianceRecordId) {
    const row = await client.companyComplianceRecord.findFirst({ where: { id: ref.companyComplianceRecordId, companyId, status: "ACTIVE" }, select: { id: true, updatedAt: true, title: true } });
    if (!row) throw new Error("EVIDENCE_ASSET_NOT_ACTIVE_OR_WRONG_COMPANY");
    return sha256(`compliance:${row.id}:${row.title}:${row.updatedAt?.toISOString?.() ?? ""}`);
  }
  if (ref.companyAssetId || ref.originalUploadId) {
    const id = ref.companyAssetId ?? ref.originalUploadId;
    const row = await client.companyAsset.findFirst({ where: { id, companyId, isActive: true }, select: { id: true, updatedAt: true, fileName: true, fileContent: true, storagePath: true } });
    if (!row) throw new Error("EVIDENCE_ASSET_NOT_ACTIVE_OR_WRONG_COMPANY");
    return sha256(`asset:${row.id}:${row.fileName}:${row.storagePath ?? ""}:${sha256(row.fileContent ?? "")}:${row.updatedAt?.toISOString?.() ?? ""}`);
  }
  throw new Error("EVIDENCE_ASSET_REFERENCE_INVALID");
}

export async function createEvidenceDecision(input: {
  tenderId: string;
  tenderRequirementId: string;
  tenderFileId: string;
  reviewerId: string;
  pageNumber: number;
  exactQuote: string;
  asset: AssetRef;
}) {
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) throw new Error("EVIDENCE_PAGE_INVALID");
  if ((input.exactQuote ?? "").trim().length < MEANINGFUL_QUOTE_MIN) throw new Error("EVIDENCE_QUOTE_TOO_SHORT");
  return (prisma as any).$transaction(async (tx: any) => {
    const tender = await tx.tender.findUnique({ where: { id: input.tenderId }, select: { id: true, user: { select: { company: { select: { id: true } } } } } });
    const companyId = tender?.user?.company?.id;
    if (!companyId) throw new Error("TENDER_COMPANY_NOT_FOUND");
    const requirement = await tx.tenderRequirement.findFirst({ where: { id: input.tenderRequirementId, tenderId: input.tenderId }, select: { id: true } });
    if (!requirement) throw new Error("REQUIREMENT_NOT_FOUND");
    const tenderFile = await tx.tenderFile.findFirst({ where: { id: input.tenderFileId, tenderId: input.tenderId, deletionStatus: "ACTIVE" }, select: { id: true } });
    if (!tenderFile) throw new Error("TENDER_FILE_NOT_ACTIVE");
    const assetContentHash = await assertAssetBelongsToCompany(tx, companyId, input.asset);
    const sourceContentHash = await computeSourceContentHash(input.tenderId, tx as any);
    return tx.requirementEvidenceDecision.create({
      data: {
        tenderId: input.tenderId,
        tenderRequirementId: input.tenderRequirementId,
        tenderFileId: input.tenderFileId,
        reviewerId: input.reviewerId,
        pageNumber: input.pageNumber,
        exactQuote: input.exactQuote,
        sourceContentHash,
        assetContentHash,
        expertId: input.asset.expertId ?? null,
        projectId: input.asset.projectId ?? null,
        legalRecordId: input.asset.legalRecordId ?? null,
        companyComplianceRecordId: input.asset.companyComplianceRecordId ?? null,
        companyAssetId: input.asset.companyAssetId ?? null,
        originalUploadId: input.asset.originalUploadId ?? null,
        status: "RECOMMENDED",
      },
    });
  });
}

async function loadDecisionForTender(tx: any, tenderId: string, decisionId: string) {
  const decision = await tx.requirementEvidenceDecision.findFirst({
    where: { id: decisionId, tenderId },
    include: { tender: { select: { id: true, user: { select: { company: { select: { id: true } } } } } } },
  });
  if (!decision) throw new Error("EVIDENCE_DECISION_NOT_FOUND");
  return decision;
}

export async function approveEvidenceDecision(tenderId: string, decisionId: string, actor: { id: string; role: string }) {
  if (!APPROVER_ROLES.has(actor.role)) throw new Error("EVIDENCE_APPROVAL_FORBIDDEN");
  return (prisma as any).$transaction(async (tx: any) => {
    const decision = await loadDecisionForTender(tx, tenderId, decisionId);
    const currentSourceHash = await computeSourceContentHash(decision.tenderId, tx as any);
    if (currentSourceHash !== decision.sourceContentHash) {
      await tx.requirementEvidenceDecision.update({ where: { id: decisionId }, data: { status: "STALE", invalidatedAt: new Date(), invalidationReason: "SOURCE_HASH_CHANGED" } });
      throw new Error("EVIDENCE_STALE_REVIEW_REQUIRED");
    }
    const companyId = decision.tender.user.company.id;
    const assetContentHash = await assertAssetBelongsToCompany(tx, companyId, decision);
    if (assetContentHash !== decision.assetContentHash) {
      await tx.requirementEvidenceDecision.update({ where: { id: decisionId }, data: { status: "STALE", invalidatedAt: new Date(), invalidationReason: "ASSET_HASH_CHANGED" } });
      throw new Error("EVIDENCE_STALE_REVIEW_REQUIRED");
    }
    return tx.requirementEvidenceDecision.update({ where: { id: decisionId }, data: { status: "APPROVED", reviewerId: actor.id, approvedAt: new Date(), invalidatedAt: null, invalidationReason: null } });
  });
}

export async function rejectEvidenceDecision(tenderId: string, decisionId: string, actor: { id: string; role: string }) {
  if (!APPROVER_ROLES.has(actor.role)) throw new Error("EVIDENCE_REJECTION_FORBIDDEN");
  return (prisma as any).$transaction(async (tx: any) => {
    await loadDecisionForTender(tx, tenderId, decisionId);
    return tx.requirementEvidenceDecision.update({ where: { id: decisionId }, data: { status: "REJECTED", reviewerId: actor.id, rejectedAt: new Date() } });
  });
}

export async function invalidateEvidenceDecision(tenderId: string, decisionId: string, reason: string) {
  return (prisma as any).$transaction(async (tx: any) => {
    await loadDecisionForTender(tx, tenderId, decisionId);
    return tx.requirementEvidenceDecision.update({ where: { id: decisionId }, data: { status: "INVALIDATED", invalidatedAt: new Date(), invalidationReason: reason.slice(0, 240) } });
  });
}

export async function hasAllMandatoryEvidenceApproved(tenderId: string): Promise<{ ok: boolean; missingRequirementIds: string[] }> {
  const requirements = await (prisma as any).tenderRequirement.findMany({ where: { tenderId, priority: { in: ["MANDATORY", "CRITICAL"] } }, select: { id: true } });
  const sourceContentHash = await computeSourceContentHash(tenderId);
  const missing: string[] = [];
  for (const req of requirements) {
    const approved = await (prisma as any).requirementEvidenceDecision.findFirst({ where: { tenderId, tenderRequirementId: req.id, status: "APPROVED", invalidatedAt: null, sourceContentHash }, select: { id: true } });
    if (!approved) missing.push(req.id);
  }
  return { ok: missing.length === 0, missingRequirementIds: missing };
}