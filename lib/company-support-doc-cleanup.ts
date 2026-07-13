import { prisma } from "./prisma";

export const SUPPORT_ONLY_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

/**
 * Non-reviewable trust levels that may be safely removed during a support-import
 * cleanup. REVIEWED records are preserved because a human has explicitly
 * validated them — even if they were originally derived from a support
 * document, the human review makes them authoritative company facts.
 */
const REMOVABLE_TRUST_LEVELS = ["REGEX_DRAFT", "AI_DRAFT"];

export async function cleanupSupportDocImportedRecords(companyId: string) {
  return prisma.$transaction(async (tx) => {
    const supportDocs = await tx.companyDocument.findMany({
      where: { companyId, category: { in: [...SUPPORT_ONLY_CATEGORIES] } },
      select: { id: true, originalFileName: true, category: true },
    });
    const supportDocIds = supportDocs.map((doc) => doc.id);

    // Authority: sourceDocumentId only. Filename-text matching is NOT a safe
    // deletion authority because a legitimate Expert or Project may mention a
    // support filename in its profile/summary without being derived from that
    // document. Text matching would silently destroy real business data.
    //
    // Additionally, only REGEX_DRAFT and AI_DRAFT records are removed.
    // REVIEWED records are preserved because human review makes them
    // authoritative — a failed import must not undo human-validated facts.
    const directExperts = supportDocIds.length > 0
      ? await tx.expert.deleteMany({
          where: {
            companyId,
            sourceDocumentId: { in: supportDocIds },
            trustLevel: { in: REMOVABLE_TRUST_LEVELS },
          },
        })
      : { count: 0 };
    const directProjects = supportDocIds.length > 0
      ? await tx.project.deleteMany({
          where: {
            companyId,
            sourceDocumentId: { in: supportDocIds },
            trustLevel: { in: REMOVABLE_TRUST_LEVELS },
          },
        })
      : { count: 0 };

    return {
      supportDocuments: supportDocs.length,
      expertsDeleted: directExperts.count,
      projectsDeleted: directProjects.count,
    };
  });
}
