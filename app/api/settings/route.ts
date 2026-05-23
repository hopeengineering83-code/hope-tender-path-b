import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export async function GET() {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId }, include: { settings: true } });
  if (!company) return NextResponse.json({ settings: null });

  return NextResponse.json({ settings: company.settings });
}

export async function PUT(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const body = await req.json() as Record<string, unknown>;

  const VALID_CURRENCIES = /^[A-Z]{3}$/;
  const VALID_EXPORT_FORMATS = new Set(["DOCX", "PDF"]);
  const VALID_LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;

  const rawCurrency = typeof body.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : "USD";
  const rawFormat = typeof body.exportFormat === "string" ? body.exportFormat.trim().toUpperCase() : "DOCX";
  const rawLanguage = typeof body.language === "string" ? body.language.trim() : "en";

  const data = {
    defaultCurrency: VALID_CURRENCIES.test(rawCurrency) ? rawCurrency : "USD",
    aiStrictMode: typeof body.aiStrictMode === "boolean" ? body.aiStrictMode : true,
    allowBrandingDefault: typeof body.allowBrandingDefault === "boolean" ? body.allowBrandingDefault : true,
    allowSignatureDefault: typeof body.allowSignatureDefault === "boolean" ? body.allowSignatureDefault : true,
    allowStampDefault: typeof body.allowStampDefault === "boolean" ? body.allowStampDefault : true,
    exportFormat: VALID_EXPORT_FORMATS.has(rawFormat) ? rawFormat : "DOCX",
    pageNumbering: typeof body.pageNumbering === "boolean" ? body.pageNumbering : true,
    includeTableOfContents: typeof body.includeTableOfContents === "boolean" ? body.includeTableOfContents : false,
    language: VALID_LANGUAGE.test(rawLanguage) ? rawLanguage : "en",
    updatedAt: new Date(),
  };

  const settings = await prisma.appSettings.upsert({
    where: { companyId: company.id },
    update: data,
    create: { companyId: company.id, ...data },
  });

  return NextResponse.json({ settings });
}
