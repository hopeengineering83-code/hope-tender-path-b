export type PrismaWriteConflictRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (context: { attempt: number; maxAttempts: number; delayMs: number }) => void;
};

/**
 * Prisma reports serializable transaction write conflicts and deadlocks as
 * P2034. The error may cross a server/chunk boundary, so use the stable public
 * error code instead of relying on instanceof identity.
 */
export function isPrismaWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === "P2034";
}

/**
 * Retry a complete transaction from the beginning after a Prisma P2034.
 *
 * Only P2034 is retryable. Every other error is rethrown immediately. The
 * caller must pass a fresh transaction operation so an aborted transaction is
 * never reused.
 */
export async function withPrismaWriteConflictRetry<T>(
  operation: () => Promise<T>,
  options: PrismaWriteConflictRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(5, Math.trunc(options.maxAttempts ?? 3)));
  const baseDelayMs = Math.max(0, Math.min(1_000, Math.trunc(options.baseDelayMs ?? 50)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isPrismaWriteConflict(error) || attempt >= maxAttempts) throw error;

      const delayMs = baseDelayMs * attempt;
      options.onRetry?.({ attempt, maxAttempts, delayMs });
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("Prisma write-conflict retry exhausted unexpectedly");
}
