import { prisma } from "./prisma";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "./company-document-durable-deletion";
import {
  assessReviewEvidence,
  buildPartialSourceVerificationProvenance,
  complianceReviewFields,
  expertReviewFields,
  financialReviewFields,
  legalReviewFields,
  matchReviewEvidenceField,
  projectReviewFields,
  publicVaultIdentifier,
  type ReviewEvidenceField,
  type ReviewRecordType,
  type ReviewSourceDocument,
} from "./vault-review-provenance";

export type VaultSourceRemapResult = {
  expertsLinked: number;
  projectsLinked: number;
  legalRecordsLinked: number;
  financialRecordsLinked: number;
  complianceRecordsLinked: number;
  blockers: Array<{ recordType: ReviewRecordType; recordId: string; reason: "NO_SOURCE_MATCH" | "AMBIGUOUS_SOURCE_MATCH" }>;
};

// Draft/regex-imported records that predate a sourceDocument binding (for
// example the Plan-B legacy-data import, which persists uploaded company
// documents but does not always declare which one produced each record) are
// eligible for remap. SOURCE_VERIFIED records are also reconciled so deleted,
// replaced, or re-extracted bytes cannot retain stale authority. Authenticated
// human REVIEWED records remain outside machine reconciliation.
const REMAP_ELIGIBLE_TRUST_LEVELS = ["REGEX_DRAFT", "AI_DRAFT"];
const RECONCILE_ELIGIBLE_TRUST_LEVELS = [...REMAP_ELIGIBLE_TRUST_LEVELS, "SOURCE_VERIFIED"];
// Legal/Financial/Compliance records may also originate as MANUAL_DRAFT. A
// manual draft is not authoritative, but when its exact identity/fields are
// later proven by an owned byte-verified document it should reconcile through
// the same zero-bureaucracy path rather than requiring a human promotion click.
const RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS = [...RECONCILE_ELIGIBLE_TRUST_LEVELS, "MANUAL_DRAFT"];

async function loadCandidateDocuments(companyId: string): Promise<ReviewSourceDocument[]> {
  return prisma.companyDocument.findMany({
    where: {
      companyId,
      integrityStatus: "VERIFIED",
      NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
    },
    select: {
      id: true,
      fileName: true,
      originalFileName: true,
      category: true,
      companyId: true,
      extractedText: true,
      contentSha256: true,
      contentByteLength: true,
      integrityStatus: true,
      metadata: true,
    },
  });
}

function identityField(recordType: ReviewRecordType): string {
  return recordType === "EXPERT" ? "fullName" : recordType === "PROJECT" ? "name" : recordType === "FINANCIAL" ? "fiscalYear" : "title";
}

function dedicatedAuthority(document: ReviewSourceDocument, recordType: ReviewRecordType): number {
  if (recordType === "EXPERT" && document.category === "EXPERT_CV") return 1;
  if (recordType === "PROJECT" && ["PROJECT_REFERENCE", "PROJECT_CONTRACT", "PORTFOLIO"].includes(document.category ?? "")) return 1;
  return 0;
}

function extractionRevision(document: ReviewSourceDocument): number {
  try {
    const revision = Number(JSON.parse(document.metadata ?? "{}").extractionRevision);
    return Number.isInteger(revision) && revision > 0 ? revision : 1;
  } catch {
    return 1;
  }
}

// Rank evidence authority per record. Database order and document id are never
// tie-breakers: indistinguishable authority remains fail-closed. An existing
// sourceDocumentId is only a stability preference AFTER evidence quality and
// dedicated-source authority have been compared; otherwise a weak profile
// chosen by an earlier importer could permanently pin a record away from a
// richer dedicated CV/project source that proves more of the current record.
function findMatchingDocument(
  documents: ReviewSourceDocument[],
  fields: ReviewEvidenceField[],
  recordType: ReviewRecordType,
  currentSourceDocumentId?: string | null,
): { document: ReviewSourceDocument | null; reason: "NO_SOURCE_MATCH" | "AMBIGUOUS_SOURCE_MATCH" | null } {
  const candidates = documents.flatMap((document) => {
    const full = assessReviewEvidence(document, fields, recordType);
    const partial = buildPartialSourceVerificationProvenance({
      recordType,
      sourceDocument: document,
      fields,
      verificationMethod: "HYBRID",
      verifiedAt: new Date(0),
    });
    if (!partial.ok) return [];
    const identity = fields.find((field) => field.field === identityField(recordType));
    const identityMatch = identity && document.extractedText
      ? matchReviewEvidenceField(document.extractedText, identity.field, String(identity.value ?? ""), recordType)
      : null;
    return [{
      document,
      rank: [
        full.ok ? 1 : 0,
        partial.verifiedFields.length,
        identityMatch?.matchMode === "STRICT_ORDERED" ? 1 : 0,
        dedicatedAuthority(document, recordType),
        document.id === currentSourceDocumentId ? 1 : 0,
        extractionRevision(document),
      ],
    }];
  });
  candidates.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i += 1) {
      const delta = b.rank[i] - a.rank[i];
      if (delta !== 0) return delta;
    }
    return 0;
  });
  if (candidates.length === 0) return { document: null, reason: "NO_SOURCE_MATCH" };
  const best = candidates[0];
  const tied = candidates[1]?.rank.every((value, index) => value === best.rank[index]);
  return tied
    ? { document: null, reason: "AMBIGUOUS_SOURCE_MATCH" }
    : { document: best.document, reason: null };
}

async function auditLink(userId: string, action: string, entityType: string, entityId: string, sourceDocumentId: string) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      description: `${entityType} record's owned source document was located and linked by matching its exact field values against uploaded company documents.`,
      metadata: JSON.stringify({ recordRef: publicVaultIdentifier(entityId), sourceDocumentId }),
    },
  });
}

function staleMachineVerificationReset() {
  return {
    trustLevel: "AI_DRAFT",
    sourceDocumentId: null,
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
  } as const;
}

async function remapExperts(companyId: string, userId: string, documents: ReviewSourceDocument[], blockers: VaultSourceRemapResult["blockers"]): Promise<number> {
  const experts = await prisma.expert.findMany({
    where: { companyId, deletedAt: null, trustLevel: { in: RECONCILE_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, sourceDocumentId: true, trustLevel: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true },
  });
  let linked = 0;
  for (const expert of experts) {
    const match = findMatchingDocument(documents, expertReviewFields(expert), "EXPERT", expert.sourceDocumentId);
    if (!match.document) {
      blockers.push({ recordType: "EXPERT", recordId: expert.id, reason: match.reason! });
      if (expert.trustLevel === "SOURCE_VERIFIED") await prisma.expert.updateMany({
        where: { id: expert.id, companyId, trustLevel: "SOURCE_VERIFIED" },
        data: staleMachineVerificationReset(),
      });
      continue;
    }
    if (expert.sourceDocumentId === match.document.id) continue;
    const updated = await prisma.expert.updateMany({
      where: { id: expert.id, companyId, sourceDocumentId: expert.sourceDocumentId },
      data: { sourceDocumentId: match.document.id, ...(expert.trustLevel === "SOURCE_VERIFIED" ? { trustLevel: "AI_DRAFT", reviewNotes: null, reviewedBy: null, reviewedAt: null } : {}) },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "EXPERT_SOURCE_REMAPPED", "Expert", expert.id, match.document.id);
  }
  return linked;
}

async function remapProjects(companyId: string, userId: string, documents: ReviewSourceDocument[], blockers: VaultSourceRemapResult["blockers"]): Promise<number> {
  const projects = await prisma.project.findMany({
    where: { companyId, deletedAt: null, trustLevel: { in: RECONCILE_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, sourceDocumentId: true, trustLevel: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, contractValue: true, currency: true },
  });
  let linked = 0;
  for (const project of projects) {
    const match = findMatchingDocument(documents, projectReviewFields(project), "PROJECT", project.sourceDocumentId);
    if (!match.document) {
      blockers.push({ recordType: "PROJECT", recordId: project.id, reason: match.reason! });
      if (project.trustLevel === "SOURCE_VERIFIED") await prisma.project.updateMany({
        where: { id: project.id, companyId, trustLevel: "SOURCE_VERIFIED" },
        data: staleMachineVerificationReset(),
      });
      continue;
    }
    if (project.sourceDocumentId === match.document.id) continue;
    const updated = await prisma.project.updateMany({
      where: { id: project.id, companyId, sourceDocumentId: project.sourceDocumentId },
      data: { sourceDocumentId: match.document.id, ...(project.trustLevel === "SOURCE_VERIFIED" ? { trustLevel: "AI_DRAFT", reviewNotes: null, reviewedBy: null, reviewedAt: null } : {}) },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "PROJECT_SOURCE_REMAPPED", "Project", project.id, match.document.id);
  }
  return linked;
}

async function remapLegalRecords(companyId: string, userId: string, documents: ReviewSourceDocument[], blockers: VaultSourceRemapResult["blockers"]): Promise<number> {
  const records = await prisma.legalRecord.findMany({
    where: { companyId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
    select: { id: true, sourceDocumentId: true, trustLevel: true, recordType: true, title: true, authority: true, referenceNumber: true, issueDate: true, expiryDate: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, legalReviewFields(record), "LEGAL", record.sourceDocumentId);
    if (!match.document) {
      blockers.push({ recordType: "LEGAL", recordId: record.id, reason: match.reason! });
      if (record.trustLevel === "SOURCE_VERIFIED") await prisma.legalRecord.updateMany({
        where: { id: record.id, companyId, trustLevel: "SOURCE_VERIFIED" },
        data: staleMachineVerificationReset(),
      });
      continue;
    }
    if (record.sourceDocumentId === match.document.id) continue;
    const updated = await prisma.legalRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: record.sourceDocumentId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
      data: { sourceDocumentId: match.document.id, ...(record.trustLevel === "SOURCE_VERIFIED" ? { trustLevel: "AI_DRAFT", reviewNotes: null, reviewedBy: null, reviewedAt: null } : {}) },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "LEGAL_RECORD_SOURCE_REMAPPED", "LegalRecord", record.id, match.document.id);
  }
  return linked;
}

async function remapFinancialRecords(companyId: string, userId: string, documents: ReviewSourceDocument[], blockers: VaultSourceRemapResult["blockers"]): Promise<number> {
  const records = await prisma.financialRecord.findMany({
    where: { companyId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
    select: { id: true, sourceDocumentId: true, trustLevel: true, fiscalYear: true, recordType: true, currency: true, amount: true, notes: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, financialReviewFields(record), "FINANCIAL", record.sourceDocumentId);
    if (!match.document) {
      blockers.push({ recordType: "FINANCIAL", recordId: record.id, reason: match.reason! });
      if (record.trustLevel === "SOURCE_VERIFIED") await prisma.financialRecord.updateMany({
        where: { id: record.id, companyId, trustLevel: "SOURCE_VERIFIED" },
        data: staleMachineVerificationReset(),
      });
      continue;
    }
    if (record.sourceDocumentId === match.document.id) continue;
    const updated = await prisma.financialRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: record.sourceDocumentId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
      data: { sourceDocumentId: match.document.id, ...(record.trustLevel === "SOURCE_VERIFIED" ? { trustLevel: "AI_DRAFT", reviewNotes: null, reviewedBy: null, reviewedAt: null } : {}) },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "FINANCIAL_RECORD_SOURCE_REMAPPED", "FinancialRecord", record.id, match.document.id);
  }
  return linked;
}

async function remapComplianceRecords(companyId: string, userId: string, documents: ReviewSourceDocument[], blockers: VaultSourceRemapResult["blockers"]): Promise<number> {
  const records = await prisma.companyComplianceRecord.findMany({
    where: { companyId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
    select: { id: true, sourceDocumentId: true, trustLevel: true, complianceType: true, title: true, status: true, evidenceSummary: true, referenceNumber: true, expiryDate: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, complianceReviewFields(record), "COMPLIANCE", record.sourceDocumentId);
    if (!match.document) {
      blockers.push({ recordType: "COMPLIANCE", recordId: record.id, reason: match.reason! });
      if (record.trustLevel === "SOURCE_VERIFIED") await prisma.companyComplianceRecord.updateMany({
        where: { id: record.id, companyId, trustLevel: "SOURCE_VERIFIED" },
        data: staleMachineVerificationReset(),
      });
      continue;
    }
    if (record.sourceDocumentId === match.document.id) continue;
    const updated = await prisma.companyComplianceRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: record.sourceDocumentId, trustLevel: { in: RECONCILE_ELIGIBLE_SUPPORT_TRUST_LEVELS } },
      data: { sourceDocumentId: match.document.id, ...(record.trustLevel === "SOURCE_VERIFIED" ? { trustLevel: "AI_DRAFT", reviewNotes: null, reviewedBy: null, reviewedAt: null } : {}) },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "COMPLIANCE_RECORD_SOURCE_REMAPPED", "CompanyComplianceRecord", record.id, match.document.id);
  }
  return linked;
}

// Reconciles Expert/Project/Legal/Financial/Compliance machine-managed records
// against the company's OWN already-uploaded, byte-verified documents. This
// covers both records that never had a sourceDocumentId and previously
// SOURCE_VERIFIED records whose source was deleted, replaced, re-extracted, or
// no longer proves the current record identity/fields. Authenticated human
// REVIEWED records remain outside machine reconciliation.
//
// This never fabricates evidence: a record with no matching document is left
// non-authoritative. A stale SOURCE_VERIFIED record is explicitly demoted and
// unlinked so UI/readiness cannot keep presenting stale machine authority. A
// later pass can automatically restore SOURCE_VERIFIED if current owned bytes
// prove the record again.
export async function remapUnlinkedVaultSources(companyId: string): Promise<VaultSourceRemapResult> {
  const empty: VaultSourceRemapResult = { expertsLinked: 0, projectsLinked: 0, legalRecordsLinked: 0, financialRecordsLinked: 0, complianceRecordsLinked: 0, blockers: [] };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { userId: true } });
  if (!company) return empty;

  const documents = await loadCandidateDocuments(companyId);
  const userId = company.userId;

  const blockers: VaultSourceRemapResult["blockers"] = [];
  const [expertsLinked, projectsLinked, legalRecordsLinked, financialRecordsLinked, complianceRecordsLinked] = await Promise.all([
    remapExperts(companyId, userId, documents, blockers),
    remapProjects(companyId, userId, documents, blockers),
    remapLegalRecords(companyId, userId, documents, blockers),
    remapFinancialRecords(companyId, userId, documents, blockers),
    remapComplianceRecords(companyId, userId, documents, blockers),
  ]);

  return { expertsLinked, projectsLinked, legalRecordsLinked, financialRecordsLinked, complianceRecordsLinked, blockers };
}