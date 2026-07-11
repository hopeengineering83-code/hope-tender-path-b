import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertTenderReadyForGenerationAndExport,
  type GenerationPurpose,
} from "./generation-readiness-gate";
import { computeTenderMutationLockKey } from "./advisory-lock-key";

export class GenerationPersistenceBlockedError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GenerationPersistenceBlockedError";
    this.code = code;
  }
}

/**
 * The only supported wrapper for creating, reactivating, or replacing a
 * GeneratedDocument. It acquires the same tender lock as source revisions and
 * engine/AI promotion, then re-runs the full canonical gate immediately before
 * the caller's write in the still-open transaction.
 */
export async function withTransactionalGenerationGate<T>(args: {
  prisma: PrismaClient;
  tx: Prisma.TransactionClient;
  tenderId: string;
  userId: string;
  purpose: GenerationPurpose;
  write: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<T> {
  const lockKey = computeTenderMutationLockKey(args.tenderId);
  await args.tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  // This intentionally uses the root client while the transaction owns the
  // advisory lock. It reads the latest committed state after all prior source
  // mutations, while the shared lock prevents any new source mutation or
  // engine/AI promotion from racing the following write.
  const gate = await assertTenderReadyForGenerationAndExport({
    prisma: args.prisma,
    tenderId: args.tenderId,
    userId: args.userId,
    purpose: args.purpose,
  });
  if (!gate.ok) {
    throw new GenerationPersistenceBlockedError(
      gate.blockerCode ?? "GENERATION_PERSISTENCE_GATE_BLOCKED",
    );
  }

  return args.write(args.tx);
}
