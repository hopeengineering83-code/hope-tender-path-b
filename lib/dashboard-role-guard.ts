import { redirect } from "next/navigation";
import { getSession, type Role } from "./auth";
import { prisma, prismaReady } from "./prisma";

export async function requireDashboardRole(...allowedRoles: Role[]) {
  const userId = await getSession();
  if (!userId) redirect("/login");

  await prismaReady;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) redirect("/login");
  if (!allowedRoles.includes(user.role as Role)) redirect("/dashboard");

  return user;
}
