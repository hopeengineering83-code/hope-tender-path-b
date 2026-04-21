import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { logAudit } from "../../../../lib/audit";
import { prisma, prismaReady } from "../../../../lib/prisma";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId }, include: { settings: true } });
  if (!company) return NextResponse.json(null);

  if (!company.settings) {
    const settings = await prisma.companySetting.create({
      data: { companyId: company.id },
    });
    return NextResponse.json(settings);
  }

  return NextResponse.json(company.settings);
}

export async function PUT(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId }, include: { settings: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const body = await req.json();
  const settings = await prisma.companySetting.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      brandingEnabled: Boolean(body.brandingEnabled),
      allowLetterheadByDefault: Boolean(body.allowLetterheadByDefault),
      allowSignatureByDefault: Boolean(body.allowSignatureByDefault),
      allowStampByDefault: Boolean(body.allowStampByDefault),
      exportDocxEnabled: Boolean(body.exportDocxEnabled),
      exportPdfEnabled: Boolean(body.exportPdfEnabled),
      exportZipEnabled: Boolean(body.exportZipEnabled),
      aiStrictMode: Boolean(body.aiStrictMode),
    },
    update: {
      brandingEnabled: Boolean(body.brandingEnabled),
      allowLetterheadByDefault: Boolean(body.allowLetterheadByDefault),
      allowSignatureByDefault: Boolean(body.allowSignatureByDefault),
      allowStampByDefault: Boolean(body.allowStampByDefault),
      exportDocxEnabled: Boolean(body.exportDocxEnabled),
      exportPdfEnabled: Boolean(body.exportPdfEnabled),
      exportZipEnabled: Boolean(body.exportZipEnabled),
      aiStrictMode: Boolean(body.aiStrictMode),
    },
  });

  await logAudit({
    userId,
    action: "company_settings_updated",
    entityType: "CompanySetting",
    entityId: settings.id,
  });

  return NextResponse.json(settings);
}
