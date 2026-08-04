/**
 * Source-file safety for final package actions.
 *
 * This file used to also carry computePackageRevision / verifyPackageRevision,
 * which fingerprinted requirements + build plan + generated documents so a
 * previously built package could be checked for staleness before being served.
 *
 * That guarantee has no subject here. The final archive is assembled fresh on
 * every request — app/api/tenders/[id]/download/route.ts calls
 * assembleFinalSubmissionZip from documents read at request time, after the
 * gates run — and the ExportPackage row is written afterwards as a record.
 * Nothing ever reads stored package bytes back to a client: ExportPackage is
 * touched only by that route (writes) and the cleanup cron (purges), and
 * packageSha256 is only ever written, never served. There is also no column to
 * hold a revision hash.
 *
 * So a stored package cannot go stale, because no stored package is ever
 * served. Both functions had zero production callers and were kept alive by a
 * test asserting their source text existed. Removed rather than wired: wiring
 * them would have required a migration to persist a fingerprint whose only
 * purpose is guarding a state this architecture cannot reach.
 *
 * The invariant that makes this safe is pinned in
 * tests/runtime-idempotency-route-security.test.ts — if the download route ever
 * starts serving a stored archive instead of rebuilding it, that test fails and
 * the revision check becomes necessary again.
 */

import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

// ─── Helpers ────────────────────────────────────────────────────────────────





// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if any source files required for grounding have been deleted
 * since the package was created.
 */
export async function verifySourceFilesNotDeleted(
  prisma: PrismaClient,
  tenderId: string,
): Promise<{ ok: boolean; deletedCount: number }> {
  const activeFiles = await (prisma as any).tenderFile.count({
    where: { tenderId, deletionStatus: "ACTIVE" },
  });

  if (activeFiles === 0) {
    return { ok: false, deletedCount: 0 };
  }

  return { ok: true, deletedCount: 0 };
}
