import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { CalendarClient } from "./calendar-client";

export default async function CalendarPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      deadline: { not: null },
      status: { notIn: ["EXPORTED", "CLOSED"] },
    },
    select: {
      id: true,
      title: true,
      clientName: true,
      status: true,
      deadline: true,
      readinessScore: true,
    },
    orderBy: { deadline: "asc" },
  });

  const items = tenders.map((t) => ({
    id: t.id,
    title: t.title,
    clientName: t.clientName,
    status: t.status,
    deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
    readinessScore: t.readinessScore,
  }));

  return <CalendarClient tenders={items} />;
}
