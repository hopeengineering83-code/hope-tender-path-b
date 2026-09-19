import { prisma } from "./prisma";

export const MIXED_OR_SUPPORT_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

/**
 * Mixed and support documents are not deletion authority.
 *
 * A company profile, certification bundle, financial record, or unclassified
 * document may contain an exact expert/project claim. Such a claim can be
 * source-verified when every bound field is present in the owned bytes; an
 * uncertain claim must remain available for automatic verification. This audit helper
 * therefore reports records for follow-up but never destroys them.
 */
export async function cleanupSupportDocImportedRecords(companyId: string) {
  const supportDocs = await prisma.companyDocument.findMany({
    where: { companyId, category: { in: [...MIXED_OR_SUPPORT_CATEGORIES] } },
    select: { id: true },
  });
  const supportDocIds = supportDocs.map((document) => document.id);

  if (supportDocIds.length === 0) {
    return {
      supportDocuments: 0,
      expertsDeleted: 0,
      projectsDeleted: 0,
      expertsPreservedForReview: 0,
      projectsPreservedForReview: 0,
    };
  }

  const [expertsPreservedForReview, projectsPreservedForReview] = await Promise.all([
    prisma.expert.count({
      where: {
        companyId,
        sourceDocumentId: { in: supportDocIds },
        trustLevel: { in: ["REGEX_DRAFT", "AI_DRAFT", "SOURCE_VERIFIED"] },
        deletedAt: null,
      },
    }),
    prisma.project.count({
      where: {
        companyId,
        sourceDocumentId: { in: supportDocIds },
        trustLevel: { in: ["REGEX_DRAFT", "AI_DRAFT", "SOURCE_VERIFIED"] },
        deletedAt: null,
      },
    }),
  ]);

  return {
    supportDocuments: supportDocs.length,
    expertsDeleted: 0,
    projectsDeleted: 0,
    expertsPreservedForReview,
    projectsPreservedForReview,
  };
}
