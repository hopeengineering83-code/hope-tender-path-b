import { prisma, prismaReady } from "./prisma";
import {
  buildSourceVerificationProvenance,
  buildPartialSourceVerificationProvenance,
  isDurablySourceVerified,
  type ReviewRecordState,
  expertReviewFields,
  projectReviewFields,
  legalReviewFields,
  financialReviewFields,
  complianceReviewFields,
  publicVaultIdentifier,
  type ReviewEvidenceField,
  type ReviewRecordType,
  type ReviewSourceDocument,
} from "./vault-review-provenance";

export type AutoVerificationResult = {
  expertsVerified: number;
  projectsVerified: number;
  expertsBlocked: number;
  projectsBlocked: number;
  legalVerified: number;
  legalBlocked: number;
  financialVerified: number;
  financialBlocked: number;
  complianceVerified: number;
  complianceBlocked: number;
};

const MACHINE_ELIGIBLE_TRUST = ["REGEX_DRAFT", "AI_DRAFT", "SOURCE_VERIFIED"];
// Legal/Financial/Compliance records also carry MANUAL_DRAFT — a record the
// owner typed in by hand rather than one extracted from an uploaded document.
// It is machine-eligible on exactly the same terms as the other drafts: it is
// promoted only if its claimed values are actually found in a linked, owned,
// byte-verified source document, and otherwise stays exactly as it is.
const MACHINE_ELIGIBLE_TRUST_SUPPORT = [...MACHINE_ELIGIBLE_TRUST, "MANUAL_DRAFT"];

// Plan B safety: automation never accepts or re-touches REVIEWED rows. The
// trust model gives automatic work exactly one promotion path —
// SOURCE_VERIFIED with `reviewedBy: null, reviewedAt: null`. Any REVIEWED row
// is either a genuine human approval (real `reviewedBy` user id) or a legacy
// fabrication (`reviewedBy: "SYSTEM_AUTO_VERIFIED"`) that the one-shot
// `20260801180000_repair_legacy_fabricated_system_review` migration has
// already converted. Re-matching REVIEWED here would re-introduce the
// original Plan-B leak: automation silently preserving a fabricated
// human-approval state on every ingest pass. The OR branch was removed and
// the migration cleans up the rows once, in PostgreSQL, instead of relying
// on every future ingest to re-write them.

function verificationMethod(trustLevel: string | null | undefined): "AI" | "DETERMINISTIC" | "HYBRID" {
  if (trustLevel === "AI_DRAFT") return "AI";
  if (trustLevel === "REGEX_DRAFT") return "DETERMINISTIC";
  return "HYBRID";
}

/**
 * A record that is ALREADY durably source-verified against the current source
 * bytes and its own current field values needs no further work.
 *
 * This guard matters because SOURCE_VERIFIED is deliberately re-selected on
 * every pass (so that a record whose source later changed gets re-checked),
 * while buildSourceVerificationProvenance() stamps a fresh `verifiedAt` on
 * each call. Without the guard, every ingest re-wrote and re-audited every
 * already-verified record: identical evidence, new timestamp, one more audit
 * row per record per pass, growing without bound. Re-verification still
 * happens for anything whose provenance no longer holds — isDurablySourceVerified
 * returns false the moment the source bytes, extraction revision, or any bound
 * field value stops matching.
 */
function alreadyDurablySourceVerified(record: unknown): boolean {
  return isDurablySourceVerified(record as ReviewRecordState);
}

/**
 * Automatic ingestion may prove that fields are grounded in current, owned
 * source bytes. It cannot manufacture an authenticated human review.
 *
 * Keeping this decision pure makes the authority transition executable in
 * tests and gives every database writer one canonical state payload.
 */
export function deriveAutomaticSourceVerification(input: {
  recordType: ReviewRecordType;
  sourceDocument: ReviewSourceDocument | null | undefined;
  fields: ReviewEvidenceField[];
  priorTrustLevel: string | null | undefined;
}) {
  const method = verificationMethod(input.priorTrustLevel);
  const verifiedAt = new Date();

  const full = buildSourceVerificationProvenance({
    recordType: input.recordType,
    sourceDocument: input.sourceDocument,
    fields: input.fields,
    verificationMethod: method,
    verifiedAt,
  });
  if (full.ok) {
    return {
      ok: true as const,
      provenance: {
        sourceContentHash: full.sourceContentHash,
        sourceByteLength: full.sourceByteLength,
        sourceTextHash: full.sourceTextHash,
        sourceExtractionRevision: full.sourceExtractionRevision,
        evidenceFields: full.evidenceFields,
        unverifiedFields: [] as string[],
        verifiedAt: full.verifiedAt,
        partial: false,
        serialized: full.serialized,
      },
      reviewState: {
        trustLevel: "SOURCE_VERIFIED" as const,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: full.serialized,
      },
    };
  }

  // Full verification requires EVERY field to appear in the source text. Real
  // CVs and certificates routinely fail that on one field — a CV names the
  // expert and the position but never prints a years-of-experience number.
  // Refusing the whole record for that left it AI_DRAFT, which the evidence
  // gate refuses, so the automatic pipeline stopped and the user had to open
  // the record and click approve. That approve button already fell back to
  // partial verification, so the click added no judgement: it just ran the
  // check the automatic pass had declined to run.
  //
  // Partial verification is not a weaker claim, it is a narrower one. The
  // identity field must still be proven or this fails closed exactly as
  // before, the proven fields carry real quote-level evidence, and the
  // unproven ones are recorded by name so they are never treated as
  // authoritative and a field added later cannot pass as verified.
  const partial = buildPartialSourceVerificationProvenance({
    recordType: input.recordType,
    sourceDocument: input.sourceDocument,
    fields: input.fields,
    verificationMethod: method,
    verifiedAt,
  });
  // PartialSourceVerificationResult carries `ok: boolean` rather than a
  // discriminated union, so it cannot narrow a caller's result. Normalize both
  // outcomes here to the shape this function has always returned, so every
  // database writer keeps one canonical payload to switch on.
  if (!partial.ok) {
    return {
      ok: false as const,
      code: partial.code ?? full.code,
      missingFields: partial.unverifiedFields,
    };
  }

  return {
    ok: true as const,
    provenance: {
      sourceContentHash: partial.sourceContentHash ?? "",
      sourceByteLength: partial.sourceByteLength ?? 0,
      sourceTextHash: partial.sourceTextHash ?? "",
      sourceExtractionRevision: partial.sourceExtractionRevision ?? "",
      evidenceFields: partial.verifiedFields,
      unverifiedFields: partial.unverifiedFields,
      verifiedAt: verifiedAt.toISOString(),
      partial: true,
      serialized: partial.serialized ?? "",
    },
    reviewState: {
      trustLevel: "SOURCE_VERIFIED" as const,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: partial.serialized ?? "",
    },
  };
}

export async function autoVerifyCompanyKnowledge(companyId: string): Promise<AutoVerificationResult> {
  await prismaReady;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, userId: true },
  });
  if (!company) {
    return {
      expertsVerified: 0, projectsVerified: 0, expertsBlocked: 0, projectsBlocked: 0,
      legalVerified: 0, legalBlocked: 0, financialVerified: 0, financialBlocked: 0,
      complianceVerified: 0, complianceBlocked: 0,
    };
  }

  const supportSourceDocumentSelect = {
    id: true,
    companyId: true,
    extractedText: true,
    contentSha256: true,
    contentByteLength: true,
    integrityStatus: true,
    metadata: true,
  } as const;

  const supportRecordWhere = {
    companyId,
    sourceDocumentId: { not: null },
    trustLevel: { in: MACHINE_ELIGIBLE_TRUST_SUPPORT },
  } as const;

  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({
      where: {
        companyId,
        deletedAt: null,
        sourceDocumentId: { not: null },
        trustLevel: { in: MACHINE_ELIGIBLE_TRUST },
      },
      select: {
        id: true,
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        fullName: true,
        title: true,
        yearsExperience: true,
        disciplines: true,
        sectors: true,
        certifications: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            metadata: true,
          },
        },
      },
    }),
    prisma.project.findMany({
      where: {
        companyId,
        deletedAt: null,
        sourceDocumentId: { not: null },
        trustLevel: { in: MACHINE_ELIGIBLE_TRUST },
      },
      select: {
        id: true,
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        name: true,
        clientName: true,
        country: true,
        sector: true,
        serviceAreas: true,
        contractValue: true,
        currency: true,
        sourceDocumentId: true,
        sourceDocument: {
          select: {
            id: true,
            companyId: true,
            extractedText: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            metadata: true,
          },
        },
      },
    }),
  ]);

  let expertsVerified = 0;
  let projectsVerified = 0;
  let expertsBlocked = 0;
  let projectsBlocked = 0;

  for (const expert of experts) {
    if (alreadyDurablySourceVerified(expert)) continue;
    const source = expert.sourceDocument?.companyId === companyId ? expert.sourceDocument : null;
    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: source,
      fields: expertReviewFields(expert),
      priorTrustLevel: expert.trustLevel,
    });
    if (!decision.ok) {
      expertsBlocked += 1;
      continue;
    }
    const { provenance } = decision;

    const updated = await prisma.expert.updateMany({
      where: {
        id: expert.id,
        companyId,
        deletedAt: null,
        trustLevel: { in: MACHINE_ELIGIBLE_TRUST },
      },
      data: {
        ...decision.reviewState,
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) continue;
    expertsVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "EXPERT_SOURCE_VERIFIED",
        entityType: "Expert",
        entityId: expert.id,
        description: "Expert evidence was machine-verified against owned source bytes and exact fields.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(expert.id),
          trustLevel: "SOURCE_VERIFIED",
          verificationMethod: verificationMethod(expert.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          sourceExtractionRevision: provenance.sourceExtractionRevision,
          evidenceFields: provenance.evidenceFields,
          // Recorded so the audit says which fields the source did NOT prove.
          // A partially verified record is real evidence for what it proves
          // and nothing at all for what it does not.
          unverifiedFields: provenance.unverifiedFields,
          partialVerification: provenance.partial,
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  for (const project of projects) {
    if (alreadyDurablySourceVerified(project)) continue;
    const source = project.sourceDocument?.companyId === companyId ? project.sourceDocument : null;
    const decision = deriveAutomaticSourceVerification({
      recordType: "PROJECT",
      sourceDocument: source,
      fields: projectReviewFields(project),
      priorTrustLevel: project.trustLevel,
    });
    if (!decision.ok) {
      projectsBlocked += 1;
      continue;
    }
    const { provenance } = decision;

    const updated = await prisma.project.updateMany({
      where: {
        id: project.id,
        companyId,
        deletedAt: null,
        trustLevel: { in: MACHINE_ELIGIBLE_TRUST },
      },
      data: {
        ...decision.reviewState,
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) continue;
    projectsVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "PROJECT_SOURCE_VERIFIED",
        entityType: "Project",
        entityId: project.id,
        description: "Project evidence was machine-verified against owned source bytes and exact fields.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(project.id),
          trustLevel: "SOURCE_VERIFIED",
          verificationMethod: verificationMethod(project.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          sourceExtractionRevision: provenance.sourceExtractionRevision,
          evidenceFields: provenance.evidenceFields,
          // Recorded so the audit says which fields the source did NOT prove.
          // A partially verified record is real evidence for what it proves
          // and nothing at all for what it does not.
          unverifiedFields: provenance.unverifiedFields,
          partialVerification: provenance.partial,
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  // ── Legal / Financial / Compliance support records ──────────────────────
  // These carry the same trustLevel/provenance columns as Expert/Project and
  // are gated by the same canUseVaultRecord() authority, but had no automatic
  // verification path at all — so a company that uploaded its licence,
  // audited accounts and certificates still had to approve each one by hand
  // before generation could use them. They now go through the identical
  // deriveAutomaticSourceVerification() decision: promoted only when their
  // exact claimed values are found in a linked, owned, byte-verified source
  // document, and left untouched otherwise.
  const [legalRecords, financialRecords, complianceRecords] = await Promise.all([
    prisma.legalRecord.findMany({
      where: supportRecordWhere,
      select: {
        id: true, companyId: true, trustLevel: true,
        reviewedBy: true, reviewedAt: true, reviewNotes: true,
        recordType: true, title: true, authority: true, referenceNumber: true,
        issueDate: true, expiryDate: true, sourceDocumentId: true,
        sourceDocument: { select: supportSourceDocumentSelect },
      },
    }),
    prisma.financialRecord.findMany({
      where: supportRecordWhere,
      select: {
        id: true, companyId: true, trustLevel: true,
        reviewedBy: true, reviewedAt: true, reviewNotes: true,
        fiscalYear: true, recordType: true, currency: true, amount: true, notes: true,
        sourceDocumentId: true,
        sourceDocument: { select: supportSourceDocumentSelect },
      },
    }),
    prisma.companyComplianceRecord.findMany({
      where: supportRecordWhere,
      select: {
        id: true, companyId: true, trustLevel: true,
        reviewedBy: true, reviewedAt: true, reviewNotes: true,
        complianceType: true, title: true, status: true, evidenceSummary: true,
        referenceNumber: true, expiryDate: true, sourceDocumentId: true,
        sourceDocument: { select: supportSourceDocumentSelect },
      },
    }),
  ]);

  let legalVerified = 0;
  let legalBlocked = 0;
  let financialVerified = 0;
  let financialBlocked = 0;
  let complianceVerified = 0;
  let complianceBlocked = 0;

  for (const record of legalRecords) {
    if (alreadyDurablySourceVerified(record)) continue;
    const source = record.sourceDocument?.companyId === companyId ? record.sourceDocument : null;
    const decision = deriveAutomaticSourceVerification({
      recordType: "LEGAL",
      sourceDocument: source,
      fields: legalReviewFields(record),
      priorTrustLevel: record.trustLevel,
    });
    if (!decision.ok) { legalBlocked += 1; continue; }
    const { provenance } = decision;

    const updated = await prisma.legalRecord.updateMany({
      where: { id: record.id, companyId, trustLevel: { in: MACHINE_ELIGIBLE_TRUST_SUPPORT } },
      data: { ...decision.reviewState, updatedAt: new Date() },
    });
    if (updated.count !== 1) continue;
    legalVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "LEGAL_RECORD_SOURCE_VERIFIED",
        entityType: "LegalRecord",
        entityId: record.id,
        description: "Legal record evidence was machine-verified against owned source bytes and exact fields.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(record.id),
          trustLevel: "SOURCE_VERIFIED",
          verificationMethod: verificationMethod(record.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          sourceExtractionRevision: provenance.sourceExtractionRevision,
          evidenceFields: provenance.evidenceFields,
          // Recorded so the audit says which fields the source did NOT prove.
          // A partially verified record is real evidence for what it proves
          // and nothing at all for what it does not.
          unverifiedFields: provenance.unverifiedFields,
          partialVerification: provenance.partial,
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  for (const record of financialRecords) {
    if (alreadyDurablySourceVerified(record)) continue;
    const source = record.sourceDocument?.companyId === companyId ? record.sourceDocument : null;
    const decision = deriveAutomaticSourceVerification({
      recordType: "FINANCIAL",
      sourceDocument: source,
      fields: financialReviewFields(record),
      priorTrustLevel: record.trustLevel,
    });
    if (!decision.ok) { financialBlocked += 1; continue; }
    const { provenance } = decision;

    const updated = await prisma.financialRecord.updateMany({
      where: { id: record.id, companyId, trustLevel: { in: MACHINE_ELIGIBLE_TRUST_SUPPORT } },
      data: { ...decision.reviewState, updatedAt: new Date() },
    });
    if (updated.count !== 1) continue;
    financialVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "FINANCIAL_RECORD_SOURCE_VERIFIED",
        entityType: "FinancialRecord",
        entityId: record.id,
        description: "Financial record evidence was machine-verified against owned source bytes and exact fields.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(record.id),
          trustLevel: "SOURCE_VERIFIED",
          verificationMethod: verificationMethod(record.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          sourceExtractionRevision: provenance.sourceExtractionRevision,
          evidenceFields: provenance.evidenceFields,
          // Recorded so the audit says which fields the source did NOT prove.
          // A partially verified record is real evidence for what it proves
          // and nothing at all for what it does not.
          unverifiedFields: provenance.unverifiedFields,
          partialVerification: provenance.partial,
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  for (const record of complianceRecords) {
    if (alreadyDurablySourceVerified(record)) continue;
    const source = record.sourceDocument?.companyId === companyId ? record.sourceDocument : null;
    const decision = deriveAutomaticSourceVerification({
      recordType: "COMPLIANCE",
      sourceDocument: source,
      fields: complianceReviewFields(record),
      priorTrustLevel: record.trustLevel,
    });
    if (!decision.ok) { complianceBlocked += 1; continue; }
    const { provenance } = decision;

    const updated = await prisma.companyComplianceRecord.updateMany({
      where: { id: record.id, companyId, trustLevel: { in: MACHINE_ELIGIBLE_TRUST_SUPPORT } },
      data: { ...decision.reviewState, updatedAt: new Date() },
    });
    if (updated.count !== 1) continue;
    complianceVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "COMPLIANCE_RECORD_SOURCE_VERIFIED",
        entityType: "CompanyComplianceRecord",
        entityId: record.id,
        description: "Compliance record evidence was machine-verified against owned source bytes and exact fields.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(record.id),
          trustLevel: "SOURCE_VERIFIED",
          verificationMethod: verificationMethod(record.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          sourceExtractionRevision: provenance.sourceExtractionRevision,
          evidenceFields: provenance.evidenceFields,
          // Recorded so the audit says which fields the source did NOT prove.
          // A partially verified record is real evidence for what it proves
          // and nothing at all for what it does not.
          unverifiedFields: provenance.unverifiedFields,
          partialVerification: provenance.partial,
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  return {
    expertsVerified, projectsVerified, expertsBlocked, projectsBlocked,
    legalVerified, legalBlocked, financialVerified, financialBlocked,
    complianceVerified, complianceBlocked,
  };
}
