import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { readStoredFile } from "../../../../../lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;
  const { id } = await params;

  const pkg = await prisma.exportPackage.findFirst({
    where: { id, tender: { userId } },
  });

  if (!pkg || !pkg.storagePath) {
    return NextResponse.json({ error: "Export package not found" }, { status: 404 });
  }

  const buffer = await readStoredFile(pkg.storagePath);
  const fileName = pkg.name.endsWith(".zip") ? pkg.name : `${pkg.name}.zip`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
}
