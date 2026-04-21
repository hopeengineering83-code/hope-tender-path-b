import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { TenderDetail } from "./tender-detail";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { documents: { orderBy: { createdAt: "desc" } } },
  });

  if (!tender) notFound();

  return <TenderDetail tender={tender} />;
}
