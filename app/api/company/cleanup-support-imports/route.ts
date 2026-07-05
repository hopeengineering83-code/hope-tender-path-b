import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { logAction } from "../../../../lib/audit";

const SUPPORT_ONLY_CATEGORIES = new Set([
  "COMPANY_PROFILE",
  "LEGAL_REGISTRATION",
  "FINANCIAL_STATEMENT",
  "MANUAL",
  "COMPLIANCE_RECORD",
  "CERTIFICATION",
  "OTHER",
]);

function isSupportOnly(category: string) {
  return SUPPORT_ONLY_CATEGORIES.has(category);
}

export async function POST() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const company = await ensureCompanyForUser(prisma, userId);

  const supportDocs = await prisma.companyDocument.findMany({
    where: { companyId: company.id },
    select: { id: true, originalFileName: true, category: true },
  });
  const supportOnlyDocs = supportDocs.filter((doc) => isSupportOnly(doc.category));
  const supportDocIds = supportOnlyDocs.map((doc) => doc.id);
  const supportFileNames = supportOnlyDocs.map((doc) => doc.originalFileName).filter(Boolean);

  const [directExpertDelete, directProjectDelete] = await Promise.all([
    supportDocIds.length
      ? prisma.expert.deleteMany({ where: { companyId: company.id, sourceDocumentId: { in: supportDocIds } } })
      : Promise.resolve({ count: 0 }),
    supportDocIds.length
      ? prisma.project.deleteMany({ where: { companyId: company.id, sourceDocumentId: { in: supportDocIds } } })
      : Promise.resolve({ count: 0 }),
  ]);

  let profileExpertDeleted = 0;
  let profileProjectDeleted = 0;

  for (const fileName of supportFileNames) {
    const [experts, projects] = await Promise.all([
      prisma.expert.findMany({
        where: {
          companyId: company.id,
          profile: { contains: fileName, mode: "insensitive" },
        },
        select: { id: true },
      }),
      prisma.project.findMany({
        where: {
          companyId: company.id,
          summary: { contains: fileName, mode: "insensitive" },
        },
        select: { id: true },
      }),
    ]);

    if (experts.length > 0) {
      const result = await prisma.expert.deleteMany({ where: { id: { in: experts.map((e) => e.id) } } });
      profileExpertDeleted += result.count;
    }
    if (projects.length > 0) {
      const result = await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
      profileProjectDeleted += result.count;
    }
  }

  const result = {
    success: true,
    supportDocuments: supportOnlyDocs.map((doc) => ({ id: doc.id, fileName: doc.originalFileName, category: doc.category })),
    expertsDeleted: directExpertDelete.count + profileExpertDeleted,
    projectsDeleted: directProjectDelete.count + profileProjectDeleted,
    directExpertsDeleted: directExpertDelete.count,
    directProjectsDeleted: directProjectDelete.count,
    textMatchedExpertsDeleted: profileExpertDeleted,
    textMatchedProjectsDeleted: profileProjectDeleted,
  };

  await logAction({
    userId,
    action: "COMPANY_KNOWLEDGE_REPAIR",
    entityType: "Company",
    entityId: company.id,
    description: `Cleaned support-document imported records: ${result.expertsDeleted} experts, ${result.projectsDeleted} projects deleted`,
    metadata: result,
  });

  return NextResponse.json(result);
}
