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
  const supportDocs = await prisma.companyDocument.findMany({
    where: { companyId, category: { in: [...SUPPORT_ONLY_CATEGORIES] } },
    select: { id: true, originalFileName: true, category: true },
  });
  const supportDocIds = supportDocs.map((d) => d.id);
  const supportFileNames = supportDocs.map((d) => d.originalFileName).filter(Boolean);

  const [directExperts, directProjects] = await Promise.all([
    supportDocIds.length ? prisma.expert.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
    supportDocIds.length ? prisma.project.deleteMany({ where: { companyId, sourceDocumentId: { in: supportDocIds } } }) : Promise.resolve({ count: 0 }),
  ]);

  let textExperts = 0;
  let textProjects = 0;
  for (const fileName of supportFileNames) {
    const expertIds = await prisma.expert.findMany({ where: { companyId, profile: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    const projectIds = await prisma.project.findMany({ where: { companyId, summary: { contains: fileName, mode: "insensitive" } }, select: { id: true } });
    if (expertIds.length) textExperts += (await prisma.expert.deleteMany({ where: { id: { in: expertIds.map((e) => e.id) } } })).count;
    if (projectIds.length) textProjects += (await prisma.project.deleteMany({ where: { id: { in: projectIds.map((p) => p.id) } } })).count;
  }

  return {
    supportDocuments: supportDocs.length,
    expertsDeleted: directExperts.count + textExperts,
    projectsDeleted: directProjects.count + textProjects,
  };
}
