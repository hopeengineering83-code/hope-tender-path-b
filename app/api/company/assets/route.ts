import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logAction } from "../../../../lib/audit";

const VALID_TYPES = ["LETTERHEAD", "LOGO", "HEADER", "FOOTER", "SIGNATURE", "STAMP"];

export async function GET(_req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ assets: [] });

  const assets = await prisma.companyAsset.findMany({
    where: { companyId: company.id },
    select: {
      id: true, assetType: true, originalFileName: true, mimeType: true,
      size: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file");
  const assetType = (formData.get("assetType") as string | null)?.toUpperCase() ?? "";

  if (!(file instanceof File)) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  if (!VALID_TYPES.includes(assetType)) {
    return NextResponse.json({ error: `assetType must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64Content = buffer.toString("base64");

  // Deactivate any previous asset of the same type
  await prisma.companyAsset.updateMany({
    where: { companyId: company.id, assetType },
    data: { isActive: false },
  });

  const asset = await prisma.companyAsset.create({
    data: {
      companyId: company.id,
      assetType,
      fileName: file.name,
      originalFileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storagePath: "",
      fileContent: base64Content,
      isActive: true,
    },
    select: {
      id: true, assetType: true, originalFileName: true, mimeType: true,
      size: true, isActive: true, createdAt: true,
    },
  });

  await logAction({
    userId,
    action: "COMPANY_ASSET_UPLOAD",
    entityType: "CompanyAsset",
    entityId: asset.id,
    description: `Uploaded ${assetType} asset "${file.name}"`,
    metadata: { assetType, companyId: company.id },
  });

  return NextResponse.json({ success: true, asset });
}

export async function DELETE(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const company = await prisma.company.findUnique({ where: { userId } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const asset = await prisma.companyAsset.findFirst({ where: { id, companyId: company.id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  await prisma.companyAsset.delete({ where: { id } });

  await logAction({
    userId,
    action: "COMPANY_ASSET_DELETE",
    entityType: "CompanyAsset",
    entityId: id,
    description: `Deleted ${asset.assetType} asset "${asset.originalFileName}"`,
  });

  return NextResponse.json({ success: true });
}
