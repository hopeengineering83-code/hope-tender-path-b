import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { ComplianceDashboard } from "./compliance-dashboard";

export default async function CompliancePage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      complianceGaps: { orderBy: [{ isResolved: "asc" }, { severity: "asc" }, { createdAt: "desc" }] },
      requirements: { select: { id: true } },
      complianceMatrix: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return <ComplianceDashboard tenders={tenders} />;
}
