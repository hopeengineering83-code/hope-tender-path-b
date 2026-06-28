import { PrismaClient } from "@prisma/client";
import { getTenderReleaseSnapshot, type ReleaseSnapshot } from "./engine/release-snapshot";

export type { ReleaseSnapshot as CanonicalTenderReadiness };

/**
 * Authoritative Tender Readiness Resolver
 *
 * Redirected to use the unified Release Snapshot to ensure Rule 1 consistency.
 */
export async function getCanonicalTenderReadiness(
  client: PrismaClient,
  userId: string,
  tenderId: string
): Promise<ReleaseSnapshot | null> {
  try {
    return await getTenderReleaseSnapshot(client, tenderId, userId);
  } catch (err) {
    console.error("[getCanonicalTenderReadiness] failed:", err);
    return null;
  }
}
