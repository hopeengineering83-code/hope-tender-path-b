import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { logAction } from "../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractRequestId } from "../../../../lib/request-id";

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

type CleanupResult = {
  success: true;
  supportDocuments: Array<{ id: string; fileName: string; category: string }>;
  expertsDeleted: number;
  projectsDeleted: number;
  directExpertsDeleted: number;
  directProjectsDeleted: number;
  textMatchedExpertsDeleted: number;
  textMatchedProjectsDeleted: number;
};

export async function POST(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`cleanup-support:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const result = await prisma.$transaction(async (tx): Promise<CleanupResult> => {
      const supportDocs = await tx.companyDocument.findMany({
        where: { companyId: company.id },
        select: { id: true, originalFileName: true, category: true },
      });
      const supportOnlyDocs = supportDocs.filter((doc) => isSupportOnly(doc.category));
      const supportDocIds = supportOnlyDocs.map((doc) => doc.id);
      const supportFileNames = supportOnlyDocs
        .map((doc) => doc.originalFileName)
        .filter((fileName): fileName is string => Boolean(fileName));

      const directExpertDelete = supportDocIds.length > 0
        ? await tx.expert.deleteMany({
            where: { companyId: company.id, sourceDocumentId: { in: supportDocIds } },
          })
        : { count: 0 };
      const directProjectDelete = supportDocIds.length > 0
        ? await tx.project.deleteMany({
            where: { companyId: company.id, sourceDocumentId: { in: supportDocIds } },
          })
        : { count: 0 };

      let profileExpertDeleted = 0;
      let profileProjectDeleted = 0;

      for (const fileName of supportFileNames) {
        const [experts, projects] = await Promise.all([
          tx.expert.findMany({
            where: {
              companyId: company.id,
              profile: { contains: fileName, mode: "insensitive" },
            },
            select: { id: true },
          }),
          tx.project.findMany({
            where: {
              companyId: company.id,
              summary: { contains: fileName, mode: "insensitive" },
            },
            select: { id: true },
          }),
        ]);

        if (experts.length > 0) {
          const deleted = await tx.expert.deleteMany({
            where: {
              companyId: company.id,
              id: { in: experts.map((expert) => expert.id) },
            },
          });
          profileExpertDeleted += deleted.count;
        }
        if (projects.length > 0) {
          const deleted = await tx.project.deleteMany({
            where: {
              companyId: company.id,
              id: { in: projects.map((project) => project.id) },
            },
          });
          profileProjectDeleted += deleted.count;
        }
      }

      return {
        success: true,
        supportDocuments: supportOnlyDocs.map((doc) => ({
          id: doc.id,
          fileName: doc.originalFileName,
          category: doc.category,
        })),
        expertsDeleted: directExpertDelete.count + profileExpertDeleted,
        projectsDeleted: directProjectDelete.count + profileProjectDeleted,
        directExpertsDeleted: directExpertDelete.count,
        directProjectsDeleted: directProjectDelete.count,
        textMatchedExpertsDeleted: profileExpertDeleted,
        textMatchedProjectsDeleted: profileProjectDeleted,
      };
    });

    void logAction({
      userId: actor.id,
      action: "COMPANY_KNOWLEDGE_REPAIR",
      entityType: "Company",
      entityId: company.id,
      description: `Cleaned support-document imported records: ${result.expertsDeleted} experts, ${result.projectsDeleted} projects deleted`,
      metadata: result,
      requestId,
    }).catch((error) => {
      logger.warn("cleanup-support-imports audit persistence failed", {
        requestId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error("cleanup-support-imports failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error: "Support-import cleanup failed. Retry or contact support with the request ID.",
        code: "SUPPORT_IMPORT_CLEANUP_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
