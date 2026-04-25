import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeCompanyKnowledgeGaps, importCompanyKnowledgeFromDocuments } from "../../../../../lib/company-knowledge-import-safe";
import { logAction } from "../../../../../lib/audit";

async function getCompany(userId: string) {
  return prisma.company.findUnique({ where: { userId }, select: { id: true, name: true } });
}

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await getCompany(userId);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const diagnostics = await analyzeCompanyKnowledgeGaps(company.id);
  return NextResponse.json({ diagnostics });
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await getCompany(userId);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const force = body?.force !== false;

  const result = await importCompanyKnowledgeFromDocuments(company.id);

  await logAction({
    userId,
    action: "COMPANY_KNOWLEDGE_REPAIR",
    entityType: "Company",
    entityId: company.id,
    description: `Ran company knowledge repair for ${company.name}: ${result.expertsCreated} experts and ${result.projectsCreated} projects created`,
    metadata: {
      force,
      expertsCreated: result.expertsCreated,
      projectsCreated: result.projectsCreated,
      aiUsed: result.aiUsed,
      aiFailures: result.aiFailures,
    },
  });

  return NextResponse.json({ result });
}
