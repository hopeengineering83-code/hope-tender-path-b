import type { PrismaClient } from "@prisma/client";

export async function ensureCompanyForUser(client: PrismaClient, userId: string) {
  const existing = await client.company.findUnique({ where: { userId } });
  if (existing) return existing;

  return client.company.create({
    data: {
      name: "Hope Urban Planning Architectural and Engineering Consultancy",
      description: "AI-powered tender proposal generation workspace",
      userId,
    },
  });
}
