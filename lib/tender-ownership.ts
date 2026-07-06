import { prisma, prismaReady } from "./prisma";
import type { Role } from "./auth";

/**
 * Enforces strict two-tier ownership lookup for tender mutations.
 * - First checks if the actor is the owner of the tender.
 * - If owner lookup fails, ONLY an ADMIN may fall back to a global lookup.
 * - PROPOSAL_MANAGER (or any other role) MUST NEVER access another user's tender.
 */
export async function requireTenderAccess(tenderId: string, actorId: string, actorRole: Role | string) {
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actorId }, select: { id: true } });
  if (tender) return tender;

  if (actorRole !== "ADMIN") {
    return null; // Cross-tenant access blocked
  }

  return prisma.tender.findFirst({ where: { id: tenderId }, select: { id: true } });
}
