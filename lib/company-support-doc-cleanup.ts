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

export async function cleanupSupportDocImportedRecords(companyId: string) {
  return prisma.$transaction(async (tx) => {
    const supportDocs = await tx.companyDocument.findMany({
      where: { companyId, category: { in: [...SUPPORT_ONLY_CATEGORIES] } },
      select: { id: true, originalFileName: true, category: true },
    });
    const supportDocIds = supportDocs.map((doc) => doc.id);
    const supportFileNames = supportDocs
      .map((doc) => doc.originalFileName)
      .filter((fileName): fileName is string => Boolean(fileName));

    const directExperts = supportDocIds.length > 0
      ? await tx.expert.deleteMany({
          where: { companyId, sourceDocumentId: { in: supportDocIds } },
        })
      : { count: 0 };
    const directProjects = supportDocIds.length > 0
      ? await tx.project.deleteMany({
          where: { companyId, sourceDocumentId: { in: supportDocIds } },
        })
      : { count: 0 };

    let textExperts = 0;
    let textProjects = 0;
    for (const fileName of supportFileNames) {
      const [expertIds, projectIds] = await Promise.all([
        tx.expert.findMany({
          where: { companyId, profile: { contains: fileName, mode: "insensitive" } },
          select: { id: true },
        }),
        tx.project.findMany({
          where: { companyId, summary: { contains: fileName, mode: "insensitive" } },
          select: { id: true },
        }),
      ]);

      if (expertIds.length > 0) {
        textExperts += (await tx.expert.deleteMany({
          where: { companyId, id: { in: expertIds.map((expert) => expert.id) } },
        })).count;
      }
      if (projectIds.length > 0) {
        textProjects += (await tx.project.deleteMany({
          where: { companyId, id: { in: projectIds.map((project) => project.id) } },
        })).count;
      }
    }

    return {
      supportDocuments: supportDocs.length,
      expertsDeleted: directExperts.count + textExperts,
      projectsDeleted: directProjects.count + textProjects,
    };
  });
}
