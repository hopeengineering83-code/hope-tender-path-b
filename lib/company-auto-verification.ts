import { prisma, prismaReady } from "./prisma";
import {
  buildReviewProvenance,
  expertReviewFields,
  projectReviewFields,
  publicVaultIdentifier,
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
    const reviewedAt = new Date();
    const provenance = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument: source,
      fields: expertReviewFields(expert),
      reviewerId: "SYSTEM_AUTO_VERIFIED",
      reviewedAt,
    });
    if (!provenance.ok) {
      expertsBlocked += 1;
      continue;
    }

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
        // Auto-review: the user uploads all company documents — the App
        // verifies them against source bytes AND auto-approves them.
        // No human review is required because uploaded documents are the
        // only source of company evidence.
        trustLevel: "REVIEWED",
        reviewedBy: "SYSTEM_AUTO_VERIFIED",
        reviewedAt,
        reviewNotes: provenance.serialized,
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) continue;
    expertsVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "EXPERT_AUTO_REVIEWED",
        entityType: "Expert",
        entityId: expert.id,
        description: "Expert evidence was machine-verified against owned source bytes and auto-approved for use.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(expert.id),
          trustLevel: "REVIEWED",
          reviewedBy: "SYSTEM_AUTO_VERIFIED",
          verificationMethod: verificationMethod(expert.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          evidenceFields: provenance.evidenceFields,
          reviewedAt: reviewedAt.toISOString(),
        }),
      },
    });
  }

  for (const project of projects) {
    const source = project.sourceDocument?.companyId === companyId ? project.sourceDocument : null;
    const reviewedAt = new Date();
    const provenance = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument: source,
      fields: projectReviewFields(project),
      reviewerId: "SYSTEM_AUTO_VERIFIED",
      reviewedAt,
    });
    if (!provenance.ok) {
      projectsBlocked += 1;
      continue;
    }

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
        // Auto-review: the user uploads all company documents — the App
        // verifies them against source bytes AND auto-approves them.
        trustLevel: "REVIEWED",
        reviewedBy: "SYSTEM_AUTO_VERIFIED",
        reviewedAt,
        reviewNotes: provenance.serialized,
        updatedAt: new Date(),
      },
    });
    if (updated.count !== 1) continue;
    projectsVerified += 1;

    await prisma.auditLog.create({
      data: {
        userId: company.userId,
        action: "PROJECT_AUTO_REVIEWED",
        entityType: "Project",
        entityId: project.id,
        description: "Project evidence was machine-verified against owned source bytes and auto-approved for use.",
        metadata: JSON.stringify({
          recordRef: publicVaultIdentifier(project.id),
          trustLevel: "REVIEWED",
          reviewedBy: "SYSTEM_AUTO_VERIFIED",
          verificationMethod: verificationMethod(project.trustLevel),
          sourceContentHash: provenance.sourceContentHash,
          sourceByteLength: provenance.sourceByteLength,
          sourceTextHash: provenance.sourceTextHash,
          evidenceFields: provenance.evidenceFields,
          reviewedAt: reviewedAt.toISOString(),
        }),
      },
    });
  }

  return { expertsVerified, projectsVerified, expertsBlocked, projectsBlocked };
}
