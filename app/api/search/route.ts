import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) return NextResponse.json({ tenders: [], experts: [], projects: [] });

  const [tenders, experts, projects] = await Promise.all([
    prisma.tender.findMany({
      where: {
        userId,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { clientName: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, title: true, clientName: true, status: true, deadline: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.expert.findMany({
      where: {
        company: { userId },
        deletedAt: null,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { disciplines: { contains: q, mode: "insensitive" } },
          { sectors: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, title: true, disciplines: true },
      take: 5,
    }),
    prisma.project.findMany({
      where: {
        company: { userId },
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { clientName: { contains: q, mode: "insensitive" } },
          { sector: { contains: q, mode: "insensitive" } },
          { country: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, clientName: true, sector: true, country: true },
      take: 5,
    }),
  ]);

  return NextResponse.json({ tenders, experts, projects });
}
