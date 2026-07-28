import { prisma, prismaReady } from "./prisma";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
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
};

const MACHINE_ELIGIBLE_TRUST = ["REGEX_DRAFT", "AI_DRAFT", "SOURCE_VERIFIED"];

function verificationMethod(trustLevel: string | null | undefined): "AI" | "DETERMINISTIC" | "HYBRID" {
  if (trustLevel === "AI_DRAFT") return "AI";
  if (trustLevel === "REGEX_DRAFT") return "DETERMINISTIC";
  return "HYBRID";
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
  const provenance = buildSourceVerificationProvenance({
    recordType: input.recordType,
    sourceDocument: input.sourceDocument,
    fields: input.fields,
    verificationMethod: verificationMethod(input.priorTrustLevel),
  });
  if (!provenance.ok) return provenance;

  return {
    ok: true as const,
    provenance,
    reviewState: {
      trustLevel: "SOURCE_VERIFIED" as const,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: provenance.serialized,
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
    return { expertsVerified: 0, projectsVerified: 0, expertsBlocked: 0, projectsBlocked: 0 };
  }

  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({
      where: {
        companyId,
        deletedAt: null,
        sourceDocumentId: { not: null },
        OR: [
          { trustLevel: { in: MACHINE_ELIGIBLE_TRUST } },
          { trustLevel: "REVIEWED", reviewedBy: "SYSTEM_AUTO_VERIFIED" },
        ],
      },
      select: {
        id: true,
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
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
        OR: [
          { trustLevel: { in: MACHINE_ELIGIBLE_TRUST } },
          { trustLevel: "REVIEWED", reviewedBy: "SYSTEM_AUTO_VERIFIED" },
        ],
      },
      select: {
        id: true,
        companyId: true,
        trustLevel: true,
        reviewedBy: true,
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
        OR: [
          { trustLevel: { in: MACHINE_ELIGIBLE_TRUST } },
          { trustLevel: "REVIEWED", reviewedBy: "SYSTEM_AUTO_VERIFIED" },
        ],
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
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  for (const project of projects) {
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
        OR: [
          { trustLevel: { in: MACHINE_ELIGIBLE_TRUST } },
          { trustLevel: "REVIEWED", reviewedBy: "SYSTEM_AUTO_VERIFIED" },
        ],
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
          verifiedAt: provenance.verifiedAt,
        }),
      },
    });
  }

  return { expertsVerified, projectsVerified, expertsBlocked, projectsBlocked };
}
