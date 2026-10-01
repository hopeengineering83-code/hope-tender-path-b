import {
  reconcileAutomaticRequirementCoverage as reconcileAutomaticRequirementCoverageOnce,
  type AutomaticRequirementCoverageResult,
} from "./automatic-requirement-coverage";

export const AUTOMATIC_REQUIREMENT_COVERAGE_MAX_ATTEMPTS = 3;

export function isRetryableAutomaticCoverageConflict(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "P2002" || code === "P2034" || code === "40001" || code === "40P01") {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("serialization failure")
    || message.includes("write conflict")
    || message.includes("deadlock detected")
    || message.includes("unique constraint");
}

export async function runAutomaticCoverageWithRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, options.attempts ?? AUTOMATIC_REQUIREMENT_COVERAGE_MAX_ATTEMPTS));
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableAutomaticCoverageConflict(error) || attempt === attempts) throw error;
      // P2002/P2034 can occur when the Engine worker and an opened coverage
      // panel reconcile the same derived row simultaneously. The database
      // uniqueness guard remains authoritative; a bounded retry reloads the
      // winning committed row and converges without weakening provenance.
      await wait(25 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Automatic requirement coverage reconciliation failed");
}

export async function reconcileAutomaticRequirementCoverage(
  db: any,
  tenderId: string,
  userId: string,
): Promise<AutomaticRequirementCoverageResult> {
  return runAutomaticCoverageWithRetry(
    () => reconcileAutomaticRequirementCoverageOnce(db, tenderId, userId),
  );
}
