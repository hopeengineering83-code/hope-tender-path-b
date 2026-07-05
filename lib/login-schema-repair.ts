import type { PrismaClient } from "@prisma/client";

/**
 * Compatibility hook retained for callers while runtime schema repair is removed.
 * Schema changes must be applied only through `prisma migrate deploy`.
 */
export async function repairLoginSchema(client: PrismaClient) {
  await client.$queryRawUnsafe(
    `SELECT "id", "email", "passwordHash", "role", "createdAt", "updatedAt" FROM "User" LIMIT 0`,
  );
}
