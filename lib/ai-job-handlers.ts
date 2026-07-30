// Canonical AI job-handler registry.
//
// The historical handler set remains in ai-job-handlers-legacy.ts for the
// non-extraction workflows. EXTRACT_TEXT is deliberately owned by the
// revision-bound background extraction service so upload requests never run
// extraction/OCR and a stale or cross-tenant source cannot be processed.

export * from "./ai-job-handlers-legacy";

import type { JobType } from "./ai-jobs";
import {
  getHandler as getLegacyHandler,
  type JobHandler,
} from "./ai-job-handlers-legacy";
import { runTenderFileExtractionJob } from "./ai-jobs/tender-extraction-service";
import { prepareCompanyVaultForEngine } from "./engine/prepare-company-vault";

export function getHandler(jobType: JobType): JobHandler | null {
  if (jobType === "EXTRACT_TEXT") {
    return runTenderFileExtractionJob as JobHandler;
  }

  const legacyHandler = getLegacyHandler(jobType);
  if (jobType === "ENGINE_RUN" && legacyHandler) {
    return async (ctx) => {
      // Preserve canonical input validation first. A malformed job must fail
      // for its missing tender identifier rather than being masked by a Vault
      // lookup error in test, retry, or operational diagnostics.
      if (!ctx.tenderId) return legacyHandler(ctx);

      // The queue may start well after the HTTP request that created the job.
      // Refresh authority again at execution time so newly repaired records are
      // promoted automatically and records changed after enqueue remain
      // fail-closed rather than using stale verification.
      const preflight = await prepareCompanyVaultForEngine(ctx.userId);
      if (!preflight) throw new Error("Company Vault profile required before Engine execution");
      return legacyHandler(ctx);
    };
  }

  return legacyHandler;
}
