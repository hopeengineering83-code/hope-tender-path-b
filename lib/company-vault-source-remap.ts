import { prisma } from "./prisma";
import { COMPANY_DOCUMENT_PENDING_DELETE_MARKER } from "./company-document-durable-deletion";
import {
  assessReviewEvidence,
  complianceReviewFields,
  expertReviewFields,
  financialReviewFields,
  legalReviewFields,
  projectReviewFields,
  publicVaultIdentifier,
  type ReviewEvidenceField,
  type ReviewSourceDocument,
} from "./vault-review-provenance";

export type VaultSourceRemapResult = {
  expertsLinked: number;
  projectsLinked: number;
  legalRecordsLinked: number;
  financialRecordsLinked: number;
  complianceRecordsLinked: number;
};

// Draft/regex-imported records that predate a sourceDocument binding (for
// example the Plan-B legacy-data import, which persists uploaded company
// documents but does not always declare which one produced each record) are
// eligible for remap. REVIEWED/SOURCE_VERIFIED records already carry a real
// binding and are left untouched.
const REMAP_ELIGIBLE_TRUST_LEVELS = ["REGEX_DRAFT", "AI_DRAFT"];

async function loadCandidateDocuments(companyId: string): Promise<ReviewSourceDocument[]> {
  return prisma.companyDocument.findMany({
    where: {
      companyId,
      integrityStatus: "VERIFIED",
      NOT: { metadata: { contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER } },
    },
    select: {
      id: true,
      companyId: true,
      extractedText: true,
      contentSha256: true,
      contentByteLength: true,
      integrityStatus: true,
      metadata: true,
    },
  });
}

// Finds an owned, byte-verified document whose extracted text genuinely
// contains every one of the record's claimed field values (the same
// quote-containment check the Review Board's approve action and
// autoVerifyCompanyKnowledge already require) — never a guess, never a
// looser match than the durable-provenance gate itself uses.
function findMatchingDocument(
  documents: ReviewSourceDocument[],
  fields: ReviewEvidenceField[],
): ReviewSourceDocument | null {
  for (const document of documents) {
    if (assessReviewEvidence(document, fields).ok) return document;
  }
  return null;
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

async function remapExperts(companyId: string, userId: string, documents: ReviewSourceDocument[]): Promise<number> {
  const experts = await prisma.expert.findMany({
    where: { companyId, deletedAt: null, sourceDocumentId: null, trustLevel: { in: REMAP_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true },
  });
  let linked = 0;
  for (const expert of experts) {
    const match = findMatchingDocument(documents, expertReviewFields(expert));
    if (!match) continue;
    const updated = await prisma.expert.updateMany({
      where: { id: expert.id, companyId, sourceDocumentId: null },
      data: { sourceDocumentId: match.id },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "EXPERT_SOURCE_REMAPPED", "Expert", expert.id, match.id);
  }
  return linked;
}

async function remapProjects(companyId: string, userId: string, documents: ReviewSourceDocument[]): Promise<number> {
  const projects = await prisma.project.findMany({
    where: { companyId, deletedAt: null, sourceDocumentId: null, trustLevel: { in: REMAP_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, contractValue: true, currency: true },
  });
  let linked = 0;
  for (const project of projects) {
    const match = findMatchingDocument(documents, projectReviewFields(project));
    if (!match) continue;
    const updated = await prisma.project.updateMany({
      where: { id: project.id, companyId, sourceDocumentId: null },
      data: { sourceDocumentId: match.id },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "PROJECT_SOURCE_REMAPPED", "Project", project.id, match.id);
  }
  return linked;
}

async function remapLegalRecords(companyId: string, userId: string, documents: ReviewSourceDocument[]): Promise<number> {
  const records = await prisma.legalRecord.findMany({
    where: { companyId, sourceDocumentId: null, trustLevel: { in: REMAP_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, recordType: true, title: true, authority: true, referenceNumber: true, issueDate: true, expiryDate: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, legalReviewFields(record));
    if (!match) continue;
    const updated = await prisma.legalRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: null },
      data: { sourceDocumentId: match.id },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "LEGAL_RECORD_SOURCE_REMAPPED", "LegalRecord", record.id, match.id);
  }
  return linked;
}

async function remapFinancialRecords(companyId: string, userId: string, documents: ReviewSourceDocument[]): Promise<number> {
  const records = await prisma.financialRecord.findMany({
    where: { companyId, sourceDocumentId: null, trustLevel: { in: REMAP_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, fiscalYear: true, recordType: true, currency: true, amount: true, notes: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, financialReviewFields(record));
    if (!match) continue;
    const updated = await prisma.financialRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: null },
      data: { sourceDocumentId: match.id },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "FINANCIAL_RECORD_SOURCE_REMAPPED", "FinancialRecord", record.id, match.id);
  }
  return linked;
}

async function remapComplianceRecords(companyId: string, userId: string, documents: ReviewSourceDocument[]): Promise<number> {
  const records = await prisma.companyComplianceRecord.findMany({
    where: { companyId, sourceDocumentId: null, trustLevel: { in: REMAP_ELIGIBLE_TRUST_LEVELS } },
    select: { id: true, complianceType: true, title: true, status: true, evidenceSummary: true, referenceNumber: true, expiryDate: true },
  });
  let linked = 0;
  for (const record of records) {
    const match = findMatchingDocument(documents, complianceReviewFields(record));
    if (!match) continue;
    const updated = await prisma.companyComplianceRecord.updateMany({
      where: { id: record.id, companyId, sourceDocumentId: null },
      data: { sourceDocumentId: match.id },
    });
    if (updated.count !== 1) continue;
    linked += 1;
    await auditLink(userId, "COMPLIANCE_RECORD_SOURCE_REMAPPED", "CompanyComplianceRecord", record.id, match.id);
  }
  return linked;
}

// Remaps Expert/Project/Legal/Financial/Compliance drafts that lack a
// sourceDocumentId (for example, records from an import that persisted the
// company's own uploaded documents but never declared which one produced
// each individual record) by searching the company's OWN already-uploaded,
// byte-verified documents for one whose extracted text genuinely contains
// every one of the record's claimed field values. No new document upload is
// required or requested — this only completes the missing link between an
// existing record and the evidence that was already uploaded for it.
//
// This never fabricates evidence: a record with no matching document is left
// untouched (still a draft, still blocked from REVIEWED/SOURCE_VERIFIED).
// Linking sourceDocumentId does not by itself change trustLevel — the caller
// is expected to run source verification (autoVerifyCompanyKnowledge) and/or
// let a human complete review in the Review Board next, exactly the same as
// any other evidence-linked draft.
export async function remapUnlinkedVaultSources(companyId: string): Promise<VaultSourceRemapResult> {
  const empty: VaultSourceRemapResult = { expertsLinked: 0, projectsLinked: 0, legalRecordsLinked: 0, financialRecordsLinked: 0, complianceRecordsLinked: 0 };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { userId: true } });
  if (!company) return empty;

  const documents = await loadCandidateDocuments(companyId);
  if (documents.length === 0) return empty;

  const userId = company.userId;

  const [expertsLinked, projectsLinked, legalRecordsLinked, financialRecordsLinked, complianceRecordsLinked] = await Promise.all([
    remapExperts(companyId, userId, documents),
    remapProjects(companyId, userId, documents),
    remapLegalRecords(companyId, userId, documents),
    remapFinancialRecords(companyId, userId, documents),
    remapComplianceRecords(companyId, userId, documents),
  ]);

  return { expertsLinked, projectsLinked, legalRecordsLinked, financialRecordsLinked, complianceRecordsLinked };
}
